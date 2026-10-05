'use server';

import { AuthError } from 'next-auth';
import bcrypt from 'bcryptjs';
import { cookies } from 'next/headers';
import { z } from 'zod';

import { signIn, signOut } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { REF_COOKIE } from '@/lib/referrals';
import { config } from '@/lib/config';
import { isHandleFree } from '@/lib/creator-profile';
import { isReservedUsername, USERNAME_PATTERN } from '@/lib/usernames';
import { calculateAge } from '@/lib/utils';
import { sendEmailOtp } from '@/lib/account-mail';

export interface ActionState {
  error?: string;
  success?: string;
  fieldErrors?: Record<string, string[]>;
}

const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, 'Minimo 3 caracteres')
  .max(30, 'Maximo 30 caracteres')
  .regex(USERNAME_PATTERN, 'Solo letras, numeros, punto, guion y guion bajo')
  .refine((u) => !isReservedUsername(u), 'Ese nombre no esta disponible');

/**
 * Registro ANONIMO: solo se pide un @usuario (un alias, no el nombre real),
 * un email privado que nadie ve y la fecha de nacimiento, que tampoco se
 * muestra y solo sirve para comprobar que es mayor de edad.
 */
const registerSchema = z.object({
  username: usernameSchema,
  email: z.string().email('Email invalido'),
  password: z
    .string()
    .min(8, 'Minimo 8 caracteres')
    .regex(/[A-Za-z]/, 'Debe contener letras')
    .regex(/[0-9]/, 'Debe contener numeros'),
  birthDate: z.string().min(1, 'Pon tu fecha de nacimiento'),
  role: z.enum(['USER', 'MODEL']).default('USER'),
  isAdult: z.literal('on', {
    errorMap: () => ({
      message: 'Tienes que confirmar que eres mayor de edad',
    }),
  }),
  acceptTerms: z.literal('on', {
    errorMap: () => ({ message: 'Debes aceptar los terminos' }),
  }),
});

/** Para el formulario: si un @usuario esta libre mientras se escribe. */
export async function checkUsernameAction(
  raw: string,
): Promise<{ available: boolean; error?: string }> {
  const parsed = usernameSchema.safeParse(raw);
  if (!parsed.success) {
    return { available: false, error: parsed.error.issues[0]?.message };
  }
  return (await isHandleFree(parsed.data))
    ? { available: true }
    : { available: false, error: 'Ya esta cogido' };
}

export async function registerAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = registerSchema.safeParse(Object.fromEntries(formData));

  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors as any };
  }

  const data = parsed.data;
  const birthDate = new Date(data.birthDate);

  if (Number.isNaN(birthDate.getTime())) {
    return { fieldErrors: { birthDate: ['Fecha invalida'] } };
  }

  const age = calculateAge(birthDate);
  if (age < config.app.minAge) {
    return {
      fieldErrors: {
        birthDate: [
          `Tienes que tener ${config.app.minAge} años o mas para entrar.`,
        ],
      },
    };
  }
  if (age > 110) {
    return { fieldErrors: { birthDate: ['Revisa el año de nacimiento'] } };
  }

  const email = data.email.toLowerCase().trim();
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return { error: 'Ya existe una cuenta con este email.' };
  }

  const passwordHash = await bcrypt.hash(data.password, 10);
  const bonus = config.economy.signupBonusTokens;

  // Referidos: quien le trajo (cookie de /r/<slug> o /reclutar/<code>).
  // "r:<id>" = reclutador; si no, el id de la creadora que invito.
  const refValue = (await cookies()).get(REF_COOKIE)?.value ?? '';
  const recruiter = refValue.startsWith('r:')
    ? await prisma.recruiter.findFirst({
        where: { id: refValue.slice(2), active: true },
        select: { id: true },
      })
    : null;
  const referrer =
    refValue && !refValue.startsWith('r:')
      ? await prisma.user.findFirst({
          where: {
            id: refValue,
            status: 'ACTIVE',
            modelProfile: { kycStatus: 'APPROVED' },
          },
          select: { id: true },
        })
      : null;

  const username = data.username;
  if (!(await isHandleFree(username))) {
    return { fieldErrors: { username: ['Ese @usuario ya esta cogido'] } };
  }

  let user;
  try {
    user = await prisma.user.create({
      data: {
        email,
        // Anonimo: el nombre visible es el propio alias hasta que lo cambie.
        name: username,
        username,
        passwordHash,
        birthDate,
        ageVerified: false, // se confirma con KYC / verificacion documental
        // Una sola cuenta para todos: el modo creadora se activa despues en
        // /hazte-creador (un solo paso; el campo "role" del formulario solo
        // indica la intencion, para llevarla alli tras registrarse).
        role: 'USER',
        status: 'ACTIVE',
        referredById: referrer?.id ?? null,
        recruitedById: recruiter?.id ?? null,
        wallet: { create: { balance: bonus } },
      },
    });
  } catch (error) {
    // Dos personas pidiendo el mismo alias a la vez: gana la primera.
    if ((error as { code?: string }).code === 'P2002') {
      return { fieldErrors: { username: ['Ese @usuario ya esta cogido'] } };
    }
    throw error;
  }

  // Bienvenida con el codigo OTP para confirmar el email (si falla, se reenvia).
  try {
    await sendEmailOtp(user.id, true);
  } catch (error) {
    console.error('[register] no se pudo enviar el codigo de bienvenida', error);
  }

  if (bonus > 0) {
    await prisma.transaction.create({
      data: {
        userId: user.id,
        type: 'SIGNUP_BONUS',
        tokens: bonus,
        balanceAfter: bonus,
        description: 'Bono de bienvenida',
      },
    });
  }

  try {
    await signIn('credentials', {
      email,
      password: data.password,
      redirect: false,
    });
  } catch {
    return {
      success: 'Cuenta creada correctamente. Inicia sesion para continuar.',
    };
  }

  return { success: 'Cuenta creada correctamente.' };
}

const loginSchema = z.object({
  email: z.string().email('Email invalido'),
  password: z.string().min(1, 'Introduce tu contraseña'),
  callbackUrl: z.string().optional(),
});

export async function loginAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = loginSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors as any };
  }

  try {
    await signIn('credentials', {
      email: parsed.data.email.toLowerCase().trim(),
      password: parsed.data.password,
      redirect: false,
    });
    return { success: 'Sesion iniciada' };
  } catch (error) {
    if (error instanceof AuthError) {
      if (error.type === 'CredentialsSignin') {
        return { error: 'Email o contraseña incorrectos.' };
      }
      return {
        error: error.cause?.err?.message ?? 'No se pudo iniciar sesion.',
      };
    }
    throw error;
  }
}

export async function logoutAction() {
  await signOut({ redirectTo: '/' });
}
