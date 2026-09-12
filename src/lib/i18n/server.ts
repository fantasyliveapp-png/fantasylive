import 'server-only';

import { cookies, headers } from 'next/headers';

import { config } from '@/lib/config';
import { createTranslator, type Translate } from '@/lib/i18n';
import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  isLocale,
  matchLocaleFromAcceptLanguage,
  type Locale,
} from '@/lib/i18n/locales';

/**
 * Idioma del visitante, por orden de preferencia:
 *
 *   1. Cookie `fl_locale`: eleccion explicita, manda siempre.
 *   2. Accept-Language del navegador.
 *   3. NEXT_PUBLIC_DEFAULT_LOCALE / espanol.
 *
 * Nunca lanza: un fallo leyendo cabeceras no debe tumbar una pagina, solo
 * dejarla en el idioma por defecto.
 */
export async function getLocale(): Promise<Locale> {
  try {
    const cookieStore = await cookies();
    const fromCookie = cookieStore.get(LOCALE_COOKIE)?.value;
    if (isLocale(fromCookie)) return fromCookie;

    const headerList = await headers();
    const fromHeader = matchLocaleFromAcceptLanguage(
      headerList.get('accept-language'),
    );
    if (fromHeader) return fromHeader;
  } catch {
    // Contexto sin peticion (build estatico): cae al idioma por defecto.
  }

  return isLocale(config.i18n.defaultLocale)
    ? config.i18n.defaultLocale
    : DEFAULT_LOCALE;
}

/** `t` del idioma del visitante, para componentes de servidor. */
export async function getT(): Promise<Translate> {
  return createTranslator(await getLocale());
}

/** Idioma + traductor de una vez, cuando hacen falta los dos. */
export async function getI18n(): Promise<{ locale: Locale; t: Translate }> {
  const locale = await getLocale();
  return { locale, t: createTranslator(locale) };
}
