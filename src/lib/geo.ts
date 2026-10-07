import 'server-only';

import { cache } from 'react';
import { headers } from 'next/headers';
import type { Prisma } from '@prisma/client';

import { config } from '@/lib/config';
import { normalizeCountryCode } from '@/lib/countries';
import { prisma } from '@/lib/prisma';
import { isVpnIp } from '@/lib/vpn';

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

// --- Bloqueo con memoria y VPN ------------------------------------------------
//
// Con una VPN cualquiera aparenta estar en otro pais. Para que el bloqueo por
// paises no se salte tan facil, se tienen en cuenta tres cosas ademas del pais
// de la conexion:
//  - los paises desde los que esa cuenta se ha conectado ALGUNA VEZ sin VPN
//    (User.seenCountries): quien vive en un pais casi siempre entra alguna vez
//    sin VPN, y desde entonces queda bloqueado aunque despues la use;
//  - los paises de sus medios de pago (User.paymentCountries);
//  - si la conexion viene de una VPN conocida: entonces no se le muestra ningun
//    perfil que bloquee algun pais (no se sabe de donde es de verdad).

/** Lo que se sabe de quien visita para decidir los bloqueos por pais. */
export type ViewerGeo = {
  /** Pais de la conexion actual (falso si viene por VPN). */
  country: string | null;
  /** Paises que cuentan para bloquear: actual (sin VPN), historicos y de pago. */
  countries: string[];
  /** La conexion viene de un servicio VPN conocido. */
  vpn: boolean;
};

const MAX_REMEMBERED = 30;

/** Apunta un pais desde el que se ha conectado la cuenta (sin VPN). Nunca lanza. */
export async function rememberViewerCountry(userId: string, country: string | null | undefined) {
  const code = normalizeCountryCode(country);
  if (!code) return;
  try {
    await prisma.$executeRaw`
      UPDATE "users" SET "seenCountries" = array_append(coalesce("seenCountries", ARRAY[]::text[]), ${code})
      WHERE "id" = ${userId}
        AND NOT (${code} = ANY(coalesce("seenCountries", ARRAY[]::text[])))
        AND coalesce(array_length("seenCountries", 1), 0) < ${MAX_REMEMBERED}`;
  } catch (error) {
    console.error('[geo] no se pudo apuntar el pais visto', error);
  }
}

/** Apunta el pais del medio de pago de una compra. Nunca lanza. */
export async function recordPaymentCountry(userId: string, country: string | null | undefined) {
  const code = normalizeCountryCode(country);
  if (!code) return;
  try {
    await prisma.$executeRaw`
      UPDATE "users" SET "paymentCountries" = array_append(coalesce("paymentCountries", ARRAY[]::text[]), ${code})
      WHERE "id" = ${userId}
        AND NOT (${code} = ANY(coalesce("paymentCountries", ARRAY[]::text[])))
        AND coalesce(array_length("paymentCountries", 1), 0) < ${MAX_REMEMBERED}`;
  } catch (error) {
    console.error('[geo] no se pudo apuntar el pais del pago', error);
  }
}

/** IP de quien hace la peticion, o null fuera de una peticion. */
async function requestIp(): Promise<string | null> {
  try {
    return getClientIp(await headers());
  } catch {
    return null;
  }
}

/**
 * Pais, paises recordados y VPN de quien visita. Una vez por peticion.
 * De paso apunta el pais actual en la cuenta si es nuevo y no hay VPN.
 */
export const getViewerGeo = cache(async (): Promise<ViewerGeo> => {
  const [country, ip] = await Promise.all([getViewerCountry(), requestIp()]);
  const vpn = await isVpnIp(ip);
  const countries = new Set<string>();
  if (country && !vpn) countries.add(country);

  let userId: string | null = null;
  try {
    // Import dinamico: auth -> correos -> geo formaria un ciclo de imports.
    const { getCurrentUser } = await import('@/lib/auth/guards');
    userId = (await getCurrentUser())?.id ?? null;
  } catch {
    userId = null;
  }
  if (userId) {
    const user = await prisma.user
      .findUnique({ where: { id: userId }, select: { seenCountries: true, paymentCountries: true } })
      .catch(() => null);
    for (const c of user?.seenCountries ?? []) countries.add(c);
    for (const c of user?.paymentCountries ?? []) countries.add(c);
    if (country && !vpn && !(user?.seenCountries ?? []).includes(country)) {
      void rememberViewerCountry(userId, country);
    }
  }
  return { country, countries: [...countries], vpn };
});

/** true si un perfil con esos bloqueos no debe verse para ese visitante. */
export function isBlockedFor(
  blockedCountries: readonly string[] | null | undefined,
  geo: Pick<ViewerGeo, 'countries' | 'vpn'>,
): boolean {
  if (!blockedCountries || blockedCountries.length === 0) return false;
  if (geo.vpn) return true;
  return geo.countries.some((c) => blockedCountries.includes(c.toUpperCase()));
}

/** Filtro de Prisma para catalogos: oculta los perfiles que bloquean a ese visitante. */
export function viewerVisibilityFilter(geo: Pick<ViewerGeo, 'countries' | 'vpn'>): Prisma.ModelProfileWhereInput {
  if (geo.vpn) return { blockedCountries: { isEmpty: true } };
  if (geo.countries.length === 0) return {};
  return { NOT: { blockedCountries: { hasSome: geo.countries.map((c) => c.toUpperCase()) } } };
}

/**
 * Atajo para paginas de catalogo: resuelve el visitante y devuelve el filtro.
 * Devuelve tambien el pais para poder mostrarlo/registrarlo si hace falta.
 */
export async function getVisibilityContext(): Promise<{
  country: string | null;
  filter: Prisma.ModelProfileWhereInput;
}> {
  const geo = await getViewerGeo();
  return { country: geo.country, filter: viewerVisibilityFilter(geo) };
}

/**
 * Version para server actions, paginas y rutas de API: true si ese perfil no
 * debe atender a quien hace la peticion.
 *
 * Corta antes de resolver nada cuando el perfil no bloquea ningun pais, que
 * es el caso normal.
 */
export async function isBlockedForViewer(
  blockedCountries: readonly string[] | null | undefined,
): Promise<boolean> {
  if (!blockedCountries || blockedCountries.length === 0) return false;
  return isBlockedFor(blockedCountries, await getViewerGeo());
}

/** Mensaje unico para todas las respuestas de bloqueo geografico. */
export const GEO_BLOCKED_MESSAGE =
  'Este perfil no esta disponible en tu pais.';
