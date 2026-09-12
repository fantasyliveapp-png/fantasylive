'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ConnectionState,
  RemoteTrack,
  Room,
  RoomEvent,
  Track,
  VideoPresets,
  createLocalTracks,
  type LocalTrack,
  type RemoteParticipant,
} from 'livekit-client';

/**
 * SALA DE UN DIRECTO
 *
 * Distinta de `use-video-room` (1 a 1) en tres cosas que importan:
 *
 *  - El espectador NUNCA publica. Su token ya lo prohibe en el servidor, pero
 *    tampoco se le pide la camara: pedir permisos para ver un directo seria
 *    absurdo y espantaria a la mitad de la audiencia.
 *
 *  - El emisor puede no publicar tampoco: cuando emite por OBS el video entra
 *    por el ingress como otro participante, asi que su propia pestana se
 *    comporta como un espectador mas de su directo.
 *
 *  - El chat va por el canal de datos de la sala (publishData), no por la base
 *    de datos: son mensajes efimeros de una sala en vivo, no un historial.
 */

export type LiveStatus =
  | 'idle'
  | 'connecting'
  | 'waiting-video'
  | 'playing'
  | 'ended'
  | 'error';

export interface LiveChatMessage {
  id: string;
  from: string;
  body: string;
  at: number;
  isMine: boolean;
}

interface UseLiveRoomOptions {
  token: string | null;
  url: string;
  /** true en la pestana de la creadora cuando emite con su camara. */
  publishCamera: boolean;
  /** Nombre visible en el chat. */
  displayName: string;
  /** Se llama la primera vez que hay video en la sala. */
  onVideoStarted?: () => void;
}

const MAX_CHAT_MESSAGES = 200;

export function useLiveRoom({
  token,
  url,
  publishCamera,
  displayName,
  onVideoStarted,
}: UseLiveRoomOptions) {
  const [status, setStatus] = useState<LiveStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<LiveChatMessage[]>([]);
  const [participantCount, setParticipantCount] = useState(0);
  const [isMicEnabled, setMicEnabled] = useState(true);
  const [isCameraEnabled, setCameraEnabled] = useState(true);

  const roomRef = useRef<Room | null>(null);
  const localTracksRef = useRef<LocalTrack[]>([]);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const videoStartedRef = useRef(false);
  // El callback se guarda en una ref para que cambiarlo no reconecte la sala.
  const onVideoStartedRef = useRef(onVideoStarted);
  onVideoStartedRef.current = onVideoStarted;

  const cleanup = useCallback(() => {
    localTracksRef.current.forEach((track) => {
      track.stop();
      track.detach().forEach((el) => el.remove());
    });
    localTracksRef.current = [];

    if (roomRef.current) {
      roomRef.current.disconnect();
      roomRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
    videoStartedRef.current = false;
  }, []);

  const connect = useCallback(async () => {
    cleanup();
    setError(null);

    if (!token || !url) {
      setStatus('error');
      setError('El servidor de video no esta configurado.');
      return;
    }

    setStatus('connecting');

    try {
      const room = new Room({
        adaptiveStream: true,
        dynacast: true,
        disconnectOnPageLeave: true,
        publishDefaults: {
          simulcast: true,
          videoSimulcastLayers: [VideoPresets.h180, VideoPresets.h360],
          videoEncoding: VideoPresets.h720.encoding,
          dtx: true,
          red: true,
        },
      });
      roomRef.current = room;

      const refreshCount = () =>
        setParticipantCount(room.remoteParticipants.size);

      room
        .on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
          if (track.kind === Track.Kind.Video && videoRef.current) {
            track.attach(videoRef.current);
            setStatus('playing');
            if (!videoStartedRef.current) {
              videoStartedRef.current = true;
              onVideoStartedRef.current?.();
            }
          }
          if (track.kind === Track.Kind.Audio && audioRef.current) {
            track.attach(audioRef.current);
          }
        })
        .on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
          track.detach().forEach((el) => el.remove());
          // Si quien se va era la emision, se vuelve a "esperando video" en
          // lugar de dejar el ultimo fotograma congelado en pantalla.
          if (track.kind === Track.Kind.Video) setStatus('waiting-video');
        })
        .on(RoomEvent.ParticipantConnected, refreshCount)
        .on(RoomEvent.ParticipantDisconnected, refreshCount)
        .on(RoomEvent.Disconnected, () => setStatus('ended'))
        .on(RoomEvent.ConnectionStateChanged, (state: ConnectionState) => {
          if (state === ConnectionState.Reconnecting) setStatus('connecting');
        })
        .on(
          RoomEvent.DataReceived,
          (payload: Uint8Array, participant?: RemoteParticipant) => {
            try {
              const parsed = JSON.parse(new TextDecoder().decode(payload)) as {
                type?: string;
                body?: string;
                from?: string;
              };
              if (parsed.type !== 'chat' || !parsed.body) return;

              setMessages((prev) =>
                [
                  ...prev,
                  {
                    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
                    from: parsed.from || participant?.name || 'Invitado',
                    body: parsed.body!,
                    at: Date.now(),
                    isMine: false,
                  },
                ].slice(-MAX_CHAT_MESSAGES),
              );
            } catch {
              // Un paquete de datos que no es nuestro chat se ignora.
            }
          },
        );

      await room.connect(url, token, {
        autoSubscribe: true,
        websocketTimeout: 15_000,
        peerConnectionTimeout: 20_000,
        maxRetries: 2,
      });

      refreshCount();

      if (publishCamera) {
        const tracks = await createLocalTracks({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
          video: { resolution: VideoPresets.h720.resolution },
        });
        localTracksRef.current = tracks;

        const videoTrack = tracks.find((t) => t.kind === Track.Kind.Video);
        if (videoTrack && videoRef.current) videoTrack.attach(videoRef.current);

        for (const track of tracks) {
          await room.localParticipant.publishTrack(track);
        }

        setStatus('playing');
        if (!videoStartedRef.current) {
          videoStartedRef.current = true;
          onVideoStartedRef.current?.();
        }
      } else {
        // Puede haber emision ya en curso: si hay pista de video se engancha
        // por TrackSubscribed; si no, se queda esperando (caso OBS sin abrir).
        setStatus((prev) => (prev === 'playing' ? prev : 'waiting-video'));
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'No se pudo conectar al directo';
      setError(
        message.includes('Permission') || message.includes('NotAllowed')
          ? 'Necesitas dar permiso de camara y microfono para emitir.'
          : message,
      );
      setStatus('error');
      cleanup();
    }
  }, [cleanup, publishCamera, token, url]);

  /** Envia un mensaje al chat de la sala. */
  const sendChat = useCallback(
    async (body: string) => {
      const text = body.trim();
      if (!text || !roomRef.current) return;

      const payload = new TextEncoder().encode(
        JSON.stringify({ type: 'chat', body: text, from: displayName }),
      );
      // reliable: el chat de un directo puede perder un mensaje sin drama,
      // pero perderlo justo cuando alguien pregunta algo se nota, asi que se
      // manda por el canal fiable.
      await roomRef.current.localParticipant.publishData(payload, {
        reliable: true,
      });

      setMessages((prev) =>
        [
          ...prev,
          {
            id: `${Date.now()}-me`,
            from: displayName,
            body: text,
            at: Date.now(),
            isMine: true,
          },
        ].slice(-MAX_CHAT_MESSAGES),
      );
    },
    [displayName],
  );

  const toggleMic = useCallback(async () => {
    const next = !isMicEnabled;
    setMicEnabled(next);
    const track = localTracksRef.current.find(
      (t) => t.kind === Track.Kind.Audio,
    );
    if (track) await (next ? track.unmute() : track.mute());
  }, [isMicEnabled]);

  const toggleCamera = useCallback(async () => {
    const next = !isCameraEnabled;
    setCameraEnabled(next);
    const track = localTracksRef.current.find(
      (t) => t.kind === Track.Kind.Video,
    );
    if (track) await (next ? track.unmute() : track.mute());
  }, [isCameraEnabled]);

  const disconnect = useCallback(() => {
    cleanup();
    setStatus('ended');
  }, [cleanup]);

  useEffect(() => {
    if (token && url && status === 'idle') void connect();
    return () => cleanup();
    // Solo al montar o al cambiar de sala.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, url]);

  return {
    status,
    error,
    messages,
    participantCount,
    isMicEnabled,
    isCameraEnabled,
    videoRef,
    audioRef,
    connect,
    disconnect,
    sendChat,
    toggleMic,
    toggleCamera,
  };
}
