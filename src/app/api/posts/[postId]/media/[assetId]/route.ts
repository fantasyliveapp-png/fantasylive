import { NextResponse, type NextRequest } from 'next/server';
import sharp from 'sharp';

import { getCurrentUser } from '@/lib/auth/guards';
import { GEO_BLOCKED_MESSAGE, isBlockedForViewer } from '@/lib/geo';
import { prisma } from '@/lib/prisma';
import { getObjectBuffer } from '@/lib/storage';
import { getActiveSubscription } from '@/lib/subscriptions';
import { watermarkLabel, watermarkSvg } from '@/lib/watermark';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Lado mayor con el que se sirve una foto de pago. */
const MAX_SIDE = 2048;

/**
 * GET /api/posts/<postId>/media/<assetId>
 *
 * Sirve una FOTO de una publicacion de pago (o de suscriptores) con una marca
 * de agua con el @usuario de quien la mira, tejida en los pixeles. Si alguien
 * la descarga o le hace captura y la sube a otro sitio, se sabe de que cuenta
 * salio. El original sin marca nunca llega al navegador de un fan.
 *
 * Solo para quien tiene derecho a verla (la ha desbloqueado o esta suscrito).
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ postId: string; assetId: string }> },
) {
  const { postId, assetId } = await params;

  const viewer = await getCurrentUser();
  if (!viewer) return new NextResponse('Unauthorized', { status: 401 });

  const asset = await prisma.postAsset.findFirst({
    where: { id: assetId, postId },
    select: {
      storageKey: true,
      mimeType: true,
      post: {
        select: {
          id: true,
          visibility: true,
          isPublished: true,
          createdAt: true,
          modelId: true,
          model: { select: { userId: true, blockedCountries: true } },
        },
      },
    },
  });
  if (!asset || !asset.mimeType.startsWith('image/')) {
    return new NextResponse('Not found', { status: 404 });
  }

  const { post } = asset;
  const isOwner = post.model.userId === viewer.id;
  const isAdmin = viewer.role === 'ADMIN';

  if (!isOwner && !isAdmin) {
    if (!post.isPublished || post.createdAt > new Date()) {
      return new NextResponse('Not found', { status: 404 });
    }
    if (await isBlockedForViewer(post.model.blockedCountries)) {
      return new NextResponse(GEO_BLOCKED_MESSAGE, { status: 451 });
    }
    const allowed =
      post.visibility === 'PUBLIC' ||
      (post.visibility === 'LOCKED' &&
        (await prisma.postUnlock.findUnique({
          where: { userId_postId: { userId: viewer.id, postId: post.id } },
          select: { id: true },
        }))) ||
      (post.visibility === 'SUBSCRIBERS' &&
        (await getActiveSubscription(viewer.id, post.modelId)));
    if (!allowed) return new NextResponse('Forbidden', { status: 403 });
  }

  const original = await getObjectBuffer(asset.storageKey);
  if (!original) return new NextResponse('Not found', { status: 404 });

  const account = await prisma.user.findUnique({
    where: { id: viewer.id },
    select: { id: true, username: true },
  });
  const label = watermarkLabel(account?.username ?? null, viewer.id);

  try {
    const base = sharp(original).rotate().resize({
      width: MAX_SIDE,
      height: MAX_SIDE,
      fit: 'inside',
      withoutEnlargement: true,
    });
    const { data, info } = await base.toBuffer({ resolveWithObject: true });

    const output = await sharp(data)
      .composite([
        { input: Buffer.from(watermarkSvg(info.width, info.height, label)), top: 0, left: 0 },
      ])
      .jpeg({ quality: 86, mozjpeg: true })
      .toBuffer();

    return new NextResponse(new Uint8Array(output), {
      headers: {
        'Content-Type': 'image/jpeg',
        // Personal de quien la mira: nada de caches compartidas.
        'Cache-Control': 'private, max-age=600',
        'Content-Disposition': 'inline',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch {
    return new NextResponse('No se pudo procesar la imagen', { status: 500 });
  }
}
