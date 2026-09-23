import { redirect } from 'next/navigation';
import type { Role } from '@prisma/client';

import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export type SessionUser = {
  id: string;
  email: string;
  name?: string | null;
  image?: string | null;
  role: Role;
  status: string;
  isVip: boolean;
  ageVerified: boolean;
  modelProfileId: string | null;
};

/** Devuelve el usuario de sesion o null. Nunca lanza. */
export async function getCurrentUser(): Promise<SessionUser | null> {
  const session = await auth();
  if (!session?.user?.id) return null;
  return session.user as unknown as SessionUser;
}

/** Exige sesion. Redirige a /login conservando el destino. */
export async function requireUser(callbackUrl?: string): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) {
    const target = callbackUrl
      ? `/login?callbackUrl=${encodeURIComponent(callbackUrl)}`
      : '/login';
    redirect(target);
  }
  return user;
}

/** Exige uno de los roles indicados. */
export async function requireRole(
  roles: Role[],
  callbackUrl?: string,
): Promise<SessionUser> {
  const user = await requireUser(callbackUrl);
  if (!roles.includes(user.role)) redirect('/403');
  return user;
}

export async function requireAdmin(): Promise<SessionUser> {
  return requireRole(['ADMIN'], '/admin');
}

/** Exige rol MODEL y devuelve tambien el perfil de modelo cargado. */
export async function requireModel() {
  const user = await requireRole(['MODEL', 'ADMIN'], '/dashboard');
  const profile = await prisma.modelProfile.findUnique({
    where: { userId: user.id },
  });
  if (!profile) redirect('/dashboard/model/onboarding');
  return { user, profile };
}

/** Version para Server Actions / API: devuelve error en vez de redirigir. */
export async function getAuthedUserOrThrow(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) throw new Error('UNAUTHORIZED');
  if (user.status === 'BANNED') throw new Error('ACCOUNT_BANNED');
  return user;
}
