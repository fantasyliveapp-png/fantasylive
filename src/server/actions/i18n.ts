'use server';

import { cookies } from 'next/headers';

import {
  LOCALE_COOKIE,
  LOCALE_COOKIE_MAX_AGE,
  isLocale,
} from '@/lib/i18n/locales';

/**
 * Guarda el idioma elegido.
 *
 * No es una cookie de sesion ni lleva datos personales, asi que no necesita
 * el prefijo __Host-; si lo llevara, dejaria de funcionar en el desarrollo
 * local sobre http.
 */
export async function setLocaleAction(locale: string): Promise<{ ok: boolean }> {
  if (!isLocale(locale)) return { ok: false };

  const cookieStore = await cookies();
  cookieStore.set(LOCALE_COOKIE, locale, {
    path: '/',
    maxAge: LOCALE_COOKIE_MAX_AGE,
    sameSite: 'lax',
    httpOnly: false,
  });

  return { ok: true };
}
