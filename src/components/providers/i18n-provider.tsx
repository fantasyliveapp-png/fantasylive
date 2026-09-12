'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';

import { createTranslator, type Translate } from '@/lib/i18n';
import { DEFAULT_LOCALE, type Locale } from '@/lib/i18n/locales';

interface I18nValue {
  locale: Locale;
  t: Translate;
}

const I18nContext = createContext<I18nValue | null>(null);

/**
 * Expone el idioma resuelto en servidor a los componentes de cliente.
 *
 * Solo viaja el codigo de idioma, no el diccionario: los diccionarios son
 * modulos estaticos y el bundler ya los incluye, asi que mandarlos por props
 * duplicaria varios KB en cada peticion.
 */
export function I18nProvider({
  locale,
  children,
}: {
  locale: Locale;
  children: ReactNode;
}) {
  const value = useMemo<I18nValue>(
    () => ({ locale, t: createTranslator(locale) }),
    [locale],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/**
 * Traductor en cliente. Si alguien renderiza fuera del provider devuelve el
 * idioma por defecto en vez de lanzar: un componente suelto en un test o en
 * un portal no deberia romper la pagina.
 */
export function useI18n(): I18nValue {
  const context = useContext(I18nContext);
  if (context) return context;
  return { locale: DEFAULT_LOCALE, t: createTranslator(DEFAULT_LOCALE) };
}

/** Atajo cuando solo hace falta `t`. */
export function useTranslate(): Translate {
  return useI18n().t;
}
