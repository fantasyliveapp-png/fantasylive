import 'server-only';

import { AccessToken, RoomServiceClient } from 'livekit-server-sdk';

import { config } from '@/lib/config';

/**
 * Genera un JWT de acceso a una sala LiveKit.
 * Si LiveKit no esta configurado devuelve null y el cliente cae al modo demo.
 */
export async function createLiveKitToken(params: {
  roomName: string;
  identity: string;
  name?: string;
  metadata?: Record<string, unknown>;
  canPublish?: boolean;
  ttlSeconds?: number;
}): Promise<string | null> {
  const { apiKey, apiSecret, configured } = config.media.livekit;
  if (!configured) return null;

  const at = new AccessToken(apiKey, apiSecret, {
    identity: params.identity,
    name: params.name,
    ttl: params.ttlSeconds ?? 60 * 60,
    metadata: params.metadata ? JSON.stringify(params.metadata) : undefined,
  });

  at.addGrant({
    room: params.roomName,
    roomJoin: true,
    canPublish: params.canPublish ?? true,
    canSubscribe: true,
    canPublishData: true,
  });

  return at.toJwt();
}

function roomService(): RoomServiceClient | null {
  const { apiKey, apiSecret, url, configured } = config.media.livekit;
  if (!configured || !url) return null;
  // El SDK de servidor usa https, no wss
  const httpUrl = url.replace(/^ws/, 'http');
  return new RoomServiceClient(httpUrl, apiKey, apiSecret);
}

/** Cierra la sala y desconecta a todos los participantes. */
export async function closeRoom(roomName: string): Promise<void> {
  const svc = roomService();
  if (!svc) return;
  try {
    await svc.deleteRoom(roomName);
  } catch {
    // La sala puede no existir todavia: no es un error funcional
  }
}

/** Expulsa a un participante concreto (moderacion / corte por saldo). */
export async function removeParticipant(
  roomName: string,
  identity: string,
): Promise<void> {
  const svc = roomService();
  if (!svc) return;
  try {
    await svc.removeParticipant(roomName, identity);
  } catch {
    // ignorar
  }
}

export function isLiveKitConfigured(): boolean {
  return config.media.livekit.configured && Boolean(config.media.livekit.url);
}
