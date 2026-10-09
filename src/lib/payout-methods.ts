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
 * valores heredados (USDT_TRC20, PAYPAL, BANK_TRANSFER, CRYPTO, PAXUM) para no romper el
 * historico, pero NO se aceptan en solicitudes nuevas.
 */
export const PAYOUT_METHODS = ['BINANCE_PAY', 'WIRE_TRANSFER'] as const;

export type ActivePayoutMethod = (typeof PAYOUT_METHODS)[number];

export const PAYOUT_METHOD_LABELS: Record<PayoutMethod, string> = {
  BINANCE_PAY: 'Binance Pay (USDT o USDC)',
  WIRE_TRANSFER: 'Transferencia bancaria',
  USDT_TRC20: 'USDT - red TRC20 (heredado)',
  PAYPAL: 'PayPal (heredado)',
  BANK_TRANSFER: 'Transferencia bancaria (heredado)',
  CRYPTO: 'Cripto (heredado)',
  PAXUM: 'Paxum (heredado)',
};

export const PAYOUT_METHOD_HINTS: Record<ActivePayoutMethod, string> = {
  BINANCE_PAY:
    'Llega al instante a tu cuenta de Binance cuando se procesa, sin comisiones de red.',
  WIRE_TRANSFER:
    'Llega en 3-5 dias habiles. El banco puede aplicar comisiones por transferencia internacional.',
};

export const BINANCE_ASSETS = ['USDT', 'USDC'] as const;
export type BinanceAsset = (typeof BINANCE_ASSETS)[number];

/** Binance Pay: en USDT o USDC, a su Pay ID o al correo de su cuenta Binance. */
export interface BinancePayDestination {
  method: 'BINANCE_PAY';
  asset: BinanceAsset;
  /** Binance Pay ID (numerico) o correo de la cuenta de Binance. */
  payId: string;
}

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

/** Lo que se puede pedir hoy. */
export type ActivePayoutDestination = BinancePayDestination | WireTransferDestination;

/** Cualquier destino guardado (incluye metodos que ya no se ofrecen). */
export type PayoutDestination =
  | ActivePayoutDestination
  | UsdtTrc20Destination
  | PaypalDestination;
