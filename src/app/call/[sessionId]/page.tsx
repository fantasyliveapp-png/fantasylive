import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';

import { VideoCallRoom } from '@/components/calls/video-call-room';
import { requireUser } from '@/lib/auth/guards';
import { prisma } from '@/lib/prisma';

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
      ratePerMinute: true,
    },
  });

  if (!session) notFound();

  const isParticipant =
    session.callerId === user.id || session.calleeId === user.id;
  if (!isParticipant) notFound();

  if (session.status === 'ENDED' || session.status === 'CANCELLED') {
    redirect('/dashboard?call=ended');
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
            modelProfile: { select: { stageName: true, slug: true, avatarUrl: true } },
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

  return (
    <VideoCallRoom
      sessionId={session.id}
      callType={session.type}
      ratePerMinute={session.ratePerMinute}
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
