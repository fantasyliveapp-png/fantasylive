/**
 * DISTRIBUIDORES: lo que comparten servidor y pantallas (no importa nada).
 *
 * Todo se cuenta en dolares: la plataforma cobra siempre en USD y cada
 * distribuidor cambia a su moneda al vender. El descuento al comprar es
 * progresivo segun el tamaño del lote (hasta el 20%) y cada uno pone sus
 * precios de venta.
 */

/**
 * Metodos con los que un distribuidor puede cobrar al fan. Sin tarjetas: las
 * redes de tarjetas prohiben revender lo comprado con tarjeta.
 */
export const PAYMENT_METHODS: ReadonlyArray<{ key: string; label: string; countries?: string[] }> = [
  { key: 'bank', label: 'Transferencia bancaria' },
  { key: 'cash', label: 'Efectivo / depósito' },
  { key: 'zelle', label: 'Zelle', countries: ['US'] },
  { key: 'cashapp', label: 'Cash App', countries: ['US'] },
  { key: 'venmo', label: 'Venmo', countries: ['US'] },
  { key: 'paypal', label: 'PayPal' },
  { key: 'mercadopago', label: 'Mercado Pago', countries: ['AR', 'MX', 'CL', 'CO', 'PE', 'UY', 'BR'] },
  { key: 'spei', label: 'SPEI', countries: ['MX'] },
  { key: 'oxxo', label: 'OXXO', countries: ['MX'] },
  { key: 'nequi', label: 'Nequi', countries: ['CO'] },
  { key: 'daviplata', label: 'Daviplata', countries: ['CO'] },
  { key: 'yape', label: 'Yape', countries: ['PE', 'BO'] },
  { key: 'plin', label: 'Plin', countries: ['PE'] },
  { key: 'pagomovil', label: 'Pago Móvil', countries: ['VE'] },
  { key: 'pix', label: 'PIX', countries: ['BR'] },
  { key: 'bizum', label: 'Bizum', countries: ['ES'] },
  { key: 'sinpe', label: 'SINPE Móvil', countries: ['CR'] },
  { key: 'usdt', label: 'USDT / cripto' },
  { key: 'binance', label: 'Binance Pay' },
  { key: 'wise', label: 'Wise' },
  { key: 'western', label: 'Western Union / remesas' },
];

export const PAYMENT_METHOD_KEYS = new Set(PAYMENT_METHODS.map((m) => m.key));

export function paymentMethodLabel(key: string) {
  return PAYMENT_METHODS.find((m) => m.key === key)?.label ?? key;
}

/**
 * Descuento progresivo al comprar: cuanto mas grande el lote, mas barato.
 * El ultimo tramo es el tope (20%, o menos si asi se configura).
 */
export const DISCOUNT_TIERS: ReadonlyArray<{ minTokens: number; percent: number }> = [
  { minTokens: 1_000, percent: 8 },
  { minTokens: 5_000, percent: 11 },
  { minTokens: 10_000, percent: 14 },
  { minTokens: 25_000, percent: 16 },
  { minTokens: 50_000, percent: 18 },
  { minTokens: 100_000, percent: 20 },
];

/** Descuento (%) de un lote de `tokens`, sin pasar de `maxPercent`. */
export function discountForTokens(tokens: number, maxPercent: number) {
  let pct = 0;
  for (const t of DISCOUNT_TIERS) if (tokens >= t.minTokens) pct = t.percent;
  return Math.min(pct, maxPercent);
}

/** Tramos con el tope aplicado (para mostrarlos). */
export function discountTiers(maxPercent: number) {
  return DISCOUNT_TIERS.map((t) => ({ ...t, percent: Math.min(t.percent, maxPercent) }));
}

/** Siguiente tramo: cuantos tokens mas para subir de descuento. */
export function nextDiscountTier(tokens: number, maxPercent: number) {
  const cur = discountForTokens(tokens, maxPercent);
  const next = DISCOUNT_TIERS.find((t) => t.minTokens > tokens && Math.min(t.percent, maxPercent) > cur);
  return next ? { minTokens: next.minTokens, percent: Math.min(next.percent, maxPercent) } : null;
}

/**
 * Las cuentas de un lote, en dolares (centavos de USD):
 *   retail  lo que valen esos tokens al precio de la web
 *   cost    lo que el distribuidor te paga a ti
 *   profit  la diferencia: lo que se ahorra con su descuento
 */
export function lotMath(tokens: number, tokenValueCents: number, discountPercent: number) {
  const retailCents = tokens * tokenValueCents;
  const costCents = Math.round((retailCents * (100 - discountPercent)) / 100);
  return { retailCents, costCents, profitCents: retailCents - costCents };
}

// ---------------------------------------------------------------------------
// Monedas
// ---------------------------------------------------------------------------

/** Moneda local de cada pais (el distribuidor puede cobrar tambien en USD). */
export const COUNTRY_CURRENCY: Record<string, string> = {
  US: 'USD', MX: 'MXN', CO: 'COP', PE: 'PEN', AR: 'ARS', CL: 'CLP', VE: 'VES', BR: 'BRL', ES: 'EUR',
  CR: 'CRC', BO: 'BOB', UY: 'UYU', EC: 'USD', DO: 'DOP', GT: 'GTQ', PA: 'USD', PY: 'PYG', SV: 'USD',
  HN: 'HNL', NI: 'NIO', PR: 'USD', CA: 'CAD', GB: 'GBP', PT: 'EUR', IT: 'EUR', FR: 'EUR', DE: 'EUR',
};

export function currenciesFor(country: string): string[] {
  const local = COUNTRY_CURRENCY[country];
  return [...new Set([local, 'USD'].filter(Boolean) as string[])];
}

/** Importe en centesimas -> "39.000 COP". */
export function formatLocal(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat('es', {
      style: 'currency',
      currency,
      currencyDisplay: 'code',
      maximumFractionDigits: amount % 100 === 0 ? 0 : 2,
    }).format(amount / 100);
  } catch {
    return `${(amount / 100).toLocaleString('es')} ${currency}`;
  }
}

/** { MXN: 120000, USD: 4500 } -> "1200 MXN · 45 USD". Cada moneda por separado: no se mezclan. */
export function formatAmounts(amounts: Record<string, number>) {
  const entries = Object.entries(amounts).filter(([, v]) => v > 0);
  if (!entries.length) return '—';
  return entries
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([c, v]) => formatLocal(v, c))
    .join(' · ');
}

/** Ganancia maxima recomendada por venta (%). Es una recomendacion, no un tope. */
export const RECOMMENDED_MAX_MARGIN = 20;

/**
 * Lo que valen N tokens al precio de la web, pasado a esa moneda con el cambio
 * oficial del dia (centesimas). Solo se guarda en cada venta como referencia
 * para auditar; no se muestra porque el cambio real puede ser otro.
 */
export function officialFor(tokens: number, tokenValueCents: number, usdRate: number) {
  return Math.round(tokens * tokenValueCents * usdRate);
}

/** Paquetes que se proponen al crear un metodo (el distribuidor los cambia). */
export const SUGGESTED_PACKAGES = [50, 100, 300, 500, 1000] as const;
export const SALE_PAY_MINUTES = 30;
export const PACKAGE_LIMITS = { minTokens: 10, maxTokens: 5000, perAccount: 8 } as const;
