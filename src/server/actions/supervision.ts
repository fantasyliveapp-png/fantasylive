'use server';

import { revalidatePath } from 'next/cache';

import { getAuthedUserOrThrow } from '@/lib/auth/guards';
import { closeRoom } from '@/lib/livekit';
import { deleteRtmpIngress } from '@/lib/live';
import { createNotification } from '@/lib/notifications';
import { prisma } from '@/lib/prisma';

/**
 * SUPERVISION (solo admin): retirar publicaciones, borrar comentarios y
 * cortar directos que incumplen las normas. Todo queda en el registro de
 * actividad con quien lo hizo y por que.
 */

export interface SupervisionResult {
  ok: boolean;
  error?: string;
  message?: string;
}

async function requireAdminUser() {
  const user = await getAuthedUserOrThrow();
  if (user.role !== 'ADMIN') throw new Error('FORBIDDEN');
  return user;
}

function cleanReason(reason: string | undefined) {
  const r = (reason ?? '').trim().slice(0, 300);
  return r || 'Incumple las normas de la comunidad';
}

/** Retira una publicacion: deja de verse y la creadora no puede republicarla. */
export async function adminRemovePostAction(input: {
  postId: string;
  reason?: string;
}): Promise<SupervisionResult> {
  try {
    const admin = await requireAdminUser();
    const reason = cleanReason(input.reason);
    const post = await prisma.post.findUnique({
      where: { id: input.postId },
      select: {
        id: true,
        isPublished: true,
        removedAt: true,
        modelId: true,
        model: { select: { userId: true, slug: true } },
      },
    });
    if (!post) return { ok: false, error: 'Publicacion no encontrada.' };
    if (post.removedAt) return { ok: true, message: 'Ya estaba retirada.' };

    await prisma.$transaction(async (tx) => {
      await tx.post.update({
        where: { id: post.id },
        data: { isPublished: false, removedAt: new Date(), removedReason: reason },
      });
      if (post.isPublished) {
        await tx.modelProfile.update({
          where: { id: post.modelId },
          data: { postsCount: { decrement: 1 } },
        });
      }
      await tx.auditLog.create({
        data: {
          actorId: admin.id,
          action: 'POST_REMOVED',
          entityType: 'Post',
          entityId: post.id,
          metadata: { reason, creatorUserId: post.model.userId },
        },
      });
      await createNotification(tx, {
        userId: post.model.userId,
        type: 'MODERATION',
        title: 'Hemos retirado una de tus publicaciones',
        body: `Motivo: ${reason}. Si crees que es un error, escribe a soporte.`,
      });
    });

    revalidatePath('/admin/content');
    revalidatePath(`/admin/content/${post.id}`);
    revalidatePath(`/models/${post.model.slug}`);
    return { ok: true, message: 'Publicacion retirada. Se ha avisado a la creadora.' };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

/** Deshace una retirada (vuelve a estar publicada). */
export async function adminRestorePostAction(postId: string): Promise<SupervisionResult> {
  try {
    const admin = await requireAdminUser();
    const post = await prisma.post.findUnique({
      where: { id: postId },
      select: { id: true, removedAt: true, modelId: true },
    });
    if (!post?.removedAt) return { ok: false, error: 'Esta publicacion no esta retirada.' };

    await prisma.$transaction([
      prisma.post.update({
        where: { id: post.id },
        data: { isPublished: true, removedAt: null, removedReason: null },
      }),
      prisma.modelProfile.update({
        where: { id: post.modelId },
        data: { postsCount: { increment: 1 } },
      }),
      prisma.auditLog.create({
        data: { actorId: admin.id, action: 'POST_RESTORED', entityType: 'Post', entityId: post.id },
      }),
    ]);

    revalidatePath('/admin/content');
    revalidatePath(`/admin/content/${post.id}`);
    return { ok: true, message: 'Publicacion restaurada.' };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

export async function adminDeleteCommentAction(commentId: string): Promise<SupervisionResult> {
  try {
    const admin = await requireAdminUser();
    const comment = await prisma.postComment.findUnique({
      where: { id: commentId },
      select: { id: true, postId: true, userId: true, body: true },
    });
    if (!comment) return { ok: false, error: 'Comentario no encontrado.' };

    await prisma.$transaction([
      prisma.postComment.delete({ where: { id: comment.id } }),
      prisma.post.updateMany({
        where: { id: comment.postId, commentCount: { gt: 0 } },
        data: { commentCount: { decrement: 1 } },
      }),
      prisma.auditLog.create({
        data: {
          actorId: admin.id,
          action: 'COMMENT_DELETED',
          entityType: 'PostComment',
          entityId: comment.id,
          metadata: { postId: comment.postId, authorId: comment.userId, body: comment.body.slice(0, 500) },
        },
      }),
    ]);

    revalidatePath(`/admin/content/${comment.postId}`);
    return { ok: true, message: 'Comentario borrado.' };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

/** Corta un directo en curso. */
export async function adminEndStreamAction(input: {
  streamId: string;
  reason?: string;
}): Promise<SupervisionResult> {
  try {
    const admin = await requireAdminUser();
    const reason = cleanReason(input.reason);
    const stream = await prisma.liveStream.findUnique({
      where: { id: input.streamId },
      select: {
        id: true,
        status: true,
        roomName: true,
        ingressId: true,
        model: { select: { userId: true } },
      },
    });
    if (!stream) return { ok: false, error: 'Directo no encontrado.' };
    if (stream.status === 'ENDED') return { ok: true, message: 'Ese directo ya habia terminado.' };

    await prisma.liveStream.update({
      where: { id: stream.id },
      data: { status: 'ENDED', endedAt: new Date(), viewerCount: 0 },
    });
    if (stream.ingressId) await deleteRtmpIngress(stream.ingressId).catch(() => {});
    await closeRoom(stream.roomName).catch(() => {});

    await prisma.auditLog.create({
      data: {
        actorId: admin.id,
        action: 'LIVE_ENDED_BY_ADMIN',
        entityType: 'LiveStream',
        entityId: stream.id,
        metadata: { reason },
      },
    });
    await createNotification(prisma, {
      userId: stream.model.userId,
      type: 'MODERATION',
      title: 'Hemos cortado tu directo',
      body: `Motivo: ${reason}. Si crees que es un error, escribe a soporte.`,
    });

    revalidatePath('/admin/live');
    revalidatePath('/live');
    revalidatePath('/');
    return { ok: true, message: 'Directo cortado. Se ha avisado a la creadora.' };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

function toMessage(error: unknown): string {
  if (error instanceof Error) {
    if (error.message === 'UNAUTHORIZED') return 'Debes iniciar sesion.';
    if (error.message === 'FORBIDDEN') return 'Solo para administradores.';
    return error.message;
  }
  return 'Error inesperado.';
}
