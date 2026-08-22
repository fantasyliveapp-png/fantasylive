import { Ban } from 'lucide-react';

import { LogoutButton } from '@/components/auth/logout-button';
import { getCurrentUser } from '@/lib/auth/guards';
import { config } from '@/lib/config';
import { prisma } from '@/lib/prisma';

export const metadata = { title: 'Cuenta suspendida' };
export const dynamic = 'force-dynamic';

export default async function BannedPage() {
  const user = await getCurrentUser();
  const record = user
    ? await prisma.user.findUnique({
        where: { id: user.id },
        select: { banReason: true, suspendedUntil: true, status: true },
      })
    : null;

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="max-w-md text-center">
        <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-full bg-destructive/15">
          <Ban className="h-7 w-7 text-destructive" />
        </div>

        <h1 className="text-2xl font-bold">
          {record?.status === 'SUSPENDED'
            ? 'Cuenta suspendida temporalmente'
            : 'Cuenta bloqueada'}
        </h1>

        <p className="mt-3 text-muted-foreground">
          {record?.banReason ??
            'Tu cuenta ha sido bloqueada por incumplir los terminos de servicio.'}
        </p>

        {record?.suspendedUntil && (
          <p className="mt-2 text-sm text-muted-foreground">
            La suspension termina el{' '}
            {new Intl.DateTimeFormat('es-ES', {
              dateStyle: 'long',
              timeStyle: 'short',
            }).format(record.suspendedUntil)}
            .
          </p>
        )}

        <p className="mt-6 text-sm text-muted-foreground">
          Si crees que se trata de un error, escribe a{' '}
          <a
            href={`mailto:${config.moderation.adminAlertEmail}`}
            className="text-primary hover:underline"
          >
            {config.moderation.adminAlertEmail}
          </a>
          .
        </p>

        <div className="mt-8">
          <LogoutButton />
        </div>
      </div>
    </div>
  );
}
