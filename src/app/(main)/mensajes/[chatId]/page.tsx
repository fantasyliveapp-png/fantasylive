import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';

import { ChatRequestBar, PeerChatThread } from '@/components/social/chat-thread';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { requireUser } from '@/lib/auth/guards';
import { isBlockedBetween } from '@/lib/chat';
import { prisma } from '@/lib/prisma';
import { initials } from '@/lib/utils';

export const metadata: Metadata = { title: 'Chat' };
export const dynamic = 'force-dynamic';

/** Chat entre dos personas (fan con fan, creadora con creadora). */
export default async function PeerChatPage({
  params,
}: {
  params: Promise<{ chatId: string }>;
}) {
  const { chatId } = await params;
  const user = await requireUser(`/mensajes/${chatId}`);

  const chat = await prisma.peerChat.findUnique({
    where: { id: chatId },
    select: {
      id: true,
      userAId: true,
      userBId: true,
      createdById: true,
      acceptedAt: true,
      userA: { select: { id: true, name: true, username: true, image: true, modelProfile: { select: { slug: true, stageName: true, avatarUrl: true } } } },
      userB: { select: { id: true, name: true, username: true, image: true, modelProfile: { select: { slug: true, stageName: true, avatarUrl: true } } } },
      messages: {
        orderBy: { createdAt: 'asc' },
        take: 200,
        select: { id: true, body: true, createdAt: true, senderId: true },
      },
    },
  });
  if (!chat || (chat.userAId !== user.id && chat.userBId !== user.id)) notFound();

  const other = chat.userAId === user.id ? chat.userB : chat.userA;
  const name = other.modelProfile?.stageName ?? other.name ?? other.username ?? 'Usuario';
  const image = other.modelProfile?.avatarUrl ?? other.image;
  const profileHref = other.modelProfile
    ? `/models/${other.modelProfile.slug}`
    : other.username
      ? `/u/${other.username}`
      : null;

  const pending = chat.acceptedAt === null;
  const iAmRecipient = pending && chat.createdById !== user.id;
  const iSentRequest = pending && chat.createdById === user.id;
  const blocked = await isBlockedBetween(user.id, other.id);

  return (
    <div className="container max-w-2xl space-y-4 py-4">
      <header className="sticky top-16 z-20 -mx-6 flex items-center gap-3 border-b border-border/60 bg-background/90 px-6 py-3 backdrop-blur-xl">
        <Link href="/mensajes" className="rounded-full p-1.5 hover:bg-muted" aria-label="Volver">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        {profileHref ? (
          <Link href={profileHref} className="flex min-w-0 items-center gap-3">
            <Avatar className="h-9 w-9">
              {image && <AvatarImage src={image} alt="" />}
              <AvatarFallback>{initials(name)}</AvatarFallback>
            </Avatar>
            <span className="truncate font-semibold">{name}</span>
          </Link>
        ) : (
          <span className="truncate font-semibold">{name}</span>
        )}
      </header>

      {iAmRecipient && !blocked && (
        <ChatRequestBar kind="peer" id={chat.id} fromName={name} fromUserId={other.id} />
      )}

      <PeerChatThread
        chatId={chat.id}
        messages={chat.messages.map((m) => ({
          id: m.id,
          body: m.body,
          createdAt: m.createdAt.toISOString(),
          isMine: m.senderId === user.id,
        }))}
        canWrite={!blocked && !iSentRequest}
        disabledHint={
          blocked
            ? 'No podeis escribiros: hay un bloqueo entre vosotros.'
            : iSentRequest
              ? `Solicitud enviada. Podras seguir escribiendo cuando ${name} la acepte.`
              : undefined
        }
      />
    </div>
  );
}
