import Link from 'next/link';

import { Logo } from '@/components/brand/logo';

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden p-6">
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
          . Solo mayores de 18 anos.
        </p>
      </div>
    </div>
  );
}
