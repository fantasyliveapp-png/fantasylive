import 'server-only';

import { createHash } from 'node:crypto';
import { headers } from 'next/headers';

import { countryName } from '@/lib/countries';
import { getClientIp, getViewerCountry } from '@/lib/geo';

/**
 * Desde donde se hace una peticion (para los correos de seguridad):
 * dispositivo, navegador, IP y pais aproximado. Nunca lanza.
 */
export type RequestInfo = {
  device: string;
  browser: string;
  ip: string | null;
  country: string | null;
  location: string;
  /** Hash estable de sistema + navegador: identifica "el mismo dispositivo". */
  deviceKey: string;
};

function parseUserAgent(ua: string) {
  const os = /iPhone/.test(ua)
    ? 'iPhone'
    : /iPad/.test(ua)
      ? 'iPad'
      : /Android/.test(ua)
        ? 'Android'
        : /Mac OS X|Macintosh/.test(ua)
          ? 'Mac'
          : /Windows/.test(ua)
            ? 'Windows'
            : /CrOS/.test(ua)
              ? 'Chromebook'
              : /Linux/.test(ua)
                ? 'Linux'
                : 'Dispositivo desconocido';
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\/|Opera/.test(ua)
      ? 'Opera'
      : /SamsungBrowser/.test(ua)
        ? 'Samsung Internet'
        : /Firefox\/|FxiOS/.test(ua)
          ? 'Firefox'
          : /Chrome\/|CriOS/.test(ua)
            ? 'Chrome'
            : /Safari\//.test(ua)
              ? 'Safari'
              : 'Navegador desconocido';
  return { os, browser };
}

export async function getRequestInfo(): Promise<RequestInfo> {
  try {
    const h = await headers();
    const ua = h.get('user-agent') ?? '';
    const { os, browser } = parseUserAgent(ua);
    const ip = getClientIp(h);
    const country = await getViewerCountry();
    return {
      device: `${browser} en ${os}`,
      browser,
      ip,
      country,
      location: country ? countryName(country) : 'Desconocida',
      deviceKey: createHash('sha256').update(`${os}|${browser}`).digest('hex').slice(0, 32),
    };
  } catch {
    return {
      device: 'Dispositivo desconocido',
      browser: 'Navegador desconocido',
      ip: null,
      country: null,
      location: 'Desconocida',
      deviceKey: 'unknown',
    };
  }
}
