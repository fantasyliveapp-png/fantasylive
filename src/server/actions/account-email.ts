'use server';

import bcrypt from 'bcryptjs';
import { z } from 'zod';

import { getAuthedUserOrThrow } from '@/lib/auth/guards';
import { consumeAuthToken, createAuthToken, revokeAuthTokens } from '@/lib/auth-tokens';
import {
  appLink,
  emailEnabled,
  sendPasswordChangedEmail,
  sendPasswordResetEmail,
  sendVerifyEmail,
} from '@/lib/email';
import { prisma } from '@/lib/prisma';

/**
 * RECUPERAR CONTRASEÑA Y VERIFICAR EMAIL (enlaces de un solo uso por correo).
 */

export type EmailFormState = { error?: string; success?: string; fieldErrors?: Record<string, string[]> };

const emailSchema = z.object({ email: z.string().trim().toLowerCase().email('Pon un email válido.') });

/**
 * Paso 1: pide el enlace. Responde siempre lo mismo, exista o no la cuenta,
 * para no revelar que emails estan registrados.
 */
export async function requestPasswordResetAction(_prev: EmailFormState, formData: FormData): Promise<EmailFormState> {
  const parsed = emailSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors };
  const done: EmailFormState = {
    success: 'Si hay una cuenta con ese email, te hemos enviado un enlace. Revisa también la carpeta de spam.',
  };

  const user = await prisma.user.findUnique({
    where: { email: parsed.data.email },
    select: { id: true, status: true, passwordHash: true },
  });
  if (!user || user.status === 'BANNED' || !user.passwordHash) return done;

  const token = await createAuthToken(user.id, 'PASSWORD_RESET');
  if (token) await sendPasswordResetEmail(parsed.data.email, appLink(`/restablecer?token=${token}`));
  return done;
}

const passwordSchema = z
  .string()
  .min(8, 'Mínimo 8 caracteres')
  .regex(/[A-Za-z]/, 'Debe contener letras')
  .regex(/[0-9]/, 'Debe contener números');

const resetSchema = z
  .object({ token: z.string().min(10), password: passwordSchema, confirm: z.string() })
  .refine((d) => d.password === d.confirm, { path: ['confirm'], message: 'Las contraseñas no coinciden.' });

/** Paso 2: contraseña nueva con el enlace. Cierra las demas sesiones. */
export async function resetPasswordAction(_prev: EmailFormState, formData: FormData): Promise<EmailFormState> {
  const parsed = resetSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors };

  const userId = await consumeAuthToken(parsed.data.token, 'PASSWORD_RESET');
  if (!userId) return { error: 'El enlace no es válido o ha caducado. Pide uno nuevo.' };

  const user = await prisma.user.update({
    where: { id: userId },
    data: {
      passwordHash: await bcrypt.hash(parsed.data.password, 10),
      passwordChangedAt: new Date(),
      // Ha demostrado que el email es suyo.
      emailVerified: new Date(),
    },
    select: { email: true },
  });
  await revokeAuthTokens(userId, 'PASSWORD_RESET');
  await prisma.auditLog.create({
    data: { actorId: userId, action: 'PASSWORD_RESET', entityType: 'User', entityId: userId },
  });
  await sendPasswordChangedEmail(user.email);
  return { success: 'Contraseña cambiada. Ya puedes iniciar sesión con la nueva.' };
}

/** Envia (o reenvia) el enlace para confirmar el email de quien esta conectado. */
export async function resendVerificationAction(): Promise<EmailFormState> {
  try {
    const me = await getAuthedUserOrThrow();
    if (!emailEnabled()) return { error: 'El envío de correos aún no está activo.' };
    const user = await prisma.user.findUnique({
      where: { id: me.id },
      select: { email: true, name: true, username: true, emailVerified: true },
    });
    if (!user) return { error: 'Cuenta no encontrada.' };
    if (user.emailVerified) return { success: 'Tu email ya está confirmado.' };
    const token = await createAuthToken(me.id, 'EMAIL_VERIFY');
    if (!token) return { error: 'Ya te enviamos varios enlaces. Espera un rato y revisa tu correo (y el spam).' };
    const sent = await sendVerifyEmail(
      user.email,
      user.username ?? user.name ?? 'hola',
      appLink(`/verificar-email?token=${token}`),
      false,
    );
    return sent
      ? { success: `Te enviamos el enlace a ${user.email}. Revisa también el spam.` }
      : { error: 'No se pudo enviar el correo. Inténtalo en unos minutos.' };
  } catch {
    return { error: 'Inicia sesión para continuar.' };
  }
}
