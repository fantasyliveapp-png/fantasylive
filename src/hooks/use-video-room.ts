'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ConnectionState,
  RemoteTrack,
  Room,
  RoomEvent,
  Track,
  createLocalTracks,
  type LocalTrack,
  type RemoteParticipant,
  type RemoteTrackPublication,
} from 'livekit-client';

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
    setError(null);
    setStatus('requesting-media');

    try {
      // 1. Camara y microfono locales (siempre, incluso en demo)
      const tracks = await createLocalTracks({
        audio: true,
        video: { resolution: { width: 1280, height: 720 } },
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
        adaptiveStream: true,
        dynacast: true,
        disconnectOnPageLeave: true,
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
        .on(RoomEvent.ConnectionStateChanged, (state: ConnectionState) => {
          if (state === ConnectionState.Connected) {
            setStatus((prev) =>
              prev === 'partner-joined' ? prev : 'connected',
            );
          }
          if (state === ConnectionState.Reconnecting) setStatus('connecting');
        });

      setStatus('connecting');
      await room.connect(url, token);

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
