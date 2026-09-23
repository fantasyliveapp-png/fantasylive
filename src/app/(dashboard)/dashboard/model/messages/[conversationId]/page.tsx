import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { MessageThread } from '@/components/messages/message-thread';
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
      user: { select: { name: true, email: true, image: true } },
      messages: {
        orderBy: { createdAt: 'asc' },
        include: { attachment: true },
      },
    },
  });
  if (!conversation) notFound();

  const messages = await buildMessageRows(conversation.messages, user.id);

  return (
    <div className="mx-auto max-w-2xl">
      <Link
        href="/dashboard/model/messages"
        className="mb-4 flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Mensajes
      </Link>

      <div className="mb-4 flex items-center gap-3">
        <Avatar className="h-10 w-10">
          {conversation.user.image && (
            <AvatarImage src={conversation.user.image} alt="" />
          )}
          <AvatarFallback>{initials(conversation.user.name)}</AvatarFallback>
        </Avatar>
        <p className="text-lg font-semibold">
          {conversation.user.name ?? conversation.user.email}
        </p>
      </div>

      <MessageThread
        conversationId={conversation.id}
        messages={messages}
        canSend
        isModel
      />
    </div>
  );
}
