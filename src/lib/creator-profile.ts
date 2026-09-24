import 'server-only';

import type { Gender, Orientation } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { slugify } from '@/lib/utils';

/**
 * Activa el modo creadora: crea el perfil publico y pasa la cuenta a MODEL.
 * Solo pide lo minimo; foto, bio, titular, etc. se completan despues en
 * Ajustes del panel. Lo usan el registro (si elige "crear") y /hazte-creadora.
 */
export async function createCreatorProfile(
  userId: string,
  input: { stageName: string; gender: Gender; orientation?: Orientation; country?: string | null },
) {
  const stageName = input.stageName.trim().slice(0, 40);
  let slug = slugify(stageName);
  if (!slug) slug = `model-${Date.now().toString(36)}`;
  if (await prisma.modelProfile.findUnique({ where: { slug }, select: { id: true } })) {
    slug = `${slug}-${Math.random().toString(36).slice(2, 6)}`;
  }

  await prisma.$transaction([
    prisma.modelProfile.create({
      data: {
        userId,
        stageName,
        slug,
        gender: input.gender,
        orientation: input.orientation ?? 'STRAIGHT',
        country: input.country || null,
        kycStatus: 'NOT_SUBMITTED',
        acceptsBookings: false,
        isVipEnabled: false,
      },
    }),
    prisma.user.update({ where: { id: userId }, data: { role: 'MODEL' } }),
    prisma.auditLog.create({
      data: { actorId: userId, action: 'MODEL_PROFILE_CREATED', entityType: 'ModelProfile' },
    }),
  ]);
}
