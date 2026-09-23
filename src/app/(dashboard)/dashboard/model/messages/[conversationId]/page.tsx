import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { MessageThread } from '@/components/messages/message-thread';
import { SafetyMenu } from '@/components/social/safety-menu';
import { requireModel } from '@/lib/auth/guards';
import { buildMessageRows } from '@/lib/messages';
import { prisma } from '@/lib/prisma';
import { initials } from '@/lib/utils';

export const metadata: Metadata = { title: 'Conversacion' };
export const dynamic = 'force-dynamic';

export default async function ModelConversationPage({
  params,
}: {
  params: Promise<{ conversationId: string }>;
}) {
  const { conversationId } = await params;
  const { user, profile } = await requireModel();

  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, modelId: profile.id },
    include: {
      // Nunca el email: es un dato personal del fan.
      user: { select: { id: true, name: true, username: true, image: true } },
      messages: {
        orderBy: { createdAt: 'asc' },
        include: { attachment: true },
      },
    },
  });
  if (!conversation) notFound();

  const messages = await buildMessageRows(conversation.messages, user.id);
  const fanName = conversation.user.name ?? conversation.user.username ?? 'Fan';
  const waitingAccept = conversation.startedByModel && conversation.acceptedAt === null;
  const iBlocked = Boolean(
    await prisma.blockedPair.findFirst({
      where: { blockerId: user.id, blockedId: conversation.user.id, isSkip: false },
      select: { id: true },
    }),
  );

  return (
    <div className="mx-auto max-w-2xl">
      <Link
        href="/mensajes"
        className="mb-4 flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Mensajes
      </Link>

      <div className="mb-4 flex items-center gap-3">
        <Link
          href={conversation.user.username ? `/u/${conversation.user.username}` : '#'}
          className="flex min-w-0 flex-1 items-center gap-3"
        >
          <Avatar className="h-10 w-10">
            {conversation.user.image && <AvatarImage src={conversation.user.image} alt="" />}
            <AvatarFallback>{initials(fanName)}</AvatarFallback>
          </Avatar>
          <p className="truncate text-lg font-semibold">{fanName}</p>
        </Link>
        <SafetyMenu
          targetUserId={conversation.user.id}
          targetName={fanName}
          context={`conversation:${conversation.id}`}
          reportLabel="Denunciar chat"
          initialBlocked={iBlocked}
          isAuthenticated
        />
      </div>

      <MessageThread
        conversationId={conversation.id}
        messages={messages}
        canSend={!waitingAccept}
        disabledReason={
          waitingAccept
            ? `Solicitud enviada. Podras seguir escribiendo cuando ${fanName} la acepte.`
            : undefined
        }
        isModel
      />
    </div>
  );
}
