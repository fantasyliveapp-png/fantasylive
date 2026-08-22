import type {
  PaymentProvider,
  Prisma,
  TransactionType,
} from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { config } from '@/lib/config';

export class InsufficientTokensError extends Error {
  constructor(
    public required: number,
    public available: number,
  ) {
    super(
      `Tokens insuficientes: necesitas ${required} y tienes ${available}.`,
    );
    this.name = 'InsufficientTokensError';
  }
}

type Tx = Prisma.TransactionClient;

/** Tipos de movimiento que restan saldo al usuario. */
const DEBIT_TYPES: TransactionType[] = [
  'CALL_CHARGE',
  'CONTENT_UNLOCK',
  'TIP',
  'BOOKING_HOLD',
  'PAYOUT',
  'ADMIN_DEBIT',
  'SUBSCRIPTION_PURCHASE',
  'CONTENT_REQUEST_PAYMENT',
  'MESSAGE_UNLOCK',
  'MESSAGE_ATTACHMENT_UNLOCK',
];

/** Tipos de movimiento que representan ingresos de una modelo. */
const EARNING_TYPES: TransactionType[] = [
  'CALL_EARNING',
  'CONTENT_EARNING',
  'TIP_EARNING',
  'SUBSCRIPTION_EARNING',
  'CONTENT_REQUEST_EARNING',
  'MESSAGE_UNLOCK_EARNING',
  'MESSAGE_ATTACHMENT_EARNING',
];

export interface LedgerEntry {
  userId: string;
  type: TransactionType;
  /** Siempre positivo: el signo lo determina el tipo. */
  tokens: number;
  description?: string;
  provider?: PaymentProvider;
  providerRef?: string;
  amountCents?: number;
  currency?: string;
  metadata?: Prisma.InputJsonValue;
  callSessionId?: string;
  contentPackageId?: string;
  bookingId?: string;
  tokenPackageId?: string;
  giftId?: string;
  payoutRequestId?: string;
  subscriptionId?: string;
  contentRequestId?: string;
  conversationId?: string;
  messageAttachmentId?: string;
  platformFeeTokens?: number;
}

/**
 * Asegura que el usuario tiene monedero. Idempotente.
 */
export async function ensureWallet(userId: string, client: Tx | typeof prisma = prisma) {
  return client.wallet.upsert({
    where: { userId },
    create: { userId },
    update: {},
  });
}

export async function getBalance(userId: string): Promise<number> {
  const wallet = await prisma.wallet.findUnique({
    where: { userId },
    select: { balance: true },
  });
  return wallet?.balance ?? 0;
}

export async function getWalletSummary(userId: string) {
  const wallet = await prisma.wallet.findUnique({ where: { userId } });
  return (
    wallet ?? {
      id: '',
      userId,
      balance: 0,
      heldBalance: 0,
      pendingEarnings: 0,
      lifetimePurchased: 0,
      lifetimeSpent: 0,
      lifetimeEarned: 0,
      lifetimeWithdrawn: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    }
  );
}

/**
 * Aplica un movimiento al monedero dentro de una transaccion de BD.
 * Usa un UPDATE condicional para evitar saldos negativos por concurrencia.
 */
export async function applyLedgerEntry(
  tx: Tx,
  entry: LedgerEntry,
): Promise<{ balanceAfter: number; transactionId: string }> {
  const isDebit = DEBIT_TYPES.includes(entry.type);
  const isEarning = EARNING_TYPES.includes(entry.type);
  const amount = Math.abs(Math.round(entry.tokens));

  if (amount <= 0) throw new Error('El importe en tokens debe ser positivo.');

  await tx.wallet.upsert({
    where: { userId: entry.userId },
    create: { userId: entry.userId },
    update: {},
  });

  let balanceAfter: number;

  if (isDebit) {
    // updateMany con filtro de saldo => atomico, no permite quedar en negativo
    const updated = await tx.wallet.updateMany({
      where: { userId: entry.userId, balance: { gte: amount } },
      data: {
        balance: { decrement: amount },
        lifetimeSpent: { increment: entry.type === 'PAYOUT' ? 0 : amount },
        lifetimeWithdrawn: { increment: entry.type === 'PAYOUT' ? amount : 0 },
      },
    });

    if (updated.count === 0) {
      const wallet = await tx.wallet.findUnique({
        where: { userId: entry.userId },
        select: { balance: true },
      });
      throw new InsufficientTokensError(amount, wallet?.balance ?? 0);
    }

    const wallet = await tx.wallet.findUniqueOrThrow({
      where: { userId: entry.userId },
      select: { balance: true },
    });
    balanceAfter = wallet.balance;
  } else {
    const wallet = await tx.wallet.update({
      where: { userId: entry.userId },
      data: {
        balance: { increment: amount },
        lifetimePurchased: {
          increment: entry.type === 'TOKEN_PURCHASE' ? amount : 0,
        },
        lifetimeEarned: { increment: isEarning ? amount : 0 },
        pendingEarnings: { increment: isEarning ? amount : 0 },
      },
      select: { balance: true },
    });
    balanceAfter = wallet.balance;
  }

  const transaction = await tx.transaction.create({
    data: {
      userId: entry.userId,
      type: entry.type,
      status: 'COMPLETED',
      tokens: isDebit ? -amount : amount,
      balanceAfter,
      amountCents: entry.amountCents,
      currency: entry.currency,
      provider: entry.provider ?? 'INTERNAL',
      providerRef: entry.providerRef,
      description: entry.description,
      metadata: entry.metadata,
      callSessionId: entry.callSessionId,
      contentPackageId: entry.contentPackageId,
      bookingId: entry.bookingId,
      tokenPackageId: entry.tokenPackageId,
      giftId: entry.giftId,
      payoutRequestId: entry.payoutRequestId,
      subscriptionId: entry.subscriptionId,
      contentRequestId: entry.contentRequestId,
      conversationId: entry.conversationId,
      messageAttachmentId: entry.messageAttachmentId,
      platformFeeTokens: entry.platformFeeTokens ?? 0,
    },
    select: { id: true },
  });

  return { balanceAfter, transactionId: transaction.id };
}

/** Helper para movimientos sueltos fuera de una transaccion existente. */
export async function recordLedgerEntry(entry: LedgerEntry) {
  return prisma.$transaction((tx) => applyLedgerEntry(tx, entry));
}

/**
 * Reparte tokens gastados por un usuario entre la modelo y la plataforma.
 * Devuelve el desglose para persistirlo en la sesion/paquete.
 */
export function splitEarnings(tokensSpent: number) {
  const fee = Math.round(
    (tokensSpent * config.economy.platformCommissionPercent) / 100,
  );
  return {
    platformFeeTokens: fee,
    modelTokens: tokensSpent - fee,
  };
}

/**
 * Transferencia usuario -> modelo con comision.
 * Ejecuta ambos asientos en la misma transaccion de BD.
 */
export async function transferWithCommission(
  tx: Tx,
  params: {
    fromUserId: string;
    toUserId: string;
    tokens: number;
    debitType: TransactionType;
    creditType: TransactionType;
    description: string;
    callSessionId?: string;
    contentPackageId?: string;
    bookingId?: string;
    giftId?: string;
    subscriptionId?: string;
    contentRequestId?: string;
    conversationId?: string;
    messageAttachmentId?: string;
    metadata?: Prisma.InputJsonValue;
  },
) {
  const { platformFeeTokens, modelTokens } = splitEarnings(params.tokens);

  const debit = await applyLedgerEntry(tx, {
    userId: params.fromUserId,
    type: params.debitType,
    tokens: params.tokens,
    description: params.description,
    callSessionId: params.callSessionId,
    contentPackageId: params.contentPackageId,
    bookingId: params.bookingId,
    giftId: params.giftId,
    subscriptionId: params.subscriptionId,
    contentRequestId: params.contentRequestId,
    conversationId: params.conversationId,
    messageAttachmentId: params.messageAttachmentId,
    metadata: params.metadata,
    platformFeeTokens,
  });

  let credit = { balanceAfter: 0, transactionId: '' };
  if (modelTokens > 0) {
    credit = await applyLedgerEntry(tx, {
      userId: params.toUserId,
      type: params.creditType,
      tokens: modelTokens,
      description: params.description,
      callSessionId: params.callSessionId,
      contentPackageId: params.contentPackageId,
      bookingId: params.bookingId,
      giftId: params.giftId,
      subscriptionId: params.subscriptionId,
      contentRequestId: params.contentRequestId,
      conversationId: params.conversationId,
      messageAttachmentId: params.messageAttachmentId,
      metadata: params.metadata,
    });
  }

  return { platformFeeTokens, modelTokens, debit, credit };
}

/** Convierte tokens ganados a centavos pagaderos a la modelo. */
export function tokensToPayoutCents(tokens: number): number {
  return Math.round(tokens * config.economy.modelPayoutCentsPerToken);
}

/** Valor de venta de N tokens en centavos (lo que paga el usuario). */
export function tokensToRetailCents(tokens: number): number {
  return Math.round(tokens * config.economy.tokenValueCents);
}

/** Minutos que el usuario puede sostener a una tarifa dada. */
export function affordableMinutes(balance: number, ratePerMinute: number) {
  if (ratePerMinute <= 0) return Infinity;
  return Math.floor(balance / ratePerMinute);
}
