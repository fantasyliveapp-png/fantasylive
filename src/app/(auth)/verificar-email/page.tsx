import type { Metadata } from 'next';
import Link from 'next/link';
import { CheckCircle2, XCircle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { consumeAuthToken, revokeAuthTokens } from '@/lib/auth-tokens';
import { prisma } from '@/lib/prisma';

export const metadata: Metadata = { title: 'Confirmar email' };
export const dynamic = 'force-dynamic';

/** Enlace del correo de bienvenida: /verificar-email?token=... */
export default async function VerifyEmailPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token = '' } = await searchParams;
  const userId = await consumeAuthToken(token, 'EMAIL_VERIFY');
  if (userId) {
    await prisma.user.updateMany({ where: { id: userId, emailVerified: null }, data: { emailVerified: new Date() } });
    await revokeAuthTokens(userId, 'EMAIL_VERIFY');
  }
  return (
    <Card>
      <CardHeader className="items-center text-center">
        {userId ? (
          <CheckCircle2 className="h-10 w-10 text-state-connected" />
        ) : (
          <XCircle className="h-10 w-10 text-muted-foreground" />
        )}
        <CardTitle className="text-2xl">{userId ? '¡Email confirmado!' : 'Enlace no válido'}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-center text-sm text-muted-foreground">
        <p>
          {userId
            ? 'Ya puedes comprar tokens, hacerte creadora y retirar tus ganancias.'
            : 'Este enlace ya se usó o ha caducado (duran 48 horas). Entra en tu cuenta y pide otro desde el aviso de arriba.'}
        </p>
        <Link href="/" className="block">
          <Button variant="brand" size="lg" className="w-full">
            Ir a FantasyLive
          </Button>
        </Link>
      </CardContent>
    </Card>
  );
}
