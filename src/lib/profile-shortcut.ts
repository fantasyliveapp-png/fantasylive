import 'server-only';

import { cache } from 'react';

import { prisma } from '@/lib/prisma';

export interface ProfileShortcut {
  slug: string;
  stageName: string;
  avatarUrl: string | null;
  /** Identidad verificada (KYC aprobado): sin ella no puede crear nada. */
  verified: boolean;
  /** "Recibo llamadas" activado. */
  callsAvailable: boolean;
}

/**
 * Datos minimos del perfil de la modelo en sesion para los accesos directos
 * (barra inferior, menu). Con `cache` la consulta se hace una vez por
 * peticion aunque la pidan el navbar y el layout a la vez (por eso recibe el
 * id y no el objeto de usuario: `cache` compara argumentos por referencia).
 */
export const getProfileShortcut = cache(
  async (modelProfileId: string | null | undefined): Promise<ProfileShortcut | null> => {
    if (!modelProfileId) return null;
    const row = await prisma.modelProfile.findUnique({
      where: { id: modelProfileId },
      select: { slug: true, stageName: true, avatarUrl: true, kycStatus: true, isOnline: true },
    });
    if (!row) return null;
    const { kycStatus, isOnline, ...rest } = row;
    return { ...rest, verified: kycStatus === 'APPROVED', callsAvailable: isOnline };
  },
);

/** @usuario de la cuenta en sesion, para enlazar a su perfil (/u/<usuario>). */
export const getOwnUsername = cache(
  async (userId: string | null | undefined): Promise<string | null> => {
    if (!userId) return null;
    const row = await prisma.user.findUnique({
      where: { id: userId },
      select: { username: true },
    });
    return row?.username ?? null;
  },
);

/** Si la cuenta es de un reclutador (para el acceso a su panel). */
/** Es distribuidor oficial de tokens (para el acceso a su panel en el menu). */
export const isDistributorAccount = cache(async (userId: string | null | undefined): Promise<boolean> => {
  if (!userId) return false;
  const d = await prisma.distributor.findUnique({ where: { userId }, select: { id: true } });
  return Boolean(d);
});

export const isRecruiterAccount = cache(async (userId: string | null | undefined): Promise<boolean> => {
  if (!userId) return false;
  const r = await prisma.recruiter.findUnique({ where: { userId }, select: { id: true } });
  return Boolean(r);
});
