import type { Metadata } from 'next';

import { ResetPasswordForm } from '@/components/auth/password-reset-forms';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { peekAuthToken } from '@/lib/auth-tokens';

export const metadata: Metadata = { title: 'Contraseña nueva' };
export const dynamic = 'force-dynamic';

/** Enlace del correo de "Recuperar contraseña": /restablecer?token=... */
export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token = '' } = await searchParams;
  const valid = await peekAuthToken(token, 'PASSWORD_RESET');
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-2xl">Contraseña nueva</CardTitle>
        <CardDescription>Elige una contraseña nueva para tu cuenta.</CardDescription>
      </CardHeader>
      <CardContent>
        <ResetPasswordForm token={token} valid={Boolean(valid)} />
      </CardContent>
    </Card>
  );
}
