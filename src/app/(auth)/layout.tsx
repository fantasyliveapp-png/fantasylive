import Link from 'next/link';

import { Logo } from '@/components/brand/logo';
import { LanguageSwitcher } from '@/components/layout/language-switcher';

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden p-6">
      {/* En movil el idioma no cabe en la barra de arriba: se elige aqui. */}
      <LanguageSwitcher className="absolute right-4 top-4" />
      <div className="w-full max-w-md">
        <Logo
          size="md"
          className="mb-8 justify-center"
          wordmarkClassName="text-2xl"
        />

        {children}

        <p className="mt-8 text-center text-xs text-muted-foreground">
          Al continuar aceptas nuestros{' '}
          <Link href="/legal/terms" className="underline hover:text-foreground">
            terminos
          </Link>{' '}
          y la{' '}
          <Link href="/legal/privacy" className="underline hover:text-foreground">
            politica de privacidad
          </Link>
          . Solo mayores de 18 años.
        </p>
      </div>
    </div>
  );
}
