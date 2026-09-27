import 'server-only';

import { randomBytes } from 'node:crypto';

import {
  AccessToken,
  IngressClient,
  IngressInput,
  type IngressInfo,
} from 'livekit-server-sdk';

import { config } from '@/lib/config';
import { prisma } from '@/lib/prisma';

/**
 * DIRECTOS
 *
 * Dos caminos de entrada de video:
 *
 *   BROWSER  - la creadora publica su camara por WebRTC contra la misma sala
 *              de LiveKit que ya usan las videollamadas.
 *   OBS_RTMP - LiveKit Ingress (un servicio aparte, `livekit-ingress`) expone
 *              una URL rtmp:// y una clave. OBS publica ahi y el ingress
 *              reenvia el video a la sala como si fuera un participante.
 *
 * El ingress necesita Redis y su propio proceso; si no esta desplegado,
 * `config.live.obsConfigured` es false y la interfaz solo ofrece el navegador
 * en vez de dar unas credenciales que no funcionarian.
 *
 * Los espectadores reciben un token de SOLO SUSCRIPCION (canPublish: false).
 * Sin eso, cualquiera con el enlace podria publicar su propia camara dentro
 * del directo de otra persona.
 */

function ingressClient(): IngressClient | null {
  const { apiKey, apiSecret, url, configured } = config.media.livekit;
  if (!configured || !url) return null;
  return new IngressClient(url.replace(/^ws/, 'http'), apiKey, apiSecret);
}

/** Clave de emision opaca para OBS. */
export function generateStreamKey(): string {
  return randomBytes(24).toString('base64url');
}

export function isLiveConfigured(): boolean {
  return config.media.livekit.configured && Boolean(config.media.livekit.url);
}

export function isObsConfigured(): boolean {
  return isLiveConfigured() && config.live.obsConfigured;
}

/**
 * Foto con la que alguien aparece en el chat y en los regalos: la de su perfil
 * de creador si lo tiene (se guarda en avatarUrl) y si no la de su cuenta.
 */
export async function avatarOf(userId: string): Promise<string | null> {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { image: true, modelProfile: { select: { avatarUrl: true } } },
  });
  return u?.modelProfile?.avatarUrl ?? u?.image ?? null;
}

/** Nombre de sala de un directo. Estable y derivado del id del stream. */
export function liveRoomName(streamId: string): string {
  return `live_${streamId}`;
}

/**
 * Token de emision para la propia creadora (puede publicar).
 * TTL largo: un directo puede durar horas y el token no debe caducar a mitad.
 */
export async function createBroadcasterToken(params: {
  roomName: string;
  identity: string;
  name?: string;
  /** Foto para el chat. Va firmada en el token: nadie puede ponerse otra. */
  avatarUrl?: string | null;
}): Promise<string | null> {
  const { apiKey, apiSecret, configured } = config.media.livekit;
  if (!configured) return null;

  const at = new AccessToken(apiKey, apiSecret, {
    identity: params.identity,
    name: params.name,
    ttl: 60 * 60 * 12,
    metadata: JSON.stringify({ avatar: params.avatarUrl ?? null }),
  });
  at.addGrant({
    room: params.roomName,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
    roomAdmin: true,
  });
  return at.toJwt();
}

/**
 * Token de espectador: puede ver y escribir en el chat, nunca publicar video.
 */
export async function createViewerToken(params: {
  roomName: string;
  identity: string;
  name?: string;
  /** Foto para el chat. Va firmada en el token: nadie puede ponerse otra. */
  avatarUrl?: string | null;
}): Promise<string | null> {
  const { apiKey, apiSecret, configured } = config.media.livekit;
  if (!configured) return null;

  const at = new AccessToken(apiKey, apiSecret, {
    identity: params.identity,
    name: params.name,
    ttl: 60 * 60 * 6,
    metadata: JSON.stringify({ avatar: params.avatarUrl ?? null }),
  });
  at.addGrant({
    room: params.roomName,
    roomJoin: true,
    // Clave de seguridad: sin esto un espectador podria publicar su camara.
    canPublish: false,
    canSubscribe: true,
    canPublishData: true,
  });
  return at.toJwt();
}

/**
 * Crea el ingress RTMP de un directo y devuelve las credenciales de OBS.
 *
 * Devuelve null si el ingress no esta configurado o si LiveKit lo rechaza:
 * quien llama debe caer a emision por navegador en vez de dejar a la creadora
 * con una pantalla de "copia esta URL" que no lleva a ningun sitio.
 */
export async function createRtmpIngress(params: {
  roomName: string;
  identity: string;
  name: string;
  streamKey: string;
}): Promise<{ ingressId: string; url: string; streamKey: string } | null> {
  const client = ingressClient();
  if (!client || !isObsConfigured()) return null;

  try {
    // Sin opciones de audio/video: el ingress transcodifica con sus valores
    // por defecto (H.264 multicapa + Opus), que es lo que queremos para OBS.
    const info: IngressInfo = await client.createIngress(IngressInput.RTMP_INPUT, {
      name: `live-${params.roomName}`,
      roomName: params.roomName,
      participantIdentity: params.identity,
      participantName: params.name,
      enableTranscoding: true,
    });

    return {
      ingressId: info.ingressId,
      // LiveKit devuelve su propia url/streamKey: son las que hay que pegar en
      // OBS, no las nuestras.
      url: info.url || config.live.rtmpUrl,
      streamKey: info.streamKey || params.streamKey,
    };
  } catch {
    return null;
  }
}

/** Borra el ingress al terminar el directo. Silencioso si ya no existe. */
export async function deleteRtmpIngress(ingressId: string): Promise<void> {
  const client = ingressClient();
  if (!client) return;
  try {
    await client.deleteIngress(ingressId);
  } catch {
    // El ingress puede haber caducado por su cuenta: no es un error funcional.
  }
}

/**
 * De estos perfiles, cuales estan emitiendo un directo ahora mismo. Sirve
 * para que las tarjetas digan "EN DIRECTO" solo a quien emite, y no a quien
 * solo esta conectado.
 */
export async function liveModelIds(modelIds: string[]): Promise<Set<string>> {
  if (modelIds.length === 0) return new Set();
  const live = await prisma.liveStream.findMany({
    where: { modelId: { in: modelIds }, status: 'LIVE' },
    select: { modelId: true },
  });
  return new Set(live.map((l) => l.modelId));
}

/** Directo en curso de una creadora, o null. */
export async function getActiveStreamForModel(modelId: string) {
  return prisma.liveStream.findFirst({
    where: { modelId, status: { in: ['PREPARING', 'LIVE'] } },
    orderBy: { createdAt: 'desc' },
  });
}
