'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ConnectionQuality,
  ConnectionState,
  RemoteTrack,
  Room,
  RoomEvent,
  Track,
  VideoPresets,
  createLocalTracks,
  type LocalTrack,
  type Participant,
  type RemoteParticipant,
  type RemoteTrackPublication,
} from 'livekit-client';

/** Calidad de conexion normalizada para la interfaz. */
export type CallQuality = 'excellent' | 'good' | 'poor' | 'unknown';

function mapQuality(q: ConnectionQuality): CallQuality {
  if (q === ConnectionQuality.Excellent) return 'excellent';
  if (q === ConnectionQuality.Good) return 'good';
  if (q === ConnectionQuality.Poor) return 'poor';
  return 'unknown';
}

export type RoomStatus =
  | 'idle'
  | 'requesting-media'
  | 'connecting'
  | 'connected'
  | 'partner-joined'
  | 'partner-left'
  | 'disconnected'
  | 'error';

interface UseVideoRoomOptions {
  token: string | null;
  url: string;
  /** Modo demo: sin LiveKit configurado solo se muestra la camara local */
  demoMode: boolean;
  autoConnect?: boolean;
}

/**
 * Encapsula el ciclo de vida de la sala de video.
 *
 * Usa LiveKit como SFU (funciona sin servidor propio y es compatible con
 * Vercel). Si LiveKit no esta configurado entra en "modo demo": pide la camara
 * local y renderiza el propio video, de forma que toda la interfaz de llamada,
 * el temporizador y el cobro por minuto se pueden probar sin infraestructura.
 */
export function useVideoRoom({
  token,
  url,
  demoMode,
  autoConnect = true,
}: UseVideoRoomOptions) {
  const [status, setStatus] = useState<RoomStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [isMicEnabled, setMicEnabled] = useState(true);
  const [isCameraEnabled, setCameraEnabled] = useState(true);
  const [partnerIdentity, setPartnerIdentity] = useState<string | null>(null);
  const [quality, setQuality] = useState<CallQuality>('unknown');

  const roomRef = useRef<Room | null>(null);
  const localTracksRef = useRef<LocalTrack[]>([]);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);

  /** Libera camara, microfono y sala. */
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

    if (localVideoRef.current) localVideoRef.current.srcObject = null;
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
  }, []);

  const connect = useCallback(async () => {
    // Limpia cualquier intento anterior. Sin esto, "Reintentar" dejaba la
    // camara y la sala previas abiertas y la reconexion no llegaba a ocurrir.
    cleanup();
    setError(null);
    setStatus('requesting-media');

    try {
      // 1. Camara y microfono locales (siempre, incluso en demo).
      //    El procesado de audio se pide al navegador: sin cancelacion de eco
      //    la llamada acopla en cuanto alguien sube el volumen.
      const tracks = await createLocalTracks({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: {
          resolution: VideoPresets.h720.resolution,
        },
      });
      localTracksRef.current = tracks;

      const videoTrack = tracks.find((t) => t.kind === Track.Kind.Video);
      if (videoTrack && localVideoRef.current) {
        videoTrack.attach(localVideoRef.current);
      }

      // 2. Modo demo: sin SFU no hay participante remoto
      if (demoMode || !token || !url) {
        setStatus('connected');
        return;
      }

      // 3. Conexion real a LiveKit
      const room = new Room({
        // Ajusta la calidad recibida al tamano real del <video> y deja de
        // enviar capas que nadie mira.
        adaptiveStream: true,
        dynacast: true,
        disconnectOnPageLeave: true,
        videoCaptureDefaults: {
          resolution: VideoPresets.h720.resolution,
        },
        audioCaptureDefaults: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        publishDefaults: {
          // Simulcast: se publican tres calidades y el SFU sirve a cada quien
          // la que aguante su conexion, en vez de cortar el video al primer
          // bache de red.
          simulcast: true,
          videoSimulcastLayers: [VideoPresets.h180, VideoPresets.h360],
          videoEncoding: VideoPresets.h720.encoding,
          // DTX deja de transmitir en los silencios; RED manda el audio por
          // duplicado para que la voz siga entendiendose con perdida de
          // paquetes. Las dos cosas juntas mejoran mucho en redes moviles.
          dtx: true,
          red: true,
        },
      });
      roomRef.current = room;

      room
        .on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
          if (track.kind === Track.Kind.Video && remoteVideoRef.current) {
            track.attach(remoteVideoRef.current);
            setStatus('partner-joined');
          }
          if (track.kind === Track.Kind.Audio && remoteAudioRef.current) {
            track.attach(remoteAudioRef.current);
          }
        })
        .on(
          RoomEvent.TrackUnsubscribed,
          (track: RemoteTrack, _pub: RemoteTrackPublication) => {
            track.detach().forEach((el) => el.remove());
          },
        )
        .on(RoomEvent.ParticipantConnected, (p: RemoteParticipant) => {
          setPartnerIdentity(p.identity);
          setStatus('partner-joined');
        })
        .on(RoomEvent.ParticipantDisconnected, () => {
          setPartnerIdentity(null);
          setStatus('partner-left');
        })
        .on(RoomEvent.Disconnected, () => {
          setStatus('disconnected');
        })
        .on(
          RoomEvent.ConnectionQualityChanged,
          (q: ConnectionQuality, _p: Participant) => {
            setQuality(mapQuality(q));
          },
        )
        .on(RoomEvent.MediaDevicesError, (err: Error) => {
          setError(
            'No se pudo acceder a la camara o el microfono: ' + err.message,
          );
        })
        .on(RoomEvent.ConnectionStateChanged, (state: ConnectionState) => {
          if (state === ConnectionState.Connected) {
            setStatus((prev) =>
              prev === 'partner-joined' ? prev : 'connected',
            );
          }
          if (state === ConnectionState.Reconnecting) setStatus('connecting');
          if (state === ConnectionState.Disconnected) setStatus('disconnected');
        })
        .on(RoomEvent.Reconnected, () => {
          setStatus(
            roomRef.current && roomRef.current.remoteParticipants.size > 0
              ? 'partner-joined'
              : 'connected',
          );
        });

      setStatus('connecting');
      // Timeouts explicitos: sin ellos, si el WebSocket o el ICE no responden
      // la promesa no resuelve nunca y la pantalla se queda en "Conectando".
      await room.connect(url, token, {
        autoSubscribe: true,
        websocketTimeout: 15_000,
        peerConnectionTimeout: 20_000,
        maxRetries: 2,
      });

      for (const track of tracks) {
        await room.localParticipant.publishTrack(track);
      }

      // Alguien ya estaba dentro
      if (room.remoteParticipants.size > 0) {
        const [first] = [...room.remoteParticipants.values()];
        setPartnerIdentity(first?.identity ?? null);
        setStatus('partner-joined');
      } else {
        setStatus('connected');
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'No se pudo iniciar la camara';
      setError(
        message.includes('Permission') || message.includes('NotAllowed')
          ? 'Necesitas dar permiso de camara y microfono para poder conectar.'
          : message,
      );
      setStatus('error');
      cleanup();
    }
  }, [cleanup, demoMode, token, url]);

  /**
   * Vigilante de conexion.
   *
   * Si la camara no responde (otra pestana la tiene ocupada) o LiveKit no
   * contesta, la pantalla se quedaba en "Conectando..." sin salida. A los 30 s
   * se pasa a error, que ya ofrece el boton de reintentar.
   */
  useEffect(() => {
    if (status !== 'connecting' && status !== 'requesting-media') return;

    const timer = setTimeout(() => {
      setStatus((prev) =>
        prev === 'connecting' || prev === 'requesting-media' ? 'error' : prev,
      );
      setError(
        'La conexion esta tardando demasiado. Comprueba que ninguna otra ' +
          'pestana este usando la camara y vuelve a intentarlo.',
      );
    }, 30_000);

    return () => clearTimeout(timer);
  }, [status]);

  const toggleMic = useCallback(async () => {
    const next = !isMicEnabled;
    setMicEnabled(next);

    const audioTrack = localTracksRef.current.find(
      (t) => t.kind === Track.Kind.Audio,
    );
    if (audioTrack) {
      next ? await audioTrack.unmute() : await audioTrack.mute();
    }
  }, [isMicEnabled]);

  const toggleCamera = useCallback(async () => {
    const next = !isCameraEnabled;
    setCameraEnabled(next);

    const videoTrack = localTracksRef.current.find(
      (t) => t.kind === Track.Kind.Video,
    );
    if (videoTrack) {
      next ? await videoTrack.unmute() : await videoTrack.mute();
    }
  }, [isCameraEnabled]);

  const disconnect = useCallback(() => {
    cleanup();
    setStatus('disconnected');
  }, [cleanup]);

  useEffect(() => {
    if (autoConnect && status === 'idle') {
      void connect();
    }
    return () => {
      cleanup();
    };
    // Solo debe ejecutarse al montar / cambiar de sala
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, url]);

  return {
    status,
    error,
    quality,
    partnerIdentity,
    isMicEnabled,
    isCameraEnabled,
    localVideoRef,
    remoteVideoRef,
    remoteAudioRef,
    connect,
    disconnect,
    toggleMic,
    toggleCamera,
  };
}
