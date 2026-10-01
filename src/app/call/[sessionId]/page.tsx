import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';

import { OutgoingCall } from '@/components/calls/outgoing-call';
import { VideoCallRoom } from '@/components/calls/video-call-room';
import { requireUser } from '@/lib/auth/guards';
import { prisma } from '@/lib/prisma';
import { formatRate } from '@/lib/rates';

export const metadata: Metadata = { title: 'Llamada en vivo' };
export const dynamic = 'force-dynamic';

export default async function CallPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  const user = await requireUser(`/call/${sessionId}`);

  const session = await prisma.callSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      type: true,
      status: true,
      callerId: true,
      calleeId: true,
      rateCentitokens: true,
      bookingId: true,
      minBilledSeconds: true,
    },
  });

  if (!session) notFound();

  const isParticipant =
    session.callerId === user.id || session.calleeId === user.id;
  if (!isParticipant) notFound();

  // Chat de la pareja fan-creador (si lo hay), para "Escribirle".
  const pair = await prisma.conversation.findFirst({
    where: {
      OR: [
        { userId: session.callerId, model: { userId: session.calleeId ?? '' } },
        { userId: session.calleeId ?? '', model: { userId: session.callerId } },
      ],
    },
    select: { id: true },
  });
  const chatHref = pair ? `/mensajes/${pair.id}` : null;

  if (session.status === 'ENDED' || session.status === 'CANCELLED') {
    // Llamada perdida o ya terminada: el creador va al chat con ese fan.
    redirect(session.calleeId === user.id && chatHref ? chatHref : '/dashboard?call=ended');
  }

  const partnerId =
    session.callerId === user.id ? session.calleeId : session.callerId;

  const [partner, wallet] = await Promise.all([
    partnerId
      ? prisma.user.findUnique({
          where: { id: partnerId },
          select: {
            id: true,
            name: true,
            image: true,
            country: true,
            modelProfile: { select: { stageName: true, slug: true, avatarUrl: true, acceptsBookings: true } },
          },
        })
      : null,
    prisma.wallet.findUnique({
      where: { userId: user.id },
      select: { balance: true },
    }),
  ]);

  // Solo paga quien inicio la llamada; la modelo (callee) cobra
  const isPayer = session.callerId === user.id;

  // Llamada directa que aun suena: el fan ve "Llamando..." hasta que la cojan.
  if (isPayer && session.type === 'PRIVATE' && !session.bookingId && session.status === 'PENDING') {
    return (
      <OutgoingCall
        sessionId={session.id}
        name={partner?.modelProfile?.stageName ?? partner?.name ?? 'Llamando'}
        image={partner?.modelProfile?.avatarUrl ?? partner?.image ?? null}
        rate={formatRate(session.rateCentitokens)}
        chatHref={chatHref}
        profileHref={partner?.modelProfile ? `/models/${partner.modelProfile.slug}` : null}
        canBook={Boolean(partner?.modelProfile?.acceptsBookings)}
      />
    );
  }

  return (
    <VideoCallRoom
      chatHref={chatHref}
      minBilledSeconds={session.minBilledSeconds}
      sessionId={session.id}
      callType={session.type}
      rateCentitokens={session.rateCentitokens}
      isPayer={isPayer}
      initialBalance={wallet?.balance ?? 0}
      allowSkip={session.type === 'RANDOM' || session.type === 'VIP_RANDOM'}
      partner={
        partner
          ? {
              id: partner.id,
              name: partner.name,
              image: partner.modelProfile?.avatarUrl ?? partner.image,
              country: partner.country,
              stageName: partner.modelProfile?.stageName ?? null,
              slug: partner.modelProfile?.slug ?? null,
            }
          : null
      }
    />
  );
}
