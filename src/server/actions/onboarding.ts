'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import type { Gender, Orientation } from '@prisma/client';

import { getAuthedUserOrThrow } from '@/lib/auth/guards';
import { prisma } from '@/lib/prisma';
import { slugify } from '@/lib/utils';

const schema = z.object({
  stageName: z.string().min(2).max(40),
  gender: z.string(),
  orientation: z.string(),
  country: z.string().max(60).optional(),
  headline: z.string().max(120).optional(),
  bio: z.string().max(1200).optional(),
});

/** Crea el perfil de modelo y promueve la cuenta a rol MODEL. */
export async function createModelProfileAction(input: {
  stageName: string;
  gender: Gender;
  orientation: Orientation;
  country?: string;
  headline?: string;
  bio?: string;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const user = await getAuthedUserOrThrow();
    const parsed = schema.safeParse(input);
    if (!parsed.success) return { ok: false, error: 'Datos invalidos.' };

    const existing = await prisma.modelProfile.findUnique({
      where: { userId: user.id },
      select: { id: true },
    });
    if (existing) return { ok: false, error: 'Ya tienes un perfil de modelo.' };

    let slug = slugify(parsed.data.stageName);
    if (!slug) slug = `model-${Date.now().toString(36)}`;
    if (await prisma.modelProfile.findUnique({ where: { slug } })) {
      slug = `${slug}-${Math.random().toString(36).slice(2, 6)}`;
    }

    await prisma.$transaction([
      prisma.modelProfile.create({
        data: {
          userId: user.id,
          stageName: parsed.data.stageName,
          slug,
          gender: parsed.data.gender as Gender,
          orientation: parsed.data.orientation as Orientation,
          country: parsed.data.country || null,
          headline: parsed.data.headline || null,
          bio: parsed.data.bio || null,
          kycStatus: 'NOT_SUBMITTED',
          acceptsBookings: false,
          isVipEnabled: false,
        },
      }),
      prisma.user.update({
        where: { id: user.id },
        data: { role: 'MODEL' },
      }),
      prisma.auditLog.create({
        data: {
          actorId: user.id,
          action: 'MODEL_PROFILE_CREATED',
          entityType: 'ModelProfile',
        },
      }),
    ]);

    revalidatePath('/dashboard/model');
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Error inesperado.',
    };
  }
}
