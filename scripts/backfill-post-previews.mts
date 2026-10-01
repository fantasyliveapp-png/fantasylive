/* eslint-disable no-console */
/**
 * Crea la miniatura borrosa de las fotos de publicaciones que no la tienen
 * (p. ej. las que vinieron de los packs antiguos). Sin ella, una publicacion
 * de pago no ensena nada antes de comprarla. Se puede reejecutar.
 *
 * Uso:
 *   npm run db:backfill-previews
 */

import { PrismaClient } from '@prisma/client';

import { makeBlurredPreview } from '../src/lib/chat-bundles';

const prisma = new PrismaClient();

async function main() {
  const assets = await prisma.postAsset.findMany({
    where: { previewKey: null, mimeType: { startsWith: 'image/' } },
    select: { id: true, storageKey: true, mimeType: true, post: { select: { id: true, modelId: true } } },
  });
  console.log(`Fotos sin miniatura: ${assets.length}`);
  let done = 0;
  for (const a of assets) {
    const previewKey = await makeBlurredPreview(
      a.storageKey,
      a.mimeType,
      `models/${a.post.modelId}/posts/${a.post.id}`,
    );
    if (!previewKey) continue;
    await prisma.postAsset.update({ where: { id: a.id }, data: { previewKey } });
    done += 1;
  }
  console.log(`Hecho: ${done} miniaturas creadas.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
