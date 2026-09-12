'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { getAuthedUserOrThrow } from '@/lib/auth/guards';
import { checkNoContactInfo } from '@/lib/content-filter';
import { prisma } from '@/lib/prisma';
import {
  buildGreetingKey,
  createUploadUrl,
  deleteObject,
} from '@/lib/storage';

export interface GreetingActionResult<T = unknown> {
  ok: boolean;
  error?: string;
  message?: string;
  data?: T;
}

async function requireModelProfile() {
  const user = await getAuthedUserOrThrow();
  const profile = await prisma.modelProfile.findUnique({
    where: { userId: user.id },
    select: {
      id: true,
      slug: true,
      autoGreetingAssetKey: true,
      autoGreetingPreviewKey: true,
    },
  });
  if (!profile) throw new Error('MODEL_PROFILE_MISSING');
  return { user, profile };
}

const greetingSchema = z
  .object({
    enabled: z.boolean(),
    text: z.string().trim().max(600).optional(),
    priceTokens: z.number().int().min(0).max(100000),
    dailyLimit: z.number().int().min(0).max(500),
    assetKey: z.string().max(400).optional(),
    assetMime: z.string().max(120).optional(),
    previewKey: z.string().max(400).optional(),
  })
  .refine((v) => !v.enabled || Boolean(v.text?.length) || Boolean(v.assetKey), {
    message: 'Escribe un texto o adjunta una foto antes de activarlo.',
    path: ['text'],
  });

/**
 * Guarda el mensaje automatico de bienvenida.
 *
 * El texto pasa por el filtro de contactos igual que cualquier otro mensaje:
 * un saludo automatico seria el sitio perfecto para repartir un Telegram a
 * todo el que entre al perfil.
 */
export async function updateAutoGreetingAction(input: {
  enabled: boolean;
  text?: string;
  priceTokens: number;
  dailyLimit: number;
  assetKey?: string;
  assetMime?: string;
  previewKey?: string;
}): Promise<GreetingActionResult> {
  try {
    const { profile } = await requireModelProfile();

    const parsed = greetingSchema.safeParse(input);
    if (!parsed.success) {
      return {
        ok: false,
        error: parsed.error.issues[0]?.message ?? 'Datos invalidos.',
      };
    }

    if (parsed.data.text) {
      const contactError = checkNoContactInfo(parsed.data.text);
      if (contactError) return { ok: false, error: contactError };
    }

    // Si llega una foto nueva se borra la anterior del bucket: si no, cada
    // cambio dejaria un archivo huerfano pagando almacenamiento para siempre.
    const replacingAsset =
      Boolean(parsed.data.assetKey) &&
      parsed.data.assetKey !== profile.autoGreetingAssetKey;

    await prisma.modelProfile.update({
      where: { id: profile.id },
      data: {
        autoGreetingEnabled: parsed.data.enabled,
        autoGreetingText: parsed.data.text || null,
        autoGreetingPriceTokens: parsed.data.priceTokens,
        autoGreetingDailyLimit: parsed.data.dailyLimit,
        ...(parsed.data.assetKey
          ? {
              autoGreetingAssetKey: parsed.data.assetKey,
              autoGreetingAssetMime: parsed.data.assetMime ?? 'image/jpeg',
              autoGreetingPreviewKey: parsed.data.previewKey ?? null,
            }
          : {}),
      },
    });

    if (replacingAsset) {
      if (profile.autoGreetingAssetKey) {
        await deleteObject(profile.autoGreetingAssetKey);
      }
      if (profile.autoGreetingPreviewKey) {
        await deleteObject(profile.autoGreetingPreviewKey);
      }
    }

    revalidatePath('/dashboard/model/greeting');
    return { ok: true, message: 'Mensaje de bienvenida guardado.' };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

/** URL firmada para subir la foto del saludo (o su miniatura difuminada). */
export async function requestGreetingUploadUrlAction(input: {
  filename: string;
  contentType: string;
  isPreview?: boolean;
}): Promise<GreetingActionResult<{ uploadUrl: string; key: string }>> {
  try {
    const { profile } = await requireModelProfile();

    const key = buildGreetingKey({
      modelId: profile.id,
      filename: input.filename,
      isPreview: input.isPreview,
    });

    const uploadUrl = await createUploadUrl({
      key,
      contentType: input.contentType,
    });
    if (!uploadUrl) {
      return {
        ok: false,
        error:
          'El almacenamiento no esta configurado. Define S3_* en tu .env o usa MinIO local.',
      };
    }

    return { ok: true, data: { uploadUrl, key } };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

/** Quita la foto adjunta del saludo. */
export async function removeGreetingAssetAction(): Promise<GreetingActionResult> {
  try {
    const { profile } = await requireModelProfile();

    await prisma.modelProfile.update({
      where: { id: profile.id },
      data: {
        autoGreetingAssetKey: null,
        autoGreetingAssetMime: null,
        autoGreetingPreviewKey: null,
      },
    });

    if (profile.autoGreetingAssetKey) {
      await deleteObject(profile.autoGreetingAssetKey);
    }
    if (profile.autoGreetingPreviewKey) {
      await deleteObject(profile.autoGreetingPreviewKey);
    }

    revalidatePath('/dashboard/model/greeting');
    return { ok: true, message: 'Foto eliminada.' };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

function toMessage(error: unknown): string {
  if (error instanceof Error) {
    if (error.message === 'UNAUTHORIZED') return 'Debes iniciar sesion.';
    if (error.message === 'MODEL_PROFILE_MISSING') {
      return 'Necesitas un perfil de creadora.';
    }
    return error.message;
  }
  return 'Error inesperado.';
}
