import 'server-only';

import { config } from '@/lib/config';
import { encryptSecret, maskDestination } from '@/lib/crypto';
import { prisma } from '@/lib/prisma';
import { destinationIdentifier, PAYOUT_METHOD_LABELS, type ActivePayoutDestination } from '@/lib/payouts';
import { applyLedgerEntry, splitPayoutFee, tokensToPayoutCents, withdrawableTokens } from '@/lib/tokens';
import { formatMoney } from '@/lib/utils';

export const OPEN_PAYOUT_STATUSES = ['REQUESTED', 'APPROVED', 'PROCESSING'] as const;

/** De quien es la solicitud: una creadora o un reclutador. */
export type PayoutOwner = { modelId: string } | { recruiterId: string };

/**
 * Crea una solicitud de retiro (creadoras y reclutadores comparten el flujo).
 *
 * Los tokens se debitan AL SOLICITAR (asiento PAYOUT) y se devuelven si un
 * admin rechaza la solicitud. El debito usa un UPDATE condicional sobre el
 * saldo, asi que dos solicitudes simultaneas no pueden dejar el monedero en
 * negativo ni retirar el mismo saldo dos veces.
 *
 * Los datos de cobro se guardan CIFRADOS (AES-256-GCM); en la base de datos
 * solo queda ademas una version enmascarada para poder listarlos.
 *
 * Devuelve el mensaje para el usuario o lanza un Error con el motivo.
 */
export async function createPayoutRequest(input: {
  userId: string;
  owner: PayoutOwner;
  tokens: number;
  destination: ActivePayoutDestination;
}): Promise<string> {
  const { userId, owner, tokens, destination } = input;

  if (tokens < config.economy.minPayoutTokens) {
    throw new Error(
      `El minimo de retiro es ${formatMoney(tokensToPayoutCents(config.economy.minPayoutTokens))}.`,
    );
  }

  // Solo se retira lo GANADO: los tokens comprados son para gastar aqui.
  const wallet = await prisma.wallet.findUnique({
    where: { userId },
    select: { balance: true, pendingEarnings: true },
  });
  const withdrawable = wallet ? withdrawableTokens(wallet) : 0;
  if (tokens > withdrawable) {
    throw new Error(
      withdrawable > 0
        ? `Solo puedes retirar tokens ganados: tienes ${withdrawable} para retirar. Los tokens comprados solo sirven para gastar dentro de Fantasy Live.`
        : 'Aun no tienes tokens ganados para retirar. Los tokens comprados solo sirven para gastar dentro de Fantasy Live.',
    );
  }

  // Una solicitud abierta a la vez: evita que se encadenen retiros mientras
  // finanzas todavia no ha procesado el anterior.
  const openRequest = await prisma.payoutRequest.findFirst({
    where: { ...owner, status: { in: [...OPEN_PAYOUT_STATUSES] } },
    select: { id: true },
  });
  if (openRequest) throw new Error('Ya tienes un retiro en curso. Espera a que se procese.');

  const { feeTokens, netTokens } = splitPayoutFee(tokens);
  if (netTokens <= 0) throw new Error('El importe no cubre la comision de retiro.');
  const amountCents = tokensToPayoutCents(netTokens);

  // El cifrado se hace ANTES de abrir la transaccion: si la clave no esta
  // configurada preferimos fallar sin haber tocado el monedero.
  const encryptedDestination = encryptSecret(JSON.stringify(destination));
  const masked = maskDestination(destinationIdentifier(destination));

  await prisma.$transaction(async (tx) => {
    const payout = await tx.payoutRequest.create({
      data: {
        ...owner,
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
      userId,
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
        actorId: userId,
        action: 'PAYOUT_REQUESTED',
        entityType: 'PayoutRequest',
        entityId: payout.id,
        metadata: { tokens, feeTokens, netTokens, amountCents, method: destination.method },
      },
    });
  });

  return feeTokens > 0
    ? `Retiro solicitado: ${tokens} tokens menos ${feeTokens} de comision (${config.economy.payoutFeePercent}%) = ${netTokens} tokens, ${(amountCents / 100).toFixed(2)} USD.`
    : `Retiro solicitado: ${formatMoney(amountCents)}.`;
}
