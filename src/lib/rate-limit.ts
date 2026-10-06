import 'server-only';

import { headers } from 'next/headers';

import { getClientIp } from '@/lib/geo';

/**
 * LIMITE DE INTENTOS (login, registro, recuperar contraseña).
 *
 * En memoria del proceso: la app corre en un solo proceso, asi que basta. Un
 * reinicio (despliegue) vacia los contadores, lo que solo da algun intento de
 * mas a quien ya estaba bloqueado.
 */

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();
let lastSweep = 0;

function sweep(now: number) {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [key, b] of buckets) if (b.resetAt <= now) buckets.delete(key);
}

function live(key: string, now: number) {
  const b = buckets.get(key);
  return b && b.resetAt > now ? b : null;
}

/** Cuenta un intento. false si ya se paso del limite (y no lo cuenta). */
export function hit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  sweep(now);
  const b = live(key, now);
  if (!b) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (b.count >= limit) return false;
  b.count++;
  return true;
}

/** true si la clave ya esta en el limite (sin contar un intento nuevo). */
export function isBlocked(key: string, limit: number): boolean {
  const b = live(key, Date.now());
  return Boolean(b && b.count >= limit);
}

export function reset(key: string) {
  buckets.delete(key);
}

/** Minutos que faltan para poder volver a intentarlo (minimo 1). */
export function minutesLeft(key: string): number {
  const b = live(key, Date.now());
  return b ? Math.max(1, Math.ceil((b.resetAt - Date.now()) / 60_000)) : 1;
}

// ---------------------------------------------------------------------------
// Inicio de sesion
// ---------------------------------------------------------------------------

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
/** Fallos de una IP contra una misma cuenta. */
const LOGIN_PER_IP_ACCOUNT = 5;
/** Fallos de una IP en total (alguien probando muchas cuentas). */
const LOGIN_PER_IP = 30;
/**
 * Fallos contra una cuenta desde todas partes. Mas alto que el de IP: si no,
 * cualquiera podria dejar sin entrar a otra persona fallando a proposito.
 */
const LOGIN_PER_ACCOUNT = 50;

const loginKeys = (email: string, ip: string | null) => {
  const who = ip ?? 'sin-ip';
  return {
    ipAccount: `login:ip-acc:${who}:${email}`,
    ip: `login:ip:${who}`,
    account: `login:acc:${email}`,
  };
};

/** true si esta IP (o esta cuenta) ya fallo demasiadas veces. */
export function loginBlocked(email: string, ip: string | null): boolean {
  const k = loginKeys(email, ip);
  return (
    isBlocked(k.ipAccount, LOGIN_PER_IP_ACCOUNT) ||
    isBlocked(k.ip, LOGIN_PER_IP) ||
    isBlocked(k.account, LOGIN_PER_ACCOUNT)
  );
}

export function loginFailed(email: string, ip: string | null) {
  const k = loginKeys(email, ip);
  hit(k.ipAccount, LOGIN_PER_IP_ACCOUNT, LOGIN_WINDOW_MS);
  hit(k.ip, LOGIN_PER_IP, LOGIN_WINDOW_MS);
  hit(k.account, LOGIN_PER_ACCOUNT, LOGIN_WINDOW_MS);
}

export function loginSucceeded(email: string, ip: string | null) {
  reset(loginKeys(email, ip).ipAccount);
}

// ---------------------------------------------------------------------------
// Por IP (registro, recuperar contraseña)
// ---------------------------------------------------------------------------

export async function currentIp(): Promise<string | null> {
  try {
    return getClientIp(await headers());
  } catch {
    return null;
  }
}

/** Cuenta un intento de esta IP para `action`. Mensaje de error si se paso. */
export async function limitByIp(action: string, limit: number, windowMs: number): Promise<string | null> {
  const key = `${action}:ip:${(await currentIp()) ?? 'sin-ip'}`;
  if (hit(key, limit, windowMs)) return null;
  return `Demasiados intentos desde tu conexión. Espera ${minutesLeft(key)} min y vuelve a probar.`;
}
