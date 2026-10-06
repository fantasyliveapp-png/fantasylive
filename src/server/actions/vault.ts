'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import type { VaultSection } from '@prisma/client';

import { getAuthedUserOrThrow } from '@/lib/auth/guards';
import { checkNoContactInfo } from '@/lib/content-filter';
import { createNotification } from '@/lib/notifications';
import { prisma } from '@/lib/prisma';
import { buildVaultKey, checkUpload, createUploadUrl, deleteObject, isVaultKeyOf } from '@/lib/storage';
import { MAX_VAULT_ITEMS, MAX_VAULT_PRICE, VAULT_SECTION_IDS } from '@/lib/vault';
import {
  bundleLabel,
  createBundleMessage,
  deliverableRequest,
  markRequestDelivered,
  MAX_BUNDLE_FILES,
  vaultItemPreview,
} from '@/lib/chat-bundles';
import { getVaultForChat, type ChatVault } from '@/lib/vault-data';
import { blockedFor, findContentPlaces } from '@/lib/content-guard';

export interface VaultActionResult<T = undefined> {
  ok: boolean;
  error?: string;
  message?: string;
  data?: T;
}

const sectionSchema = z.enum(VAULT_SECTION_IDS as [VaultSection, ...VaultSection[]]);
const priceSchema = z.number().int().min(1).max(MAX_VAULT_PRICE);

async function requireCreator() {
  const user = await getAuthedUserOrThrow();
  const profile = await prisma.modelProfile.findUnique({
    where: { userId: user.id },
    select: {
      id: true,
      vaultPriceLevel1: true,
      vaultPriceLevel2: true,
      vaultPriceLevel3: true,
      vaultPriceSpecial: true,
    },
  });
  if (!profile) throw new Error('Solo para creadores.');
  return { user, profile };
}

async function ownFolder(modelId: string, folderId: string | null | undefined) {
  if (!folderId) return null;
  const folder = await prisma.vaultFolder.findUnique({ where: { id: folderId } });
  if (!folder || folder.modelId !== modelId) throw new Error('Carpeta no encontrada.');
  return folder.id;
}

function done() {
  revalidatePath('/dashboard/model/contenido');
}

/** Un paquete sin archivos (se movieron o borraron) desaparece. */
async function dropEmptyPacks(modelId: string) {
  await prisma.vaultPack.deleteMany({ where: { modelId, items: { none: {} } } });
}

// ---------------------------------------------------------------------------
// CREADORA: su Boveda
// ---------------------------------------------------------------------------

export async function requestVaultUploadUrlAction(input: {
  filename: string;
  contentType: string;
  sizeBytes: number;
}): Promise<VaultActionResult<{ uploadUrl: string; key: string }>> {
  try {
    const { profile } = await requireCreator();
    if (!/^(image|video)\//.test(input.contentType)) {
      return { ok: false, error: 'Solo fotos o videos.' };
    }
    const invalid = checkUpload(input.contentType, input.sizeBytes, ['image', 'video']);
    if (invalid) return { ok: false, error: invalid };
    const count = await prisma.vaultItem.count({ where: { modelId: profile.id } });
    if (count >= MAX_VAULT_ITEMS) {
      return { ok: false, error: `Maximo ${MAX_VAULT_ITEMS} archivos en la Boveda.` };
    }
    const key = buildVaultKey({ modelId: profile.id, filename: input.filename });
    const uploadUrl = await createUploadUrl({ key, contentType: input.contentType, sizeBytes: input.sizeBytes });
    if (!uploadUrl) return { ok: false, error: 'El almacenamiento no esta configurado.' };
    return { ok: true, data: { uploadUrl, key } };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

/**
 * Guarda en la Boveda los archivos ya subidos: sueltos (cada uno con su
 * precio) o, con `pack`, todos juntos como un paquete con un precio.
 * Nunca entra lo que ya es de un pack de directo (tiene que ser exclusivo).
 */
export async function addVaultItemsAction(input: {
  section: VaultSection;
  folderId?: string | null;
  files: { key: string; mimeType: string; sizeBytes?: number; contentHash?: string | null }[];
  /** Precio propio de lo que se sube (si no, el de su nivel). */
  priceTokens?: number | null;
  /** Subirlos como un paquete. */
  pack?: { name: string; priceTokens: number } | null;
}): Promise<VaultActionResult> {
  try {
    const { profile } = await requireCreator();
    const section = sectionSchema.parse(input.section);
    const folderId = await ownFolder(profile.id, input.folderId);
    let files = input.files.filter(
      (f) => isVaultKeyOf(profile.id, f.key) && /^(image|video)\//.test(f.mimeType),
    );
    if (files.length === 0) return { ok: false, error: 'No hay archivos validos.' };

    // Sin repetir: lo de directos no entra; lo que ya esta en la Boveda, tampoco.
    const places = await findContentPlaces(
      profile.id,
      files.map((f) => f.contentHash ?? '').filter(Boolean),
    );
    const blocked = files.filter((f) => f.contentHash && blockedFor('chat', places.get(f.contentHash)));
    const repeated = files.filter((f) => f.contentHash && places.get(f.contentHash) === 'chat');
    files = files.filter((f) => !blocked.includes(f) && !repeated.includes(f));
    const skipped: string[] = [];
    if (blocked.length) skipped.push(`${blocked.length} ya ${blocked.length === 1 ? 'es' : 'son'} de un pack de directo`);
    if (repeated.length) skipped.push(`${repeated.length} ya ${repeated.length === 1 ? 'estaba' : 'estaban'} en tu Bóveda`);
    if (files.length === 0) {
      return { ok: false, error: `No se ha guardado nada: ${skipped.join(' y ')}.` };
    }

    const paid = section !== 'TEASER';
    const pack =
      paid && input.pack
        ? { name: input.pack.name.trim().slice(0, 60) || 'Paquete', priceTokens: priceSchema.parse(input.pack.priceTokens) }
        : null;
    const priceTokens = !paid || input.priceTokens == null ? null : priceSchema.parse(input.priceTokens);

    await prisma.$transaction(async (tx) => {
      const created = pack
        ? await tx.vaultPack.create({ data: { modelId: profile.id, ...pack }, select: { id: true } })
        : null;
      await tx.vaultItem.createMany({
        data: files.map((f) => ({
          modelId: profile.id,
          section,
          folderId,
          storageKey: f.key,
          mimeType: f.mimeType,
          sizeBytes: f.sizeBytes ?? null,
          priceTokens: created ? null : priceTokens,
          packId: created?.id ?? null,
          contentHash: f.contentHash ?? null,
        })),
      });
    });
    done();
    const saved = pack
      ? `Paquete «${pack.name}» creado con ${files.length} ${files.length === 1 ? 'archivo' : 'archivos'}.`
      : files.length === 1
        ? 'Guardado en tu Boveda.'
        : `${files.length} archivos guardados.`;
    return { ok: true, message: skipped.length ? `${saved} (${skipped.join(' y ')}).` : saved };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

/** Junta varios archivos sueltos de pago en un paquete con un precio. */
export async function createVaultPackAction(input: {
  name: string;
  priceTokens: number;
  itemIds: string[];
}): Promise<VaultActionResult> {
  try {
    const { profile } = await requireCreator();
    const priceTokens = priceSchema.parse(input.priceTokens);
    const name = input.name.trim().slice(0, 60);
    if (!name) return { ok: false, error: 'Ponle un nombre al paquete.' };
    const items = await prisma.vaultItem.findMany({
      where: { id: { in: input.itemIds.slice(0, MAX_BUNDLE_FILES * 2) }, modelId: profile.id, section: { not: 'TEASER' } },
      select: { id: true },
    });
    if (items.length < 2) return { ok: false, error: 'Elige al menos 2 archivos de pago.' };
    await prisma.$transaction(async (tx) => {
      const pack = await tx.vaultPack.create({ data: { modelId: profile.id, name, priceTokens }, select: { id: true } });
      await tx.vaultItem.updateMany({ where: { id: { in: items.map((i) => i.id) } }, data: { packId: pack.id } });
    });
    done();
    return { ok: true, message: `Paquete «${name}» creado.` };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

/** Cambia nombre o precio de un paquete. */
export async function updateVaultPackAction(input: {
  id: string;
  name?: string;
  priceTokens?: number;
}): Promise<VaultActionResult> {
  try {
    const { profile } = await requireCreator();
    const data: { name?: string; priceTokens?: number } = {};
    if (input.name !== undefined) {
      const name = input.name.trim().slice(0, 60);
      if (!name) return { ok: false, error: 'Ponle un nombre al paquete.' };
      data.name = name;
    }
    if (input.priceTokens !== undefined) data.priceTokens = priceSchema.parse(input.priceTokens);
    const res = await prisma.vaultPack.updateMany({ where: { id: input.id, modelId: profile.id }, data });
    if (res.count === 0) return { ok: false, error: 'Paquete no encontrado.' };
    done();
    return { ok: true, message: 'Paquete actualizado.' };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

/** Deshace un paquete: sus archivos vuelven a venderse sueltos. */
export async function deleteVaultPackAction(id: string): Promise<VaultActionResult> {
  try {
    const { profile } = await requireCreator();
    const pack = await prisma.vaultPack.findFirst({ where: { id, modelId: profile.id }, select: { id: true } });
    if (!pack) return { ok: false, error: 'Paquete no encontrado.' };
    await prisma.$transaction([
      prisma.vaultItem.updateMany({ where: { packId: id }, data: { packId: null } }),
      prisma.vaultPack.delete({ where: { id } }),
    ]);
    done();
    return { ok: true, message: 'Paquete deshecho: sus archivos se venden sueltos.' };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

/** Mover de seccion o carpeta, cambiar nota o precio (de uno o varios). */
export async function updateVaultItemsAction(input: {
  ids: string[];
  section?: VaultSection;
  /** null = sin carpeta; undefined = no tocar. */
  folderId?: string | null;
  note?: string | null;
  /** null = usar el del nivel. */
  priceTokens?: number | null;
}): Promise<VaultActionResult> {
  try {
    const { profile } = await requireCreator();
    const data: {
      section?: VaultSection;
      folderId?: string | null;
      note?: string | null;
      priceTokens?: number | null;
    } = {};
    if (input.section !== undefined) data.section = sectionSchema.parse(input.section);
    // Lo gratis no va en paquetes de pago.
    const leavePack = data.section === 'TEASER';
    if (input.folderId !== undefined) data.folderId = await ownFolder(profile.id, input.folderId);
    if (input.note !== undefined) data.note = input.note?.trim().slice(0, 80) || null;
    if (input.priceTokens !== undefined) {
      data.priceTokens = input.priceTokens === null ? null : priceSchema.parse(input.priceTokens);
    }
    const res = await prisma.vaultItem.updateMany({
      where: { id: { in: input.ids.slice(0, 200) }, modelId: profile.id },
      data: leavePack ? { ...data, packId: null } : data,
    });
    await dropEmptyPacks(profile.id);
    done();
    return {
      ok: true,
      message: res.count === 1 ? 'Guardado.' : `${res.count} archivos actualizados.`,
    };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

/**
 * Borra archivos de la Boveda. Lo que ya se envio por chat sigue viendose
 * (el fan lo compro), asi que el archivo solo se borra si nadie lo recibio.
 */
export async function deleteVaultItemsAction(ids: string[]): Promise<VaultActionResult> {
  try {
    const { profile } = await requireCreator();
    const items = await prisma.vaultItem.findMany({
      where: { id: { in: ids.slice(0, 200) }, modelId: profile.id },
      select: {
        id: true,
        storageKey: true,
        previewKey: true,
        _count: { select: { attachments: true, attachmentFiles: true } },
      },
    });
    await prisma.vaultItem.deleteMany({ where: { id: { in: items.map((i) => i.id) } } });
    await Promise.all(
      items
        .filter((i) => i._count.attachments === 0 && i._count.attachmentFiles === 0)
        .flatMap((i) => [i.storageKey, i.previewKey])
        .filter((k): k is string => Boolean(k))
        .map((k) => deleteObject(k).catch(() => undefined)),
    );
    await dropEmptyPacks(profile.id);
    done();
    return {
      ok: true,
      message: items.length === 1 ? 'Borrado.' : `${items.length} archivos borrados.`,
    };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

export async function saveVaultFolderAction(input: {
  id?: string;
  name: string;
}): Promise<VaultActionResult<{ id: string }>> {
  try {
    const { profile } = await requireCreator();
    const name = input.name.trim().slice(0, 30);
    if (name.length < 1) return { ok: false, error: 'Ponle un nombre.' };
    const clash = await prisma.vaultFolder.findUnique({
      where: { modelId_name: { modelId: profile.id, name } },
      select: { id: true },
    });
    if (clash && clash.id !== input.id) return { ok: false, error: 'Ya tienes una carpeta asi.' };
    if (input.id) {
      await ownFolder(profile.id, input.id);
      await prisma.vaultFolder.update({ where: { id: input.id }, data: { name } });
      done();
      return { ok: true, message: 'Carpeta renombrada.', data: { id: input.id } };
    }
    const count = await prisma.vaultFolder.count({ where: { modelId: profile.id } });
    if (count >= 50) return { ok: false, error: 'Maximo 50 carpetas.' };
    const folder = await prisma.vaultFolder.create({ data: { modelId: profile.id, name } });
    done();
    return { ok: true, message: 'Carpeta creada.', data: { id: folder.id } };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

/** Borra la carpeta; sus archivos se quedan en la Boveda, sin carpeta. */
export async function deleteVaultFolderAction(id: string): Promise<VaultActionResult> {
  try {
    const { profile } = await requireCreator();
    await ownFolder(profile.id, id);
    await prisma.vaultFolder.delete({ where: { id } });
    done();
    return { ok: true, message: 'Carpeta borrada. Los archivos siguen en tu Boveda.' };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

export async function updateVaultPricesAction(input: {
  level1: number;
  level2: number;
  level3: number;
  special: number;
}): Promise<VaultActionResult> {
  try {
    const { profile } = await requireCreator();
    const p = z
      .object({
        level1: priceSchema,
        level2: priceSchema,
        level3: priceSchema,
        special: priceSchema,
      })
      .safeParse(input);
    if (!p.success)
      return { ok: false, error: `Los precios van de 1 a ${MAX_VAULT_PRICE} tokens.` };
    await prisma.modelProfile.update({
      where: { id: profile.id },
      data: {
        vaultPriceLevel1: p.data.level1,
        vaultPriceLevel2: p.data.level2,
        vaultPriceLevel3: p.data.level3,
        vaultPriceSpecial: p.data.special,
      },
    });
    done();
    return { ok: true, message: 'Precios guardados.' };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

// ---------------------------------------------------------------------------
// DESDE EL CHAT
// ---------------------------------------------------------------------------

async function chatContext(conversationId: string, userId: string) {
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: {
      id: true,
      userId: true,
      startedByModel: true,
      acceptedAt: true,
      model: {
        select: {
          id: true,
          userId: true,
          stageName: true,
          vaultPriceLevel1: true,
          vaultPriceLevel2: true,
          vaultPriceLevel3: true,
          vaultPriceSpecial: true,
        },
      },
    },
  });
  if (!conversation) throw new Error('Conversacion no encontrada.');
  // Solo la propia creadora envia desde su Boveda.
  if (conversation.model.userId !== userId) throw new Error('Sin acceso a esta Boveda.');
  return { conversation };
}

export async function getChatVaultAction(
  conversationId: string,
): Promise<VaultActionResult<ChatVault>> {
  try {
    const user = await getAuthedUserOrThrow();
    const { conversation } = await chatContext(conversationId, user.id);
    const data = await getVaultForChat({
      modelId: conversation.model.id,
      prices: conversation.model,
      conversationId,
      fanId: conversation.userId,
    });
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

/**
 * La creadora envia uno o varios archivos de su Boveda en UN envio con UN
 * precio (el fan paga una vez y los ve todos). Con `requestId` entrega un
 * pedido a medida ya pagado: va gratis y el pedido queda entregado.
 */
export async function sendVaultItemsAction(input: {
  conversationId: string;
  itemIds: string[];
  priceTokens: number;
  body?: string;
  requestId?: string;
}): Promise<VaultActionResult> {
  try {
    const user = await getAuthedUserOrThrow();
    const { conversation } = await chatContext(input.conversationId, user.id);
    if (conversation.startedByModel && conversation.acceptedAt === null) {
      return { ok: false, error: 'Espera a que acepte tu solicitud de mensaje.' };
    }
    const wanted = [...new Set(input.itemIds)].slice(0, MAX_BUNDLE_FILES);
    if (wanted.length === 0) return { ok: false, error: 'Elige algo de la Boveda.' };

    const body = input.body?.trim().slice(0, 1000) || null;
    if (body) {
      const contactError = checkNoContactInfo(body);
      if (contactError) return { ok: false, error: contactError };
    }
    if (input.requestId) {
      await deliverableRequest(input.requestId, conversation.model.id, conversation.userId);
    }

    const found = await prisma.vaultItem.findMany({
      where: { id: { in: wanted }, modelId: conversation.model.id },
    });
    const byId = new Map(found.map((f) => [f.id, f]));
    const items = wanted.map((id) => byId.get(id)).filter((x) => x !== undefined);
    if (items.length === 0) return { ok: false, error: 'Esos archivos ya no estan en la Boveda.' };

    // Lo de "enganchar" va siempre gratis, y un pedido ya esta pagado.
    const allTeasers = items.every((i) => i.section === 'TEASER');
    const price =
      input.requestId || allTeasers
        ? 0
        : Math.min(Math.max(Math.round(input.priceTokens) || 0, 0), MAX_VAULT_PRICE);

    const previews = await Promise.all(items.map((i) => vaultItemPreview(i)));

    await prisma.$transaction(async (tx) => {
      const message = await createBundleMessage(tx, {
        conversationId: conversation.id,
        senderId: conversation.model.userId,
        body,
        priceTokens: price,
        files: items.map((i, idx) => ({
          storageKey: i.storageKey,
          mimeType: i.mimeType,
          sizeBytes: i.sizeBytes,
          previewKey: previews[idx],
          vaultItemId: i.id,
        })),
      });
      if (input.requestId) await markRequestDelivered(tx, input.requestId, message.id);
      await createNotification(tx, {
        userId: conversation.userId,
        type: input.requestId ? 'CONTENT_REQUEST_DELIVERED' : 'NEW_MESSAGE',
        title: input.requestId
          ? `${conversation.model.stageName} te entrego tu pedido`
          : price > 0
            ? `${conversation.model.stageName} te envio ${bundleLabel(items)} especiales`
            : `${conversation.model.stageName} te envio ${bundleLabel(items)}`,
        link: `/mensajes/${conversation.id}`,
      });
    });

    revalidatePath(`/mensajes/${conversation.id}`);
    if (input.requestId) revalidatePath('/dashboard/requests');
    return {
      ok: true,
      message: input.requestId
        ? 'Pedido entregado por chat.'
        : items.length === 1
          ? 'Enviado.'
          : `${items.length} archivos enviados en un solo envio.`,
    };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

function toMessage(error: unknown): string {
  if (error instanceof z.ZodError) return 'Datos no validos.';
  if (error instanceof Error) {
    if (error.message === 'UNAUTHORIZED') return 'Debes iniciar sesion.';
    return error.message;
  }
  return 'Error inesperado.';
}
