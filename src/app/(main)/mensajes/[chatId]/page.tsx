import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';

import { MessageThread } from '@/components/messages/message-thread';
import { ChatRequestBar, PeerChatThread } from '@/components/social/chat-thread';
import { SafetyMenu } from '@/components/social/safety-menu';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { requireUser } from '@/lib/auth/guards';
import { isBlockedBetween } from '@/lib/chat';
import { getChatRole } from '@/lib/chat-team';
import { buildMessageRows } from '@/lib/messages';
import { prisma } from '@/lib/prisma';
import { initials } from '@/lib/utils';

export const metadata: Metadata = { title: 'Chat' };
export const dynamic = 'force-dynamic';

/**
 * UN CHAT, SEA CUAL SEA.
 *
 * Todas las conversaciones se abren aqui y se ven igual, las abra quien las
 * abra: entre personas (PeerChat) o entre un fan y una creadora
 * (Conversation, con fotos de pago). Cambia solo lo que hace falta: quien
 * puede escribir y si se pueden adjuntar archivos.
 */
export default async function ChatPage({
  params,
}: {
  params: Promise<{ chatId: string }>;
}) {
  const { chatId } = await params;
  const user = await requireUser(`/mensajes/${chatId}`);

  const peer = await getPeerChat(chatId, user.id);
  if (peer) return <PeerView {...peer} viewerId={user.id} />;

  const conversation = await getConversation(chatId, user.id);
  if (conversation) return <ConversationView {...conversation} viewerId={user.id} />;

  notFound();
}

// ---------------------------------------------------------------------------
// Cabecera comun
// ---------------------------------------------------------------------------

function ChatHeader({
  name,
  image,
  profileHref,
  safety,
  backHref = '/mensajes',
}: {
  name: string;
  image: string | null;
  profileHref: string | null;
  safety: React.ReactNode;
  backHref?: string;
}) {
  const who = (
    <>
      <Avatar className="h-9 w-9">
        {image && <AvatarImage src={image} alt="" />}
        <AvatarFallback>{initials(name)}</AvatarFallback>
      </Avatar>
      <span className="truncate font-semibold">{name}</span>
    </>
  );
  return (
    <header className="sticky top-16 z-20 -mx-6 md:top-0 flex items-center gap-3 border-b border-border/60 bg-background/90 px-6 py-3 backdrop-blur-xl">
      <Link href={backHref} className="rounded-full p-1.5 hover:bg-muted" aria-label="Volver">
        <ArrowLeft className="h-5 w-5" />
      </Link>
      {profileHref ? (
        <Link href={profileHref} className="flex min-w-0 items-center gap-3">
          {who}
        </Link>
      ) : (
        <span className="flex min-w-0 items-center gap-3">{who}</span>
      )}
      <div className="ml-auto">{safety}</div>
    </header>
  );
}

async function iBlocked(viewerId: string, otherId: string) {
  return Boolean(
    await prisma.blockedPair.findFirst({
      where: { blockerId: viewerId, blockedId: otherId, isSkip: false },
      select: { id: true },
    }),
  );
}

// ---------------------------------------------------------------------------
// Chat entre personas
// ---------------------------------------------------------------------------

const personSelect = {
  id: true,
  name: true,
  username: true,
  image: true,
  modelProfile: { select: { slug: true, stageName: true, avatarUrl: true, kycStatus: true } },
} as const;

async function getPeerChat(id: string, viewerId: string) {
  const chat = await prisma.peerChat.findUnique({
    where: { id },
    select: {
      id: true,
      userAId: true,
      userBId: true,
      createdById: true,
      acceptedAt: true,
      userA: { select: personSelect },
      userB: { select: personSelect },
      messages: {
        orderBy: { createdAt: 'asc' },
        take: 200,
        select: { id: true, body: true, createdAt: true, senderId: true },
      },
    },
  });
  if (!chat || (chat.userAId !== viewerId && chat.userBId !== viewerId)) return null;
  return chat;
}

type Person = {
  id: string;
  name: string | null;
  username: string | null;
  image: string | null;
  modelProfile: { slug: string; stageName: string; avatarUrl: string | null; kycStatus: string } | null;
};

function personCard(p: Person) {
  const creator = p.modelProfile?.kycStatus === 'APPROVED' ? p.modelProfile : null;
  return {
    name: creator?.stageName ?? p.name ?? p.username ?? 'Usuario',
    image: creator?.avatarUrl ?? p.image,
    profileHref: creator ? `/models/${creator.slug}` : p.username ? `/u/${p.username}` : null,
  };
}

async function PeerView({
  viewerId,
  ...chat
}: NonNullable<Awaited<ReturnType<typeof getPeerChat>>> & { viewerId: string }) {
  const other = chat.userAId === viewerId ? chat.userB : chat.userA;
  const card = personCard(other);

  const pending = chat.acceptedAt === null;
  const iAmRecipient = pending && chat.createdById !== viewerId;
  const iSentRequest = pending && chat.createdById === viewerId;
  const [blocked, blockedByMe] = await Promise.all([
    isBlockedBetween(viewerId, other.id),
    iBlocked(viewerId, other.id),
    // Abrirlo (o que se recargue mientras lo tienes abierto) es leerlo.
    prisma.peerChat.update({
      where: { id: chat.id },
      data: chat.userAId === viewerId ? { readAtA: new Date() } : { readAtB: new Date() },
    }),
  ]);

  return (
    <div className="container max-w-2xl space-y-4 py-4">
      <ChatHeader
        {...card}
        safety={
          <SafetyMenu
            targetUserId={other.id}
            targetName={card.name}
            context={`chat:${chat.id}`}
            reportLabel="Denunciar chat"
            initialBlocked={blockedByMe}
            isAuthenticated
          />
        }
      />

      {iAmRecipient && !blocked && (
        <ChatRequestBar kind="peer" id={chat.id} fromName={card.name} fromUserId={other.id} />
      )}

      <PeerChatThread
        chatId={chat.id}
        messages={chat.messages.map((m) => ({
          id: m.id,
          body: m.body,
          createdAt: m.createdAt.toISOString(),
          isMine: m.senderId === viewerId,
        }))}
        canWrite={!blocked && !iSentRequest}
        disabledHint={
          blocked
            ? 'No podeis escribiros: hay un bloqueo entre vosotros.'
            : iSentRequest
              ? `Solicitud enviada. Podras seguir escribiendo cuando ${card.name} la acepte.`
              : undefined
        }
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Chat fan <-> creadora
// ---------------------------------------------------------------------------

async function getConversation(id: string, viewerId: string) {
  const conversation = await prisma.conversation.findUnique({
    where: { id },
    include: {
      // Nunca el email: es un dato personal del fan.
      user: { select: { id: true, name: true, username: true, image: true } },
      model: {
        select: { id: true, userId: true, slug: true, stageName: true, avatarUrl: true },
      },
      messages: {
        orderBy: { createdAt: 'asc' },
        include: { attachment: true, writtenBy: { select: { username: true } } },
      },
    },
  });
  if (!conversation) return null;
  // Fan, creadora o alguien de su equipo de chat.
  const role = await getChatRole(conversation, viewerId);
  if (!role) return null;
  return { ...conversation, role };
}

async function ConversationView({
  viewerId,
  ...conversation
}: NonNullable<Awaited<ReturnType<typeof getConversation>>> & { viewerId: string }) {
  // El chatter ve el chat como si fuera ella (sus mensajes, a la derecha).
  const iAmCreator = conversation.role !== 'fan';
  const isAssistant = conversation.role === 'assistant';
  const sideId = iAmCreator ? conversation.model.userId : viewerId;
  const messages = await buildMessageRows(conversation.messages, sideId, iAmCreator);

  // Quien esta al otro lado.
  const card = iAmCreator
    ? {
        id: conversation.user.id,
        name: conversation.user.name ?? conversation.user.username ?? 'Fan',
        image: conversation.user.image,
        profileHref: conversation.user.username ? `/u/${conversation.user.username}` : null,
      }
    : {
        id: conversation.model.userId,
        name: conversation.model.stageName,
        image: conversation.model.avatarUrl,
        profileHref: `/models/${conversation.model.slug}`,
      };

  const waitingAccept = conversation.startedByModel && conversation.acceptedAt === null;
  const [blocked, blockedByMe, wallet] = await Promise.all([
    isBlockedBetween(sideId, card.id),
    iBlocked(sideId, card.id),
    iAmCreator
      ? null
      : prisma.wallet.findUnique({ where: { userId: viewerId }, select: { balance: true } }),
    // Abrirlo (o que se recargue mientras lo tienes abierto) es leerlo.
    prisma.conversation.update({
      where: { id: conversation.id },
      data: iAmCreator ? { modelReadAt: new Date() } : { userReadAt: new Date() },
    }),
  ]);

  // Quien puede escribir ahora mismo, y si no, por que.
  let canSend = !blocked;
  let reason: string | undefined = blocked
    ? 'No podeis escribiros: hay un bloqueo entre vosotros.'
    : undefined;
  if (canSend && iAmCreator && waitingAccept) {
    canSend = false;
    reason = `Solicitud enviada. Podras seguir escribiendo cuando ${card.name} la acepte.`;
  }
  if (canSend && !iAmCreator && conversation.unlockPriceTokens > 0 && (wallet?.balance ?? 0) <= 0) {
    canSend = false;
    reason = 'Necesitas tokens en tu monedero para seguir escribiendo.';
  }

  return (
    <div className="container max-w-2xl space-y-4 py-4">
      {isAssistant && (
        <p className="rounded-xl border border-primary/30 bg-primary/5 px-3 py-2 text-xs text-muted-foreground">
          Escribes como <strong className="text-foreground">{conversation.model.stageName}</strong>. El
          fan no ve que eres del equipo.
        </p>
      )}
      <ChatHeader
        name={card.name}
        image={card.image}
        profileHref={card.profileHref}
        backHref={isAssistant ? `/mensajes?equipo=${conversation.model.id}` : '/mensajes'}
        safety={
          isAssistant ? null : (
            <SafetyMenu
              targetUserId={card.id}
              targetName={card.name}
              context={`conversation:${conversation.id}`}
              reportLabel="Denunciar chat"
              initialBlocked={blockedByMe}
              isAuthenticated
            />
          )
        }
      />

      {!iAmCreator && waitingAccept && !blocked && (
        <ChatRequestBar
          kind="conversation"
          id={conversation.id}
          fromName={card.name}
          fromUserId={card.id}
        />
      )}

      <MessageThread
        conversationId={conversation.id}
        messages={messages}
        canSend={canSend}
        disabledReason={reason}
        isModel={iAmCreator}
      />
    </div>
  );
}
