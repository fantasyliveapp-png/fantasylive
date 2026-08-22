import type { Metadata, Viewport } from 'next';
import { Toaster } from 'sonner';

import { AgeGate } from '@/components/age-gate';
import { AuthProvider } from '@/components/providers/auth-provider';
import { config } from '@/lib/config';
import { fontVariables } from '@/lib/fonts';

import './globals.css';

export const metadata: Metadata = {
  title: {
    default: `${config.app.name} - Conoce gente y a tus creadores favoritos`,
    template: `%s | ${config.app.name}`,
  },
  description:
    'Conecta con gente nueva y con tus creadores de contenido favoritos: videollamadas en vivo, mensajeria y contenido exclusivo, todo con un unico monedero de tokens.',
  // Se mantiene sin indexar y con el rating RTA: el contenido intimo sigue
  // existiendo en areas privadas, aunque la superficie publica ya no lo
  // muestre. No es solo cosmetica de marketing.
  robots: { index: false, follow: false },
  other: { rating: 'adult, RTA-5042-1996-1400-1577-RTA' },
};

export const viewport: Viewport = {
  themeColor: '#0a0a0b',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="es"
      className={`dark ${fontVariables}`}
      suppressHydrationWarning
    >
      <body className="min-h-screen bg-background font-sans">
        <AuthProvider>
          <AgeGate />
          {children}
          <Toaster
            position="top-center"
            theme="dark"
            richColors
            closeButton
          />
        </AuthProvider>
      </body>
    </html>
  );
}
