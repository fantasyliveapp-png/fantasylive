'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { getAuthedUserOrThrow, getCurrentUser } from '@/lib/auth/guards';
import { config } from '@/lib/config';
import { checkNoContactInfo } from '@/lib/content-filter';
import {
  GEO_BLOCKED_MESSAGE,
  getViewerCountry,
  isBlockedForViewer,
} from '@/lib/geo';
import {
  createBroadcasterToken,
  createRtmpIngress,
  createViewerToken,
  deleteRtmpIngress,
  generateStreamKey,
  isLiveConfigured,
  isObsConfigured,
  liveRoomName,
} from '@/lib/live';
import { closeRoom, countRoomParticipants } from '@/lib/livekit';
import { prisma } from '@/lib/prisma';
import { maybeSendAutoGreeting } from '@/lib/greeting';
import { recordProfileVisit } from '@/lib/visits';

export interface LiveActionResult<T = unknown> {
  ok: boolean;
  error?: string;
  message?: string;
  data?: T;
}

async function requireLiveModel() {
  const user = await getAuthedUserOrThrow();
  const profile = await prisma.modelProfile.findUnique({
    where: { userId: user.id },
    select: {
      id: true,
      slug: true,
      stageName: true,
      kycStatus: true,
      liveEnabled: true,
      streamKey: true,
    },
  });
  if (!profile) throw new Error('MODEL_PROFILE_MISSING');
  return { user, profile };
}

// ---------------------------------------------------------------------------
// EMITIR
// ---------------------------------------------------------------------------

const startSchema = z.object({
  title: z.string().trim().max(120).optional(),
  source: z.enum(['BROWSER', 'OBS_RTMP']),
});

/**
 * Abre un directo.
 *
 * El KYC aprobado es un requisito duro, no una recomendacion: emitir video en
 * vivo en una plataforma para adultos sin identidad verificada es exactamente
 * el riesgo que el KYC existe para cubrir. Se comprueba aqui, en el servidor,
 * no solo escondiendo el boton.
 *
 * El directo nace en PREPARING y solo pasa a LIVE cuando hay video de verdad
 * en la sala (ver `markStreamLiveAction`): asi la portada nunca anuncia un
 * directo que todavia esta cargando OBS.
 */
export async function startStreamAction(input: {
  title?: string;
  source: 'BROWSER' | 'OBS_RTMP';
}): Promise<
  LiveActionResult<{
    streamId: string;
    roomName: string;
    token: string | null;
    url: string;
    rtmpUrl: string | null;
    streamKey: string | null;
    source: 'BROWSER' | 'OBS_RTMP';
  }>
> {
  try {
    const { user, profile } = await requireLiveModel();

    const parsed = startSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: 'Datos del directo invalidos.' };

    if (config.moderation.requireKycToStream && profile.kycStatus !== 'APPROVED') {
      return {
        ok: false,
        error: 'Necesitas la verificacion de identidad (KYC) aprobada para emitir.',
      };
    }
    if (!isLiveConfigured()) {
      return {
        ok: false,
        error: 'El servidor de video no esta configurado. Define LIVEKIT_* en el entorno.',
      };
    }
    if (parsed.data.title) {
      const contactError = checkNoContactInfo(parsed.data.title);
      if (contactError) return { ok: false, error: contactError };
    }

    // Un directo a la vez: dos salas en paralelo dividirian a los
    // espectadores y los regalos irian a la sala equivocada.
    const existing = await prisma.liveStream.findFirst({
      where: { modelId: profile.id, status: { in: ['PREPARING', 'LIVE'] } },
      select: { id: true },
    });
    if (existing) {
      await endStreamAction(existing.id);
    }

    const streamKey = profile.streamKey ?? generateStreamKey();

    const stream = await prisma.liveStream.create({
      data: {
        modelId: profile.id,
        title: parsed.data.title || null,
        source: parsed.data.source,
        status: 'PREPARING',
        // roomName se reescribe abajo con el id real; se crea con un valor
        // unico provisional porque la columna es unique y NOT NULL.
        roomName: `live_pending_${crypto.randomUUID()}`,
        streamKey,
      },
      select: { id: true },
    });

    const roomName = liveRoomName(stream.id);

    let rtmpUrl: string | null = null;
    let obsKey: string | null = null;
    let ingressId: string | null = null;

    if (parsed.data.source === 'OBS_RTMP') {
      const ingress = await createRtmpIngress({
        roomName,
        identity: `model_${profile.id}`,
        name: profile.stageName,
        streamKey,
      });
      if (!ingress) {
        // Sin ingress no hay forma de recibir OBS: se borra el directo en vez
        // de dejar a la creadora con unas credenciales inservibles.
        await prisma.liveStream.delete({ where: { id: stream.id } });
        return {
          ok: false,
          error: isObsConfigured()
            ? 'LiveKit rechazo la creacion del ingress RTMP. Revisa el servicio livekit-ingress.'
            : 'El ingress RTMP no esta configurado en este servidor. Emite desde el navegador.',
        };
      }
      rtmpUrl = ingress.url;
      obsKey = ingress.streamKey;
      ingressId = ingress.ingressId;
    }

    await prisma.$transaction([
      prisma.liveStream.update({
        where: { id: stream.id },
        data: { roomName, rtmpUrl, streamKey: obsKey ?? streamKey, ingressId },
      }),
      prisma.modelProfile.update({
        where: { id: profile.id },
        data: { liveEnabled: true, streamKey, isOnline: true, lastOnlineAt: new Date() },
      }),
    ]);

    // Token de publicacion solo para emision por navegador; con OBS el video
    // entra por el ingress y la creadora solo mira su propio directo.
    const token =
      parsed.data.source === 'BROWSER'
        ? await createBroadcasterToken({
            roomName,
            identity: user.id,
            name: profile.stageName,
          })
        : await createViewerToken({
            roomName,
            identity: user.id,
            name: profile.stageName,
          });

    revalidatePath('/dashboard/model/live');
    return {
      ok: true,
      data: {
        streamId: stream.id,
        roomName,
        token,
        url: process.env.NEXT_PUBLIC_LIVEKIT_URL || '',
        rtmpUrl,
        streamKey: obsKey,
        source: parsed.data.source,
      },
    };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

/**
 * Marca el directo como LIVE y avisa a los seguidores.
 *
 * Lo llama el navegador de la creadora cuando ya hay pista de video publicada
 * (camara conectada o OBS emitiendo). Es idempotente: solo notifica la primera
 * vez, comprobando el estado anterior dentro del propio UPDATE.
 */
export async function markStreamLiveAction(
  streamId: string,
): Promise<LiveActionResult> {
  try {
    const { profile } = await requireLiveModel();

    const updated = await prisma.liveStream.updateMany({
      where: { id: streamId, modelId: profile.id, status: 'PREPARING' },
      data: { status: 'LIVE', startedAt: new Date() },
    });

    // updateMany devuelve 0 si ya estaba LIVE: no se vuelve a notificar.
    if (updated.count === 0) return { ok: true };

    const followers = await prisma.follow.findMany({
      where: { modelId: profile.id },
      select: { userId: true },
      take: 500,
      orderBy: { createdAt: 'desc' },
    });

    if (followers.length > 0) {
      await prisma.notification.createMany({
        data: followers.map((f) => ({
          userId: f.userId,
          type: 'LIVE_STARTED' as const,
          title: `${profile.stageName} esta en directo`,
          link: `/live/${profile.slug}`,
        })),
      });
    }

    revalidatePath('/');
    revalidatePath('/live');
    return { ok: true };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

/** Cierra el directo, la sala y el ingress. */
export async function endStreamAction(
  streamId: string,
): Promise<LiveActionResult> {
  try {
    const { profile } = await requireLiveModel();

    const stream = await prisma.liveStream.findFirst({
      where: { id: streamId, modelId: profile.id },
      select: { id: true, roomName: true, ingressId: true, status: true },
    });
    if (!stream) return { ok: false, error: 'Directo no encontrado.' };

    await prisma.liveStream.update({
      where: { id: stream.id },
      data: { status: 'ENDED', endedAt: new Date(), viewerCount: 0 },
    });

    if (stream.ingressId) await deleteRtmpIngress(stream.ingressId);
    await closeRoom(stream.roomName);

    revalidatePath('/');
    revalidatePath('/live');
    revalidatePath('/dashboard/model/live');
    return { ok: true, message: 'Directo finalizado.' };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

/** Rota la clave de emision. Corta cualquier OBS que estuviera conectado. */
export async function regenerateStreamKeyAction(): Promise<
  LiveActionResult<{ streamKey: string }>
> {
  try {
    const { profile } = await requireLiveModel();
    const streamKey = generateStreamKey();

    await prisma.modelProfile.update({
      where: { id: profile.id },
      data: { streamKey },
    });

    revalidatePath('/dashboard/model/live');
    return { ok: true, data: { streamKey }, message: 'Clave regenerada.' };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

// ---------------------------------------------------------------------------
// VER
// ---------------------------------------------------------------------------

/**
 * Token de espectador de un directo.
 *
 * Ademas de las credenciales, aqui es donde se registra la visita y donde se
 * dispara el saludo automatico: entrar a un directo cuenta igual que entrar
 * al perfil para las analiticas de la creadora.
 */
export async function joinStreamAction(
  streamId: string,
): Promise<
  LiveActionResult<{
    token: string | null;
    url: string;
    roomName: string;
    viewerCount: number;
  }>
> {
  try {
    const viewer = await getCurrentUser();

    const stream = await prisma.liveStream.findUnique({
      where: { id: streamId },
      select: {
        id: true,
        roomName: true,
        status: true,
        viewerCount: true,
        viewerPeak: true,
        modelId: true,
        model: {
          select: { userId: true, stageName: true, blockedCountries: true },
        },
      },
    });

    if (!stream) return { ok: false, error: 'Directo no encontrado.' };
    if (stream.status === 'ENDED') {
      return { ok: false, error: 'Este directo ha terminado.' };
    }
    if (await isBlockedForViewer(stream.model.blockedCountries)) {
      return { ok: false, error: GEO_BLOCKED_MESSAGE };
    }
    if (!viewer) return { ok: false, error: 'Debes iniciar sesion para ver el directo.' };

    if (stream.viewerCount >= config.live.maxViewers) {
      return { ok: false, error: 'El directo esta lleno. Intentalo en un momento.' };
    }

    const token = await createViewerToken({
      roomName: stream.roomName,
      identity: viewer.id,
      name: viewer.name ?? 'Invitado',
    });

    // Presencia real: LiveKit es la unica fuente fiable del numero de
    // espectadores. El contador de BD es un espejo para poder ordenar la
    // portada sin consultar a LiveKit en cada render.
    const participants = await countRoomParticipants(stream.roomName);
    const viewerCount = Math.max(0, (participants ?? 1) - 1);

    await prisma.liveStream.update({
      where: { id: stream.id },
      data: {
        viewerCount,
        viewerPeak: Math.max(stream.viewerPeak, viewerCount),
        // Cuenta ENTRADAS a la sala, no personas distintas: quien recarga
        // la pagina entra otra vez. Las personas distintas salen de
        // ProfileVisit, que si deduplica.
        totalJoins: { increment: 1 },
      },
    });

    if (viewer.id !== stream.model.userId) {
      await recordProfileVisit({
        modelId: stream.modelId,
        modelUserId: stream.model.userId,
        viewerId: viewer.id,
        viewerCountry: await getViewerCountry(),
        source: 'LIVE',
      });
      await maybeSendAutoGreeting({
        modelId: stream.modelId,
        viewerId: viewer.id,
        source: 'LIVE',
      });
    }

    return {
      ok: true,
      data: {
        token,
        url: process.env.NEXT_PUBLIC_LIVEKIT_URL || '',
        roomName: stream.roomName,
        viewerCount,
      },
    };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

/**
 * Recuento de espectadores para el contador en vivo.
 *
 * Lo consulta el cliente cada pocos segundos. Se apoya en LiveKit y refresca
 * el espejo de BD, que es lo que ordena la portada.
 */
export async function getStreamViewersAction(
  streamId: string,
): Promise<LiveActionResult<{ viewerCount: number; status: string }>> {
  try {
    const stream = await prisma.liveStream.findUnique({
      where: { id: streamId },
      select: { id: true, roomName: true, status: true, viewerPeak: true },
    });
    if (!stream) return { ok: false, error: 'Directo no encontrado.' };

    const participants = await countRoomParticipants(stream.roomName);
    if (participants === null) {
      return {
        ok: true,
        data: { viewerCount: 0, status: stream.status },
      };
    }

    const viewerCount = Math.max(0, participants - 1);
    await prisma.liveStream.update({
      where: { id: stream.id },
      data: {
        viewerCount,
        viewerPeak: Math.max(stream.viewerPeak, viewerCount),
      },
    });

    return { ok: true, data: { viewerCount, status: stream.status } };
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
