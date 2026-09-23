/**
 * TARIFAS POR MINUTO EN CENTITOKENS
 *
 * La creadora fija su precio por minuto entre 1,75 y 25 tokens. El minimo
 * tiene decimales, asi que guardar la tarifa como un Int de tokens no sirve:
 * se guarda multiplicada por 100 ("centitokens") y todo el calculo del cobro
 * sigue siendo aritmetica entera, sin errores de coma flotante acumulados a lo
 * largo de una llamada de una hora.
 *
 *   175  = 1,75 tokens/min  (minimo)
 *   250  = 2,50 tokens/min  (default)
 *   2500 = 25 tokens/min    (maximo)
 *
 * Lo que se DEBITA del monedero siguen siendo tokens enteros: el redondeo se
 * hace una sola vez sobre el total acumulado de la llamada (ver
 * `tokensForSeconds`), no en cada tick, para que la factura no se infle.
 *
 * Este modulo no importa nada: lo usan tanto el servidor como los formularios
 * de cliente.
 */

/** 1 token = 100 centitokens. */
export const CENTITOKENS_PER_TOKEN = 100;

/** Tarifa minima que puede fijar una creadora: 1,75 tokens/min. */
export const MIN_RATE_CENTITOKENS = 175;

/** Tarifa maxima: 25 tokens/min. */
export const MAX_RATE_CENTITOKENS = 2500;

/** Tarifa por defecto de un perfil nuevo: 2,50 tokens/min. */
export const DEFAULT_RATE_CENTITOKENS = 250;

/**
 * Duracion minima FACTURABLE de una llamada de pago.
 *
 * Aunque quien llama cuelgue al segundo 30, se cobran 5 minutos: es el
 * compromiso minimo que protege el tiempo de la creadora. Para empezar la
 * llamada hace falta saldo suficiente para cubrirlos.
 */
export const MIN_BILLED_CALL_MINUTES = 5;
export const MIN_BILLED_CALL_SECONDS = MIN_BILLED_CALL_MINUTES * 60;

/** Recorta una tarifa al rango permitido. */
export function clampRateCentitokens(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_RATE_CENTITOKENS;
  const rounded = Math.round(value);
  return Math.min(MAX_RATE_CENTITOKENS, Math.max(MIN_RATE_CENTITOKENS, rounded));
}

/** True si la tarifa esta dentro del rango permitido. */
export function isValidRateCentitokens(value: number): boolean {
  return (
    Number.isInteger(value) &&
    value >= MIN_RATE_CENTITOKENS &&
    value <= MAX_RATE_CENTITOKENS
  );
}

/** Centitokens -> tokens con decimales (para mostrar y para formularios). */
export function centitokensToTokens(centitokens: number): number {
  return centitokens / CENTITOKENS_PER_TOKEN;
}

/**
 * Tokens escritos por la creadora (ej. 1.75) -> centitokens.
 * Acepta coma decimal, que es lo que teclea la mayoria en espanol.
 */
export function tokensToCentitokens(tokens: number | string): number {
  const value =
    typeof tokens === 'string' ? Number(tokens.replace(',', '.')) : tokens;
  if (!Number.isFinite(value)) return Number.NaN;
  return Math.round(value * CENTITOKENS_PER_TOKEN);
}

/**
 * Etiqueta de la tarifa: "2,5 tokens/min". Sin decimales cuando es redonda,
 * para no llenar la interfaz de ",00".
 */
export function formatRate(centitokens: number): string {
  return `${formatRateNumber(centitokens)} tokens/min`;
}

/** Solo el numero: "1,75" / "25". */
export function formatRateNumber(centitokens: number): string {
  const tokens = centitokensToTokens(centitokens);
  const text = Number.isInteger(tokens)
    ? String(tokens)
    : tokens.toFixed(2).replace(/0$/, '');
  return text.replace('.', ',');
}

/**
 * Tokens ENTEROS que corresponden a `seconds` segundos a esa tarifa.
 *
 * Se redondea al alza una sola vez: quien llama nunca paga menos de lo
 * consumido, pero tampoco se le cobra un token extra por cada tick de 15 s.
 */
export function tokensForSeconds(
  rateCentitokens: number,
  seconds: number,
): number {
  if (rateCentitokens <= 0 || seconds <= 0) return 0;
  return Math.ceil(
    (rateCentitokens * seconds) / (60 * CENTITOKENS_PER_TOKEN),
  );
}

/** Tokens que hay que tener para sostener `minutes` minutos a esa tarifa. */
export function tokensForMinutes(
  rateCentitokens: number,
  minutes: number,
): number {
  return tokensForSeconds(rateCentitokens, minutes * 60);
}

/**
 * Minutos completos que aguanta un saldo a esa tarifa.
 * Infinity si la tarifa es 0 (llamada gratuita).
 */
export function affordableMinutesAtRate(
  balance: number,
  rateCentitokens: number,
): number {
  if (rateCentitokens <= 0) return Number.POSITIVE_INFINITY;
  return Math.floor((balance * CENTITOKENS_PER_TOKEN) / rateCentitokens);
}

/** Aplica el descuento de suscriptor sin salirse del minimo permitido. */
export function applyDiscountToRate(
  rateCentitokens: number,
  discountPercent: number,
): number {
  if (discountPercent <= 0) return rateCentitokens;
  const discounted = Math.round(rateCentitokens * (1 - discountPercent / 100));
  return Math.max(MIN_RATE_CENTITOKENS, discounted);
}
