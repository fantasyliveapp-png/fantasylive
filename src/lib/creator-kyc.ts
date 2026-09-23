import 'server-only';

import { prisma } from '@/lib/prisma';

/**
 * VERIFICACION OBLIGATORIA PARA CREADORAS.
 *
 * Hasta que el equipo aprueba su identidad (KYC), una creadora no puede
 * publicar, cobrar, emitir ni usar ninguna herramienta de creadora. Solo
 * puede verificarse y preparar su perfil (foto, bio). Se comprueba en cada
 * accion del servidor, no solo en la interfaz, para que no se pueda saltar.
 */
export const KYC_REQUIRED_MESSAGE =
  'Primero verifica tu identidad. Hasta que la aprobemos no puedes publicar, cobrar ni usar las herramientas de creadora.';

export async function assertCreatorVerified(
  who: { modelId: string } | { userId: string },
): Promise<void> {
  const profile = await prisma.modelProfile.findUnique({
    where: 'modelId' in who ? { id: who.modelId } : { userId: who.userId },
    select: { kycStatus: true },
  });
  if (!profile) throw new Error('MODEL_PROFILE_MISSING');
  if (profile.kycStatus !== 'APPROVED') throw new Error(KYC_REQUIRED_MESSAGE);
}
