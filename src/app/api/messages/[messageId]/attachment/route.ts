import { NextRequest, NextResponse } from 'next/server';

import { getCurrentUser } from '@/lib/auth/guards';
import { prisma } from '@/lib/prisma';
import { resolveAssetUrl } from '@/lib/storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/messages/:messageId/attachment
 *
 * Devuelve una URL firmada SOLO si quien pregunta es quien mando el mensaje,
 * el archivo es gratis, o ya lo desbloqueo. Nunca expone la clave de S3.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ messageId: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { messageId } = await params;

  const message = await prisma.message.findUnique({
    where: { id: messageId },
    include: {
      attachment: true,
      conversation: { select: { userId: true, modelId: true, model: { select: { userId: true } } } },
    },
  });

  if (!message || !message.attachment) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  }

  const isParticipant =
    message.conversation.userId === user.id ||
    message.conversation.model.userId === user.id;
  if (!isParticipant) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const attachment = message.attachment;
  const isSender = message.senderId === user.id;
  const isFree = attachment.priceTokens <= 0;

  const unlocked = isSender
    ? true
    : isFree
      ? true
      : Boolean(
          await prisma.messageAttachmentUnlock.findUnique({
            where: {
              userId_attachmentId: { userId: user.id, attachmentId: attachment.id },
            },
            select: { id: true },
          }),
        );

  if (!unlocked) {
    return NextResponse.json({
      locked: true,
      priceTokens: attachment.priceTokens,
      mimeType: attachment.mimeType,
    });
  }

  const url = await resolveAssetUrl(attachment.storageKey, { isPublic: false });

  return NextResponse.json({
    locked: false,
    priceTokens: attachment.priceTokens,
    mimeType: attachment.mimeType,
    url,
  });
}
