/**
 * Filtro de datos de contacto.
 *
 * Objetivo de negocio: que la relacion ocurra DENTRO de la plataforma. Si un
 * usuario y una creadora se pasan el Instagram o el telefono, la siguiente
 * conversacion (y el siguiente pago) ya no pasan por aqui.
 *
 * El filtro asume que quien intenta saltarselo lo hace a proposito, asi que
 * normaliza el texto antes de buscar: quita acentos, deshace el "leet"
 * (1nst4gr4m), y colapsa separadores para pillar "i n s t a g r a m" o
 * "t.e.l.e.g.r.a.m".
 *
 * Se prefiere un falso positivo ocasional a una fuga: el mensaje de error
 * explica que se ha detectado y la persona puede reformular.
 */

export type ContactKind =
  | 'telefono'
  | 'email'
  | 'enlace'
  | 'red-social'
  | 'usuario';

export interface FilterResult {
  blocked: boolean;
  reasons: ContactKind[];
}

const KIND_LABELS: Record<ContactKind, string> = {
  telefono: 'numeros de telefono',
  email: 'correos electronicos',
  enlace: 'enlaces externos',
  'red-social': 'redes sociales o apps de mensajeria',
  usuario: 'nombres de usuario de otras plataformas',
};

// ---------------------------------------------------------------------------
// NORMALIZACION
// ---------------------------------------------------------------------------

/** Sustituciones "leet" habituales para esquivar filtros. */
const LEET: Record<string, string> = {
  '0': 'o',
  '1': 'i',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '7': 't',
  '8': 'b',
  '@': 'a',
  $: 's',
  '!': 'i',
  '|': 'i',
  '¡': 'i',
};

function deaccent(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Texto para buscar palabras clave: sin acentos, en minusculas. */
function toWordText(text: string): string {
  return deaccent(text.toLowerCase());
}

/**
 * Texto para buscar palabras clave ofuscadas: ademas del anterior, deshace el
 * leet y elimina TODO lo que no sea letra, de modo que "i-n-s-t-a" y
 * "1n5t4" acaban siendo "insta".
 */
function toSquashedText(text: string): string {
  const lower = toWordText(text);
  let out = '';
  for (const ch of lower) {
    const mapped = LEET[ch] ?? ch;
    if (mapped >= 'a' && mapped <= 'z') out += mapped;
  }
  return out;
}

// ---------------------------------------------------------------------------
// TELEFONOS
// ---------------------------------------------------------------------------

/** Numeros escritos con palabras: "seis uno dos tres...". */
const DIGIT_WORDS = [
  'cero', 'uno', 'una', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete',
  'ocho', 'nueve',
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
];

/**
 * Un telefono es una tirada larga de digitos, tolerando los separadores
 * habituales. Antes se descartan fechas y horas, que si no dispararian el
 * filtro ("quedamos el 01/02/2026").
 *
 * El umbral son 8 digitos: los moviles reales tienen 9 o mas con prefijo, y
 * subirlo hasta aqui evita confundir cantidades ("1000 tokens") con contactos.
 */
function hasPhone(text: string): boolean {
  const cleaned = text
    .replace(/\b\d{1,2}\s*[/.-]\s*\d{1,2}\s*[/.-]\s*\d{2,4}\b/g, ' ') // fechas
    .replace(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g, ' '); // horas

  const runs = cleaned.match(/(?:\+?\d[\s.()\-_/]*){8,}/g) ?? [];
  for (const run of runs) {
    const digits = (run.match(/\d/g) ?? []).length;
    if (digits >= 8 && digits <= 15) return true;
  }

  // Telefono deletreado con palabras
  const words = toWordText(text).split(/[^a-z]+/).filter(Boolean);
  let streak = 0;
  for (const word of words) {
    if (DIGIT_WORDS.includes(word)) {
      streak++;
      if (streak >= 7) return true;
    } else {
      streak = 0;
    }
  }

  return false;
}

// ---------------------------------------------------------------------------
// CORREOS Y ENLACES
// ---------------------------------------------------------------------------

function hasEmail(text: string): boolean {
  if (/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i.test(text)) return true;
  // "nombre arroba gmail punto com"
  const squashed = toSquashedText(text);
  return /arroba(gmail|hotmail|outlook|yahoo|proton|icloud)/.test(squashed);
}

/** TLDs frecuentes en enlaces de contacto. */
const TLD =
  '(?:com|net|org|me|app|io|xyz|link|bio|tv|cc|co|es|mx|ar|cl|pe|info|site|online|live|fans|page|gg)';

function hasLink(text: string): boolean {
  const lower = text.toLowerCase();
  if (/https?:\/\//.test(lower)) return true;
  if (/\bwww\s*\.\s*[a-z0-9-]+/.test(lower)) return true;
  // dominio.tld suelto, con o sin espacios alrededor del punto
  const domain = new RegExp(`\\b[a-z0-9][a-z0-9-]{1,}\\s*\\.\\s*${TLD}\\b`);
  if (domain.test(lower)) return true;
  // "punto com" escrito con palabras
  return /\bpunto\s*(com|net|org|me|es)\b/.test(lower);
}

// ---------------------------------------------------------------------------
// REDES SOCIALES Y MENSAJERIA
// ---------------------------------------------------------------------------

/**
 * Terminos largos y distintivos. Se buscan sobre el texto "aplastado" (sin
 * separadores), asi que tambien caen "i n s t a g r a m" y "1n5t4gr4m".
 */
const PLATFORM_TERMS = [
  'instagram',
  'telegram',
  'whatsapp',
  'watsapp',
  'wasapp',
  'snapchat',
  'onlyfans',
  'discord',
  'facebook',
  'messenger',
  'tiktok',
  'twitter',
  'reddit',
  'skype',
  'viber',
  'signal',
  'threema',
  'wechat',
  'line',
  'kakao',
  'fansly',
  'manyvids',
  'chaturbate',
  'gmail',
  'hotmail',
  'outlook',
  'protonmail',
  'yahoo',
  'icloud',
];

/**
 * Abreviaturas cortas y ambiguas. Estas SI se buscan con limites de palabra
 * sobre el texto normal: buscarlas en el texto aplastado marcaria "amigo"
 * como Instagram por contener "ig".
 */
const SHORT_TERMS = [
  'ig',
  'insta',
  'tg',
  'telegrama',
  'wsp',
  'wpp',
  'wasap',
  'guasap',
  'snap',
  'fb',
  'onlyf',
  'kik',
];

function hasPlatform(text: string): boolean {
  const squashed = toSquashedText(text);
  if (PLATFORM_TERMS.some((term) => squashed.includes(term))) return true;

  const words = toWordText(text);
  return SHORT_TERMS.some((term) =>
    new RegExp(`\\b${term}\\b`).test(words),
  );
}

/** @usuario de otra plataforma (se permite en cambio "@" dentro de un correo). */
function hasHandle(text: string): boolean {
  return /(^|[\s(:,.-])@[a-z0-9._]{3,}/i.test(text);
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

/** Analiza un texto y devuelve que tipos de contacto contiene. */
export function detectContactInfo(text: string): FilterResult {
  if (!text || text.trim().length === 0) {
    return { blocked: false, reasons: [] };
  }

  const reasons: ContactKind[] = [];
  if (hasPhone(text)) reasons.push('telefono');
  if (hasEmail(text)) reasons.push('email');
  if (hasLink(text)) reasons.push('enlace');
  if (hasPlatform(text)) reasons.push('red-social');
  if (hasHandle(text)) reasons.push('usuario');

  return { blocked: reasons.length > 0, reasons };
}

/** Mensaje de error para la persona, explicando que se ha detectado. */
export function contactBlockMessage(reasons: ContactKind[]): string {
  const list = reasons.map((r) => KIND_LABELS[r]);
  const detail =
    list.length === 0
      ? 'datos de contacto'
      : list.length === 1
        ? list[0]!
        : `${list.slice(0, -1).join(', ')} y ${list[list.length - 1]}`;

  return `Por seguridad no se pueden compartir ${detail}. Todo el contacto tiene que ocurrir dentro de ${'FantasyLive'}: si sales de la plataforma pierdes la proteccion de pagos y de moderacion.`;
}

/**
 * Atajo para las server actions: devuelve null si el texto es aceptable, o el
 * mensaje de error si hay que rechazarlo.
 */
export function checkNoContactInfo(text: string): string | null {
  const result = detectContactInfo(text);
  return result.blocked ? contactBlockMessage(result.reasons) : null;
}
