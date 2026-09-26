'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { getAuthedUserOrThrow, getCurrentUser } from '@/lib/auth/guards';
import { checkNoContactInfo } from '@/lib/content-filter';
import { GEO_BLOCKED_MESSAGE, isBlockedForViewer } from '@/lib/geo';
import { createNotification } from '@/lib/notifications';
import {
  POLL_DURATIONS,
  POLL_MAX_OPTIONS,
  POLL_MIN_OPTIONS,
  POLL_OPTION_MAX,
  POLL_QUESTION_MAX,
} from '@/lib/polls';
import { assertCreatorVerified } from '@/lib/creator-kyc';
import { prisma } from '@/lib/prisma';
import { buildPostKey, createUploadUrl, deleteObject } from '@/lib/storage';
import { getActiveSubscription } from '@/lib/subscriptions';
import { InsufficientTokensError, transferWithCommission } from '@/lib/tokens';

export interface PostActionResult<T = unknown> {
  ok: boolean;
  error?: string;
  message?: string;
  data?: T;
}

/** Cuantos seguidores como maximo reciben aviso de una publicacion nueva. */
const NOTIFY_FOLLOWERS_LIMIT = 500;

async function requireModelProfile() {
  const user = await getAuthedUserOrThrow();
  const profile = await prisma.modelProfile.findUnique({
    where: { userId: user.id },
    select: { id: true, slug: true, stageName: true, subscriptionEnabled: true },
  });
  if (!profile) throw new Error('MODEL_PROFILE_MISSING');
  return { user, profile };
}

// ---------------------------------------------------------------------------
// PUBLICAR
// ---------------------------------------------------------------------------

const pollSchema = z
  .object({
    question: z
      .string()
      .trim()
      .min(1, 'Escribe la pregunta de la encuesta.')
      .max(POLL_QUESTION_MAX),
    options: z
      .array(
        z.string().trim().min(1, 'Ninguna opcion puede quedar vacia.').max(POLL_OPTION_MAX),
      )
      .min(POLL_MIN_OPTIONS, `Una encuesta necesita al menos ${POLL_MIN_OPTIONS} opciones.`)
      .max(POLL_MAX_OPTIONS, `Una encuesta admite como mucho ${POLL_MAX_OPTIONS} opciones.`),
    durationHours: z
      .number()
      .int()
      .nullable()
      .refine((h) => POLL_DURATIONS.some((d) => d.hours === h), 'Duracion no valida.'),
  })
  .refine(
    (p) => new Set(p.options.map((o) => o.toLowerCase())).size === p.options.length,
    { message: 'Las opciones de la encuesta no pueden repetirse.' },
  );

const postSchema = z
  .object({
    body: z.string().trim().max(2000).optional(),
    visibility: z.enum(['PUBLIC', 'LOCKED', 'SUBSCRIBERS']),
    priceTokens: z.number().int().min(0).max(100000),
    poll: pollSchema.optional(),
  })
  .refine((v) => v.visibility !== 'LOCKED' || v.priceTokens > 0, {
    message: 'Una publicacion de pago necesita un precio mayor que 0.',
    path: ['priceTokens'],
  });

/**
 * Crea la publicacion en BORRADOR (isPublished: false).
 *
 * Se crea antes de subir los archivos porque la clave de S3 los agrupa por
 * postId; publicarla es un segundo paso explicito, de modo que una subida a
 * medias nunca aparece en el feed de nadie.
 */
export async function createPostAction(input: {
  body?: string;
  visibility: 'PUBLIC' | 'LOCKED' | 'SUBSCRIBERS';
  priceTokens: number;
  poll?: { question: string; options: string[]; durationHours: number | null };
}): Promise<PostActionResult<{ postId: string }>> {
  try {
    const { profile } = await requireModelProfile();
    await assertCreatorVerified({ modelId: profile.id });

    const parsed = postSchema.safeParse(input);
    if (!parsed.success) {
      return {
        ok: false,
        error: parsed.error.issues[0]?.message ?? 'Datos de publicacion invalidos.',
      };
    }

    if (parsed.data.visibility === 'SUBSCRIBERS' && !profile.subscriptionEnabled) {
      return {
        ok: false,
        error: 'Activa la suscripcion mensual antes de publicar solo para suscriptores.',
      };
    }

    // El texto de una publicacion es tan buen sitio para colar un Telegram
    // como la biografia, asi que pasa por el mismo filtro.
    // La encuesta tambien es texto publico: mismo filtro.
    const publicText = [
      parsed.data.body,
      parsed.data.poll?.question,
      ...(parsed.data.poll?.options ?? []),
    ]
      .filter(Boolean)
      .join(' \n ');
    if (publicText) {
      const contactError = checkNoContactInfo(publicText);
      if (contactError) return { ok: false, error: contactError };
    }

    const poll = parsed.data.poll;

    const post = await prisma.post.create({
      data: {
        modelId: profile.id,
        body: parsed.data.body || null,
        visibility: parsed.data.visibility,
        priceTokens:
          parsed.data.visibility === 'LOCKED' ? parsed.data.priceTokens : 0,
        isPublished: false,
        ...(poll
          ? {
              poll: {
                create: {
                  question: poll.question,
                  // El plazo empieza al crear el borrador; la subida tarda
                  // segundos, no merece la pena recalcularlo al publicar.
                  endsAt: poll.durationHours
                    ? new Date(Date.now() + poll.durationHours * 3600_000)
                    : null,
                  options: {
                    create: poll.options.map((text, sortOrder) => ({ text, sortOrder })),
                  },
                },
              },
            }
          : {}),
      },
      select: { id: true },
    });

    return { ok: true, data: { postId: post.id } };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

/** URL firmada para subir un archivo (o su miniatura) de una publicacion. */
export async function requestPostUploadUrlAction(input: {
  postId: string;
  filename: string;
  contentType: string;
  isPreview?: boolean;
}): Promise<PostActionResult<{ uploadUrl: string; key: string }>> {
  try {
    const { profile } = await requireModelProfile();
    await assertCreatorVerified({ modelId: profile.id });

    const post = await prisma.post.findFirst({
      where: { id: input.postId, modelId: profile.id },
      select: { id: true },
    });
    if (!post) return { ok: false, error: 'Publicacion no encontrada.' };

    const key = buildPostKey({
      modelId: profile.id,
      postId: post.id,
      filename: input.filename,
      isPreview: input.isPreview,
    });

    const uploadUrl = await createUploadUrl({
      key,
      contentType: input.contentType,
    });
    if (!uploadUrl) {
      return {
        ok: false,
        error:
          'El almacenamiento no esta configurado. Define S3_* en tu .env o usa MinIO local.',
      };
    }

    return { ok: true, data: { uploadUrl, key } };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

/**
 * Registra un archivo ya subido.
 *
 * `previewKey` es la miniatura difuminada que se sirve sin pagar. Para las
 * publicaciones de pago es obligatoria: sin ella no habria nada que mostrar
 * y la unica alternativa seria servir el original y difuminarlo con CSS, que
 * no protege nada.
 */
export async function attachPostAssetAction(input: {
  postId: string;
  storageKey: string;
  previewKey?: string;
  mimeType: string;
  sizeBytes?: number;
  width?: number;
  height?: number;
  durationSec?: number;
}): Promise<PostActionResult> {
  try {
    const { profile } = await requireModelProfile();
    await assertCreatorVerified({ modelId: profile.id });

    const post = await prisma.post.findFirst({
      where: { id: input.postId, modelId: profile.id },
      select: { id: true, visibility: true, _count: { select: { assets: true } } },
    });
    if (!post) return { ok: false, error: 'Publicacion no encontrada.' };

    // Mismo tope que el estudio (MAX_FILES): una sesion completa cabe.
    if (post._count.assets >= 20) {
      return { ok: false, error: 'Una publicacion admite como mucho 20 archivos.' };
    }

    if (post.visibility !== 'PUBLIC' && !input.previewKey) {
      return {
        ok: false,
        error: 'Falta la miniatura difuminada de una publicacion de pago.',
      };
    }

    await prisma.postAsset.create({
      data: {
        postId: post.id,
        storageKey: input.storageKey,
        previewKey: input.previewKey ?? null,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes ?? null,
        width: input.width ?? null,
        height: input.height ?? null,
        durationSec: input.durationSec ?? null,
        sortOrder: post._count.assets,
      },
    });

    return { ok: true };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

/** Minimo y maximo de antelacion al programar una publicacion. */
const SCHEDULE_MIN_MS = 5 * 60_000;
const SCHEDULE_MAX_MS = 60 * 24 * 3600_000;

/** Valida una fecha de programacion. null = publicar ya. */
function parsePublishAt(value: string | null | undefined): Date | null | string {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Fecha no valida.';
  const diff = date.getTime() - Date.now();
  if (diff < SCHEDULE_MIN_MS) return 'Programala al menos 5 minutos en el futuro.';
  if (diff > SCHEDULE_MAX_MS) return 'Solo puedes programar hasta 60 dias vista.';
  return date;
}

/**
 * Publica el borrador y avisa a los seguidores.
 *
 * Con `publishAt` queda PROGRAMADA: se guarda como publicada con esa fecha y
 * el feed no la muestra hasta entonces (ver livePostWhere). Los avisos a los
 * seguidores se crean ya, con la misma fecha, y tampoco se ven hasta esa hora.
 */
export async function publishPostAction(
  postId: string,
  options: { publishAt?: string | null } = {},
): Promise<PostActionResult> {
  try {
    const { profile } = await requireModelProfile();
    await assertCreatorVerified({ modelId: profile.id });

    const publishAt = parsePublishAt(options.publishAt);
    if (typeof publishAt === 'string') return { ok: false, error: publishAt };

    const post = await prisma.post.findFirst({
      where: { id: postId, modelId: profile.id },
      select: {
        id: true,
        body: true,
        isPublished: true,
        removedAt: true,
        poll: { select: { id: true, endsAt: true } },
        _count: { select: { assets: true } },
      },
    });
    if (!post) return { ok: false, error: 'Publicacion no encontrada.' };
    if (post.removedAt) {
      return { ok: false, error: 'Esta publicacion fue retirada por moderacion y no se puede publicar.' };
    }
    if (post.isPublished) return { ok: true, message: 'Ya estaba publicada.' };
    if (post._count.assets === 0 && !post.body && !post.poll) {
      return { ok: false, error: 'Anade texto o al menos un archivo.' };
    }

    const goesOutAt = publishAt ?? new Date();

    await prisma.$transaction([
      prisma.post.update({
        where: { id: post.id },
        data: { isPublished: true, createdAt: goesOutAt },
      }),
      // La encuesta dura lo elegido desde que SALE, no desde el borrador.
      ...(publishAt && post.poll?.endsAt
        ? [
            prisma.postPoll.update({
              where: { id: post.poll.id },
              data: {
                endsAt: new Date(
                  post.poll.endsAt.getTime() + (publishAt.getTime() - Date.now()),
                ),
              },
            }),
          ]
        : []),
      prisma.modelProfile.update({
        where: { id: profile.id },
        data: { postsCount: { increment: 1 } },
      }),
    ]);

    // Aviso a seguidores. Con un tope, para que una creadora con 50.000
    // seguidores no genere 50.000 filas dentro de la peticion del navegador.
    const followers = await prisma.follow.findMany({
      where: { modelId: profile.id },
      select: { userId: true },
      take: NOTIFY_FOLLOWERS_LIMIT,
      orderBy: { createdAt: 'desc' },
    });

    if (followers.length > 0) {
      await prisma.notification.createMany({
        data: followers.map((f) => ({
          userId: f.userId,
          type: 'NEW_POST' as const,
          title: `${profile.stageName} ha publicado algo nuevo`,
          body: post.body?.slice(0, 120) ?? null,
          link: postLink(profile.slug, post.id),
          createdAt: goesOutAt,
        })),
      });
    }

    revalidatePath('/feed');
    revalidatePath('/dashboard/model/posts');
    revalidatePath(`/models/${profile.slug}`);
    return {
      ok: true,
      message: publishAt ? 'Publicacion programada.' : 'Publicacion creada.',
    };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

/** Enlace de una publicacion (lo usan los avisos a seguidores). */
function postLink(slug: string, postId: string) {
  return `/models/${slug}?post=${postId}`;
}

const updatePostSchema = z.object({
  postId: z.string().min(1),
  body: z.string().trim().max(2000),
  priceTokens: z.number().int().min(1).max(100000).optional(),
  /** Solo para publicaciones programadas: nueva hora, o null = publicar ya. */
  publishAt: z.string().nullable().optional(),
});

/**
 * Edita una publicacion propia: el texto, el precio si es de pago y, si aun
 * no ha salido, la hora de publicacion. Quien lo ve (publico, de pago,
 * suscriptores) NO se cambia: quien ya pago o se suscribio lo hizo por eso.
 */
export async function updatePostAction(input: {
  postId: string;
  body: string;
  priceTokens?: number;
  publishAt?: string | null;
}): Promise<PostActionResult> {
  try {
    const { profile } = await requireModelProfile();
    await assertCreatorVerified({ modelId: profile.id });

    const parsed = updatePostSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? 'Datos no validos.' };
    }
    const data = parsed.data;

    const post = await prisma.post.findFirst({
      where: { id: data.postId, modelId: profile.id, isPublished: true },
      select: {
        id: true,
        visibility: true,
        createdAt: true,
        poll: { select: { id: true, endsAt: true } },
        _count: { select: { assets: true } },
      },
    });
    if (!post) return { ok: false, error: 'Publicacion no encontrada.' };

    if (!data.body && post._count.assets === 0 && !post.poll) {
      return { ok: false, error: 'La publicacion no puede quedarse vacia.' };
    }
    if (data.body) {
      const contactError = checkNoContactInfo(data.body);
      if (contactError) return { ok: false, error: contactError };
    }

    const now = new Date();
    const isScheduled = post.createdAt > now;
    let newDate: Date | null = null;
    if (data.publishAt !== undefined) {
      if (!isScheduled) {
        return { ok: false, error: 'Esta publicacion ya salio; no se puede reprogramar.' };
      }
      const parsedDate = parsePublishAt(data.publishAt);
      if (typeof parsedDate === 'string') return { ok: false, error: parsedDate };
      newDate = parsedDate ?? now;
    }

    await prisma.$transaction([
      prisma.post.update({
        where: { id: post.id },
        data: {
          body: data.body || null,
          ...(post.visibility === 'LOCKED' && data.priceTokens
            ? { priceTokens: data.priceTokens }
            : {}),
          ...(newDate ? { createdAt: newDate } : {}),
        },
      }),
      ...(newDate
        ? [
            // Los avisos a seguidores salen con la publicacion.
            prisma.notification.updateMany({
              where: { type: 'NEW_POST', link: postLink(profile.slug, post.id) },
              data: { createdAt: newDate },
            }),
            ...(post.poll?.endsAt
              ? [
                  prisma.postPoll.update({
                    where: { id: post.poll.id },
                    data: {
                      endsAt: new Date(
                        post.poll.endsAt.getTime() +
                          (newDate.getTime() - post.createdAt.getTime()),
                      ),
                    },
                  }),
                ]
              : []),
          ]
        : []),
    ]);

    revalidatePath('/feed');
    revalidatePath('/dashboard/model/posts');
    revalidatePath(`/models/${profile.slug}`);
    return {
      ok: true,
      message:
        newDate && newDate <= now
          ? 'Publicada ahora.'
          : newDate
            ? 'Hora de publicacion cambiada.'
            : 'Publicacion actualizada.',
    };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

/** Borra una publicacion propia y sus archivos del bucket. */
export async function deletePostAction(
  postId: string,
): Promise<PostActionResult> {
  try {
    const { profile } = await requireModelProfile();

    const post = await prisma.post.findFirst({
      where: { id: postId, modelId: profile.id },
      select: {
        id: true,
        isPublished: true,
        assets: { select: { storageKey: true, previewKey: true } },
      },
    });
    if (!post) return { ok: false, error: 'Publicacion no encontrada.' };

    await prisma.$transaction([
      prisma.post.delete({ where: { id: post.id } }),
      ...(post.isPublished
        ? [
            prisma.modelProfile.update({
              where: { id: profile.id },
              data: { postsCount: { decrement: 1 } },
            }),
          ]
        : []),
    ]);

    // Los objetos se borran DESPUES de que la BD confirme: si fallase el
    // borrado del bucket quedarian archivos huerfanos, que es mucho menos
    // grave que una fila apuntando a un archivo que ya no existe.
    for (const asset of post.assets) {
      await deleteObject(asset.storageKey);
      if (asset.previewKey) await deleteObject(asset.previewKey);
    }

    revalidatePath('/feed');
    revalidatePath('/dashboard/model/posts');
    revalidatePath(`/models/${profile.slug}`);
    return { ok: true, message: 'Publicacion eliminada.' };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

// ---------------------------------------------------------------------------
// INTERACCION DE LOS USUARIOS
// ---------------------------------------------------------------------------

/**
 * Paga el desbloqueo de una publicacion.
 *
 * El cobro y el registro del desbloqueo van en la MISMA transaccion, asi que
 * no existe el estado intermedio de "pagado pero sin acceso". El unique de
 * PostUnlock garantiza que nadie pueda pagar dos veces por lo mismo ni con
 * dos pestanas a la vez.
 */
export async function unlockPostAction(
  postId: string,
): Promise<PostActionResult<{ balance: number }>> {
  try {
    const user = await getAuthedUserOrThrow();

    const post = await prisma.post.findUnique({
      where: { id: postId },
      select: {
        id: true,
        visibility: true,
        priceTokens: true,
        isPublished: true,
        createdAt: true,
        modelId: true,
        model: {
          select: {
            userId: true,
            slug: true,
            stageName: true,
            blockedCountries: true,
          },
        },
      },
    });

    if (!post || !post.isPublished || post.createdAt > new Date()) {
      return { ok: false, error: 'Publicacion no encontrada.' };
    }
    if (post.model.userId === user.id) {
      return { ok: false, error: 'Es tu propia publicacion.' };
    }
    if (await isBlockedForViewer(post.model.blockedCountries)) {
      return { ok: false, error: GEO_BLOCKED_MESSAGE };
    }

    if (post.visibility === 'PUBLIC') {
      return { ok: false, error: 'Esta publicacion ya es publica.' };
    }
    if (post.visibility === 'SUBSCRIBERS') {
      const subscription = await getActiveSubscription(user.id, post.modelId);
      return subscription
        ? { ok: true, message: 'Ya tienes acceso con tu suscripcion.', data: { balance: 0 } }
        : {
            ok: false,
            error: 'Esta publicacion es solo para suscriptores. Suscribete para verla.',
          };
    }

    const existing = await prisma.postUnlock.findUnique({
      where: { userId_postId: { userId: user.id, postId: post.id } },
      select: { id: true },
    });
    if (existing) {
      return { ok: true, message: 'Ya la tenias desbloqueada.', data: { balance: 0 } };
    }

    const balance = await prisma.$transaction(async (tx) => {
      await tx.postUnlock.create({
        data: {
          userId: user.id,
          postId: post.id,
          tokensSpent: post.priceTokens,
        },
      });

      const { debit, modelTokens } = await transferWithCommission(tx, {
        fromUserId: user.id,
        toUserId: post.model.userId,
        tokens: post.priceTokens,
        debitType: 'POST_UNLOCK',
        creditType: 'POST_EARNING',
        description: `Desbloqueo de publicacion de ${post.model.stageName}`,
        postId: post.id,
      });

      await tx.post.update({
        where: { id: post.id },
        data: {
          unlockCount: { increment: 1 },
          tokensEarned: { increment: modelTokens },
        },
      });

      return debit.balanceAfter;
    });

    revalidatePath('/feed');
    revalidatePath(`/models/${post.model.slug}`);
    return {
      ok: true,
      message: 'Publicacion desbloqueada.',
      data: { balance },
    };
  } catch (error) {
    if (error instanceof InsufficientTokensError) {
      return {
        ok: false,
        error: `Te faltan ${error.required - error.available} tokens.`,
      };
    }
    return { ok: false, error: toMessage(error) };
  }
}

/** Da o quita un "me gusta". Idempotente por usuario y publicacion. */
export async function togglePostLikeAction(
  postId: string,
): Promise<PostActionResult<{ liked: boolean; likeCount: number }>> {
  try {
    const user = await getAuthedUserOrThrow();

    const existing = await prisma.postLike.findUnique({
      where: { userId_postId: { userId: user.id, postId } },
      select: { id: true },
    });

    const post = await prisma.$transaction(async (tx) => {
      if (existing) {
        await tx.postLike.delete({ where: { id: existing.id } });
        return tx.post.update({
          where: { id: postId },
          data: { likeCount: { decrement: 1 } },
          select: { likeCount: true },
        });
      }

      await tx.postLike.create({ data: { userId: user.id, postId } });
      return tx.post.update({
        where: { id: postId },
        data: { likeCount: { increment: 1 } },
        select: { likeCount: true },
      });
    });

    return {
      ok: true,
      data: { liked: !existing, likeCount: Math.max(0, post.likeCount) },
    };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

/**
 * Vota en la encuesta de una publicacion.
 *
 * Un voto por persona (lo garantiza el indice unico) y sin cambiarlo despues,
 * como en Instagram. Solo vota quien puede ver la publicacion: en una de pago
 * o para suscriptores, la encuesta es parte del contenido que se paga.
 */
export async function votePostPollAction(input: {
  pollId: string;
  optionId: string;
}): Promise<
  PostActionResult<{
    totalVotes: number;
    options: { id: string; votes: number }[];
    myOptionId: string;
  }>
> {
  try {
    const user = await getAuthedUserOrThrow();

    const poll = await prisma.postPoll.findUnique({
      where: { id: input.pollId },
      select: {
        id: true,
        endsAt: true,
        options: { select: { id: true } },
        post: {
          select: {
            id: true,
            isPublished: true,
            createdAt: true,
            visibility: true,
            modelId: true,
            model: { select: { userId: true, blockedCountries: true } },
          },
        },
      },
    });
    if (!poll || !poll.post.isPublished || poll.post.createdAt > new Date()) {
      return { ok: false, error: 'Encuesta no encontrada.' };
    }
    if (!poll.options.some((o) => o.id === input.optionId)) {
      return { ok: false, error: 'Opcion no valida.' };
    }
    if (poll.post.model.userId === user.id) {
      return { ok: false, error: 'No puedes votar en tu propia encuesta.' };
    }
    if (poll.endsAt && poll.endsAt <= new Date()) {
      return { ok: false, error: 'Esta encuesta ya ha terminado.' };
    }
    if (await isBlockedForViewer(poll.post.model.blockedCountries)) {
      return { ok: false, error: GEO_BLOCKED_MESSAGE };
    }

    if (poll.post.visibility === 'LOCKED') {
      const unlocked = await prisma.postUnlock.findUnique({
        where: { userId_postId: { userId: user.id, postId: poll.post.id } },
        select: { id: true },
      });
      if (!unlocked) return { ok: false, error: 'Desbloquea la publicacion para votar.' };
    } else if (poll.post.visibility === 'SUBSCRIBERS') {
      const subscription = await getActiveSubscription(user.id, poll.post.modelId);
      if (!subscription) return { ok: false, error: 'Suscribete para votar.' };
    }

    try {
      await prisma.$transaction([
        prisma.postPollVote.create({
          data: { pollId: poll.id, optionId: input.optionId, userId: user.id },
        }),
        prisma.postPollOption.update({
          where: { id: input.optionId },
          data: { voteCount: { increment: 1 } },
        }),
        prisma.postPoll.update({
          where: { id: poll.id },
          data: { totalVotes: { increment: 1 } },
        }),
      ]);
    } catch (error) {
      // Doble toque o dos pestanas: el indice unico rechaza el segundo voto.
      if ((error as { code?: string }).code === 'P2002') {
        return { ok: false, error: 'Ya has votado en esta encuesta.' };
      }
      throw error;
    }

    const updated = await prisma.postPoll.findUniqueOrThrow({
      where: { id: poll.id },
      select: {
        totalVotes: true,
        options: {
          orderBy: { sortOrder: 'asc' },
          select: { id: true, voteCount: true },
        },
      },
    });

    return {
      ok: true,
      data: {
        totalVotes: updated.totalVotes,
        options: updated.options.map((o) => ({ id: o.id, votes: o.voteCount })),
        myOptionId: input.optionId,
      },
    };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

const commentSchema = z.string().trim().min(1).max(500);

export async function addPostCommentAction(input: {
  postId: string;
  body: string;
}): Promise<PostActionResult> {
  try {
    const user = await getAuthedUserOrThrow();

    const parsed = commentSchema.safeParse(input.body);
    if (!parsed.success) return { ok: false, error: 'Escribe un comentario.' };

    // Los comentarios son publicos: si se permitiera dejar un Telegram aqui,
    // el filtro de los mensajes privados no serviria para nada.
    const contactError = checkNoContactInfo(parsed.data);
    if (contactError) return { ok: false, error: contactError };

    const post = await prisma.post.findUnique({
      where: { id: input.postId },
      select: {
        id: true,
        isPublished: true,
        createdAt: true,
        model: { select: { userId: true, slug: true, blockedCountries: true } },
      },
    });
    if (!post || !post.isPublished || post.createdAt > new Date()) {
      return { ok: false, error: 'Publicacion no encontrada.' };
    }
    if (await isBlockedForViewer(post.model.blockedCountries)) {
      return { ok: false, error: GEO_BLOCKED_MESSAGE };
    }

    await prisma.$transaction(async (tx) => {
      await tx.postComment.create({
        data: { postId: post.id, userId: user.id, body: parsed.data },
      });
      await tx.post.update({
        where: { id: post.id },
        data: { commentCount: { increment: 1 } },
      });

      if (post.model.userId !== user.id) {
        await createNotification(tx, {
          userId: post.model.userId,
          type: 'NEW_POST',
          title: `${user.name ?? 'Alguien'} ha comentado tu publicacion`,
          body: parsed.data.slice(0, 120),
          link: `/models/${post.model.slug}`,
        });
      }
    });

    revalidatePath('/feed');
    return { ok: true };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

/** Comentarios de una publicacion, para el desplegable del feed. */
export async function getPostCommentsAction(postId: string): Promise<
  PostActionResult<
    Array<{
      id: string;
      body: string;
      createdAt: string;
      author: string;
      image: string | null;
      /** Enlace a su perfil: el de creadora o el de persona. */
      profileHref: string | null;
      isMine: boolean;
    }>
  >
> {
  try {
    const viewer = await getCurrentUser();

    const comments = await prisma.postComment.findMany({
      where: { postId },
      orderBy: { createdAt: 'asc' },
      take: 100,
      select: {
        id: true,
        body: true,
        createdAt: true,
        userId: true,
        user: {
          select: {
            name: true,
            email: true,
            image: true,
            username: true,
            modelProfile: { select: { slug: true } },
          },
        },
      },
    });

    return {
      ok: true,
      data: comments.map((c) => ({
        id: c.id,
        body: c.body,
        createdAt: c.createdAt.toISOString(),
        // Sin nombre se usa la parte local del correo: publicar el correo
        // completo de alguien bajo una publicacion seria filtrar un dato
        // personal a cualquiera que pase por el feed.
        author: c.user.name ?? c.user.email.split('@')[0] ?? 'Usuario',
        image: c.user.image,
        profileHref: c.user.modelProfile
          ? `/models/${c.user.modelProfile.slug}`
          : c.user.username
            ? `/u/${c.user.username}`
            : null,
        isMine: Boolean(viewer) && c.userId === viewer?.id,
      })),
    };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

function toMessage(error: unknown): string {
  if (error instanceof Error) {
    if (error.message === 'UNAUTHORIZED') return 'Debes iniciar sesion.';
    if (error.message === 'ACCOUNT_BANNED') return 'Tu cuenta esta suspendida.';
    if (error.message === 'MODEL_PROFILE_MISSING') {
      return 'Necesitas un perfil de creadora.';
    }
    return error.message;
  }
  return 'Error inesperado.';
}

/**
 * "No me interesa": la publicacion deja de salirle en el Descubrir y lo de
 * esa creadora baja. Con `undo` se deshace.
 */
export async function hidePostAction(
  postId: string,
  undo = false,
): Promise<PostActionResult> {
  try {
    const user = await getAuthedUserOrThrow();
    if (undo) {
      await prisma.postHide.deleteMany({ where: { userId: user.id, postId } });
      return { ok: true };
    }
    const post = await prisma.post.findUnique({
      where: { id: postId },
      select: { id: true, model: { select: { userId: true } } },
    });
    if (!post || post.model.userId === user.id) {
      return { ok: false, error: 'Publicacion no encontrada.' };
    }
    await prisma.postHide.upsert({
      where: { userId_postId: { userId: user.id, postId } },
      create: { userId: user.id, postId },
      update: {},
    });
    return { ok: true, message: 'Veras menos publicaciones como esta.' };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}
