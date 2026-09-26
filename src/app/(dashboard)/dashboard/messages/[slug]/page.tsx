import { notFound, redirect } from 'next/navigation';

import { requireUser } from '@/lib/auth/guards';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

/**
 * Direccion antigua del chat de un fan con una creadora (por su nombre).
 * Todos los chats viven ahora en /mensajes/<id>: se redirige alli.
 */
export default async function OldFanChatPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const user = await requireUser(`/dashboard/messages/${slug}`);
  const conversation = await prisma.conversation.findFirst({
    where: { userId: user.id, model: { slug } },
    select: { id: true },
  });
  if (!conversation) notFound();
  redirect(`/mensajes/${conversation.id}`);
}
