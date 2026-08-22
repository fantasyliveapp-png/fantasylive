'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Coins,
  Crown,
  Loader2,
  Radar,
  Shuffle,
  Users,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import type { Gender } from '@prisma/client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { GENDER_LABELS } from '@/lib/constants';
import {
  joinQueueAction,
  leaveQueueAction,
  pollQueueAction,
} from '@/server/actions/calls';
import { formatDuration, formatTokens } from '@/lib/utils';

interface MatchmakingLobbyProps {
  mode: 'RANDOM' | 'VIP';
  balance: number;
  stats: {
    waiting: number;
    onlineModels: number;
    vipModels: number;
  };
  /** Tarifa mas barata disponible ahora mismo (solo modo VIP) */
  minRate?: number;
}

export function MatchmakingLobby({
  mode,
  balance,
  stats,
  minRate = 0,
}: MatchmakingLobbyProps) {
  const router = useRouter();

  const [isSearching, setIsSearching] = useState(false);
  const [entryId, setEntryId] = useState<string | null>(null);
  const [waitSeconds, setWaitSeconds] = useState(0);
  const [genderPrefs, setGenderPrefs] = useState<Gender[]>([]);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  const stopSearching = useCallback(
    async (cancelServerSide = true) => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (timerRef.current) clearInterval(timerRef.current);
      eventSourceRef.current?.close();
      pollRef.current = null;
      timerRef.current = null;
      eventSourceRef.current = null;

      if (cancelServerSide && entryId) {
        await leaveQueueAction(entryId);
      }

      setIsSearching(false);
      setEntryId(null);
      setWaitSeconds(0);
    },
    [entryId],
  );

  const onMatched = useCallback(
    (sessionId: string) => {
      void stopSearching(false);
      toast.success('Conectado! Abriendo la sala...');
      router.push(`/call/${sessionId}`);
    },
    [router, stopSearching],
  );

  /**
   * Escucha el estado de la cola por SSE, con polling de respaldo.
   * SSE evita martillear el servidor; el polling cubre navegadores o proxies
   * que corten el stream.
   */
  const listen = useCallback(
    (id: string) => {
      const source = new EventSource(`/api/matchmaking/stream?entryId=${id}`);
      eventSourceRef.current = source;

      source.addEventListener('matched', (event) => {
        const data = JSON.parse((event as MessageEvent).data);
        if (data.sessionId) onMatched(data.sessionId);
      });

      source.addEventListener('ended', () => {
        source.close();
        void stopSearching(false);
        toast.info('La busqueda ha terminado.');
      });

      source.addEventListener('reconnect', () => {
        source.close();
        // El navegador reabre solo; si no, el polling de respaldo sigue vivo
        listen(id);
      });

      source.onerror = () => {
        source.close();
        eventSourceRef.current = null;
      };

      // Respaldo cada 3 s
      pollRef.current = setInterval(async () => {
        const result = await pollQueueAction(id);
        if (!result.ok) return;
        const data = result.data as any;
        if (data?.status === 'matched' && data.sessionId) {
          onMatched(data.sessionId);
        }
      }, 3000);
    },
    [onMatched, stopSearching],
  );

  async function startSearching() {
    if (mode === 'VIP' && balance < minRate) {
      toast.error(`Necesitas al menos ${minRate} tokens para entrar en VIP.`);
      router.push('/wallet');
      return;
    }

    setIsSearching(true);
    setWaitSeconds(0);

    const result = await joinQueueAction({
      mode,
      genderPreference: genderPrefs,
    });

    if (!result.ok) {
      toast.error(result.error ?? 'No se pudo entrar en la cola');
      setIsSearching(false);
      return;
    }

    const data = result.data as any;

    if (data.status === 'matched' && data.sessionId) {
      onMatched(data.sessionId);
      return;
    }

    setEntryId(data.queueEntryId);
    listen(data.queueEntryId);

    timerRef.current = setInterval(() => {
      setWaitSeconds((s) => s + 1);
    }, 1000);
  }

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (timerRef.current) clearInterval(timerRef.current);
      eventSourceRef.current?.close();
    };
  }, []);

  const isVip = mode === 'VIP';

  return (
    <div className="mx-auto max-w-2xl">
      <Card className="overflow-hidden">
        <div
          className={
            isVip
              ? 'gradient-brand p-6 text-center text-white'
              : 'bg-muted/40 p-6 text-center'
          }
        >
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-white/15 backdrop-blur">
            {isVip ? (
              <Crown className="h-7 w-7" />
            ) : (
              <Shuffle className="h-7 w-7" />
            )}
          </div>
          <h1 className="text-2xl font-bold">
            {isVip ? 'Sala VIP' : 'Llamadas aleatorias'}
          </h1>
          <p className={`mt-2 text-sm ${isVip ? 'text-white/80' : 'text-muted-foreground'}`}>
            {isVip
              ? 'Conexion aleatoria exclusivamente con modelos VIP verificadas y en linea. Pagas por minuto.'
              : 'Conecta con gente nueva al azar. Gratis, sin limite de tiempo.'}
          </p>
        </div>

        <CardContent className="space-y-6 pt-6">
          {/* Estado en vivo */}
          <div className="grid grid-cols-3 gap-3 text-center">
            <StatBox
              icon={Users}
              value={stats.waiting}
              label="En cola"
            />
            <StatBox
              icon={Radar}
              value={isVip ? stats.vipModels : stats.onlineModels}
              label={isVip ? 'Modelos VIP' : 'En linea'}
            />
            <StatBox
              icon={Coins}
              value={formatTokens(balance)}
              label="Tu saldo"
            />
          </div>

          {/* Filtros */}
          {!isSearching && (
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Quiero hablar con
              </p>
              <div className="flex flex-wrap gap-1.5">
                {(Object.keys(GENDER_LABELS) as Gender[]).map((gender) => {
                  const active = genderPrefs.includes(gender);
                  return (
                    <button
                      key={gender}
                      type="button"
                      onClick={() =>
                        setGenderPrefs((prev) =>
                          prev.includes(gender)
                            ? prev.filter((g) => g !== gender)
                            : [...prev, gender],
                        )
                      }
                    >
                      <Badge
                        variant={active ? 'default' : 'muted'}
                        className="cursor-pointer hover:opacity-80"
                      >
                        {GENDER_LABELS[gender]}
                      </Badge>
                    </button>
                  );
                })}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Sin seleccion = cualquiera. Cuantos mas filtros, mas larga puede
                ser la espera.
              </p>
            </div>
          )}

          {/* Aviso de coste */}
          {isVip && (
            <div className="rounded-lg border border-token/30 bg-token/10 p-3">
              <p className="flex items-center gap-2 text-sm font-medium">
                <Coins className="h-4 w-4 text-token" />
                Desde {minRate} tokens/min
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                El cobro empieza al conectar y se detiene al instante cuando
                cuelgas o pasas a la siguiente. Con tu saldo actual tienes
                aproximadamente{' '}
                <strong>
                  {minRate > 0 ? Math.floor(balance / minRate) : '-'} minutos
                </strong>
                .
              </p>
            </div>
          )}

          {/* Accion */}
          {isSearching ? (
            <div className="space-y-4 text-center">
              <div className="relative mx-auto flex h-24 w-24 items-center justify-center">
                <span className="absolute inset-0 rounded-full border-2 border-primary/40 animate-pulse-ring" />
                <span
                  className="absolute inset-0 rounded-full border-2 border-primary/30 animate-pulse-ring"
                  style={{ animationDelay: '0.6s' }}
                />
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              </div>

              <div>
                <p className="font-medium">Buscando a alguien...</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Tiempo de espera: {formatDuration(waitSeconds)}
                </p>
              </div>

              <Button variant="outline" onClick={() => stopSearching()}>
                <X className="h-4 w-4" />
                Cancelar busqueda
              </Button>
            </div>
          ) : (
            <Button
              variant="brand"
              size="lg"
              className="w-full"
              onClick={startSearching}
            >
              {isVip ? <Crown className="h-5 w-5" /> : <Shuffle className="h-5 w-5" />}
              {isVip ? 'Buscar modelo VIP' : 'Empezar a buscar'}
            </Button>
          )}

          <p className="text-center text-xs text-muted-foreground">
            Al conectar aceptas las normas de convivencia. Cualquier conducta
            abusiva puede reportarse durante la llamada y conlleva expulsion.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function StatBox({
  icon: Icon,
  value,
  label,
}: {
  icon: typeof Users;
  value: string | number;
  label: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3">
      <Icon className="mx-auto h-4 w-4 text-muted-foreground" />
      <p className="mt-1.5 text-lg font-bold">{value}</p>
      <p className="text-[11px] text-muted-foreground">{label}</p>
    </div>
  );
}
