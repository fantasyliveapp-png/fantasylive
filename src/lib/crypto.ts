import 'server-only';

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';

/**
 * Cifrado simetrico para datos de cobro (IBAN, wallet TRC20, email de PayPal).
 *
 * AES-256-GCM: confidencialidad + autenticacion. El formato serializado es
 *   v1.<iv base64url>.<tag base64url>.<ciphertext base64url>
 * de modo que se puede rotar a v2 sin romper lo ya guardado.
 *
 * La clave sale de PAYOUT_ENCRYPTION_KEY (32 bytes en base64 o hex). En
 * produccion es OBLIGATORIA: sin ella las funciones lanzan en vez de guardar
 * datos bancarios en claro. Generala con:
 *   openssl rand -base64 32
 */

const VERSION = 'v1';
const IV_BYTES = 12; // recomendado para GCM
const KEY_BYTES = 32;

let cachedKey: Buffer | null = null;

function decodeKey(raw: string): Buffer | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return Buffer.from(trimmed, 'hex');
  }

  try {
    const buf = Buffer.from(trimmed, 'base64');
    return buf.length === KEY_BYTES ? buf : null;
  } catch {
    return null;
  }
}

function getKey(): Buffer {
  if (cachedKey) return cachedKey;

  const configured = process.env.PAYOUT_ENCRYPTION_KEY;
  if (configured) {
    const key = decodeKey(configured);
    if (!key) {
      throw new Error(
        'PAYOUT_ENCRYPTION_KEY invalida: se esperan 32 bytes en base64 o hex (openssl rand -base64 32).',
      );
    }
    cachedKey = key;
    return key;
  }

  // Sin clave dedicada solo se admite fuera de produccion, derivando de
  // AUTH_SECRET para que el entorno local funcione sin configurar nada mas.
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'PAYOUT_ENCRYPTION_KEY no configurada: los datos de cobro no pueden guardarse de forma segura.',
    );
  }

  const fallbackSource = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET;
  if (!fallbackSource) {
    throw new Error('Falta AUTH_SECRET para derivar la clave de cifrado local.');
  }

  cachedKey = scryptSync(fallbackSource, 'fantasylive:payout:v1', KEY_BYTES);
  return cachedKey;
}

/** True si el cifrado esta listo (clave presente y valida). */
export function isPayoutEncryptionReady(): boolean {
  try {
    getKey();
    return true;
  } catch {
    return false;
  }
}

/** Cifra un texto. El resultado es seguro para guardar en la base de datos. */
export function encryptSecret(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);

  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return [
    VERSION,
    iv.toString('base64url'),
    tag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.');
}

/**
 * Descifra un valor producido por encryptSecret.
 * Devuelve null si el formato no cuadra o si el tag de autenticacion falla
 * (dato manipulado o clave distinta), nunca lanza.
 */
export function decryptSecret(payload: string): string | null {
  try {
    const parts = payload.split('.');
    if (parts.length !== 4 || parts[0] !== VERSION) return null;

    const [, ivPart, tagPart, dataPart] = parts;
    const iv = Buffer.from(ivPart!, 'base64url');
    const tag = Buffer.from(tagPart!, 'base64url');
    const data = Buffer.from(dataPart!, 'base64url');
    if (iv.length !== IV_BYTES || tag.length !== 16) return null;

    const decipher = createDecipheriv('aes-256-gcm', getKey(), iv);
    decipher.setAuthTag(tag);

    return Buffer.concat([decipher.update(data), decipher.final()]).toString(
      'utf8',
    );
  } catch {
    return null;
  }
}

/** True si el valor tiene la forma de un secreto cifrado por este modulo. */
export function isEncrypted(value: string): boolean {
  return value.startsWith(`${VERSION}.`) && value.split('.').length === 4;
}

/**
 * Version mostrable de un dato de cobro: conserva lo justo para que la modelo
 * reconozca su cuenta sin exponer el numero completo.
 *   ES9121000418450200051332 -> ES91**************1332
 *   correo@dominio.com       -> co****@dominio.com
 */
export function maskDestination(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';

  const atIndex = trimmed.indexOf('@');
  if (atIndex > 0) {
    const local = trimmed.slice(0, atIndex);
    const domain = trimmed.slice(atIndex);
    const head = local.slice(0, Math.min(2, local.length));
    return `${head}${'*'.repeat(Math.max(2, local.length - head.length))}${domain}`;
  }

  if (trimmed.length <= 8) {
    return `${'*'.repeat(Math.max(0, trimmed.length - 2))}${trimmed.slice(-2)}`;
  }

  return `${trimmed.slice(0, 4)}${'*'.repeat(trimmed.length - 8)}${trimmed.slice(-4)}`;
}

/** Comparacion en tiempo constante para tokens/secretos cortos. */
export function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
