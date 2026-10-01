import { redirect } from 'next/navigation';

import { requireUser } from '@/lib/auth/guards';
import { prisma } from '@/lib/prisma';

/** Las suscripciones viven ahora en el perfil del fan (pestana Suscripciones). */
export default async function UserSubscriptionsPage() {
  const user = await requireUser('/dashboard/subscriptions');
  const account = await prisma.user.findUnique({ where: { id: user.id }, select: { username: true } });
  redirect(account?.username ? `/u/${account.username}?tab=suscripciones` : '/dashboard');
}
