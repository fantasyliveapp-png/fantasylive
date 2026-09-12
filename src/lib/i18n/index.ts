import { en } from '@/lib/i18n/dictionaries/en';
import { es, type Dictionary } from '@/lib/i18n/dictionaries/es';
import { DEFAULT_LOCALE, type Locale } from '@/lib/i18n/locales';

export type { Dictionary };
export * from '@/lib/i18n/locales';

const DICTIONARIES: Record<Locale, Dictionary> = { es, en };

export function getDictionary(locale: Locale): Dictionary {
  return DICTIONARIES[locale] ?? DICTIONARIES[DEFAULT_LOCALE];
}

/**
 * Rutas validas del diccionario ("nav.feed", "live.viewers"...).
 *
 * Se calculan con tipos en vez de aceptar `string` para que una clave mal
 * escrita sea un error de compilacion y no un hueco en la interfaz.
 */
type Leaves<T> = {
  [K in keyof T & string]: T[K] extends string
    ? K
    : `${K}.${Leaves<T[K]>}`;
}[keyof T & string];

export type TranslationKey = Leaves<Dictionary>;

export type TranslateParams = Record<string, string | number>;

/** Funcion de traduccion con interpolacion de `{parametros}`. */
export type Translate = (key: TranslationKey, params?: TranslateParams) => string;

function lookup(dictionary: Dictionary, key: string): string | undefined {
  let current: unknown = dictionary;
  for (const segment of key.split('.')) {
    if (typeof current !== 'object' || current === null) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return typeof current === 'string' ? current : undefined;
}

/**
 * Construye la funcion `t` de un idioma.
 *
 * Si falta la clave en el idioma activo cae al espanol, y si tampoco esta
 * devuelve la propia clave: preferimos ver "live.viewers" en pantalla (que
 * delata el error de inmediato) antes que un hueco en blanco.
 */
export function createTranslator(locale: Locale): Translate {
  const dictionary = getDictionary(locale);

  return (key, params) => {
    const template = lookup(dictionary, key) ?? lookup(es, key) ?? key;
    if (!params) return template;

    return template.replace(/\{(\w+)\}/g, (match, name: string) =>
      name in params ? String(params[name]) : match,
    );
  };
}
