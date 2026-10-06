'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { getAuthedUserOrThrow } from '@/lib/auth/guards';
import { emailVerificationBlock } from '@/lib/auth-tokens';
import { assertCreatorVerified } from '@/lib/creator-kyc';
import { prisma } from '@/lib/prisma';
import { onlineLabel } from '@/lib/gender-words';
import { checkNoContactInfo } from '@/lib/content-filter';
import { changeHandle, isHandleFree } from '@/lib/creator-profile';
import { isReservedUsername, USERNAME_PATTERN } from '@/lib/usernames';
import { config } from '@/lib/config';
import {
  applyLedgerEntry,
  splitPayoutFee,
  tokensToPayoutCents,
  withdrawableTokens,
} from '@/lib/tokens';
import { encryptSecret, maskDestination } from '@/lib/crypto';
import { normalizeCountryCode } from '@/lib/countries';
import {
  MAX_RATE_CENTITOKENS,
  MIN_BILLED_CALL_MINUTES,
  MIN_RATE_CENTITOKENS,
  formatRate,
} from '@/lib/rates';
import {
  destinationIdentifier,
  payoutDestinationSchema,
  PAYOUT_METHOD_LABELS,
  type PayoutDestination,
} from '@/lib/payouts';
import {
  buildKycKey,
  buildProfileImageKey,
  checkUpload,
  createUploadUrl,
  deleteObject,
  isProfileImageKey,
  profileImageUrl,
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

const PUBLIC_MEDIA_PREFIX = '/api/public-media/';

/**
 * Avatar/portada: una URL absoluta (datos de seed, CDN) o la ruta propia de
 * una foto subida, que solo se acepta si apunta a una clave de perfil.
 */
const imageUrlSchema = z
  .string()
  .refine(
    (v) =>
      v === '' ||
      z.string().url().safeParse(v).success ||
      (v.startsWith(PUBLIC_MEDIA_PREFIX) &&
        isProfileImageKey(v.slice(PUBLIC_MEDIA_PREFIX.length))),
  )
  .optional();

const profileSchema = z.object({
  stageName: z.string().min(2).max(40),
  /** Su @: el mismo para su cuenta y su direccion de creadora. */
  username: z.string().trim().toLowerCase().regex(USERNAME_PATTERN).optional(),
  headline: z.string().max(120).optional(),
  bio: z.string().max(1200).optional(),
  languages: z.array(z.string()).max(8).optional(),
  tags: z.array(z.string()).max(12).optional(),
  avatarUrl: imageUrlSchema,
  coverUrl: imageUrlSchema,
});

export async function updateModelProfileAction(input: {
  stageName: string;
  username?: string;
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

    const handle = parsed.data.username;
    if (handle && handle !== profile.slug) {
      if (isReservedUsername(handle) || !(await isHandleFree(handle, profile.userId))) {
        return { ok: false, error: 'Ese @usuario ya esta cogido.' };
      }
      await changeHandle(profile.userId, handle);
      revalidatePath(`/models/${handle}`);
    }

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

/**
 * URL firmada para subir una foto de perfil o portada ya recortada en el
 * navegador. Devuelve tambien la URL publica que hay que guardar en el perfil.
 */
export async function requestProfileImageUploadUrlAction(input: {
  kind: 'avatar' | 'cover';
  sizeBytes: number;
}): Promise<ModelActionResult<{ uploadUrl: string; publicUrl: string }>> {
  try {
    const { profile } = await requireModelProfile();
    if (input.kind !== 'avatar' && input.kind !== 'cover') {
      return { ok: false, error: 'Tipo de imagen invalido.' };
    }
    const invalid = checkUpload('image/jpeg', input.sizeBytes, ['image']);
    if (invalid) return { ok: false, error: invalid };

    const key = buildProfileImageKey({ modelId: profile.id, kind: input.kind });
    const uploadUrl = await createUploadUrl({ key, contentType: 'image/jpeg', sizeBytes: input.sizeBytes });
    if (!uploadUrl) {
      return {
        ok: false,
        error:
          'El almacenamiento no esta configurado. Define S3_* en tu .env o usa MinIO local.',
      };
    }

    return { ok: true, data: { uploadUrl, publicUrl: profileImageUrl(key) } };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

const ratesSchema = z.object({
  // Tarifas en centitokens/min: el rango permitido es 17,5 - 250 tokens/min.
  vipRateCentitokens: z
    .number()
    .int()
    .min(MIN_RATE_CENTITOKENS)
    .max(MAX_RATE_CENTITOKENS),
  privateRateCentitokens: z
    .number()
    .int()
    .min(MIN_RATE_CENTITOKENS)
    .max(MAX_RATE_CENTITOKENS),
  minPrivateMinutes: z
    .number()
    .int()
    .min(MIN_BILLED_CALL_MINUTES)
    .max(120),
  isVipEnabled: z.boolean(),
  acceptsBookings: z.boolean(),
  subscriptionEnabled: z.boolean(),
  subscriptionPriceTokens: z.number().int().min(0).max(100000),
  subscriptionDiscountPercent: z.number().int().min(0).max(90),
  messagingEnabled: z.boolean(),
  messagePriceTokens: z.number().int().min(0).max(100000),
});

export async function updateRatesAction(input: {
  vipRateCentitokens: number;
  privateRateCentitokens: number;
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
    await assertCreatorVerified({ modelId: profile.id });
    const parsed = ratesSchema.safeParse(input);
    if (!parsed.success) {
      return {
        ok: false,
        error: `Tarifas invalidas. El precio por minuto va de ${formatRate(
          MIN_RATE_CENTITOKENS,
        )} a ${formatRate(MAX_RATE_CENTITOKENS)} y el minimo de llamada es de ${MIN_BILLED_CALL_MINUTES} min.`,
      };
    }

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
      // El privado al azar sigue a "Recibo llamadas".
      data: { ...parsed.data, isAvailableForVip: profile.isOnline && parsed.data.isVipEnabled },
    });

    revalidatePath('/dashboard/model/rates');
    revalidatePath(`/models/${profile.slug}`);
    return { ok: true, message: 'Tarifas actualizadas.' };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

/**
 * "Recibo llamadas": el UNICO interruptor de disponibilidad. Encendido, los
 * fans pueden llamarle ya (y entra en el privado al azar si lo tiene activado
 * en Ajustes). Se apaga solo si cierra la web (ver src/lib/call-presence.ts).
 */
export async function setOnlineStatusAction(input: {
  isOnline: boolean;
  /** Ya no se usa: el privado al azar sigue a este interruptor. */
  isAvailableForVip?: boolean;
}): Promise<ModelActionResult> {
  try {
    const { profile } = await requireModelProfile();
    if (input.isOnline) await assertCreatorVerified({ modelId: profile.id });

    if (
      input.isOnline &&
      config.moderation.requireKycToStream &&
      profile.kycStatus !== 'APPROVED'
    ) {
      return {
        ok: false,
        error: 'Verifica tu identidad para poder recibir llamadas.',
      };
    }

    await prisma.modelProfile.update({
      where: { id: profile.id },
      data: {
        isOnline: input.isOnline,
        isAvailableForVip: input.isOnline && profile.isVipEnabled,
        lastOnlineAt: new Date(),
      },
    });

    revalidatePath('/dashboard/model');
    revalidatePath('/models');
    revalidatePath('/vip');
    return {
      ok: true,
      message: input.isOnline
        ? 'Recibes llamadas. Mantén la web abierta para oírlas.'
        : 'Ya no recibes llamadas.',
    };
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
  sizeBytes: number;
}): Promise<ModelActionResult<{ uploadUrl: string; key: string }>> {
  try {
    const { profile } = await requireModelProfile();
    const invalid = checkUpload(input.contentType, input.sizeBytes, ['image', 'pdf']);
    if (invalid) return { ok: false, error: invalid };

    const key = buildKycKey({
      modelId: profile.id,
      kind: input.kind,
      filename: input.filename,
    });

    const uploadUrl = await createUploadUrl({
      key,
      contentType: input.contentType,
      sizeBytes: input.sizeBytes,
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
 *
 * COMISION DE RETIRO: se retiene un `payoutFeePercent` (10% por defecto) de
 * los tokens solicitados. Se debita el bruto del monedero y solo se transfiere
 * el neto; la diferencia queda registrada en `feeTokens` y en
 * `platformFeeTokens` del asiento, para que el desglose sea auditable. Es una
 * comision DISTINTA de la de plataforma, que ya se cobro cuando el usuario
 * gasto el token.
 */
export async function requestPayoutAction(input: {
  tokens: number;
  destination: PayoutDestination;
}): Promise<ModelActionResult> {
  try {
    const { user, profile } = await requireModelProfile();
    const unverified = await emailVerificationBlock(user.id);
    if (unverified) return { ok: false, error: unverified };

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

    // Solo se retira lo GANADO: los tokens comprados son para gastar aqui.
    const wallet = await prisma.wallet.findUnique({
      where: { userId: user.id },
      select: { balance: true, pendingEarnings: true },
    });
    const withdrawable = wallet ? withdrawableTokens(wallet) : 0;
    if (tokens > withdrawable) {
      return {
        ok: false,
        error:
          withdrawable > 0
            ? `Solo puedes retirar tokens ganados: tienes ${withdrawable} para retirar. Los tokens comprados solo sirven para gastar dentro de FantasyLive.`
            : 'Aun no tienes tokens ganados para retirar. Los tokens comprados solo sirven para gastar dentro de FantasyLive.',
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

    const { feeTokens, netTokens } = splitPayoutFee(tokens);
    if (netTokens <= 0) {
      return { ok: false, error: 'El importe no cubre la comision de retiro.' };
    }
    const amountCents = tokensToPayoutCents(netTokens);

    // El cifrado se hace ANTES de abrir la transaccion: si la clave no esta
    // configurada preferimos fallar sin haber tocado el monedero.
    const encryptedDestination = encryptSecret(JSON.stringify(destination));
    const masked = maskDestination(destinationIdentifier(destination));

    await prisma.$transaction(async (tx) => {
      const payout = await tx.payoutRequest.create({
        data: {
          modelId: profile.id,
          tokens,
          feeTokens,
          netTokens,
          amountCents,
          currency: 'USD',
          method: destination.method,
          destination: encryptedDestination,
          destinationMasked: masked,
          status: 'REQUESTED',
        },
        select: { id: true },
      });

      // Debito atomico (solo de lo ganado): lanza NotWithdrawableError y revierte la
      // transaccion completa si el saldo no alcanza.
      await applyLedgerEntry(tx, {
        userId: user.id,
        type: 'PAYOUT',
        tokens,
        amountCents,
        currency: 'USD',
        description: `Solicitud de retiro (${PAYOUT_METHOD_LABELS[destination.method]})`,
        payoutRequestId: payout.id,
        platformFeeTokens: feeTokens,
      });

      await tx.auditLog.create({
        data: {
          actorId: user.id,
          action: 'PAYOUT_REQUESTED',
          entityType: 'PayoutRequest',
          entityId: payout.id,
          metadata: {
            tokens,
            feeTokens,
            netTokens,
            amountCents,
            method: destination.method,
          },
        },
      });
    });

    revalidatePath('/dashboard/model/payouts');
    revalidatePath('/admin/payouts');
    return {
      ok: true,
      message:
        feeTokens > 0
          ? `Retiro solicitado: ${tokens} tokens menos ${feeTokens} de comision (${config.economy.payoutFeePercent}%) = ${netTokens} tokens, ${(amountCents / 100).toFixed(2)} USD.`
          : `Retiro solicitado: ${tokens} tokens (${(amountCents / 100).toFixed(2)} USD).`,
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
    await assertCreatorVerified({ modelId: profile.id });

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
