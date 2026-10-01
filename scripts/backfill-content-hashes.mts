/* eslint-disable no-console */
/**
 * Calcula la huella (SHA-256) de los archivos de la Boveda y de las
 * publicaciones que aun no la tienen, para que el control de contenido
 * repetido entre chat y directos (src/lib/content-guard.ts) tambien cubra lo
 * subido antes. Se puede reejecutar: solo toca lo que falta.
 *
 * Uso:
 *   npm run db:backfill-hashes
 */

import { createHash } from 'node:crypto';

import { PrismaClient } from '@prisma/client';

import { getObjectBuffer } from '../src/lib/storage';

const prisma = new PrismaClient();
const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex');

async function main() {
  const vault = await prisma.vaultItem.findMany({ where: { contentHash: null }, select: { id: true, storageKey: true } });
  const assets = await prisma.postAsset.findMany({ where: { contentHash: null }, select: { id: true, storageKey: true } });
  console.log(`Sin huella: ${vault.length} de la Boveda, ${assets.length} de publicaciones.`);
  let done = 0;
  let missing = 0;
  for (const v of vault) {
    const buf = await getObjectBuffer(v.storageKey);
    if (!buf) { missing++; continue; }
    await prisma.vaultItem.update({ where: { id: v.id }, data: { contentHash: sha256(buf) } });
    done++;
  }
  for (const a of assets) {
    const buf = await getObjectBuffer(a.storageKey);
    if (!buf) { missing++; continue; }
    await prisma.postAsset.update({ where: { id: a.id }, data: { contentHash: sha256(buf) } });
    done++;
  }
  console.log(`Hecho: ${done} huellas calculadas${missing ? `, ${missing} archivos no encontrados (externos o borrados)` : ''}.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
