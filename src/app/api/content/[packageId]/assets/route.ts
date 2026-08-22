import { NextRequest, NextResponse } from 'next/server';

import { getCurrentUser } from '@/lib/auth/guards';
import { prisma } from '@/lib/prisma';
import { resolveAssetUrl } from '@/lib/storage';
import { getActiveSubscription } from '@/lib/subscriptions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/content/:packageId/assets
 *
 * Devuelve URLs firmadas de corta duracion SOLO si el usuario desbloqueo el
 * paquete (o es su duena/o, o admin). Las claves de S3 nunca salen al cliente.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ packageId: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { packageId } = await params;

  const pkg = await prisma.contentPackage.findUnique({
    where: { id: packageId },
    include: {
      model: { select: { id: true, userId: true } },
      assets: { orderBy: { sortOrder: 'asc' } },
    },
  });

  if (!pkg) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  }

  const isOwner = pkg.model.userId === user.id;
  const isAdmin = user.role === 'ADMIN';

  const unlock = isOwner
    ? true
    : Boolean(
        await prisma.contentUnlock.findUnique({
          where: { userId_packageId: { userId: user.id, packageId } },
        }),
      );

  // El contenido exclusivo se accede mientras la suscripcion este activa,
  // no queda desbloqueado para siempre como un ContentUnlock comprado.
  const subscriberAccess =
    !isOwner &&
    pkg.subscriberOnly &&
    Boolean(await getActiveSubscription(user.id, pkg.model.id));

  const hasAccess =
    isOwner || isAdmin || unlock || pkg.isPublic || subscriberAccess;

  // Un paquete oculto (isPublished: false) solo es visible para quien tiene
  // acceso real (dueña, admin o desbloqueo); para el resto no existe.
  if (!pkg.isPublished && !hasAccess) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  }

  if (!hasAccess) {
    // Sin acceso: solo se devuelven los teasers marcados como preview
    const previews = await Promise.all(
      pkg.assets
        .filter((a) => a.isPreview)
        .map(async (a) => ({
          id: a.id,
          mimeType: a.mimeType,
          url: await resolveAssetUrl(a.storageKey, { isPublic: true }),
          isPreview: true,
        })),
    );

    return NextResponse.json({
      locked: true,
      priceTokens: pkg.priceTokens,
      assetCount: pkg.assetCount,
      assets: previews,
    });
  }

  const assets = await Promise.all(
    pkg.assets.map(async (a) => ({
      id: a.id,
      mimeType: a.mimeType,
      width: a.width,
      height: a.height,
      durationSec: a.durationSec,
      isPreview: a.isPreview,
      url: await resolveAssetUrl(a.storageKey, { isPublic: pkg.isPublic }),
    })),
  );

  return NextResponse.json({
    locked: false,
    priceTokens: pkg.priceTokens,
    assetCount: pkg.assetCount,
    assets,
  });
}
