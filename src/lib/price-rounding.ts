/**
 * PRECIOS REDONDOS
 *
 * Los precios con oferta terminan siempre en ,99 (22,99 y no 23,19): se ven
 * mas limpios y venden mas. Lo usan tanto el servidor (lo que se cobra) como
 * la vista previa del admin, asi que no importa nada.
 */

/**
 * Precios "de escaparate", de menor a mayor: X,99 por debajo de 20 $ (7,99,
 * 8,99...) y, desde ahi, solo los que acaban en 4,99 o 9,99 (24,99, 59,99,
 * 124,99, 299,99...).
 */
function charmPrices(maxCents: number): number[] {
  const out: number[] = [];
  for (let p = 99; p < maxCents; p += p < 1999 ? 100 : 500) out.push(p);
  return out;
}

/**
 * Precio de escaparate mas parecido a `rawCents` que no baje de `minCents`
 * (el minimo seguro) ni llegue a `baseCents` (el precio sin oferta). null si
 * no hay ninguno: ese paquete se queda sin oferta.
 */
export function roundOfferPrice(rawCents: number, baseCents: number, minCents: number): number | null {
  const valid = charmPrices(baseCents).filter((p) => p >= minCents);
  if (valid.length === 0) return null;
  // El mas cercano (puede quedar 1-2 puntos por encima o por debajo del % pedido;
  // el minimo seguro ya esta filtrado). En empate, el de arriba: menos descuento.
  return valid.reduce((best, p) => {
    const d = Math.abs(p - rawCents);
    const bd = Math.abs(best - rawCents);
    return d < bd || (d === bd && p > best) ? p : best;
  });
}

/** Tokens de regalo redondeados a multiplos de 5 (+30, no +31). */
export function roundBonusTokens(tokens: number): number {
  return tokens >= 10 ? Math.floor(tokens / 5) * 5 : tokens;
}
