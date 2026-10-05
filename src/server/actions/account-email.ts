'use server';

import bcrypt from 'bcryptjs';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { sendEmailChangeMails, sendEmailOtp, sendPasswordChanged } from '@/lib/account-mail';
import { getAuthedUserOrThrow } from '@/lib/auth/guards';
import { checkEmailOtp, consumeAuthToken, createAuthToken, revokeAuthTokens, TOKEN_TTL_MS } from '@/lib/auth-tokens';
import { appLink, emailEnabled, formatEmailDate, sendTemplate } from '@/lib/email';
import { prisma } from '@/lib/prisma';
import { getRequestInfo } from '@/lib/request-info';

/**
 * CUENTA POR CORREO: recuperar contraseña (enlace), confirmar el email
 * (codigo OTP de 6 cifras) y cambiar el email (enlace al correo nuevo).
 */

export type EmailFormState = { error?: string; success?: string; fieldErrors?: Record<string, string[]> };

const emailSchema = z.object({ email: z.string().trim().toLowerCase().email('Pon un email válido.') });

// ---------------------------------------------------------------------------
// Recuperar contraseña
// ---------------------------------------------------------------------------

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
    select: { id: true, status: true, passwordHash: true, username: true, name: true },
  });
  if (!user || user.status === 'BANNED' || !user.passwordHash) return done;

  const token = await createAuthToken(user.id, 'PASSWORD_RESET');
  if (token) {
    const info = await getRequestInfo();
    await sendTemplate('02-restablecer-contrasena', parsed.data.email, 'Restablece tu contraseña', {
      userName: user.username ?? user.name ?? 'hola',
      actionUrl: appLink(`/restablecer?token=${token}`),
      expiresInMinutes: Math.round(TOKEN_TTL_MS.PASSWORD_RESET / 60_000),
      requestDevice: info.device,
      requestLocation: info.location,
      requestDate: formatEmailDate(new Date(), true),
    });
  }
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
    select: { email: true, username: true, name: true },
  });
  await revokeAuthTokens(userId, 'PASSWORD_RESET');
  await prisma.auditLog.create({
    data: { actorId: userId, action: 'PASSWORD_RESET', entityType: 'User', entityId: userId },
  });
  await sendPasswordChanged(user);
  return { success: 'Contraseña cambiada. Ya puedes iniciar sesión con la nueva.' };
}

// ---------------------------------------------------------------------------
// Confirmar email con codigo OTP
// ---------------------------------------------------------------------------

/** Envia (o reenvia) un codigo de 6 cifras a quien esta conectado. */
export async function resendVerificationAction(): Promise<EmailFormState> {
  try {
    const me = await getAuthedUserOrThrow();
    if (!emailEnabled()) return { error: 'El envío de correos aún no está activo.' };
    const user = await prisma.user.findUnique({ where: { id: me.id }, select: { email: true, emailVerified: true } });
    if (!user) return { error: 'Cuenta no encontrada.' };
    if (user.emailVerified) return { success: 'Tu email ya está confirmado.' };
    const r = await sendEmailOtp(me.id, false);
    if (r === 'limit') return { error: 'Ya te enviamos varios códigos. Espera un rato y revisa tu correo (y el spam).' };
    if (r === 'failed') return { error: 'No se pudo enviar el correo. Inténtalo en unos minutos.' };
    return { success: `Te enviamos un código nuevo a ${user.email}.` };
  } catch {
    return { error: 'Inicia sesión para continuar.' };
  }
}

const codeSchema = z.object({ code: z.string().trim().regex(/^\d{6}$/, 'El código tiene 6 números.') });

export async function verifyEmailCodeAction(_prev: EmailFormState, formData: FormData): Promise<EmailFormState> {
  try {
    const me = await getAuthedUserOrThrow();
    const parsed = codeSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors };
    const r = await checkEmailOtp(me.id, parsed.data.code);
    if (r === 'wrong') return { error: 'Código incorrecto. Revisa el último correo que te enviamos.' };
    if (r === 'expired') return { error: 'Este código ya no vale (caducó o se falló varias veces). Pide uno nuevo.' };
    await prisma.user.update({ where: { id: me.id }, data: { emailVerified: new Date() } });
    revalidatePath('/', 'layout');
    return { success: '¡Email confirmado! Ya puedes comprar tokens, hacerte creadora y retirar tus ganancias.' };
  } catch {
    return { error: 'Inicia sesión para continuar.' };
  }
}

// ---------------------------------------------------------------------------
// Cambiar el email
// ---------------------------------------------------------------------------

const changeSchema = z.object({
  newEmail: z.string().trim().toLowerCase().email('Pon un email válido.'),
  password: z.string().min(1, 'Escribe tu contraseña actual.'),
});

/** Pide el cambio: enlace al correo nuevo y aviso al antiguo. No cambia nada aun. */
export async function requestEmailChangeAction(_prev: EmailFormState, formData: FormData): Promise<EmailFormState> {
  try {
    const me = await getAuthedUserOrThrow();
    const parsed = changeSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors };
    if (!emailEnabled()) return { error: 'El envío de correos aún no está activo.' };

    const user = await prisma.user.findUnique({
      where: { id: me.id },
      select: { email: true, username: true, name: true, passwordHash: true },
    });
    if (!user?.passwordHash || !(await bcrypt.compare(parsed.data.password, user.passwordHash))) {
      return { fieldErrors: { password: ['La contraseña no es correcta.'] } };
    }
    const newEmail = parsed.data.newEmail;
    if (newEmail === user.email) return { fieldErrors: { newEmail: ['Ese ya es tu email.'] } };
    if (await prisma.user.findUnique({ where: { email: newEmail }, select: { id: true } })) {
      return { fieldErrors: { newEmail: ['Ese email ya lo usa otra cuenta.'] } };
    }

    await revokeAuthTokens(me.id, 'EMAIL_CHANGE');
    const token = await createAuthToken(me.id, 'EMAIL_CHANGE', newEmail);
    if (!token) return { error: 'Has pedido varios cambios seguidos. Espera un rato.' };
    const sent = await sendEmailChangeMails(user, newEmail, token);
    if (!sent) return { error: 'No se pudo enviar el correo de confirmación. Inténtalo en unos minutos.' };
    return {
      success: `Te enviamos un enlace a ${newEmail}. El cambio se hace cuando lo abras (caduca en 24 horas).`,
    };
  } catch {
    return { error: 'Inicia sesión para continuar.' };
  }
}
