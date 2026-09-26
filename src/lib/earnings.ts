/**
 * Calculo de lo que gana una modelo con un pago en tokens.
 *
 * Replica el reparto de `splitEarnings` (lib/tokens) pero sin leer la config
 * del servidor, para poder usarlo en componentes de cliente: los parametros
 * de la economia se pasan desde la pagina.
 */
export interface EconomyParams {
  /** Comision de la plataforma sobre lo gastado (%). */
  platformCommissionPercent: number;
  /** Lo que se paga a la modelo por token ganado (centavos). */
  payoutCentsPerToken: number;
  /** Comision al retirar (%). */
  payoutFeePercent: number;
}

export function estimateEarnings(tokensSpent: number, economy: EconomyParams) {
  // Mismo redondeo que splitEarnings: la comision se redondea y la modelo se
  // queda con el resto, asi el calculo coincide token a token con el real.
  const feeTokens = Math.round(
    (tokensSpent * economy.platformCommissionPercent) / 100,
  );
  const modelTokens = Math.max(0, tokensSpent - feeTokens);
  const grossCents = modelTokens * economy.payoutCentsPerToken;
  const netCents = Math.round(
    (grossCents * (100 - economy.payoutFeePercent)) / 100,
  );
  return { feeTokens, modelTokens, grossCents, netCents };
}
