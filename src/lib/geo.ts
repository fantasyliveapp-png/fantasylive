import 'server-only';

import { headers } from 'next/headers';
import type { Prisma } from '@prisma/client';

import { config } from '@/lib/config';
import { normalizeCountryCode } from '@/lib/countries';

/**
 * Resolucion del pais de quien visita, para el bloqueo geografico que cada
 * modelo configura en /dashboard/model/privacy.
 *
 * ORDEN DE CONFIANZA (de mas a menos fiable):
 *   1. GEO_OVERRIDE_COUNTRY .......... solo desarrollo/QA.
 *   2. Cabeceras de CDN/proxy ........ cf-ipcountry, x-vercel-ip-country, ...
 *   3. GeoIP local sobre la IP ....... geoip-lite (base MaxMind embebida).
 *
 * SEGURIDAD: las cabeceras las puede falsificar cualquier cliente si llegan
 * directas a la app. Solo se leen cuando `GEO_TRUST_PROXY_HEADERS=true`, que
 * unicamente debe activarse si hay un proxy delante que las SOBRESCRIBE (el
 * nginx que desplegamos hace exactamente eso, ver deploy/nginx.conf).
 */

const PROXY_COUNTRY_HEADERS = [
  'cf-ipcountry', // Cloudflare
  'x-vercel-ip-country', // Vercel
  'x-geo-country', // nginx + modulo GeoIP2
  'x-country-code', // generico
] as const;

/**
 * IP real del cliente.
 *
 * `x-real-ip` es la fuente preferida porque nginx la fija SIEMPRE a
 * `$remote_addr`, machacando lo que mandase el cliente. `x-forwarded-for` solo
 * se usa como respaldo: al construirse por concatenacion, las entradas de la
 * izquierda son las que el cliente controla, asi que se cuenta desde la
 * DERECHA tantos saltos de confianza como proxies haya delante.
 */
export function getClientIp(headerList: Headers): string | null {
  const realIp = headerList.get('x-real-ip')?.trim();
  if (realIp) return stripPort(realIp);

  const forwarded = headerList.get('x-forwarded-for');
  if (!forwarded) return null;

  const chain = forwarded
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  if (chain.length === 0) return null;

  // hops = numero de proxies de confianza delante de la app.
  const index = chain.length - Math.max(1, config.geo.trustedProxyHops);
  return stripPort(chain[Math.max(0, index)]!);
}

function stripPort(ip: string): string {
  // IPv4 con puerto (1.2.3.4:5678). Las IPv6 llevan ":" de serie: se dejan.
  const match = /^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/.exec(ip);
  return match ? match[1]! : ip;
}

// --- GeoIP local (opcional) ------------------------------------------------
// geoip-lite embebe una base MaxMind y funciona sin red. Se carga de forma
// perezosa y tolerante: si no esta instalada, el resto de la cadena sigue.

type GeoLookup = (ip: string) => { country?: string } | null;

let geoipLoader: Promise<GeoLookup | null> | null = null;

function loadGeoip(): Promise<GeoLookup | null> {
  geoipLoader ??= import('geoip-lite')
    .then((mod) => {
      const lookup = (mod as unknown as { default?: { lookup?: GeoLookup }; lookup?: GeoLookup });
      return lookup.lookup ?? lookup.default?.lookup ?? null;
    })
    .catch(() => null);
  return geoipLoader;
}

async function countryFromIp(ip: string | null): Promise<string | null> {
  if (!ip) return null;
  const lookup = await loadGeoip();
  if (!lookup) return null;
  try {
    return normalizeCountryCode(lookup(ip)?.country);
  } catch {
    return null;
  }
}

/**
 * Pais ISO-3166 alpha-2 de quien visita, o null si no se puede determinar.
 * Nunca lanza: un fallo de geolocalizacion no debe tumbar una pagina.
 */
export async function getViewerCountry(): Promise<string | null> {
  try {
    if (config.geo.overrideCountry) return config.geo.overrideCountry;

    const headerList = await headers();

    if (config.geo.trustProxyHeaders) {
      for (const name of PROXY_COUNTRY_HEADERS) {
        const value = normalizeCountryCode(headerList.get(name));
        // Cloudflare manda "XX" cuando no sabe el pais: normalize ya lo filtra.
        if (value) return value;
      }
    }

    return await countryFromIp(getClientIp(headerList));
  } catch {
    return null;
  }
}

// --- Reglas de bloqueo -----------------------------------------------------

/** True si un perfil con esa lista de bloqueos no debe verse desde `country`. */
export function isCountryBlocked(
  blockedCountries: readonly string[] | null | undefined,
  country: string | null | undefined,
): boolean {
  if (!country || !blockedCountries || blockedCountries.length === 0) {
    return false;
  }
  return blockedCountries.includes(country.toUpperCase());
}

/**
 * Fragmento de `where` de Prisma que excluye los perfiles que bloquean ese
 * pais. Devuelve `{}` si no hay pais conocido, para no ocultar nada de mas.
 */
export function countryVisibilityFilter(
  country: string | null | undefined,
): Prisma.ModelProfileWhereInput {
  if (!country) return {};
  return { NOT: { blockedCountries: { has: country.toUpperCase() } } };
}

/**
 * Atajo para paginas de catalogo: resuelve el pais y devuelve el filtro.
 * Devuelve tambien el pais para poder mostrarlo/registrarlo si hace falta.
 */
export async function getVisibilityContext(): Promise<{
  country: string | null;
  filter: Prisma.ModelProfileWhereInput;
}> {
  const country = await getViewerCountry();
  return { country, filter: countryVisibilityFilter(country) };
}

/**
 * Version para server actions y rutas de API: true si ese perfil no debe
 * atender a quien hace la peticion.
 *
 * Corta antes de resolver el pais cuando el perfil no bloquea nada, que es el
 * caso normal: asi la geolocalizacion solo se calcula cuando de verdad importa.
 */
export async function isBlockedForViewer(
  blockedCountries: readonly string[] | null | undefined,
): Promise<boolean> {
  if (!blockedCountries || blockedCountries.length === 0) return false;
  return isCountryBlocked(blockedCountries, await getViewerCountry());
}

/** Mensaje unico para todas las respuestas de bloqueo geografico. */
export const GEO_BLOCKED_MESSAGE =
  'Esta creadora no esta disponible en tu pais.';
