'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { getAuthedUserOrThrow } from '@/lib/auth/guards';
import { prisma } from '@/lib/prisma';
import { checkNoContactInfo } from '@/lib/content-filter';
import { config } from '@/lib/config';
import { applyLedgerEntry, tokensToPayoutCents } from '@/lib/tokens';
import { encryptSecret, maskDestination } from '@/lib/crypto';
import { normalizeCountryCode } from '@/lib/countries';
import {
  destinationIdentifier,
  payoutDestinationSchema,
  PAYOUT_METHOD_LABELS,
  type PayoutDestination,
} from '@/lib/payouts';
import {
  buildContentKey,
  buildKycKey,
  createUploadUrl,
  deleteObject,
} from '@/lib/storage';

export interface ModelActionResult<T = unknown> {
  ok: boolean;
  error?: string;
  message?: string;
  data?: T;
}

async function requireModelProfile() {
  const user = await getAuthedUserOrThrow();
  const profile = await prisma.modelProfile.findUnique({
    where: { userId: user.id },
  });
  if (!profile) throw new Error('MODEL_PROFILE_MISSING');
  return { user, profile };
}

// ---------------------------------------------------------------------------
// PERFIL Y TARIFAS
// ---------------------------------------------------------------------------

const profileSchema = z.object({
  stageName: z.string().min(2).max(40),
  headline: z.string().max(120).optional(),
  bio: z.string().max(1200).optional(),
  languages: z.array(z.string()).max(8).optional(),
  tags: z.array(z.string()).max(12).optional(),
  avatarUrl: z.string().url().optional().or(z.literal('')),
  coverUrl: z.string().url().optional().or(z.literal('')),
});

export async function updateModelProfileAction(input: {
  stageName: string;
  headline?: string;
  bio?: string;
  languages?: string[];
  tags?: string[];
  avatarUrl?: string;
  coverUrl?: string;
}): Promise<ModelActionResult> {
  try {
    const { profile } = await requireModelProfile();
    const parsed = profileSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: 'Datos de perfil invalidos.' };

    // La biografia es la via mas comoda para colar un Instagram, asi que
    // pasa por el mismo filtro que los mensajes.
    const contactError = checkNoContactInfo(
      [parsed.data.stageName, parsed.data.headline, parsed.data.bio]
        .filter(Boolean)
        .join(' \n '),
    );
    if (contactError) return { ok: false, error: contactError };

    await prisma.modelProfile.update({
      where: { id: profile.id },
      data: {
        stageName: parsed.data.stageName,
        headline: parsed.data.headline || null,
        bio: parsed.data.bio || null,
        languages: parsed.data.languages ?? profile.languages,
        tags: parsed.data.tags ?? profile.tags,
        avatarUrl: parsed.data.avatarUrl || profile.avatarUrl,
        coverUrl: parsed.data.coverUrl || profile.coverUrl,
      },
    });

    revalidatePath('/dashboard/model');
    revalidatePath(`/models/${profile.slug}`);
    return { ok: true, message: 'Perfil actualizado.' };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

const ratesSchema = z.object({
  vipRatePerMinute: z.number().int().min(1).max(1000),
  privateRatePerMinute: z.number().int().min(1).max(2000),
  minPrivateMinutes: z.number().int().min(5).max(120),
  isVipEnabled: z.boolean(),
  acceptsBookings: z.boolean(),
  subscriptionEnabled: z.boolean(),
  subscriptionPriceTokens: z.number().int().min(0).max(100000),
  subscriptionDiscountPercent: z.number().int().min(0).max(90),
  messagingEnabled: z.boolean(),
  messagePriceTokens: z.number().int().min(0).max(100000),
});

export async function updateRatesAction(input: {
  vipRatePerMinute: number;
  privateRatePerMinute: number;
  minPrivateMinutes: number;
  isVipEnabled: boolean;
  acceptsBookings: boolean;
  subscriptionEnabled: boolean;
  subscriptionPriceTokens: number;
  subscriptionDiscountPercent: number;
  messagingEnabled: boolean;
  messagePriceTokens: number;
}): Promise<ModelActionResult> {
  try {
    const { profile } = await requireModelProfile();
    const parsed = ratesSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: 'Tarifas invalidas.' };

    if (
      config.moderation.requireKycToStream &&
      profile.kycStatus !== 'APPROVED' &&
      (parsed.data.isVipEnabled ||
        parsed.data.acceptsBookings ||
        parsed.data.subscriptionEnabled ||
        parsed.data.messagingEnabled)
    ) {
      return {
        ok: false,
        error: 'Necesitas el KYC aprobado para activar VIP, reservas, suscripcion o mensajeria.',
      };
    }
    if (parsed.data.subscriptionEnabled && parsed.data.subscriptionPriceTokens <= 0) {
      return {
        ok: false,
        error: 'Definí un precio mayor a 0 para activar la suscripcion.',
      };
    }
    if (parsed.data.messagingEnabled && parsed.data.messagePriceTokens <= 0) {
      return {
        ok: false,
        error: 'Definí un precio mayor a 0 para activar la mensajeria.',
      };
    }

    await prisma.modelProfile.update({
      where: { id: profile.id },
      data: parsed.data,
    });

    revalidatePath('/dashboard/model/rates');
    revalidatePath(`/models/${profile.slug}`);
    return { ok: true, message: 'Tarifas actualizadas.' };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

/** Alterna el estado en linea / disponible para VIP. */
export async function setOnlineStatusAction(input: {
  isOnline: boolean;
  isAvailableForVip?: boolean;
}): Promise<ModelActionResult> {
  try {
    const { profile } = await requireModelProfile();

    if (
      input.isOnline &&
      config.moderation.requireKycToStream &&
      profile.kycStatus !== 'APPROVED'
    ) {
      return {
        ok: false,
        error: 'No puedes emitir hasta que tu KYC este aprobado.',
      };
    }

    await prisma.modelProfile.update({
      where: { id: profile.id },
      data: {
        isOnline: input.isOnline,
        isAvailableForVip:
          input.isOnline && (input.isAvailableForVip ?? profile.isAvailableForVip),
        lastOnlineAt: new Date(),
      },
    });

    revalidatePath('/dashboard/model');
    revalidatePath('/models');
    revalidatePath('/vip');
    return { ok: true, message: input.isOnline ? 'Estas en linea.' : 'Desconectada.' };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

// ---------------------------------------------------------------------------
// CONTENIDO
// ---------------------------------------------------------------------------

const contentSchema = z.object({
  title: z.string().min(3).max(80),
  description: z.string().max(600).optional(),
  type: z.enum(['PHOTO', 'VIDEO', 'BUNDLE']),
  priceTokens: z.number().int().min(0).max(100000),
  previewUrl: z.string().optional(),
  isPublished: z.boolean().default(true),
  subscriberOnly: z.boolean().default(false),
});

export async function createContentPackageAction(input: {
  title: string;
  description?: string;
  type: 'PHOTO' | 'VIDEO' | 'BUNDLE';
  priceTokens: number;
  previewUrl?: string;
  isPublished?: boolean;
  subscriberOnly?: boolean;
}): Promise<ModelActionResult<{ packageId: string }>> {
  try {
    const { profile } = await requireModelProfile();
    const parsed = contentSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: 'Datos de contenido invalidos.' };
    if (parsed.data.subscriberOnly && !profile.subscriptionEnabled) {
      return {
        ok: false,
        error: 'Activa la suscripcion mensual antes de marcar contenido exclusivo.',
      };
    }

    const pkg = await prisma.contentPackage.create({
      data: {
        modelId: profile.id,
        title: parsed.data.title,
        description: parsed.data.description ?? null,
        type: parsed.data.type,
        priceTokens: parsed.data.priceTokens,
        isPublic: parsed.data.priceTokens === 0,
        isPublished: parsed.data.isPublished,
        previewUrl: parsed.data.previewUrl ?? null,
        subscriberOnly: parsed.data.subscriberOnly,
      },
      select: { id: true },
    });

    revalidatePath('/dashboard/model/content');
    revalidatePath(`/models/${profile.slug}`);
    return { ok: true, data: { packageId: pkg.id }, message: 'Paquete creado.' };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

export async function updateContentPackageAction(input: {
  packageId: string;
  title?: string;
  description?: string;
  priceTokens?: number;
  isPublished?: boolean;
}): Promise<ModelActionResult> {
  try {
    const { profile } = await requireModelProfile();

    const pkg = await prisma.contentPackage.findFirst({
      where: { id: input.packageId, modelId: profile.id },
    });
    if (!pkg) return { ok: false, error: 'Paquete no encontrado.' };

    await prisma.contentPackage.update({
      where: { id: pkg.id },
      data: {
        title: input.title ?? pkg.title,
        description: input.description ?? pkg.description,
        priceTokens: input.priceTokens ?? pkg.priceTokens,
        isPublic:
          input.priceTokens !== undefined
            ? input.priceTokens === 0
            : pkg.isPublic,
        isPublished: input.isPublished ?? pkg.isPublished,
      },
    });

    revalidatePath('/dashboard/model/content');
    revalidatePath(`/models/${profile.slug}`);
    return { ok: true, message: 'Paquete actualizado.' };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

export async function deleteContentPackageAction(
  packageId: string,
): Promise<ModelActionResult> {
  try {
    const { profile } = await requireModelProfile();
    const pkg = await prisma.contentPackage.findFirst({
      where: { id: packageId, modelId: profile.id },
      select: { id: true, unlocks: { select: { id: true }, take: 1 } },
    });
    if (!pkg) return { ok: false, error: 'Paquete no encontrado.' };
    if (pkg.unlocks.length > 0) {
      return {
        ok: false,
        error: 'No puedes borrar un paquete que ya ha sido comprado. Ocultalo en su lugar.',
      };
    }

    await prisma.contentPackage.delete({ where: { id: pkg.id } });

    revalidatePath('/dashboard/model/content');
    return { ok: true, message: 'Paquete eliminado.' };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

/** Devuelve una URL firmada para subir un archivo directamente a S3/R2. */
export async function requestContentUploadUrlAction(input: {
  packageId: string;
  filename: string;
  contentType: string;
}): Promise<ModelActionResult<{ uploadUrl: string; key: string }>> {
  try {
    const { profile } = await requireModelProfile();

    const pkg = await prisma.contentPackage.findFirst({
      where: { id: input.packageId, modelId: profile.id },
      select: { id: true },
    });
    if (!pkg) return { ok: false, error: 'Paquete no encontrado.' };

    const key = buildContentKey({
      modelId: profile.id,
      packageId: pkg.id,
      filename: input.filename,
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

/** Registra en BD un asset ya subido a S3/R2. */
export async function attachContentAssetAction(input: {
  packageId: string;
  storageKey: string;
  mimeType: string;
  sizeBytes?: number;
  durationSec?: number;
  isPreview?: boolean;
}): Promise<ModelActionResult> {
  try {
    const { profile } = await requireModelProfile();

    const pkg = await prisma.contentPackage.findFirst({
      where: { id: input.packageId, modelId: profile.id },
      select: { id: true, assetCount: true },
    });
    if (!pkg) return { ok: false, error: 'Paquete no encontrado.' };

    await prisma.$transaction([
      prisma.contentAsset.create({
        data: {
          packageId: pkg.id,
          storageKey: input.storageKey,
          mimeType: input.mimeType,
          sizeBytes: input.sizeBytes ?? null,
          durationSec: input.durationSec ?? null,
          isPreview: input.isPreview ?? pkg.assetCount === 0,
          sortOrder: pkg.assetCount,
        },
      }),
      prisma.contentPackage.update({
        where: { id: pkg.id },
        data: { assetCount: { increment: 1 } },
      }),
    ]);

    revalidatePath('/dashboard/model/content');
    return { ok: true, message: 'Archivo anadido.' };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

/** Borra un archivo suelto de un paquete propio (no todo el paquete). */
export async function removeContentAssetAction(
  assetId: string,
): Promise<ModelActionResult> {
  try {
    const { profile } = await requireModelProfile();

    const asset = await prisma.contentAsset.findUnique({
      where: { id: assetId },
      select: {
        id: true,
        storageKey: true,
        package: {
          select: { id: true, modelId: true, unlocks: { select: { id: true }, take: 1 } },
        },
      },
    });
    if (!asset || asset.package.modelId !== profile.id) {
      return { ok: false, error: 'Archivo no encontrado.' };
    }
    if (asset.package.unlocks.length > 0) {
      return {
        ok: false,
        error: 'No puedes borrar archivos de un paquete que ya fue comprado.',
      };
    }

    await prisma.$transaction([
      prisma.contentAsset.delete({ where: { id: asset.id } }),
      prisma.contentPackage.update({
        where: { id: asset.package.id },
        data: { assetCount: { decrement: 1 } },
      }),
    ]);

    await deleteObject(asset.storageKey);

    revalidatePath('/dashboard/model/content');
    return { ok: true, message: 'Archivo eliminado.' };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

// ---------------------------------------------------------------------------
// KYC
// ---------------------------------------------------------------------------

const kycSchema = z.object({
  fullLegalName: z.string().min(3).max(120),
  birthDate: z.string().min(1),
  country: z.string().min(2).max(60),
  documentType: z.enum(['PASSPORT', 'NATIONAL_ID', 'DRIVERS_LICENSE']),
  documentNumber: z.string().max(40).optional(),
  documentFrontKey: z.string().min(1, 'Sube el anverso del documento'),
  documentBackKey: z.string().optional(),
  selfieKey: z.string().min(1, 'Sube un selfie con el documento'),
  handwrittenNoteKey: z.string().optional(),
});

export async function requestKycUploadUrlAction(input: {
  kind: 'front' | 'back' | 'selfie' | 'note';
  filename: string;
  contentType: string;
}): Promise<ModelActionResult<{ uploadUrl: string; key: string }>> {
  try {
    const { profile } = await requireModelProfile();

    const key = buildKycKey({
      modelId: profile.id,
      kind: input.kind,
      filename: input.filename,
    });

    const uploadUrl = await createUploadUrl({
      key,
      contentType: input.contentType,
    });

    if (!uploadUrl) {
      return {
        ok: false,
        error: 'Almacenamiento no configurado (S3_*). Revisa tu .env.',
      };
    }

    return { ok: true, data: { uploadUrl, key } };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

export async function submitKycAction(input: {
  fullLegalName: string;
  birthDate: string;
  country: string;
  documentType: 'PASSPORT' | 'NATIONAL_ID' | 'DRIVERS_LICENSE';
  documentNumber?: string;
  documentFrontKey: string;
  documentBackKey?: string;
  selfieKey: string;
  handwrittenNoteKey?: string;
}): Promise<ModelActionResult> {
  try {
    const { user, profile } = await requireModelProfile();
    const parsed = kycSchema.safeParse(input);
    if (!parsed.success) {
      const first = Object.values(parsed.error.flatten().fieldErrors)[0]?.[0];
      return { ok: false, error: first ?? 'Datos de KYC incompletos.' };
    }

    const pending = await prisma.kycVerification.findFirst({
      where: { modelId: profile.id, status: 'PENDING' },
    });
    if (pending) {
      return { ok: false, error: 'Ya tienes una verificacion en revision.' };
    }

    const birthDate = new Date(parsed.data.birthDate);
    const age =
      (Date.now() - birthDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
    if (age < config.app.minAge) {
      return { ok: false, error: 'Debes ser mayor de edad para verificarte.' };
    }

    await prisma.$transaction([
      prisma.kycVerification.create({
        data: {
          modelId: profile.id,
          status: 'PENDING',
          fullLegalName: parsed.data.fullLegalName,
          birthDate,
          country: parsed.data.country,
          documentType: parsed.data.documentType,
          documentNumber: parsed.data.documentNumber ?? null,
          documentFrontKey: parsed.data.documentFrontKey,
          documentBackKey: parsed.data.documentBackKey ?? null,
          selfieKey: parsed.data.selfieKey,
          handwrittenNoteKey: parsed.data.handwrittenNoteKey ?? null,
        },
      }),
      prisma.modelProfile.update({
        where: { id: profile.id },
        data: { kycStatus: 'PENDING' },
      }),
      prisma.auditLog.create({
        data: {
          actorId: user.id,
          action: 'KYC_SUBMITTED',
          entityType: 'ModelProfile',
          entityId: profile.id,
        },
      }),
    ]);

    revalidatePath('/dashboard/model/kyc');
    revalidatePath('/admin/kyc');
    return { ok: true, message: 'Documentacion enviada. Revision en 24-48 h.' };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

// ---------------------------------------------------------------------------
// PAYOUTS
// ---------------------------------------------------------------------------

const payoutSchema = z.object({
  tokens: z.number().int().min(1).max(10_000_000),
  destination: payoutDestinationSchema,
});

/**
 * Solicita un retiro.
 *
 * Los tokens se debitan AL SOLICITAR (asiento PAYOUT) y se devuelven si un
 * admin rechaza la solicitud. El debito usa un UPDATE condicional sobre el
 * saldo, asi que dos solicitudes simultaneas no pueden dejar el monedero en
 * negativo ni retirar el mismo saldo dos veces.
 *
 * Los datos de cobro se guardan CIFRADOS (AES-256-GCM); en la base de datos
 * solo queda ademas una version enmascarada para poder listarlos.
 */
export async function requestPayoutAction(input: {
  tokens: number;
  destination: PayoutDestination;
}): Promise<ModelActionResult> {
  try {
    const { user, profile } = await requireModelProfile();

    const parsed = payoutSchema.safeParse(input);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return {
        ok: false,
        error: issue?.message ?? 'Datos de retiro invalidos.',
      };
    }

    const { tokens, destination } = parsed.data;

    if (profile.kycStatus !== 'APPROVED') {
      return { ok: false, error: 'Necesitas el KYC aprobado para retirar.' };
    }
    if (tokens < config.economy.minPayoutTokens) {
      return {
        ok: false,
        error: `El minimo de retiro es de ${config.economy.minPayoutTokens} tokens.`,
      };
    }

    // Una solicitud abierta a la vez: evita que se encadenen retiros mientras
    // finanzas todavia no ha procesado el anterior.
    const openRequest = await prisma.payoutRequest.findFirst({
      where: {
        modelId: profile.id,
        status: { in: ['REQUESTED', 'APPROVED', 'PROCESSING'] },
      },
      select: { id: true },
    });
    if (openRequest) {
      return {
        ok: false,
        error: 'Ya tienes un retiro en curso. Espera a que se procese.',
      };
    }

    const amountCents = tokensToPayoutCents(tokens);

    // El cifrado se hace ANTES de abrir la transaccion: si la clave no esta
    // configurada preferimos fallar sin haber tocado el monedero.
    const encryptedDestination = encryptSecret(JSON.stringify(destination));
    const masked = maskDestination(destinationIdentifier(destination));

    await prisma.$transaction(async (tx) => {
      const payout = await tx.payoutRequest.create({
        data: {
          modelId: profile.id,
          tokens,
          amountCents,
          currency: 'USD',
          method: destination.method,
          destination: encryptedDestination,
          destinationMasked: masked,
          status: 'REQUESTED',
        },
        select: { id: true },
      });

      // Debito atomico: lanza InsufficientTokensError y revierte la
      // transaccion completa si el saldo no alcanza.
      await applyLedgerEntry(tx, {
        userId: user.id,
        type: 'PAYOUT',
        tokens,
        amountCents,
        currency: 'USD',
        description: `Solicitud de retiro (${PAYOUT_METHOD_LABELS[destination.method]})`,
        payoutRequestId: payout.id,
      });

      // pendingEarnings nunca debe quedar negativo: se relee dentro de la
      // transaccion y se descuenta solo lo que realmente hay acumulado.
      const wallet = await tx.wallet.findUniqueOrThrow({
        where: { userId: user.id },
        select: { pendingEarnings: true },
      });
      const consumed = Math.min(tokens, Math.max(0, wallet.pendingEarnings));
      if (consumed > 0) {
        await tx.wallet.update({
          where: { userId: user.id },
          data: { pendingEarnings: { decrement: consumed } },
        });
      }

      await tx.auditLog.create({
        data: {
          actorId: user.id,
          action: 'PAYOUT_REQUESTED',
          entityType: 'PayoutRequest',
          entityId: payout.id,
          metadata: { tokens, amountCents, method: destination.method },
        },
      });
    });

    revalidatePath('/dashboard/model/payouts');
    revalidatePath('/admin/payouts');
    return {
      ok: true,
      message: `Retiro solicitado: ${tokens} tokens (${(amountCents / 100).toFixed(2)} USD).`,
    };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

// ---------------------------------------------------------------------------
// PRIVACIDAD: BLOQUEO POR PAIS
// ---------------------------------------------------------------------------

const MAX_BLOCKED_COUNTRIES = 100;

/**
 * Define desde que paises NO se ve este perfil.
 *
 * Se guardan solo codigos ISO 3166-1 alpha-2 conocidos: cualquier valor
 * inventado se descarta en vez de persistirse, de forma que el filtro de
 * catalogo siempre compara contra datos limpios.
 */
export async function updateBlockedCountriesAction(input: {
  countries: string[];
}): Promise<ModelActionResult<{ countries: string[] }>> {
  try {
    const { user, profile } = await requireModelProfile();

    if (!Array.isArray(input?.countries)) {
      return { ok: false, error: 'Lista de paises invalida.' };
    }
    if (input.countries.length > MAX_BLOCKED_COUNTRIES) {
      return {
        ok: false,
        error: `No puedes bloquear mas de ${MAX_BLOCKED_COUNTRIES} paises.`,
      };
    }

    const invalid: string[] = [];
    const valid = new Set<string>();
    for (const raw of input.countries) {
      const code = normalizeCountryCode(raw);
      if (code) valid.add(code);
      else if (typeof raw === 'string' && raw.trim()) invalid.push(raw.trim());
    }

    if (invalid.length > 0) {
      return {
        ok: false,
        error: `Codigo de pais no reconocido: ${invalid.slice(0, 3).join(', ')}.`,
      };
    }

    const countries = [...valid].sort();

    await prisma.$transaction([
      prisma.modelProfile.update({
        where: { id: profile.id },
        data: { blockedCountries: countries },
      }),
      prisma.auditLog.create({
        data: {
          actorId: user.id,
          action: 'BLOCKED_COUNTRIES_UPDATED',
          entityType: 'ModelProfile',
          entityId: profile.id,
          metadata: { count: countries.length, countries },
        },
      }),
    ]);

    revalidatePath('/dashboard/model/privacy');
    revalidatePath('/models');
    revalidatePath(`/models/${profile.slug}`);
    return {
      ok: true,
      message:
        countries.length === 0
          ? 'Tu perfil vuelve a verse desde todos los paises.'
          : `Bloqueo actualizado: ${countries.length} ${countries.length === 1 ? 'pais' : 'paises'}.`,
      data: { countries },
    };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

// ---------------------------------------------------------------------------
// DISPONIBILIDAD
// ---------------------------------------------------------------------------

export async function setAvailabilityAction(
  slots: Array<{ weekday: number; startMinute: number; endMinute: number }>,
): Promise<ModelActionResult> {
  try {
    const { profile } = await requireModelProfile();

    await prisma.$transaction([
      prisma.availabilitySlot.deleteMany({ where: { modelId: profile.id } }),
      prisma.availabilitySlot.createMany({
        data: slots
          .filter((s) => s.endMinute > s.startMinute)
          .map((s) => ({
            modelId: profile.id,
            weekday: s.weekday,
            startMinute: s.startMinute,
            endMinute: s.endMinute,
          })),
        skipDuplicates: true,
      }),
    ]);

    revalidatePath('/dashboard/model/schedule');
    revalidatePath(`/models/${profile.slug}`);
    return { ok: true, message: 'Disponibilidad guardada.' };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

function toMessage(error: unknown): string {
  if (error instanceof Error) {
    if (error.message === 'UNAUTHORIZED') return 'Debes iniciar sesion.';
    if (error.message === 'MODEL_PROFILE_MISSING')
      return 'No tienes perfil de modelo.';
    return error.message;
  }
  return 'Error inesperado.';
}
