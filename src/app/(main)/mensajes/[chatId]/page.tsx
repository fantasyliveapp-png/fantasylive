import type { Metadata } from 'next';
import { DistributorBadge } from '@/components/distributors/distributor-badge';
import { config } from '@/lib/config';
import { countryFlag } from '@/lib/countries';
import { operatingBlock } from '@/lib/distributors';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, BadgeCheck } from 'lucide-react';

import { type DealView } from '@/components/messages/deal-cards';
import { MessageThread } from '@/components/messages/message-thread';
import { StartPrivateCallButton } from '@/components/calls/start-private-call-button';
import { CouponButton } from '@/components/messages/coupon-button';
import { applyRateOffer, getCallOffer, getContentOffer } from '@/lib/creator-offers';
import { canCallNow } from '@/lib/call-presence';
import { applySubscriberDiscount, getActiveSubscription } from '@/lib/subscriptions';
import { ChatRequestBar, PeerChatThread } from '@/components/social/chat-thread';
import { SafetyMenu } from '@/components/social/safety-menu';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { requireUser } from '@/lib/auth/guards';
import { isBlockedBetween } from '@/lib/chat';
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
  call,
}: {
  name: string;
  image: string | null;
  profileHref: string | null;
  safety: React.ReactNode;
  /** Fan con un creador: boton de videollamada. */
  call?: React.ReactNode;
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
      <Link href="/mensajes" className="rounded-full p-1.5 hover:bg-muted" aria-label="Volver">
        <ArrowLeft className="h-5 w-5" />
      </Link>
      {profileHref ? (
        <Link href={profileHref} className="flex min-w-0 items-center gap-3">
          {who}
        </Link>
      ) : (
        <span className="flex min-w-0 items-center gap-3">{who}</span>
      )}
      <div className="ml-auto flex items-center gap-1">
        {call}
        {safety}
      </div>
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
  const [blocked, blockedByMe, theirDistributor] = await Promise.all([
    isBlockedBetween(viewerId, other.id),
    iBlocked(viewerId, other.id),
    // Distribuidores oficiales: el fan les pide tokens por aqui.
    config.distributors.enabled ? prisma.distributor.findUnique({ where: { userId: other.id } }) : null,
    // Abrirlo (o que se recargue mientras lo tienes abierto) es leerlo.
    prisma.peerChat.update({
      where: { id: chat.id },
      data: chat.userAId === viewerId ? { readAtA: new Date() } : { readAtB: new Date() },
    }),
  ]);

  const officialSeller = theirDistributor && !operatingBlock(theirDistributor) ? theirDistributor : null;

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

      {officialSeller && (
        <p className="flex items-start gap-2 rounded-2xl border border-state-connected/40 bg-state-connected/10 p-3 text-sm">
          <DistributorBadge className="shrink-0" />
          <span>
            {officialSeller.countries.map((c) => countryFlag(c)).join(' ')} {officialSeller.legalName}.{' '}
            <a href="/distribuidores" className="font-semibold underline">
              Compra protegida
            </a>
            : tus tokens quedan reservados hasta que pagues. Nunca le des tu contraseña.
          </span>
        </p>
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
        select: {
          id: true,
          userId: true,
          slug: true,
          stageName: true,
          avatarUrl: true,
          messagingEnabled: true,
          messagePriceTokens: true,
          isOnline: true,
          lastOnlineAt: true,
          privateRateCentitokens: true,
          minPrivateMinutes: true,
          acceptsBookings: true,
          kycStatus: true,
        },
      },
      messages: {
        orderBy: { createdAt: 'asc' },
        include: {
          attachment: { include: { files: { orderBy: { sortOrder: 'asc' } } } },
          deliveredRequest: { select: { id: true } },
        },
      },
    },
  });
  if (!conversation) return null;
  if (conversation.userId !== viewerId && conversation.model.userId !== viewerId) return null;
  return conversation;
}

async function ConversationView({
  viewerId,
  ...conversation
}: NonNullable<Awaited<ReturnType<typeof getConversation>>> & { viewerId: string }) {
  const iAmCreator = conversation.model.userId === viewerId;
  // Rebajas o cupon del creador en su contenido (lo ve el fan con el precio tachado).
  const contentOffer = iAmCreator ? null : await getContentOffer(conversation.model.id, viewerId);
  const messages = await buildMessageRows(conversation.messages, viewerId, contentOffer);

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
  const [blocked, blockedByMe, wallet, deals] = await Promise.all([
    isBlockedBetween(viewerId, card.id),
    iBlocked(viewerId, card.id),
    iAmCreator
      ? null
      : prisma.wallet.findUnique({ where: { userId: viewerId }, select: { balance: true } }),
    // Pedidos y citas de esta pareja: tarjetas dentro del hilo.
    Promise.all([
      prisma.contentRequest.findMany({
        where: { modelId: conversation.model.id, userId: conversation.userId },
        orderBy: { createdAt: 'asc' },
        take: 50,
        select: { id: true, createdAt: true, status: true, description: true, quotedTokens: true, modelNote: true },
      }),
      prisma.booking.findMany({
        where: { modelId: conversation.model.id, userId: conversation.userId },
        orderBy: { createdAt: 'asc' },
        take: 50,
        select: {
          id: true,
          createdAt: true,
          status: true,
          startsAt: true,
          durationMinutes: true,
          totalTokens: true,
          userNote: true,
        },
      }),
      // Videollamadas directas de esta pareja (una linea cada una).
      prisma.callSession.findMany({
        where: {
          type: 'PRIVATE',
          bookingId: null,
          callerId: conversation.userId,
          calleeId: conversation.model.userId,
          status: { in: ['ACTIVE', 'ENDED', 'CANCELLED'] },
        },
        orderBy: { createdAt: 'desc' },
        take: 30,
        select: {
          id: true,
          createdAt: true,
          status: true,
          endReason: true,
          billedSeconds: true,
          tokensSpent: true,
          tokensEarned: true,
        },
      }),
      // Cupones que el creador le envio a este fan.
      prisma.creatorOffer.findMany({
        where: { modelId: conversation.model.id, kind: 'COUPON', fanId: conversation.userId },
        orderBy: { createdAt: 'asc' },
        take: 20,
        select: { id: true, createdAt: true, target: true, percentOff: true, endsAt: true, usedAt: true, active: true },
      }),
    ]).then(([requests, bookings, calls, coupons]): DealView[] => [
      ...coupons.map((c) => ({
        kind: 'coupon' as const,
        id: c.id,
        createdAt: c.createdAt.toISOString(),
        target: c.target ?? ('CONTENT' as const),
        percentOff: c.percentOff,
        endsAt: c.endsAt?.toISOString() ?? null,
        status: c.usedAt
          ? ('used' as const)
          : c.active && c.endsAt && c.endsAt > new Date()
            ? ('live' as const)
            : ('expired' as const),
      })),
      ...calls.map((c) => ({
        kind: 'call' as const,
        id: c.id,
        createdAt: c.createdAt.toISOString(),
        outcome:
          c.status === 'ACTIVE'
            ? ('live' as const)
            : c.status === 'ENDED'
              ? ('done' as const)
              : c.endReason === 'TIMEOUT'
                ? ('missed' as const)
                : c.endReason === 'PARTNER_HANGUP'
                  ? ('declined' as const)
                  : ('cancelled' as const),
        seconds: c.billedSeconds,
        tokens: iAmCreator ? c.tokensEarned : c.tokensSpent,
      })),
      ...requests.map((r) => ({ kind: 'request' as const, ...r, createdAt: r.createdAt.toISOString() })),
      ...bookings.map((b) => ({
        kind: 'booking' as const,
        ...b,
        createdAt: b.createdAt.toISOString(),
        startsAt: b.startsAt.toISOString(),
      })),
    ]),
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
  // Chat que existe solo por un pedido o una cita: el fan lo abre para escribir.
  const lockedForFan = !iAmCreator && !conversation.chatUnlocked && !blocked;
  if (canSend && lockedForFan) {
    canSend = false;
    reason = conversation.model.messagingEnabled ? undefined : 'Este perfil no recibe mensajes; aqui ves tus pedidos y reservas.';
  }
  if (canSend && !iAmCreator && conversation.unlockPriceTokens > 0 && (wallet?.balance ?? 0) <= 0) {
    canSend = false;
    reason = 'Necesitas tokens en tu monedero para seguir escribiendo.';
  }

  // Videollamada desde el chat (solo el fan llama). Activo si el creador
  // tiene "Recibo llamadas" y no esta en directo ni en otra llamada.
  let callButton: React.ReactNode = null;
  if (!iAmCreator && !blocked && conversation.model.kycStatus === 'APPROVED') {
    const m = conversation.model;
    const [subscription, callable, callOffer] = await Promise.all([
      getActiveSubscription(viewerId, m.id),
      canCallNow(m),
      getCallOffer({ id: m.id, userId: m.userId }, viewerId),
    ]);
    // Igual que al cobrar: gana el descuento mayor (suscriptor u oferta).
    const subscriberRate = subscription
      ? applySubscriberDiscount(m.privateRateCentitokens, subscription.discountPercent)
      : m.privateRateCentitokens;
    const rate = callOffer
      ? Math.min(subscriberRate, applyRateOffer(m.privateRateCentitokens, callOffer.percentOff))
      : subscriberRate;
    callButton = (
      <StartPrivateCallButton
        variant="icon"
        slug={m.slug}
        stageName={m.stageName}
        isOnline={callable}
        rateCentitokens={rate}
        minMinutes={m.minPrivateMinutes}
        isAuthenticated
      />
    );
  }

  // El creador puede enviarle un cupon a este fan.
  if (iAmCreator && !blocked) {
    callButton = <CouponButton fanId={conversation.userId} fanName={card.name} />;
  }

  return (
    <div className="container max-w-2xl space-y-4 py-4">
      <ChatHeader
        name={card.name}
        image={card.image}
        profileHref={card.profileHref}
        call={callButton}
        safety={
          <SafetyMenu
            targetUserId={card.id}
            targetName={card.name}
            context={`conversation:${conversation.id}`}
            reportLabel="Denunciar chat"
            initialBlocked={blockedByMe}
            isAuthenticated
          />
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
        deals={deals}
        unlockChat={lockedForFan ? { priceTokens: conversation.model.messagePriceTokens } : null}
      />
    </div>
  );
}
