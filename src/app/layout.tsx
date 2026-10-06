import type { Metadata, Viewport } from 'next';
import { cookies } from 'next/headers';
import { Toaster } from 'sonner';

import { AgeGate } from '@/components/age-gate';
import { InstallApp } from '@/components/pwa/install-app';
import { PushPrompt } from '@/components/pwa/push';
import { AuthProvider } from '@/components/providers/auth-provider';
import { AGE_COOKIE } from '@/lib/age-gate';
import { I18nProvider } from '@/components/providers/i18n-provider';
import { JoinPromptProvider } from '@/components/providers/join-prompt';
import { config } from '@/lib/config';
import { fontVariables } from '@/lib/fonts';
import { getLocale } from '@/lib/i18n/server';
import { SHARE_IMAGE } from '@/lib/seo';

import './globals.css';

const SITE_TITLE = `${config.app.name} - Conoce gente y a tus creadores favoritos`;
const SITE_DESCRIPTION =
  'Directos, videollamadas, mensajes y contenido exclusivo de tus creadores favoritos, todo con un único monedero de tokens.';

export const metadata: Metadata = {
  // Base para que las imagenes de vista previa salgan con URL completa.
  metadataBase: new URL(config.app.url),
  title: {
    default: SITE_TITLE,
    template: `%s | ${config.app.name}`,
  },
  description: SITE_DESCRIPTION,
  // Vista previa al compartir el enlace.
  openGraph: {
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    siteName: config.app.name,
    type: 'website',
    locale: 'es_ES',
    images: [SHARE_IMAGE],
  },
  twitter: {
    card: 'summary_large_image',
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    images: [SHARE_IMAGE.url],
  },
  // Se mantiene sin indexar y con el rating RTA: el contenido intimo sigue
  // existiendo en areas privadas, aunque la superficie publica ya no lo
  // muestre. No es solo cosmetica de marketing.
  robots: { index: false, follow: false },
  other: {
    rating: 'adult, RTA-5042-1996-1400-1577-RTA',
    // iPhone con iOS antiguo: abrirla a pantalla completa al instalarla.
    'apple-mobile-web-app-capable': 'yes',
  },
  // App instalable en iPhone ("Añadir a pantalla de inicio").
  appleWebApp: { capable: true, title: config.app.name, statusBarStyle: 'black' },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: '#0a0a0b',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // El idioma se resuelve aqui una vez y baja por contexto, asi que `lang`
  // del documento y el texto de la interfaz nunca se contradicen.
  const locale = await getLocale();
  const ageConfirmed = (await cookies()).get(AGE_COOKIE)?.value === '1';

  return (
    <html
      lang={locale}
      className={`dark ${fontVariables}`}
      suppressHydrationWarning
    >
      <body className="min-h-screen bg-background font-sans">
        <I18nProvider locale={locale}>
          <AuthProvider>
            <AgeGate initialConfirmed={ageConfirmed} />
            <JoinPromptProvider>{children}</JoinPromptProvider>
            <InstallApp />
            <PushPrompt />
            <Toaster
              position="top-center"
              theme="dark"
              richColors
              closeButton
            />
          </AuthProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
