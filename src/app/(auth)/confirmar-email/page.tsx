import type { Metadata } from 'next';
import Link from 'next/link';
import { CheckCircle2, XCircle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { consumeAuthTokenFull } from '@/lib/auth-tokens';
import { prisma } from '@/lib/prisma';

export const metadata: Metadata = { title: 'Confirmar cambio de email' };
export const dynamic = 'force-dynamic';

/** Enlace del correo de cambio de email (17): /confirmar-email?token=... */
export default async function ConfirmEmailChangePage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token = '' } = await searchParams;
  let result: { ok: true; email: string } | { ok: false; reason: string };
  const t = await consumeAuthTokenFull(token, 'EMAIL_CHANGE');
  if (!t?.payload) {
    result = { ok: false, reason: 'Este enlace ya se usó o ha caducado (duran 24 horas). Pide el cambio otra vez desde Ajustes.' };
  } else if (await prisma.user.findUnique({ where: { email: t.payload }, select: { id: true } })) {
    result = { ok: false, reason: 'Ese email ya lo usa otra cuenta, así que no se pudo cambiar.' };
  } else {
    await prisma.user.update({ where: { id: t.userId }, data: { email: t.payload, emailVerified: new Date() } });
    await prisma.auditLog.create({
      data: { actorId: t.userId, action: 'EMAIL_CHANGED', entityType: 'User', entityId: t.userId },
    });
    result = { ok: true, email: t.payload };
  }

  return (
    <Card>
      <CardHeader className="items-center text-center">
        {result.ok ? (
          <CheckCircle2 className="h-10 w-10 text-state-connected" />
        ) : (
          <XCircle className="h-10 w-10 text-muted-foreground" />
        )}
        <CardTitle className="text-2xl">{result.ok ? '¡Email cambiado!' : 'No se pudo cambiar'}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-center text-sm text-muted-foreground">
        <p>{result.ok ? `Desde ahora entras con ${result.email}.` : result.reason}</p>
        <Link href={result.ok ? '/login' : '/dashboard/settings'} className="block">
          <Button variant="brand" size="lg" className="w-full">
            {result.ok ? 'Iniciar sesión' : 'Ir a Ajustes'}
          </Button>
        </Link>
      </CardContent>
    </Card>
  );
}
