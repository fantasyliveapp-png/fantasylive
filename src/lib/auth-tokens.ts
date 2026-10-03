import 'server-only';

import { createHash, randomBytes } from 'node:crypto';

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
  EMAIL_VERIFY: 48 * 60 * 60 * 1000, // 48 horas
};

/** Como mucho tantos correos de cada tipo por cuenta y hora (evita abusos). */
const MAX_PER_HOUR = 3;

const hash = (raw: string) => createHash('sha256').update(raw).digest('hex');

/** Crea un enlace nuevo; null si ya se pidieron demasiados en la ultima hora. */
export async function createAuthToken(userId: string, kind: AuthTokenKind): Promise<string | null> {
  const recent = await prisma.authToken.count({
    where: { userId, kind, createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) } },
  });
  if (recent >= MAX_PER_HOUR) return null;
  const raw = randomBytes(32).toString('base64url');
  await prisma.authToken.create({
    data: { userId, kind, tokenHash: hash(raw), expiresAt: new Date(Date.now() + TOKEN_TTL_MS[kind]) },
  });
  return raw;
}

/** Comprueba un enlace sin gastarlo (para enseñar el formulario). */
export async function peekAuthToken(raw: string, kind: AuthTokenKind) {
  if (!raw) return null;
  const t = await prisma.authToken.findUnique({ where: { tokenHash: hash(raw) } });
  if (!t || t.kind !== kind || t.usedAt || t.expiresAt < new Date()) return null;
  return t;
}

/** Gasta el enlace: devuelve el userId si era valido (solo la primera vez). */
export async function consumeAuthToken(raw: string, kind: AuthTokenKind): Promise<string | null> {
  if (!raw) return null;
  const tokenHash = hash(raw);
  const { count } = await prisma.authToken.updateMany({
    where: { tokenHash, kind, usedAt: null, expiresAt: { gt: new Date() } },
    data: { usedAt: new Date() },
  });
  if (count === 0) return null;
  const t = await prisma.authToken.findUnique({ where: { tokenHash }, select: { userId: true } });
  return t?.userId ?? null;
}

/** Al usar un enlace, los demas del mismo tipo de esa cuenta dejan de valer. */
export async function revokeAuthTokens(userId: string, kind: AuthTokenKind) {
  await prisma.authToken.updateMany({ where: { userId, kind, usedAt: null }, data: { usedAt: new Date() } });
}

// ---------------------------------------------------------------------------
// Email verificado: obligatorio para pagar, hacerse creadora y retirar
// ---------------------------------------------------------------------------

export const EMAIL_NOT_VERIFIED =
  'Confirma tu email para continuar. Te enviamos un enlace al registrarte; puedes pedir otro desde el aviso de arriba.';

/**
 * null si puede seguir; el mensaje de error si le falta verificar el email.
 * Mientras el correo no este configurado no se exige (nadie podria verificar).
 */
export async function emailVerificationBlock(userId: string): Promise<string | null> {
  if (!emailEnabled()) return null;
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { emailVerified: true } });
  return u?.emailVerified ? null : EMAIL_NOT_VERIFIED;
}
