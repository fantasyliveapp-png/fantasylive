import type { Metadata } from 'next';

import { TastesWizard } from '@/components/onboarding/tastes-wizard';
import { requireUser } from '@/lib/auth/guards';
import { prisma } from '@/lib/prisma';

export const metadata: Metadata = { title: 'Tus gustos' };
export const dynamic = 'force-dynamic';

/**
 * Preguntas de bienvenida tras crear la cuenta. Tambien es la pantalla
 * "Tus gustos" del menu, para cambiarlas cuando quiera.
 */
export default async function WelcomePage() {
  const user = await requireUser('/bienvenida');
  const account = await prisma.user.findUnique({
    where: { id: user.id },
    select: {
      name: true,
      preferredGenders: true,
      interests: true,
      lookingFor: true,
      onboardedAt: true,
    },
  });

  return (
    <TastesWizard
      name={account?.name ?? null}
      isEditing={Boolean(account?.onboardedAt)}
      initial={{
        preferredGenders: account?.preferredGenders ?? [],
        interests: account?.interests ?? [],
        lookingFor: account?.lookingFor ?? [],
      }}
    />
  );
}
