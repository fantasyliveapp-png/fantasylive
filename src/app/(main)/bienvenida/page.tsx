import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import type { Gender } from '@prisma/client';

import { TastesWizard } from '@/components/onboarding/tastes-wizard';
import { ANON_TASTE_COOKIE, decodeAnonTaste } from '@/lib/anon-taste';
import { requireUser } from '@/lib/auth/guards';
import { prisma } from '@/lib/prisma';
import { TASTE_TAG_IDS } from '@/lib/tastes';

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

  // Si miro el Descubrir antes de registrarse, sus respuestas salen ya
  // marcadas con lo que le intereso (cookie de gustos anonimos).
  let initial = {
    preferredGenders: account?.preferredGenders ?? [],
    interests: account?.interests ?? [],
    lookingFor: account?.lookingFor ?? [],
  };
  const hasAny =
    initial.preferredGenders.length || initial.interests.length || initial.lookingFor.length;
  if (!account?.onboardedAt && !hasAny) {
    const anon = decodeAnonTaste((await cookies()).get(ANON_TASTE_COOKIE)?.value);
    if (anon && anon.n >= 3) {
      const genderTotal = Object.values(anon.g).reduce((a, v) => a + Math.max(0, v ?? 0), 0);
      initial = {
        preferredGenders: (Object.entries(anon.g) as [Gender, number][])
          .filter(([, v]) => genderTotal > 0 && v / genderTotal >= 0.3)
          .map(([g]) => g),
        interests: Object.entries(anon.t)
          .filter(([tag, v]) => v > 0 && TASTE_TAG_IDS.includes(tag))
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([tag]) => tag),
        lookingFor: [],
      };
    }
  }

  return (
    <TastesWizard
      name={account?.name ?? null}
      isEditing={Boolean(account?.onboardedAt)}
      initial={initial}
    />
  );
}
