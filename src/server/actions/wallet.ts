'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { getAuthedUserOrThrow } from '@/lib/auth/guards';
import { prisma } from '@/lib/prisma';
import { checkNoContactInfo } from '@/lib/content-filter';
import { GEO_BLOCKED_MESSAGE, isBlockedForViewer } from '@/lib/geo';
import { avatarOf } from '@/lib/live';
import { parseTipMenu } from '@/lib/live-state';
import { sendRoomData } from '@/lib/livekit';
import { createNotification } from '@/lib/notifications';
import { startTokenPurchase } from '@/lib/payments';
import { emailVerificationBlock } from '@/lib/auth-tokens';
import {
  InsufficientTokensError,
  applyLedgerEntry,
  getWalletSummary,
  transferWithCommission,
} from '@/lib/tokens';

export interface WalletActionResult {
  ok: boolean;
  error?: string;
  redirectUrl?: string | null;
  balance?: number;
  message?: string;
}

/** Inicia la compra de un paquete de tokens. */
export async function purchaseTokensAction(
  packageId: string,
): Promise<WalletActionResult> {
  try {
    const user = await getAuthedUserOrThrow();
    const unverified = await emailVerificationBlock(user.id);
    if (unverified) return { ok: false, error: unverified };

    const result = await startTokenPurchase({
      userId: user.id,
      packageId,
      userEmail: user.email,
    });

    if (result.credited) {
      revalidatePath('/wallet');
      return {
        ok: true,
        balance: result.newBalance,
        message: `Se han acreditado ${result.tokens} tokens (modo prueba).`,
      };
    }

    return { ok: true, redirectUrl: result.url };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

const giftSchema = z.object({
  receiverId: z.string().min(1),
  tokens: z.number().int().min(1).max(100000),
  sessionId: z.string().optional(),
  streamId: z.string().optional(),
  emoji: z.string().max(8).optional(),
  message: z.string().max(200).optional(),
});

/**
 * Envia una propina (tip) en una llamada, en un directo o desde el perfil.
 *
 * `sessionId` y `streamId` son excluyentes: un regalo pertenece a una
 * videollamada o a un directo, nunca a los dos. El reparto con la plataforma
 * es el mismo en los tres casos, asi que se reutiliza TIP / TIP_EARNING.
 */
export async function sendGiftAction(input: {
  receiverId: string;
  tokens: number;
  sessionId?: string;
  streamId?: string;
  emoji?: string;
  message?: string;
}): Promise<WalletActionResult> {
  return giftCore(input);
}

/**
 * Pedir una accion del menu de propinas en un directo ("200 tokens -> baile").
 * El precio y el texto salen del menu guardado de la creadora, nunca de lo
 * que mande el navegador.
 */
export async function buyTipMenuItemAction(
  streamId: string,
  itemId: string,
): Promise<WalletActionResult> {
  const stream = await prisma.liveStream.findUnique({
    where: { id: streamId },
    select: { status: true, model: { select: { userId: true, liveTipMenu: true } } },
  });
  if (!stream || stream.status === 'ENDED') return { ok: false, error: 'Este directo ha terminado.' };
  const item = parseTipMenu(stream.model.liveTipMenu).find((i) => i.id === itemId);
  if (!item) return { ok: false, error: 'Esa accion ya no esta en el menu.' };
  return giftCore(
    { receiverId: stream.model.userId, tokens: item.tokens, streamId, emoji: '⭐', message: item.label },
    { request: item.label },
  );
}

/** Cobra y anuncia un regalo. `request`: accion del menu de propinas. */
async function giftCore(
  input: {
    receiverId: string;
    tokens: number;
    sessionId?: string;
    streamId?: string;
    emoji?: string;
    message?: string;
  },
  extras: { request?: string } = {},
): Promise<WalletActionResult> {
  try {
    const user = await getAuthedUserOrThrow();
    const parsed = giftSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: 'Datos de regalo invalidos.' };

    const { receiverId, tokens, sessionId, streamId, emoji, message } =
      parsed.data;

    if (message) {
      const contactError = checkNoContactInfo(message);
      if (contactError) return { ok: false, error: contactError };
    }
    if (receiverId === user.id) {
      return { ok: false, error: 'No puedes enviarte regalos a ti mismo.' };
    }

    const receiver = await prisma.user.findUnique({
      where: { id: receiverId },
      select: {
        id: true,
        name: true,
        modelProfile: { select: { blockedCountries: true } },
      },
    });
    if (!receiver) return { ok: false, error: 'Destinatario no encontrado.' };

    // Un regalo "de llamada" solo vale dentro de una llamada entre estas dos
    // personas: si no, se podria anunciar un regalo en la sala de otros.
    let callRoomName: string | null = null;
    if (sessionId) {
      const session = await prisma.callSession.findUnique({
        where: { id: sessionId },
        select: { roomName: true, callerId: true, calleeId: true },
      });
      const members = [session?.callerId, session?.calleeId];
      if (!session || !members.includes(user.id) || !members.includes(receiverId)) {
        return { ok: false, error: 'Llamada no encontrada.' };
      }
      callRoomName = session.roomName;
    }
    if (await isBlockedForViewer(receiver.modelProfile?.blockedCountries)) {
      return { ok: false, error: GEO_BLOCKED_MESSAGE };
    }

    let liveRoomName: string | null = null;
    let liveGoal: { label: string; target: number; progress: number } | null = null;

    const balance = await prisma.$transaction(async (tx) => {
      const gift = await tx.gift.create({
        data: {
          senderId: user.id,
          receiverId,
          sessionId: sessionId ?? null,
          streamId: streamId ?? null,
          tokens,
          emoji: emoji ?? null,
          message: message ?? null,
        },
        select: { id: true },
      });

      const { debit, modelTokens } = await transferWithCommission(tx, {
        fromUserId: user.id,
        toUserId: receiverId,
        tokens,
        debitType: 'TIP',
        creditType: 'TIP_EARNING',
        description: `Regalo para ${receiver.name ?? 'modelo'}`,
        callSessionId: sessionId,
        liveStreamId: streamId,
        giftId: gift.id,
      });

      // Contadores del directo: son lo que la creadora ve al terminar de
      // emitir, sin tener que agregar la tabla de regalos.
      if (streamId) {
        const stream = await tx.liveStream.update({
          where: { id: streamId },
          data: {
            giftsCount: { increment: 1 },
            tokensEarned: { increment: modelTokens },
            // La meta cuenta lo que paga el fan (lo que ve en pantalla),
            // no la parte neta de la creadora.
            goalProgress: { increment: tokens },
          },
          select: {
            id: true,
            roomName: true,
            goalLabel: true,
            goalTokens: true,
            goalProgress: true,
            goalReachedAt: true,
          },
        });
        liveRoomName = stream.roomName;
        if (stream.goalLabel && stream.goalTokens) {
          liveGoal = {
            label: stream.goalLabel,
            target: stream.goalTokens,
            progress: stream.goalProgress,
          };
          if (!stream.goalReachedAt && stream.goalProgress >= stream.goalTokens) {
            await tx.liveStream.update({
              where: { id: stream.id },
              data: { goalReachedAt: new Date() },
            });
          }
        }
      }

      await createNotification(tx, {
        userId: receiverId,
        type: 'GIFT_RECEIVED',
        title: `${user.name ?? 'Alguien'} te ha enviado ${tokens} tokens`,
        body: message ?? undefined,
      });

      return debit.balanceAfter;
    });

    // El regalo se anuncia en la sala desde el servidor, ya cobrado: asi lo
    // ven la creadora y todo el publico, y nadie puede fingirlo por el chat.
    const senderAvatar = liveRoomName || callRoomName ? await avatarOf(user.id) : null;
    if (liveRoomName) {
      await sendRoomData(liveRoomName, {
        type: 'gift',
        from: user.name ?? 'Alguien',
        avatar: senderAvatar,
        tokens,
        emoji: emoji ?? '🎁',
        ...(extras.request ? { request: extras.request } : {}),
      });
      if (liveGoal) await sendRoomData(liveRoomName, { type: 'goal', goal: liveGoal });
    }
    // En una llamada 1 a 1 se anuncia igual, para que quien lo recibe lo vea
    // en pantalla al momento y no solo en las notificaciones.
    if (callRoomName) {
      await sendRoomData(callRoomName, {
        type: 'gift',
        from: user.name ?? 'Alguien',
        avatar: senderAvatar,
        senderId: user.id,
        tokens,
        emoji: emoji ?? '🎁',
      });
    }

    return {
      ok: true,
      balance,
      message: `Has enviado ${tokens} tokens.`,
    };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

export async function getWalletAction() {
  const user = await getAuthedUserOrThrow();
  return getWalletSummary(user.id);
}

/** Ajuste manual de saldo (solo ADMIN). */
export async function adminAdjustBalanceAction(input: {
  userId: string;
  tokens: number;
  reason: string;
}): Promise<WalletActionResult> {
  try {
    const admin = await getAuthedUserOrThrow();
    if (admin.role !== 'ADMIN') return { ok: false, error: 'No autorizado.' };

    const amount = Math.abs(Math.round(input.tokens));
    if (amount === 0) return { ok: false, error: 'Importe invalido.' };

    const { balanceAfter } = await prisma.$transaction((tx) =>
      applyLedgerEntry(tx, {
        userId: input.userId,
        type: input.tokens > 0 ? 'ADMIN_CREDIT' : 'ADMIN_DEBIT',
        tokens: amount,
        description: input.reason || 'Ajuste manual de administracion',
        metadata: { adminId: admin.id },
      }),
    );

    await prisma.auditLog.create({
      data: {
        actorId: admin.id,
        action: input.tokens > 0 ? 'ADMIN_CREDIT' : 'ADMIN_DEBIT',
        entityType: 'Wallet',
        entityId: input.userId,
        metadata: { tokens: input.tokens, reason: input.reason },
      },
    });

    revalidatePath('/admin/users');
    return { ok: true, balance: balanceAfter, message: 'Saldo ajustado.' };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

function toMessage(error: unknown): string {
  if (error instanceof InsufficientTokensError) return error.message;
  if (error instanceof Error) {
    if (error.message === 'UNAUTHORIZED') return 'Debes iniciar sesion.';
    if (error.message === 'ACCOUNT_BANNED') return 'Cuenta suspendida.';
    if (error.message === 'PACKAGE_NOT_AVAILABLE')
      return 'El paquete seleccionado no esta disponible.';
    if (error.message === 'STRIPE_NOT_CONFIGURED')
      return 'La pasarela de pago no esta configurada. Usa PAYMENT_PROVIDER=mock en local.';
    if (error.message === 'PAYPAL_NOT_CONFIGURED')
      return 'PayPal no esta configurado. Revisa PAYPAL_CLIENT_ID y PAYPAL_CLIENT_SECRET.';
    if (
      error.message === 'PAYPAL_ORDER_FAILED' ||
      error.message === 'PAYPAL_NO_APPROVAL_URL' ||
      error.message.startsWith('PAYPAL_AUTH_FAILED')
    )
      return 'No se pudo iniciar el pago con PayPal. Intentalo de nuevo.';
    return error.message;
  }
  return 'Error inesperado.';
}
