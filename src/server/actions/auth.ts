'use server';

import { AuthError } from 'next-auth';
import bcrypt from 'bcryptjs';
import { z } from 'zod';

import { signIn, signOut } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { config } from '@/lib/config';
import { calculateAge, slugify } from '@/lib/utils';

export interface ActionState {
  error?: string;
  success?: string;
  fieldErrors?: Record<string, string[]>;
}

const registerSchema = z
  .object({
    email: z.string().email('Email invalido'),
    password: z
      .string()
      .min(8, 'Minimo 8 caracteres')
      .regex(/[A-Za-z]/, 'Debe contener letras')
      .regex(/[0-9]/, 'Debe contener numeros'),
    confirmPassword: z.string(),
    name: z.string().min(2, 'Nombre demasiado corto').max(60),
    birthDate: z.string().min(1, 'La fecha de nacimiento es obligatoria'),
    gender: z.string().optional(),
    country: z.string().optional(),
    role: z.enum(['USER', 'MODEL']).default('USER'),
    acceptTerms: z.literal('on', {
      errorMap: () => ({ message: 'Debes aceptar los terminos' }),
    }),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: 'Las contrasenas no coinciden',
    path: ['confirmPassword'],
  });

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
      error: `Debes tener al menos ${config.app.minAge} anos para registrarte.`,
    };
  }

  const email = data.email.toLowerCase().trim();
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return { error: 'Ya existe una cuenta con este email.' };
  }

  const passwordHash = await bcrypt.hash(data.password, 10);
  const bonus = config.economy.signupBonusTokens;

  // Username unico a partir del nombre
  let username = slugify(data.name) || `user${Date.now().toString(36)}`;
  if (await prisma.user.findUnique({ where: { username } })) {
    username = `${username}-${Math.random().toString(36).slice(2, 6)}`;
  }

  const user = await prisma.user.create({
    data: {
      email,
      name: data.name.trim(),
      username,
      passwordHash,
      birthDate,
      ageVerified: false, // se confirma con KYC / verificacion documental
      gender: (data.gender as any) || null,
      country: data.country || null,
      role: data.role,
      status: 'ACTIVE',
      wallet: { create: { balance: bonus } },
    },
  });

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

  // Alta como modelo: crea perfil borrador pendiente de KYC
  if (data.role === 'MODEL') {
    let slug = slugify(data.name);
    if (await prisma.modelProfile.findUnique({ where: { slug } })) {
      slug = `${slug}-${Math.random().toString(36).slice(2, 6)}`;
    }
    await prisma.modelProfile.create({
      data: {
        userId: user.id,
        stageName: data.name.trim(),
        slug,
        gender: (data.gender as any) || 'FEMALE',
        orientation: 'STRAIGHT',
        country: data.country || null,
        kycStatus: 'NOT_SUBMITTED',
        acceptsBookings: false,
        isVipEnabled: false,
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
      success:
        'Cuenta creada correctamente. Inicia sesion para continuar.',
    };
  }

  return { success: 'Cuenta creada correctamente.' };
}

const loginSchema = z.object({
  email: z.string().email('Email invalido'),
  password: z.string().min(1, 'Introduce tu contrasena'),
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
        return { error: 'Email o contrasena incorrectos.' };
      }
      return { error: error.cause?.err?.message ?? 'No se pudo iniciar sesion.' };
    }
    throw error;
  }
}

export async function logoutAction() {
  await signOut({ redirectTo: '/' });
}
