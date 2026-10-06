'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { getAuthedUserOrThrow } from '@/lib/auth/guards';
import { checkNoContactInfo } from '@/lib/content-filter';
import { changeHandle, isHandleFree } from '@/lib/creator-profile';
import { prisma } from '@/lib/prisma';
import { isReservedUsername, USERNAME_PATTERN } from '@/lib/usernames';
import {
  buildUserAvatarKey,
  checkUpload,
  createUploadUrl,
  isProfileImageKey,
  profileImageUrl,
} from '@/lib/storage';

/**
 * RED SOCIAL: perfil de cuenta (fans) y seguir a personas.
 *
 * Las creadoras tienen su perfil en /models/<slug> y se siguen con `Follow`;
 * aqui va lo de todas las demas cuentas (/u/<usuario>).
 */

export interface SocialActionResult<T = unknown> {
  ok: boolean;
  error?: string;
  message?: string;
  data?: T;
}

const PUBLIC_MEDIA_PREFIX = '/api/public-media/';

/** Una URL absoluta o la ruta de una foto de perfil subida (nunca otra clave). */
function isAcceptableImage(url: string) {
  if (url === '') return true;
  if (z.string().url().safeParse(url).success) return true;
  return url.startsWith(PUBLIC_MEDIA_PREFIX) && isProfileImageKey(url.slice(PUBLIC_MEDIA_PREFIX.length));
}

const profileSchema = z.object({
  name: z.string().trim().min(2, 'El nombre necesita al menos 2 letras.').max(60),
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(
      USERNAME_PATTERN,
      'El usuario solo puede tener letras, numeros, puntos, guiones y guion bajo (3 a 30).',
    ),
  bio: z.string().trim().max(300).optional(),
  image: z.string().refine(isAcceptableImage, 'Imagen no valida.').optional(),
  isProfilePublic: z.boolean(),
});

/** URL firmada para subir la foto de perfil (ya recortada en el navegador). */
export async function requestUserAvatarUploadUrlAction(input: { sizeBytes: number }): Promise<
  SocialActionResult<{ uploadUrl: string; publicUrl: string }>
> {
  try {
    const user = await getAuthedUserOrThrow();
    const invalid = checkUpload('image/jpeg', input?.sizeBytes, ['image']);
    if (invalid) return { ok: false, error: invalid };
    const key = buildUserAvatarKey(user.id);
    const uploadUrl = await createUploadUrl({ key, contentType: 'image/jpeg', sizeBytes: input.sizeBytes });
    if (!uploadUrl) return { ok: false, error: 'El almacenamiento no esta configurado.' };
    return { ok: true, data: { uploadUrl, publicUrl: profileImageUrl(key) } };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

export async function updateUserProfileAction(input: {
  name: string;
  username: string;
  bio?: string;
  image?: string;
  isProfilePublic: boolean;
}): Promise<SocialActionResult<{ username: string }>> {
  try {
    const user = await getAuthedUserOrThrow();
    const parsed = profileSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? 'Datos no validos.' };
    }
    const data = parsed.data;

    // La bio es publica: nada de telefonos ni redes para saltarse la app.
    const contactError = checkNoContactInfo([data.name, data.bio].filter(Boolean).join(' \n '));
    if (contactError) return { ok: false, error: contactError };

    if (isReservedUsername(data.username) || !(await isHandleFree(data.username, user.id))) {
      return { ok: false, error: 'Ese nombre de usuario ya esta en uso.' };
    }
    // Un solo @: si es creadora, su direccion de creadora cambia con el.
    await changeHandle(user.id, data.username);

    await prisma.user.update({
      where: { id: user.id },
      data: {
        name: data.name,
        bio: data.bio || null,
        isProfilePublic: data.isProfilePublic,
        ...(data.image !== undefined ? { image: data.image || null } : {}),
      },
    });

    revalidatePath(`/u/${data.username}`);
    return { ok: true, message: 'Perfil guardado.', data: { username: data.username } };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

/**
 * Seguir a personas ya no existe: solo se sigue a creadores (ver
 * toggleFollowAction). Se deja para que ninguna pantalla antigua pueda crear
 * seguimientos entre fans.
 */
export async function toggleUserFollowAction(
  _targetUserId: string,
): Promise<SocialActionResult<{ following: boolean; followers: number }>> {
  return { ok: false, error: 'Solo se puede seguir a creadores.' };
}

function toMessage(error: unknown): string {
  if (error instanceof Error) {
    if (error.message === 'UNAUTHORIZED') return 'Debes iniciar sesion.';
    if (error.message === 'ACCOUNT_BANNED') return 'Tu cuenta esta suspendida.';
    return error.message;
  }
  return 'Error inesperado.';
}
