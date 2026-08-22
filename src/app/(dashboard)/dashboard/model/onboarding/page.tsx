import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { OnboardingForm } from '@/components/model/onboarding-form';
import { requireUser } from '@/lib/auth/guards';
import { prisma } from '@/lib/prisma';

export const metadata: Metadata = { title: 'Alta como modelo' };
export const dynamic = 'force-dynamic';

/**
 * Alta de perfil de modelo para cuentas que aun no lo tienen
 * (por ejemplo altas via OAuth o usuarios que se reconvierten).
 */
export default async function ModelOnboardingPage() {
  const user = await requireUser('/dashboard/model/onboarding');

  const existing = await prisma.modelProfile.findUnique({
    where: { userId: user.id },
    select: { id: true },
  });

  if (existing) redirect('/dashboard/model');

  const account = await prisma.user.findUnique({
    where: { id: user.id },
    select: { name: true, gender: true, orientation: true, country: true },
  });

  return (
    <div className="mx-auto max-w-2xl py-4">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">
          Crea tu perfil de modelo
        </h1>
        <p className="mt-2 text-muted-foreground">
          Estos datos definen como apareces en el catalogo. Podras cambiarlos
          despues desde tu panel.
        </p>
      </div>

      <OnboardingForm
        defaultName={account?.name ?? ''}
        defaultGender={account?.gender ?? 'FEMALE'}
        defaultOrientation={account?.orientation ?? 'STRAIGHT'}
        defaultCountry={account?.country ?? ''}
      />
    </div>
  );
}
