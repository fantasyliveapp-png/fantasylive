/**
 * IDIOMAS DE LA INTERFAZ
 *
 * No hay prefijo de ruta (/es, /en): el idioma vive en una cookie y, si no
 * hay, se deduce de Accept-Language. Asi una URL compartida se ve en el idioma
 * de quien la abre, no en el de quien la pego, y no hay que duplicar el arbol
 * de rutas ni regenerar enlaces internos.
 */

export const LOCALES = ['es', 'en'] as const;

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'es';

/** Nombre de cada idioma en su propio idioma (asi lo reconoce quien lo busca). */
export const LOCALE_LABELS: Record<Locale, string> = {
  es: 'Espanol',
  en: 'English',
};

export const LOCALE_FLAGS: Record<Locale, string> = {
  es: '\u{1F1EA}\u{1F1F8}',
  en: '\u{1F1EC}\u{1F1E7}',
};

/** Nombre de la cookie donde se guarda la eleccion explicita del visitante. */
export const LOCALE_COOKIE = 'fl_locale';

/** Un ano: la eleccion de idioma no deberia caducar entre visitas. */
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/**
 * Mejor idioma disponible segun una cabecera Accept-Language.
 *
 * Compara solo la parte del idioma ("en-GB" -> "en") y respeta el orden de
 * calidad (q=) que manda el navegador. Devuelve null si no coincide ninguno,
 * para que quien llame decida el fallback.
 */
export function matchLocaleFromAcceptLanguage(
  header: string | null | undefined,
): Locale | null {
  if (!header) return null;

  const candidates = header
    .split(',')
    .map((part) => {
      const [tag, ...params] = part.trim().split(';');
      const q = params
        .map((p) => p.trim())
        .find((p) => p.startsWith('q='));
      const quality = q ? Number(q.slice(2)) : 1;
      return {
        language: (tag ?? '').trim().toLowerCase().split('-')[0] ?? '',
        quality: Number.isFinite(quality) ? quality : 0,
      };
    })
    .filter((c) => c.language && c.quality > 0)
    .sort((a, b) => b.quality - a.quality);

  for (const candidate of candidates) {
    if (isLocale(candidate.language)) return candidate.language;
  }
  return null;
}
