import 'server-only';

import type { Gender, Orientation } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { slugify } from '@/lib/utils';

/**
 * Activa el modo creadora: crea el perfil publico y pasa la cuenta a MODEL.
 * Solo pide lo minimo; foto, bio, titular, etc. se completan despues en
 * Ajustes del panel. Lo usan el registro (si elige "crear") y /hazte-creador.
 */
export async function createCreatorProfile(
  userId: string,
  input: { stageName: string; gender: Gender; orientation?: Orientation; country?: string | null },
) {
  const stageName = input.stageName.trim().slice(0, 40);
  // Su direccion de creadora es su mismo @usuario: un solo @ para todo.
  const account = await prisma.user.findUnique({ where: { id: userId }, select: { username: true } });
  let slug = account?.username || slugify(stageName) || `model-${Date.now().toString(36)}`;
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

/** ¿Esta libre este @ (como usuario y como direccion de creadora)? */
export async function isHandleFree(handle: string, exceptUserId?: string) {
  const [user, model] = await Promise.all([
    prisma.user.findFirst({
      where: { username: handle, ...(exceptUserId ? { NOT: { id: exceptUserId } } : {}) },
      select: { id: true },
    }),
    prisma.modelProfile.findFirst({
      where: { slug: handle, ...(exceptUserId ? { NOT: { userId: exceptUserId } } : {}) },
      select: { id: true },
    }),
  ]);
  return !user && !model;
}

/**
 * Cambia el @ de una persona. Si es creadora, su direccion publica
 * (/models/<slug>) cambia a la vez: un solo @ para todo.
 */
export async function changeHandle(userId: string, handle: string) {
  const model = await prisma.modelProfile.findUnique({
    where: { userId },
    select: { id: true },
  });
  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { username: handle } }),
    ...(model
      ? [prisma.modelProfile.update({ where: { id: model.id }, data: { slug: handle } })]
      : []),
  ]);
}
