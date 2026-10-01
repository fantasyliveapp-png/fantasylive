'use server';

import { revalidatePath } from 'next/cache';
import type { Prisma } from '@prisma/client';

import { getAuthedUserOrThrow } from '@/lib/auth/guards';
import { contentTitle } from '@/lib/creator-content';
import { LIVE_LIMITS, parseTipMenu, type TipMenuItem } from '@/lib/live-state';
import { prisma } from '@/lib/prisma';
import { deleteObject } from '@/lib/storage';

/** PACKS DE DIRECTO desde el panel "Contenido" de la creadora. */

export interface ContentActionResult {
  ok: boolean;
  error?: string;
  message?: string;
}

async function ownLivePack(postId: string) {
  const user = await getAuthedUserOrThrow();
  const post = await prisma.post.findFirst({
    where: { id: postId, model: { userId: user.id }, liveExclusiveAt: { not: null }, removedAt: null },
    select: {
      id: true,
      body: true,
      priceTokens: true,
      unlockCount: true,
      modelId: true,
      model: { select: { liveTipMenu: true } },
      assets: { select: { storageKey: true, previewKey: true } },
    },
  });
  if (!post) throw new Error('Ese pack ya no existe.');
  return post;
}

/** Pone o quita el pack del menu "Especiales" (al final de la lista). */
export async function setLivePackInMenuAction(postId: string, inMenu: boolean): Promise<ContentActionResult> {
  try {
    const post = await ownLivePack(postId);
    const menu = parseTipMenu(post.model.liveTipMenu);
    const without = menu.filter((i) => i.postId !== post.id);
    let next: TipMenuItem[] = without;
    if (inMenu) {
      if (without.length >= LIVE_LIMITS.tipMenuMax) {
        return { ok: false, error: `Tu menu ya tiene ${LIVE_LIMITS.tipMenuMax} cosas. Quita alguna primero.` };
      }
      next = [
        ...without,
        {
          id: `p-${post.id}`,
          label: contentTitle(post.body, 'Pack exclusivo').slice(0, 40),
          tokens: post.priceTokens,
          postId: post.id,
        },
      ];
    }
    await prisma.modelProfile.update({
      where: { id: post.modelId },
      data: { liveTipMenu: next as unknown as Prisma.InputJsonArray },
    });
    revalidatePath('/dashboard/model/contenido');
    return { ok: true, message: inMenu ? 'Añadido a tu menú de Especiales.' : 'Quitado del menú de Especiales.' };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

/**
 * Borra un pack de directo que nadie ha comprado. Si ya se vendio no se
 * borra (quien lo compro lo sigue teniendo): solo se quita del menu.
 */
export async function deleteLivePackAction(postId: string): Promise<ContentActionResult> {
  try {
    const post = await ownLivePack(postId);
    if (post.unlockCount > 0) {
      return { ok: false, error: 'Ya lo ha comprado alguien, así que no se puede borrar. Quítalo del menú.' };
    }
    const menu = parseTipMenu(post.model.liveTipMenu).filter((i) => i.postId !== post.id);
    await prisma.$transaction([
      prisma.modelProfile.update({
        where: { id: post.modelId },
        data: { liveTipMenu: menu as unknown as Prisma.InputJsonArray },
      }),
      prisma.post.delete({ where: { id: post.id } }),
    ]);
    await Promise.all(
      post.assets
        .flatMap((a) => [a.storageKey, a.previewKey])
        .filter((k): k is string => Boolean(k) && !/^https?:\/\//.test(k!))
        .map((k) => deleteObject(k).catch(() => undefined)),
    );
    revalidatePath('/dashboard/model/contenido');
    return { ok: true, message: 'Pack borrado.' };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

function toMessage(error: unknown): string {
  if (error instanceof Error) {
    if (error.message === 'UNAUTHORIZED') return 'Debes iniciar sesion.';
    return error.message;
  }
  return 'Error inesperado.';
}
