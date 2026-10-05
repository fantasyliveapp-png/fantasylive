import 'server-only';

import { createHash, randomBytes, randomInt } from 'node:crypto';

import type { AuthTokenKind } from '@prisma/client';

import { emailEnabled } from '@/lib/email';
import { prisma } from '@/lib/prisma';

/**
 * ENLACES DE UN SOLO USO (recuperar contraseña, verificar email)
 *
 * El token va en el enlace del correo; en la base de datos solo se guarda su
 * hash, asi que quien lea la base no puede usarlos. Caducan y solo valen una vez.
 */

export const TOKEN_TTL_MS: Record<AuthTokenKind, number> = {
  PASSWORD_RESET: 60 * 60 * 1000, // 1 hora
  EMAIL_VERIFY: 15 * 60 * 1000, // codigo OTP: 15 minutos
  EMAIL_CHANGE: 24 * 60 * 60 * 1000, // 24 horas
};

/** Intentos para acertar un codigo OTP antes de que deje de valer. */
const MAX_OTP_ATTEMPTS = 5;

/** Como mucho tantos correos de cada tipo por cuenta y hora (evita abusos). */
const MAX_PER_HOUR = 3;

const hash = (raw: string) => createHash('sha256').update(raw).digest('hex');

/** Crea un enlace nuevo; null si ya se pidieron demasiados en la ultima hora. */
export async function createAuthToken(userId: string, kind: AuthTokenKind, payload?: string): Promise<string | null> {
  const recent = await prisma.authToken.count({
    where: { userId, kind, createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) } },
  });
  if (recent >= MAX_PER_HOUR) return null;
  const raw = randomBytes(32).toString('base64url');
  await prisma.authToken.create({
    data: { userId, kind, tokenHash: hash(raw), payload, expiresAt: new Date(Date.now() + TOKEN_TTL_MS[kind]) },
  });
  return raw;
}

// ---------------------------------------------------------------------------
// Codigo OTP de 6 cifras (confirmar email)
// ---------------------------------------------------------------------------

/** El hash lleva la cuenta: dos cuentas con el mismo codigo no chocan. */
const otpHash = (userId: string, code: string) => hash(`otp:${userId}:${code}`);

/**
 * Codigo nuevo para confirmar el email (anula los anteriores). null si ya se
 * pidieron demasiados en la ultima hora.
 */
export async function createEmailOtp(userId: string): Promise<string | null> {
  const recent = await prisma.authToken.count({
    where: { userId, kind: 'EMAIL_VERIFY', createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) } },
  });
  if (recent >= MAX_PER_HOUR + 2) return null;
  await revokeAuthTokens(userId, 'EMAIL_VERIFY');
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  await prisma.authToken.create({
    data: {
      userId,
      kind: 'EMAIL_VERIFY',
      // Unico por fila: el codigo + un sufijo aleatorio no reutilizable.
      tokenHash: `${otpHash(userId, code)}:${randomBytes(6).toString('hex')}`,
      expiresAt: new Date(Date.now() + TOKEN_TTL_MS.EMAIL_VERIFY),
    },
  });
  return code;
}

export type OtpResult = 'ok' | 'wrong' | 'expired';

/** Comprueba el codigo del ultimo envio. Cuenta los fallos. */
export async function checkEmailOtp(userId: string, code: string): Promise<OtpResult> {
  const t = await prisma.authToken.findFirst({
    where: { userId, kind: 'EMAIL_VERIFY', usedAt: null },
    orderBy: { createdAt: 'desc' },
  });
  if (!t || t.expiresAt < new Date() || t.attempts >= MAX_OTP_ATTEMPTS) return 'expired';
  const ok = t.tokenHash.startsWith(`${otpHash(userId, code.trim())}:`);
  if (!ok) {
    const updated = await prisma.authToken.update({ where: { id: t.id }, data: { attempts: { increment: 1 } } });
    return updated.attempts >= MAX_OTP_ATTEMPTS ? 'expired' : 'wrong';
  }
  const { count } = await prisma.authToken.updateMany({ where: { id: t.id, usedAt: null }, data: { usedAt: new Date() } });
  return count ? 'ok' : 'expired';
}

/** Comprueba un enlace sin gastarlo (para enseñar el formulario). */
export async function peekAuthToken(raw: string, kind: AuthTokenKind) {
  if (!raw) return null;
  const t = await prisma.authToken.findUnique({ where: { tokenHash: hash(raw) } });
  if (!t || t.kind !== kind || t.usedAt || t.expiresAt < new Date()) return null;
  return t;
}

/** Gasta el enlace: devuelve el userId (y su dato extra) si era valido (solo la primera vez). */
export async function consumeAuthTokenFull(raw: string, kind: AuthTokenKind) {
  if (!raw) return null;
  const tokenHash = hash(raw);
  const { count } = await prisma.authToken.updateMany({
    where: { tokenHash, kind, usedAt: null, expiresAt: { gt: new Date() } },
    data: { usedAt: new Date() },
  });
  if (count === 0) return null;
  return prisma.authToken.findUnique({ where: { tokenHash }, select: { userId: true, payload: true } });
}

export async function consumeAuthToken(raw: string, kind: AuthTokenKind): Promise<string | null> {
  return (await consumeAuthTokenFull(raw, kind))?.userId ?? null;
}

/** Al usar un enlace, los demas del mismo tipo de esa cuenta dejan de valer. */
export async function revokeAuthTokens(userId: string, kind: AuthTokenKind) {
  await prisma.authToken.updateMany({ where: { userId, kind, usedAt: null }, data: { usedAt: new Date() } });
}

// ---------------------------------------------------------------------------
// Email verificado: obligatorio para pagar, hacerse creadora y retirar
// ---------------------------------------------------------------------------

export const EMAIL_NOT_VERIFIED =
  'Confirma tu email para continuar: escribe el código que te enviamos (o pide otro) en el aviso de arriba.';

/**
 * null si puede seguir; el mensaje de error si le falta verificar el email.
 * Mientras el correo no este configurado no se exige (nadie podria verificar).
 */
export async function emailVerificationBlock(userId: string): Promise<string | null> {
  if (!emailEnabled()) return null;
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { emailVerified: true } });
  return u?.emailVerified ? null : EMAIL_NOT_VERIFIED;
}
