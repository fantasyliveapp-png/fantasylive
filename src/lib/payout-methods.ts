import type { PayoutMethod } from '@prisma/client';

/**
 * Constantes y tipos de los metodos de retiro, SIN dependencias de Node.
 *
 * Vive aparte de `payouts.ts` (que usa node:crypto para validar direcciones
 * TRON) para que los formularios de cliente puedan importarlo sin arrastrar
 * modulos de servidor al bundle del navegador.
 */

/**
 * Metodos que la plataforma ofrece hoy. El enum de Prisma conserva ademas
 * valores heredados (BANK_TRANSFER, CRYPTO, PAXUM) para no romper el
 * historico, pero NO se aceptan en solicitudes nuevas.
 */
export const PAYOUT_METHODS = ['WIRE_TRANSFER', 'USDT_TRC20', 'PAYPAL'] as const;

export type ActivePayoutMethod = (typeof PAYOUT_METHODS)[number];

export const PAYOUT_METHOD_LABELS: Record<PayoutMethod, string> = {
  WIRE_TRANSFER: 'Transferencia bancaria (wire)',
  USDT_TRC20: 'USDT - red TRC20',
  PAYPAL: 'PayPal',
  BANK_TRANSFER: 'Transferencia bancaria (heredado)',
  CRYPTO: 'Cripto (heredado)',
  PAXUM: 'Paxum (heredado)',
};

export const PAYOUT_METHOD_HINTS: Record<ActivePayoutMethod, string> = {
  WIRE_TRANSFER:
    'Llega en 3-5 dias habiles. El banco puede aplicar comisiones por transferencia internacional.',
  USDT_TRC20:
    'Se envia en 24-48 h. Comprueba la direccion: la red TRON es irreversible.',
  PAYPAL: 'Llega en 1-2 dias habiles a la cuenta asociada a ese correo.',
};

/** Datos de cobro para transferencia bancaria internacional. */
export interface WireTransferDestination {
  method: 'WIRE_TRANSFER';
  accountHolder: string;
  bankName: string;
  accountNumber: string;
  swiftBic: string;
  bankCountry: string;
  bankAddress?: string;
}

/** Direccion de wallet USDT en la red TRON. */
export interface UsdtTrc20Destination {
  method: 'USDT_TRC20';
  address: string;
}

/** Correo asociado a la cuenta de PayPal. */
export interface PaypalDestination {
  method: 'PAYPAL';
  email: string;
}

export type PayoutDestination =
  | WireTransferDestination
  | UsdtTrc20Destination
  | PaypalDestination;
