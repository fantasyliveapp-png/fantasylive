import type { Metadata } from 'next';
import Link from 'next/link';
import { Coins, Mail, ShieldCheck, User as UserIcon } from 'lucide-react';

import { LogoutButton } from '@/components/auth/logout-button';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { requireUser } from '@/lib/auth/guards';
import { GENDER_LABELS, ORIENTATION_LABELS, ROLE_LABELS } from '@/lib/constants';
import { prisma } from '@/lib/prisma';
import { calculateAge, formatDate, formatTokens } from '@/lib/utils';

export const metadata: Metadata = { title: 'Ajustes' };
export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const session = await requireUser('/dashboard/settings');

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: session.id },
    include: { wallet: true, modelProfile: { select: { slug: true } } },
  });

  return (
    <div className="container max-w-3xl py-10">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Ajustes de cuenta</h1>
        <p className="mt-2 text-muted-foreground">
          Datos de tu perfil y estado de la cuenta.
        </p>
      </div>

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UserIcon className="h-4 w-4" />
              Datos personales
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field label="Nombre" value={user.name ?? '-'} />
            <Separator />
            <Field label="Email" value={user.email} />
            <Separator />
            <Field
              label="Fecha de nacimiento"
              value={
                user.birthDate
                  ? `${formatDate(user.birthDate)} (${calculateAge(user.birthDate)} anos)`
                  : 'No indicada'
              }
            />
            <Separator />
            <Field
              label="Genero"
              value={user.gender ? GENDER_LABELS[user.gender] : 'No indicado'}
            />
            <Separator />
            <Field
              label="Orientacion"
              value={
                user.orientation
                  ? ORIENTATION_LABELS[user.orientation]
                  : 'No indicada'
              }
            />
            <Separator />
            <Field label="Pais" value={user.country ?? 'No indicado'} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4" />
              Estado de la cuenta
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Rol</span>
              <Badge variant="muted">{ROLE_LABELS[user.role]}</Badge>
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Estado</span>
              <Badge variant={user.status === 'ACTIVE' ? 'success' : 'destructive'}>
                {user.status}
              </Badge>
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">
                Verificacion de edad
              </span>
              <Badge variant={user.ageVerified ? 'success' : 'warning'}>
                {user.ageVerified ? 'Verificada' : 'Pendiente'}
              </Badge>
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Miembro desde</span>
              <span className="text-sm">{formatDate(user.createdAt)}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Coins className="h-4 w-4 text-token" />
              Monedero
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">
                Saldo disponible
              </span>
              <span className="text-xl font-bold text-token">
                {formatTokens(user.wallet?.balance ?? 0)}
              </span>
            </div>
            <Link href="/wallet">
              <Button variant="token" className="w-full">
                Ir al monedero
              </Button>
            </Link>
          </CardContent>
        </Card>

        {user.role === 'USER' && !user.modelProfile && (
          <Card>
            <CardHeader>
              <CardTitle>Trabajar como modelo</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Convierte tu cuenta en perfil de modelo para fijar tarifas,
                vender contenido y cobrar por videollamadas.
              </p>
              <Link href="/dashboard/model/onboarding">
                <Button variant="brand">Crear perfil de modelo</Button>
              </Link>
            </CardContent>
          </Card>
        )}

        <Card className="border-destructive/30">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Mail className="h-4 w-4" />
              Soporte y sesion
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Para eliminar tu cuenta o solicitar tus datos (RGPD), escribe a
              soporte desde el email registrado.
            </p>
            <LogoutButton />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="truncate text-sm font-medium">{value}</span>
    </div>
  );
}
