import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { MessageThread } from '@/components/messages/message-thread';
import { requireUser } from '@/lib/auth/guards';
import { buildMessageRows } from '@/lib/messages';
import { prisma } from '@/lib/prisma';
import { initials } from '@/lib/utils';

export const metadata: Metadata = { title: 'Conversacion' };
export const dynamic = 'force-dynamic';

export default async function UserConversationPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const user = await requireUser(`/dashboard/messages/${slug}`);

  const model = await prisma.modelProfile.findUnique({
    where: { slug },
    select: { id: true, stageName: true, avatarUrl: true },
  });
  if (!model) notFound();

  const conversation = await prisma.conversation.findUnique({
    where: { userId_modelId: { userId: user.id, modelId: model.id } },
    include: {
      messages: {
        orderBy: { createdAt: 'asc' },
        include: { attachment: true },
      },
    },
  });
  if (!conversation) notFound();

  const wallet = await prisma.wallet.findUnique({
    where: { userId: user.id },
    select: { balance: true },
  });
  const canSend = (wallet?.balance ?? 0) > 0;

  const messages = await buildMessageRows(conversation.messages, user.id);

  return (
    <div className="container max-w-2xl py-10">
      <Link
        href="/dashboard/messages"
        className="mb-4 flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Mensajes
      </Link>

      <div className="mb-4 flex items-center gap-3">
        <Avatar className="h-10 w-10">
          {model.avatarUrl && <AvatarImage src={model.avatarUrl} alt="" />}
          <AvatarFallback>{initials(model.stageName)}</AvatarFallback>
        </Avatar>
        <p className="text-lg font-semibold">{model.stageName}</p>
      </div>

      <MessageThread
        conversationId={conversation.id}
        messages={messages}
        canSend={canSend}
        disabledReason={
          canSend ? undefined : 'Necesitas tokens en tu monedero para seguir escribiendo.'
        }
      />
    </div>
  );
}
