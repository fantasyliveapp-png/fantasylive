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
  type LocalAudioTrack,
  type LocalVideoTrack,
  type RemoteParticipant,
} from 'livekit-client';

import {
  EMPTY_LIVE_STATE,
  hasBlockedWord,
  type LivePaywall,
  type LivePollState,
  type LiveRoomState,
} from '@/lib/live-state';

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
  /**
   * chat: lo escribe alguien de la sala. gift / ticket: lo anuncia el
   * servidor (regalo cobrado, entrada comprada). system: aviso para ti.
   */
  kind: 'chat' | 'gift' | 'ticket' | 'system' | 'pack';
  /** Quien lo escribio (id de usuario): la creadora puede moderarle. */
  identity?: string;
  /** Regalo pedido desde el menu de propinas ("Baile"). */
  request?: string;
  /** Mensaje al que responde (quien lo escribio y un trozo del texto). */
  replyTo?: LiveReplyTo;
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
  /** Estado del directo al entrar (titulo, fijado, pausa...). */
  initialState?: LiveRoomState | null;
  initialPoll?: LivePollState | null;
  initialMyVote?: number | null;
  /** La creadora le habia silenciado antes de entrar. */
  initialMuted?: boolean;
  /** La creadora ha cambiado el acceso y ya no puede verlo. */
  onAccessLost?: (paywall: LivePaywall) => void;
  /** La creadora le ha sacado del directo. */
  onKicked?: () => void;
}

const MAX_CHAT_MESSAGES = 200;
const MAX_HEARTS = 24;
const HEART_LIFETIME_MS = 2_400;
/**
 * Los "me gusta" se agrupan: como mucho un mensaje por la red cada tanto,
 * con el numero de toques ("+7"), asi no se satura la sala ni se pierde
 * ninguno por el camino.
 */
const LIKE_SEND_INTERVAL_MS = 300;
/** Tope de toques que se aceptan en un solo mensaje (evita inflar el contador). */
const MAX_LIKES_PER_MESSAGE = 50;

export interface LiveReplyTo {
  from: string;
  body: string;
}

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
  initialState = null,
  initialPoll = null,
  initialMyVote = null,
  initialMuted = false,
  onAccessLost,
  onKicked,
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
  const [liveState, setLiveState] = useState<LiveRoomState>(initialState ?? EMPTY_LIVE_STATE);
  const [poll, setPoll] = useState<LivePollState | null>(initialPoll);
  const [myVote, setMyVote] = useState<number | null>(initialMyVote);
  const [muted, setMuted] = useState(initialMuted);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');
  const [noiseSuppression, setNoiseSuppressionState] = useState(true);
  const lastLikeSentRef = useRef(0);
  /** Toques aun sin enviar y el temporizador que los manda juntos. */
  const pendingLikesRef = useRef(0);
  const likeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // El filtro se lee desde el manejador de la sala sin reconectarla.
  const blockedWordsRef = useRef<string[]>(liveState.blockedWords);
  blockedWordsRef.current = liveState.blockedWords;
  const onAccessLostRef = useRef(onAccessLost);
  onAccessLostRef.current = onAccessLost;
  const onKickedRef = useRef(onKicked);
  onKickedRef.current = onKicked;

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

  /** Suma `count` me gusta al contador y lanza unos pocos corazones. */
  const addHeart = useCallback((count = 1) => {
    setLikeCount((c) => c + count);
    const shown = Math.min(count, 3);
    for (let i = 0; i < shown; i++) {
      const id = `${Date.now()}-${i}-${Math.random().toString(36).slice(2)}`;
      const heart: LiveHeart = {
        id,
        drift: Math.round(Math.random() * 60 - 30),
        color: HEART_COLORS[Math.floor(Math.random() * HEART_COLORS.length)]!,
      };
      setHearts((prev) => [...prev, heart].slice(-MAX_HEARTS));
      setTimeout(
        () => setHearts((prev) => prev.filter((h) => h.id !== id)),
        HEART_LIFETIME_MS,
      );
    }
  }, []);

  const cleanup = useCallback(() => {
    if (likeTimerRef.current) clearTimeout(likeTimerRef.current);
    likeTimerRef.current = null;
    pendingLikesRef.current = 0;
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
              /** "me gusta" agrupados en este mensaje. */
              n?: number;
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

            // Estado, encuestas y sanciones: solo valen si vienen del servidor.
            if (parsed.type === 'state') {
              if (participant) return;
              const patch = (parsed as { patch?: Partial<LiveRoomState> }).patch ?? {};
              setLiveState((prev) => ({ ...prev, ...patch }));
              return;
            }
            if (parsed.type === 'poll') {
              if (participant) return;
              const next = (parsed as { poll?: LivePollState | null }).poll ?? null;
              setPoll((prev) => {
                if (!next || prev?.id !== next.id) setMyVote(null);
                return next;
              });
              return;
            }
            if (parsed.type === 'sanction') {
              if (participant) return;
              const kind = (parsed as { kind?: string }).kind;
              if (kind === 'MUTE' || kind === 'UNMUTE') {
                setMuted(kind === 'MUTE');
                pushMessage({
                  id: `${Date.now()}-sys`,
                  kind: 'system',
                  from: '',
                  body:
                    kind === 'MUTE'
                      ? 'Te han silenciado en este directo.'
                      : 'Ya puedes volver a escribir.',
                  at: Date.now(),
                  isMine: false,
                  isHost: false,
                });
              }
              if (kind === 'KICK') onKickedRef.current?.();
              return;
            }
            if (parsed.type === 'access_lost') {
              if (participant) return;
              const paywall = (parsed as { paywall?: LivePaywall }).paywall;
              if (paywall) onAccessLostRef.current?.(paywall);
              return;
            }
            if (parsed.type === 'pack') {
              if (participant) return;
              pushMessage({
                id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
                kind: 'pack',
                from: parsed.from || 'Alguien',
                body: typeof (parsed as { label?: unknown }).label === 'string' ? (parsed as { label: string }).label : '',
                at: Date.now(),
                isMine: false,
                isHost: false,
                tokens: typeof parsed.tokens === 'number' ? parsed.tokens : undefined,
                avatar: typeof parsed.avatar === 'string' ? parsed.avatar : null,
              });
              return;
            }
            if (parsed.type === 'ticket') {
              if (participant) return;
              pushMessage({
                id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
                kind: 'ticket',
                from: parsed.from || 'Alguien',
                body: '',
                at: Date.now(),
                isMine: false,
                isHost: false,
                tokens: typeof parsed.tokens === 'number' ? parsed.tokens : undefined,
                avatar: typeof parsed.avatar === 'string' ? parsed.avatar : null,
              });
              return;
            }

            if (parsed.type === 'like') {
              const n = typeof parsed.n === 'number' && Number.isFinite(parsed.n) ? Math.floor(parsed.n) : 1;
              addHeart(Math.min(MAX_LIKES_PER_MESSAGE, Math.max(1, n)));
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
                request:
                  typeof (parsed as { request?: unknown }).request === 'string'
                    ? (parsed as { request: string }).request
                    : undefined,
              });
              return;
            }

            if (parsed.type !== 'chat' || !parsed.body) return;
            // Filtro de palabras de la creadora: se aplica en cada pantalla
            // que recibe, asi que nadie ve el mensaje aunque el emisor lo
            // mande saltandose el filtro de su navegador.
            if (hasBlockedWord(parsed.body, blockedWordsRef.current)) return;
            const reply = (parsed as { replyTo?: { from?: unknown; body?: unknown } }).replyTo;
            pushMessage({
              id,
              kind: 'chat',
              replyTo:
                reply && typeof reply.from === 'string' && typeof reply.body === 'string'
                  ? { from: reply.from.slice(0, 60), body: reply.body.slice(0, 80) }
                  : undefined,
              identity: participant?.identity,
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
  /** Por que no se puede mandar este texto (o null si se puede). */
  const chatBlockReason = useCallback(
    (body: string): string | null => {
      if (muted) return 'Estas silenciado en este directo.';
      if (hasBlockedWord(body, liveState.blockedWords)) {
        return 'Tu mensaje contiene una palabra que no está permitida en este directo.';
      }
      return null;
    },
    [muted, liveState.blockedWords],
  );

  const sendChat = useCallback(
    async (body: string, replyTo?: LiveReplyTo): Promise<boolean> => {
      const text = body.trim();
      if (!text || !roomRef.current) return false;
      if (chatBlockReason(text)) return false;
      const reply = replyTo ? { from: replyTo.from.slice(0, 60), body: replyTo.body.slice(0, 80) } : undefined;

      const payload = new TextEncoder().encode(
        JSON.stringify({ type: 'chat', body: text, from: displayName, ...(reply ? { replyTo: reply } : {}) }),
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
        replyTo: reply,
        at: Date.now(),
        isMine: true,
        isHost:
          Boolean(hostIdentityRef.current) &&
          roomRef.current?.localParticipant.identity === hostIdentityRef.current,
        avatar: avatarFromMetadata(roomRef.current?.localParticipant.metadata),
      });
      return true;
    },
    [chatBlockReason, displayName, pushMessage],
  );

  /** Manda de una vez los toques acumulados ("+n"). */
  const flushLikes = useCallback(() => {
    likeTimerRef.current = null;
    const n = pendingLikesRef.current;
    const room = roomRef.current;
    if (!n || !room) return;
    pendingLikesRef.current = 0;
    lastLikeSentRef.current = Date.now();
    void room.localParticipant
      .publishData(new TextEncoder().encode(JSON.stringify({ type: 'like', n })), {
        reliable: true,
      })
      .catch(() => {
        // Si falla el envio, se vuelven a intentar con el siguiente toque.
        pendingLikesRef.current += n;
      });
  }, []);

  /** Corazon: se ve al instante y se reparte a la sala sin perder ninguno. */
  const sendLike = useCallback(() => {
    addHeart();
    pendingLikesRef.current = Math.min(pendingLikesRef.current + 1, MAX_LIKES_PER_MESSAGE);
    if (likeTimerRef.current) return;
    const wait = Math.max(0, LIKE_SEND_INTERVAL_MS - (Date.now() - lastLikeSentRef.current));
    likeTimerRef.current = setTimeout(flushLikes, wait);
  }, [addHeart, flushLikes]);

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

  /** Camara frontal <-> trasera sin cortar la emision. */
  const flipCamera = useCallback(async () => {
    const track = localTracksRef.current.find((t) => t.kind === Track.Kind.Video) as
      | LocalVideoTrack
      | undefined;
    if (!track) return;
    const next = facingMode === 'user' ? 'environment' : 'user';
    await track.restartTrack({
      facingMode: next,
      resolution: window.matchMedia('(orientation: portrait)').matches
        ? { width: 720, height: 1280, frameRate: 30 }
        : VideoPresets.h720.resolution,
    });
    if (!isCameraEnabled) await track.mute();
    setFacingMode(next);
  }, [facingMode, isCameraEnabled]);

  /** Filtro de ruido de fondo del microfono (el del navegador). */
  const setNoiseSuppression = useCallback(
    async (on: boolean) => {
      const track = localTracksRef.current.find((t) => t.kind === Track.Kind.Audio) as
        | LocalAudioTrack
        | undefined;
      if (!track) return;
      await track.restartTrack({ noiseSuppression: on, echoCancellation: true, autoGainControl: true });
      if (!isMicEnabled) await track.mute();
      setNoiseSuppressionState(on);
    },
    [isMicEnabled],
  );

  /**
   * Pausa: se deja de enviar imagen y sonido sin salir de la sala, asi nadie
   * se va. Al volver se respeta si el micro o la camara estaban apagados.
   */
  const setMediaPaused = useCallback(
    async (paused: boolean) => {
      for (const track of localTracksRef.current) {
        const enabled = track.kind === Track.Kind.Audio ? isMicEnabled : isCameraEnabled;
        if (paused || !enabled) await track.mute();
        else await track.unmute();
      }
    },
    [isCameraEnabled, isMicEnabled],
  );

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
    liveState,
    setLiveState,
    poll,
    setPoll,
    myVote,
    setMyVote,
    muted,
    setMuted,
    facingMode,
    noiseSuppression,
    chatBlockReason,
    flipCamera,
    setNoiseSuppression,
    setMediaPaused,
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
