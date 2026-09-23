import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { MessageThread } from '@/components/messages/message-thread';
import { ChatRequestBar } from '@/components/social/chat-thread';
import { SafetyMenu } from '@/components/social/safety-menu';
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
    select: { id: true, stageName: true, avatarUrl: true, userId: true },
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
  // En los chats gratis (precio 0 o abiertos por ella) no hace falta saldo.
  const canSend = conversation.unlockPriceTokens === 0 || (wallet?.balance ?? 0) > 0;
  const isRequest = conversation.startedByModel && conversation.acceptedAt === null;

  const messages = await buildMessageRows(conversation.messages, user.id);

  return (
    <div className="container max-w-2xl py-10">
      <Link
        href="/mensajes"
        className="mb-4 flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Mensajes
      </Link>

      <div className="mb-4 flex items-center gap-3">
        <Link href={`/models/${slug}`} className="flex min-w-0 flex-1 items-center gap-3">
          <Avatar className="h-10 w-10">
            {model.avatarUrl && <AvatarImage src={model.avatarUrl} alt="" />}
            <AvatarFallback>{initials(model.stageName)}</AvatarFallback>
          </Avatar>
          <p className="truncate text-lg font-semibold">{model.stageName}</p>
        </Link>
        <SafetyMenu
          targetUserId={model.userId}
          targetName={model.stageName}
          context={`conversation:${conversation.id}`}
          reportLabel="Denunciar chat"
          isAuthenticated
        />
      </div>

      {isRequest && (
        <div className="mb-4">
          <ChatRequestBar
            kind="conversation"
            id={conversation.id}
            fromName={model.stageName}
            fromUserId={model.userId}
          />
        </div>
      )}

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
