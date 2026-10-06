import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { VerifyCodeForm } from '@/components/auth/password-reset-forms';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getCurrentUser } from '@/lib/auth/guards';
import { emailEnabled } from '@/lib/email';
import { prisma } from '@/lib/prisma';
import { safeNext } from '@/lib/safe-next';

export const metadata: Metadata = { title: 'Confirma tu email' };
export const dynamic = 'force-dynamic';

/** Escribir el codigo OTP de 6 cifras que llega por correo. */
export default async function VerifyEmailPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = safeNext((await searchParams).next) ?? '/';
  const me = await getCurrentUser();
  if (!me) redirect(`/login?callbackUrl=${encodeURIComponent('/verificar-email')}`);
  const user = await prisma.user.findUnique({ where: { id: me.id }, select: { email: true, emailVerified: true } });
  // Sin correo activo no hay codigo que escribir; si ya esta confirmado, a seguir.
  if (!user || user.emailVerified || !emailEnabled()) redirect(next);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-2xl">Confirma tu email</CardTitle>
        <CardDescription>Lo necesitas para comprar tokens, hacerte creadora y retirar tus ganancias.</CardDescription>
      </CardHeader>
      <CardContent>
        <VerifyCodeForm email={user.email} next={next} />
      </CardContent>
    </Card>
  );
}
