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
  /** chat: lo escribe alguien de la sala. gift: lo anuncia el servidor. */
  kind: 'chat' | 'gift';
  from: string;
  body: string;
  at: number;
  isMine: boolean;
  /** Lo escribio la creadora del directo. */
  isHost: boolean;
  /** Foto de quien escribe o regala (firmada por el servidor), si tiene. */
  avatar?: string | null;
  /** Solo en regalos. */
  tokens?: number;
  emoji?: string;
}

interface UseLiveRoomOptions {
  token: string | null;
  url: string;
  /** true en la pestana de la creadora cuando emite con su camara. */
  publishCamera: boolean;
  /** Nombre visible en el chat. */
  displayName: string;
  /** Identidad de la creadora en la sala, para destacar sus mensajes. */
  hostIdentity?: string;
  /** Se llama la primera vez que hay video en la sala. */
  onVideoStarted?: () => void;
  /** Meta de tokens al entrar; luego llega por la sala. */
  initialGoal?: LiveGoal | null;
}

const MAX_CHAT_MESSAGES = 200;
const MAX_HEARTS = 24;
const HEART_LIFETIME_MS = 2_400;
/** Como mucho un "me gusta" por la red cada tanto, por mucho que se pulse. */
const LIKE_SEND_INTERVAL_MS = 300;

export interface LiveGoal {
  label: string;
  target: number;
  progress: number;
}

export interface LiveHeart {
  id: string;
  /** Desvio lateral en px, para que no suban todos en fila. */
  drift: number;
  color: string;
}

/** La foto viaja en los metadatos del token, que firma el servidor. */
function avatarFromMetadata(metadata: string | undefined): string | null {
  if (!metadata) return null;
  try {
    const parsed = JSON.parse(metadata) as { avatar?: unknown };
    return typeof parsed.avatar === 'string' && parsed.avatar ? parsed.avatar : null;
  } catch {
    return null;
  }
}

const HEART_COLORS = ['#fe2c55', '#ff6fa3', '#ffb86b', '#ff4d6d', '#c77dff'];

export function useLiveRoom({
  token,
  url,
  publishCamera,
  displayName,
  hostIdentity,
  onVideoStarted,
  initialGoal = null,
}: UseLiveRoomOptions) {
  const [status, setStatus] = useState<LiveStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<LiveChatMessage[]>([]);
  const [participantCount, setParticipantCount] = useState(0);
  const [isMicEnabled, setMicEnabled] = useState(true);
  const [isCameraEnabled, setCameraEnabled] = useState(true);
  const [giftTotals, setGiftTotals] = useState({ count: 0, tokens: 0 });
  const [hearts, setHearts] = useState<LiveHeart[]>([]);
  const [likeCount, setLikeCount] = useState(0);
  const [goal, setGoal] = useState<LiveGoal | null>(initialGoal);
  const lastLikeSentRef = useRef(0);

  const roomRef = useRef<Room | null>(null);
  const localTracksRef = useRef<LocalTrack[]>([]);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const videoStartedRef = useRef(false);
  // El callback se guarda en una ref para que cambiarlo no reconecte la sala.
  const onVideoStartedRef = useRef(onVideoStarted);
  onVideoStartedRef.current = onVideoStarted;
  const hostIdentityRef = useRef(hostIdentity);
  hostIdentityRef.current = hostIdentity;

  const pushMessage = useCallback((message: LiveChatMessage) => {
    setMessages((prev) => [...prev, message].slice(-MAX_CHAT_MESSAGES));
  }, []);

  const addHeart = useCallback(() => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const heart: LiveHeart = {
      id,
      drift: Math.round(Math.random() * 60 - 30),
      color: HEART_COLORS[Math.floor(Math.random() * HEART_COLORS.length)]!,
    };
    setHearts((prev) => [...prev, heart].slice(-MAX_HEARTS));
    setLikeCount((count) => count + 1);
    setTimeout(
      () => setHearts((prev) => prev.filter((h) => h.id !== id)),
      HEART_LIFETIME_MS,
    );
  }, []);

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

    // Solo la sala mas reciente puede tocar el estado: una anterior que se
    // esta cerrando (recarga, cambio de token, doble montaje de React) no
    // debe dejar la pantalla en "terminado" ni tumbar la conexion nueva.
    let room: Room | null = null;
    const isCurrent = () => room !== null && roomRef.current === room;

    try {
      room = new Room({
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

      const refreshCount = () => {
        if (isCurrent()) setParticipantCount(room!.remoteParticipants.size);
      };

      room
        .on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
          if (!isCurrent()) return;
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
          if (!isCurrent()) return;
          // Si quien se va era la emision, se vuelve a "esperando video" en
          // lugar de dejar el ultimo fotograma congelado en pantalla.
          if (track.kind === Track.Kind.Video) setStatus('waiting-video');
        })
        .on(RoomEvent.ParticipantConnected, refreshCount)
        .on(RoomEvent.ParticipantDisconnected, refreshCount)
        .on(RoomEvent.Disconnected, () => {
          if (isCurrent()) setStatus('ended');
        })
        .on(RoomEvent.ConnectionStateChanged, (state: ConnectionState) => {
          if (isCurrent() && state === ConnectionState.Reconnecting) {
            setStatus('connecting');
          }
        })
        .on(
          RoomEvent.DataReceived,
          (payload: Uint8Array, participant?: RemoteParticipant) => {
            if (!isCurrent()) return;
            let parsed: {
              type?: string;
              body?: string;
              from?: string;
              tokens?: number;
              emoji?: string;
              avatar?: string | null;
            };
            try {
              parsed = JSON.parse(new TextDecoder().decode(payload));
            } catch {
              // Un paquete de datos que no es nuestro chat se ignora.
              return;
            }

            // La meta solo la cambia el servidor (al cobrar o al editarla).
            if (parsed.type === 'goal') {
              if (participant) return;
              const next = (parsed as { goal?: LiveGoal | null }).goal ?? null;
              setGoal(next);
              return;
            }

            if (parsed.type === 'like') {
              addHeart();
              return;
            }

            const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

            // Los regalos solo valen si los manda el servidor (sin
            // participante): un espectador no puede inventarse uno.
            if (parsed.type === 'gift') {
              if (participant || typeof parsed.tokens !== 'number') return;
              const tokens = parsed.tokens;
              const emoji = parsed.emoji || '🎁';
              setGiftTotals((prev) => ({
                count: prev.count + 1,
                tokens: prev.tokens + tokens,
              }));
              pushMessage({
                id,
                kind: 'gift',
                from: parsed.from || 'Alguien',
                body: `${emoji} ${tokens} tokens`,
                at: Date.now(),
                isMine: false,
                isHost: false,
                tokens,
                emoji,
                avatar: typeof parsed.avatar === 'string' ? parsed.avatar : null,
              });
              return;
            }

            if (parsed.type !== 'chat' || !parsed.body) return;
            pushMessage({
              id,
              kind: 'chat',
              from: participant?.name || parsed.from || 'Invitado',
              body: parsed.body,
              at: Date.now(),
              isMine: false,
              isHost:
                Boolean(hostIdentityRef.current) &&
                participant?.identity === hostIdentityRef.current,
              avatar: avatarFromMetadata(participant?.metadata),
            });
          },
        );

      await room.connect(url, token, {
        autoSubscribe: true,
        websocketTimeout: 15_000,
        peerConnectionTimeout: 20_000,
        maxRetries: 2,
      });
      if (!isCurrent()) return;

      refreshCount();

      if (publishCamera) {
        const tracks = await createLocalTracks({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
          // En un movil en vertical se pide la camara en vertical: el
          // directo se ve a pantalla completa, como en TikTok.
          video: {
            facingMode: 'user',
            resolution: window.matchMedia('(orientation: portrait)').matches
              ? { width: 720, height: 1280, frameRate: 30 }
              : VideoPresets.h720.resolution,
          },
        });
        if (!isCurrent()) {
          tracks.forEach((track) => track.stop());
          return;
        }
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
      // El fallo de una sala ya sustituida no es asunto de la pantalla.
      if (room && !isCurrent()) return;
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
  }, [addHeart, cleanup, publishCamera, pushMessage, token, url]);

  /**
   * Envia un mensaje al chat de la sala. Devuelve false si no se pudo enviar,
   * para que quien llama conserve el texto en vez de perderlo en silencio.
   */
  const sendChat = useCallback(
    async (body: string): Promise<boolean> => {
      const text = body.trim();
      if (!text || !roomRef.current) return false;

      const payload = new TextEncoder().encode(
        JSON.stringify({ type: 'chat', body: text, from: displayName }),
      );
      try {
        // reliable: perder un mensaje justo cuando alguien pregunta algo se
        // nota, asi que se manda por el canal fiable.
        await roomRef.current.localParticipant.publishData(payload, {
          reliable: true,
        });
      } catch {
        return false;
      }

      pushMessage({
        id: `${Date.now()}-me`,
        kind: 'chat',
        from: displayName,
        body: text,
        at: Date.now(),
        isMine: true,
        isHost:
          Boolean(hostIdentityRef.current) &&
          roomRef.current?.localParticipant.identity === hostIdentityRef.current,
        avatar: avatarFromMetadata(roomRef.current?.localParticipant.metadata),
      });
      return true;
    },
    [displayName, pushMessage],
  );

  /** Corazon: se ve al instante y se reparte a la sala sin saturarla. */
  const sendLike = useCallback(() => {
    addHeart();
    const room = roomRef.current;
    const now = Date.now();
    if (!room || now - lastLikeSentRef.current < LIKE_SEND_INTERVAL_MS) return;
    lastLikeSentRef.current = now;
    void room.localParticipant
      .publishData(new TextEncoder().encode(JSON.stringify({ type: 'like' })), {
        reliable: false,
      })
      .catch(() => {
        // Un corazon perdido no importa.
      });
  }, [addHeart]);

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
    if (token && url) void connect();
    return () => cleanup();
    // Solo al montar o al cambiar de sala.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, url]);

  return {
    status,
    error,
    messages,
    giftTotals,
    hearts,
    likeCount,
    goal,
    setGoal,
    participantCount,
    isMicEnabled,
    isCameraEnabled,
    videoRef,
    audioRef,
    connect,
    disconnect,
    sendChat,
    sendLike,
    toggleMic,
    toggleCamera,
  };
}
