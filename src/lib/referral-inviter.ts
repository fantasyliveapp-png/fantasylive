import 'server-only';

import { cookies } from 'next/headers';

import { prisma } from '@/lib/prisma';
import { REF_COOKIE } from '@/lib/referrals';

/**
 * Quien invito a esta persona (cookie de /r/<slug> o /referidos/<code>),
 * para que en el registro vea con que invitacion entra. Mismas reglas que
 * registerAction: reclutador activo o creadora verificada; si no, null.
 */
export async function getInviterName(): Promise<string | null> {
  const value = (await cookies()).get(REF_COOKIE)?.value ?? '';
  if (!value) return null;
  if (value.startsWith('r:')) {
    const recruiter = await prisma.recruiter.findFirst({
      where: { id: value.slice(2), active: true },
      select: { user: { select: { username: true, name: true } } },
    });
    return recruiter ? `@${recruiter.user.username ?? recruiter.user.name ?? 'fantasylive'}` : null;
  }
  const creator = await prisma.modelProfile.findFirst({
    where: { userId: value, kycStatus: 'APPROVED', user: { status: 'ACTIVE' } },
    select: { stageName: true },
  });
  return creator?.stageName ?? null;
}
