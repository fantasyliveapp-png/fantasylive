'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import type { VaultSection } from '@prisma/client';

import { getAuthedUserOrThrow } from '@/lib/auth/guards';
import { checkNoContactInfo } from '@/lib/content-filter';
import { createNotification } from '@/lib/notifications';
import { prisma } from '@/lib/prisma';
import { buildVaultKey, createUploadUrl, deleteObject, isVaultKeyOf } from '@/lib/storage';
import { MAX_VAULT_ITEMS, MAX_VAULT_PRICE, VAULT_SECTION_IDS } from '@/lib/vault';
import { getVaultForChat, type ChatVault } from '@/lib/vault-data';

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
  revalidatePath('/dashboard/model/boveda');
}

// ---------------------------------------------------------------------------
// CREADORA: su Boveda
// ---------------------------------------------------------------------------

export async function requestVaultUploadUrlAction(input: {
  filename: string;
  contentType: string;
}): Promise<VaultActionResult<{ uploadUrl: string; key: string }>> {
  try {
    const { profile } = await requireCreator();
    if (!/^(image|video)\//.test(input.contentType)) {
      return { ok: false, error: 'Solo fotos o videos.' };
    }
    const count = await prisma.vaultItem.count({ where: { modelId: profile.id } });
    if (count >= MAX_VAULT_ITEMS) {
      return { ok: false, error: `Maximo ${MAX_VAULT_ITEMS} archivos en la Boveda.` };
    }
    const key = buildVaultKey({ modelId: profile.id, filename: input.filename });
    const uploadUrl = await createUploadUrl({ key, contentType: input.contentType });
    if (!uploadUrl) return { ok: false, error: 'El almacenamiento no esta configurado.' };
    return { ok: true, data: { uploadUrl, key } };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

/** Guarda en la Boveda los archivos ya subidos. */
export async function addVaultItemsAction(input: {
  section: VaultSection;
  folderId?: string | null;
  files: { key: string; mimeType: string; sizeBytes?: number }[];
}): Promise<VaultActionResult> {
  try {
    const { profile } = await requireCreator();
    const section = sectionSchema.parse(input.section);
    const folderId = await ownFolder(profile.id, input.folderId);
    const files = input.files.filter(
      (f) => isVaultKeyOf(profile.id, f.key) && /^(image|video)\//.test(f.mimeType),
    );
    if (files.length === 0) return { ok: false, error: 'No hay archivos validos.' };

    await prisma.vaultItem.createMany({
      data: files.map((f) => ({
        modelId: profile.id,
        section,
        folderId,
        storageKey: f.key,
        mimeType: f.mimeType,
        sizeBytes: f.sizeBytes ?? null,
      })),
    });
    done();
    return {
      ok: true,
      message:
        files.length === 1 ? 'Guardado en tu Boveda.' : `${files.length} archivos guardados.`,
    };
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
    if (input.folderId !== undefined) data.folderId = await ownFolder(profile.id, input.folderId);
    if (input.note !== undefined) data.note = input.note?.trim().slice(0, 80) || null;
    if (input.priceTokens !== undefined) {
      data.priceTokens = input.priceTokens === null ? null : priceSchema.parse(input.priceTokens);
    }
    const res = await prisma.vaultItem.updateMany({
      where: { id: { in: input.ids.slice(0, 200) }, modelId: profile.id },
      data,
    });
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
      select: { id: true, storageKey: true, _count: { select: { attachments: true } } },
    });
    await prisma.vaultItem.deleteMany({ where: { id: { in: items.map((i) => i.id) } } });
    await Promise.all(
      items
        .filter((i) => i._count.attachments === 0)
        .map((i) => deleteObject(i.storageKey).catch(() => undefined)),
    );
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

/** La creadora envia uno o varios archivos de su Boveda, cada uno con su precio. */
export async function sendVaultItemsAction(input: {
  conversationId: string;
  items: { id: string; priceTokens: number }[];
  body?: string;
}): Promise<VaultActionResult> {
  try {
    const user = await getAuthedUserOrThrow();
    const { conversation } = await chatContext(input.conversationId, user.id);
    if (conversation.startedByModel && conversation.acceptedAt === null) {
      return { ok: false, error: 'Espera a que acepte tu solicitud de mensaje.' };
    }
    const wanted = input.items.slice(0, 10);
    if (wanted.length === 0) return { ok: false, error: 'Elige algo de la Boveda.' };

    const body = input.body?.trim().slice(0, 1000) || null;
    if (body) {
      const contactError = checkNoContactInfo(body);
      if (contactError) return { ok: false, error: contactError };
    }

    const found = await prisma.vaultItem.findMany({
      where: { id: { in: wanted.map((w) => w.id) }, modelId: conversation.model.id },
    });
    const byId = new Map(found.map((f) => [f.id, f]));
    const toSend = wanted
      .map((w) => {
        const item = byId.get(w.id);
        if (!item) return null;
        // Lo de "enganchar" va siempre gratis.
        const price =
          item.section === 'TEASER'
            ? 0
            : Math.min(Math.max(Math.round(w.priceTokens) || 0, 0), MAX_VAULT_PRICE);
        return { item, price };
      })
      .filter((x) => x !== null);
    if (toSend.length === 0) return { ok: false, error: 'Esos archivos ya no estan en la Boveda.' };

    await prisma.$transaction(async (tx) => {
      if (body) {
        await tx.message.create({
          data: {
            conversationId: conversation.id,
            senderId: conversation.model.userId,
            body,
          },
        });
      }
      for (const { item, price } of toSend) {
        const message = await tx.message.create({
          data: {
            conversationId: conversation.id,
            senderId: conversation.model.userId,
          },
          select: { id: true },
        });
        await tx.messageAttachment.create({
          data: {
            messageId: message.id,
            storageKey: item.storageKey,
            mimeType: item.mimeType,
            sizeBytes: item.sizeBytes,
            priceTokens: price,
            vaultItemId: item.id,
          },
        });
      }
      await tx.conversation.update({
        where: { id: conversation.id },
        data: { lastMessageAt: new Date() },
      });
      const paid = toSend.some((t) => t.price > 0);
      await createNotification(tx, {
        userId: conversation.userId,
        type: 'NEW_MESSAGE',
        title: paid
          ? `${conversation.model.stageName} te envio algo especial`
          : `${conversation.model.stageName} te envio ${toSend.length === 1 ? 'una foto' : 'fotos'}`,
        link: `/mensajes/${conversation.id}`,
      });
    });

    revalidatePath(`/mensajes/${conversation.id}`);
    return {
      ok: true,
      message: toSend.length === 1 ? 'Enviado.' : `${toSend.length} archivos enviados.`,
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
