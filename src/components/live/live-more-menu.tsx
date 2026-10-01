'use client';

import { useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import {
  BarChart3,
  ChevronLeft,
  Coins,
  FlipHorizontal2,
  Gift,
  Loader2,
  Lock,
  Mic,
  MicOff,
  Package,
  Pause,
  PencilLine,
  Pin,
  Play,
  Plus,
  LayoutDashboard,
  Move,
  Reply,
  ShieldBan,
  SlidersHorizontal,
  Star,
  SwitchCamera,
  Trash2,
  UserX,
  Users,
  AudioLines,
  VolumeX,
  X,
  Volume2,
} from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import type { useLiveRoom } from '@/hooks/use-live-room';
import { LIVE_LIMITS, type LiveAccessModeValue, type LiveExclusiveInfo, type TipMenuItem } from '@/lib/live-state';
import { exclusiveSummary } from '@/components/live/live-extras';
import { cn, formatTokens, initials, relativeTime } from '@/lib/utils';
import {
  closeLivePollAction,
  createLivePollAction,
  getLiveGiftsAction,
  getLiveViewersAction,
  hideLivePollAction,
  sanctionViewerAction,
  setLiveAccessAction,
  setLiveBlockedWordsAction,
  setLiveTipMenuAction,
  setPinnedMessageAction,
  setStreamMirroredAction,
  setStreamPausedAction,
  getMyLiveExclusivesAction,
  setStreamTitleAction,
  setTipMenuOnScreenAction,
  setWidgetLayoutAction,
  type LiveGiftsData,
  type LiveViewerRow,
} from '@/server/actions/live-controls';

type Room = ReturnType<typeof useLiveRoom>;
type View = 'main' | 'gifts' | 'poll' | 'title' | 'pinned' | 'tipmenu' | 'access' | 'viewers' | 'words' | 'layout';

/** Panel lateral de control: entra por la derecha sobre el directo. */
const drawer =
  'absolute inset-y-0 right-0 z-30 flex w-[88%] max-w-sm flex-col animate-in slide-in-from-right overflow-hidden rounded-l-[26px] bg-gradient-to-b from-[#1c0a10] via-[#121114] to-[#0d0d0f] text-white shadow-[-20px_0_60px_rgb(0_0_0/0.55)] ring-1 ring-champagne-gold/15 duration-300';
const card = 'overflow-hidden rounded-2xl bg-white/[0.04] ring-1 ring-white/[0.06]';
const field = 'border-white/10 bg-white/5 text-white placeholder:text-white/40';

/**
 * PANEL DE CONTROL DE LA CREADORA EN SU DIRECTO
 *
 * Panel lateral con el estado del directo arriba y tarjetas por secciones:
 * emision (camara y audio), publico (encuesta, fijado, titulo, filtro),
 * ingresos (regalos, menu de propinas, acceso) y moderacion.
 */
export function LiveMoreMenu({
  streamId,
  browserSource,
  room,
  onClose,
}: {
  streamId: string;
  /** Emite con la camara del navegador (con OBS no hay camara que girar). */
  browserSource: boolean;
  room: Room;
  onClose: () => void;
}) {
  const [view, setView] = useState<View>('main');
  const [busy, startBusy] = useTransition();
  const s = room.liveState;

  function act(fn: () => Promise<{ ok: boolean; error?: string; message?: string }>, after?: () => void) {
    startBusy(async () => {
      const r = await fn();
      if (!r.ok) toast.error(r.error ?? 'No se pudo.');
      else {
        if (r.message) toast.success(r.message);
        after?.();
      }
    });
  }

  function togglePause() {
    const next = !s.paused;
    act(
      async () => {
        const r = await setStreamPausedAction(streamId, next);
        if (r.ok) await room.setMediaPaused(next);
        return r;
      },
      () => room.setLiveState((prev) => ({ ...prev, paused: next })),
    );
  }

  function toggleMirror() {
    const next = !s.mirrored;
    act(
      () => setStreamMirroredAction(streamId, next),
      () => room.setLiveState((prev) => ({ ...prev, mirrored: next })),
    );
  }

  const accessLabel =
    s.access.mode === 'PUBLIC' ? 'Abierto' : s.access.mode === 'SUBSCRIBERS' ? 'Suscriptores' : `${s.access.ticketTokens} tk`;
  const pollOpen = Boolean(room.poll && !room.poll.closed);
  const titles: Record<View, string> = {
    main: 'Control del directo',
    gifts: 'Regalos',
    poll: 'Encuesta',
    title: 'Titulo',
    pinned: 'Mensaje fijado',
    tipmenu: 'Especiales',
    access: 'Acceso',
    viewers: 'Espectadores',
    words: 'Filtro de palabras',
    layout: 'Colocar paneles',
  };

  return (
    <>
      <button type="button" aria-label="Cerrar" className="absolute inset-0 z-20 bg-black/45 backdrop-blur-[2px]" onClick={onClose} />
      <aside className={drawer}>
        {/* Cabecera */}
        <header className="flex items-center gap-2 border-b border-white/[0.06] px-4 pb-3 pt-[max(1rem,env(safe-area-inset-top))]">
          {view !== 'main' ? (
            <button type="button" onClick={() => setView('main')} aria-label="Volver" className="-ml-1 rounded-full p-1.5 text-white/70 hover:bg-white/10 hover:text-white">
              <ChevronLeft className="h-5 w-5" />
            </button>
          ) : (
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-fantazy-red to-champagne-gold">
              <SlidersHorizontal className="h-4 w-4 text-white" />
            </span>
          )}
          <p className="flex-1 font-heading text-lg uppercase tracking-wide">{titles[view]}</p>
          <button type="button" onClick={onClose} aria-label="Cerrar panel" className="rounded-full p-1.5 text-white/60 hover:bg-white/10 hover:text-white">
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4">
          {view === 'main' && (
            <div className="space-y-5">
              {/* Estado de un vistazo */}
              <div className="grid grid-cols-3 gap-2">
                <StatusChip label="Estado" value={s.paused ? 'En pausa' : 'Emitiendo'} tone={s.paused ? 'warn' : 'live'} />
                <StatusChip label="Acceso" value={accessLabel} tone={s.access.mode === 'PUBLIC' ? 'neutral' : 'gold'} />
                <StatusChip label="Regalos" value={`${formatTokens(room.giftTotals.tokens)} tk`} tone="gold" />
              </div>

              <Section title="Emision">
                <Tile icon={SwitchCamera} label="Girar camara" sub={room.facingMode === 'user' ? 'Frontal' : 'Trasera'} onClick={() => void room.flipCamera().catch(() => toast.error('No se pudo cambiar de camara.'))} disabled={!browserSource} />
                <Tile icon={FlipHorizontal2} label="Espejo" sub={s.mirrored ? 'Activado' : 'Desactivado'} active={s.mirrored} onClick={toggleMirror} disabled={busy} />
                <Tile icon={room.isMicEnabled ? Mic : MicOff} label="Microfono" sub={room.isMicEnabled ? 'Encendido' : 'Apagado'} active={!room.isMicEnabled} onClick={room.toggleMic} disabled={!browserSource} />
                <Tile icon={s.paused ? Play : Pause} label={s.paused ? 'Reanudar' : 'Pausar'} sub={s.paused ? 'Vuelve a emitir' : 'Vuelvo enseguida'} active={s.paused} onClick={togglePause} disabled={busy} />
                {browserSource && (
                  <Tile
                    icon={AudioLines}
                    label="Ruido de fondo"
                    sub={room.noiseSuppression ? 'Se elimina' : 'Sin filtrar'}
                    active={room.noiseSuppression}
                    onClick={() => void room.setNoiseSuppression(!room.noiseSuppression).catch(() => toast.error('No se pudo cambiar el filtro.'))}
                    wide
                  />
                )}
              </Section>

              <Section title="Publico">
                <Tile icon={BarChart3} label="Encuesta" sub={pollOpen ? 'En curso' : 'Lanzar una'} active={pollOpen} onClick={() => setView('poll')} />
                <Tile icon={Pin} label="Fijar mensaje" sub={s.pinned ? 'Activo' : 'Ninguno'} active={Boolean(s.pinned)} onClick={() => setView('pinned')} />
                <Tile icon={PencilLine} label="Titulo" sub={s.title ?? 'Sin titulo'} onClick={() => setView('title')} />
                <Tile icon={ShieldBan} label="Filtro" sub={s.blockedWords.length ? `${s.blockedWords.length} palabras` : 'Desactivado'} active={s.blockedWords.length > 0} onClick={() => setView('words')} />
              </Section>

              <Section title="Ingresos">
                <Tile icon={Gift} label="Regalos" sub="Top fans y lista" onClick={() => setView('gifts')} />
                <Tile
                  icon={Star}
                  label="Especiales"
                  sub={!s.tipMenu.length ? 'Vacio' : s.tipMenuOnScreen ? 'En pantalla' : `${s.tipMenu.length} acciones`}
                  active={s.tipMenuOnScreen && s.tipMenu.length > 0}
                  onClick={() => setView('tipmenu')}
                />
                <Tile icon={Lock} label="Acceso" sub={s.access.mode === 'PUBLIC' ? 'Todos' : s.access.mode === 'SUBSCRIBERS' ? 'Solo suscriptores' : `De pago · ${s.access.ticketTokens} tokens`} active={s.access.mode !== 'PUBLIC'} onClick={() => setView('access')} wide />
              </Section>

              <Section title="Moderacion">
                <Tile icon={Users} label="Espectadores" sub="Silenciar o expulsar" onClick={() => setView('viewers')} wide />
              </Section>

              <Section title="Pantalla">
                <Tile
                  icon={LayoutDashboard}
                  label="Colocar paneles"
                  sub={Object.keys(s.layout).length ? 'Posiciones propias' : 'Arrastra el asa dorada'}
                  active={Object.keys(s.layout).length > 0}
                  onClick={() => setView('layout')}
                  wide
                />
              </Section>
            </div>
          )}

        {view === 'gifts' && (
          <>
            <GiftsView streamId={streamId} />
          </>
        )}
        {view === 'poll' && (
          <>
            <PollView streamId={streamId} room={room} />
          </>
        )}
        {view === 'title' && (
          <>
            <TextView
              title="Titulo del LIVE"
              help="Lo ven en la portada y arriba del directo. Se cambia sin cortar."
              initial={s.title ?? ''}
              max={LIVE_LIMITS.titleMax}
              onSave={(text) =>
                act(
                  () => setStreamTitleAction(streamId, text),
                  () => room.setLiveState((prev) => ({ ...prev, title: text.trim() || null })),
                )
              }
              busy={busy}
            />
          </>
        )}
        {view === 'pinned' && (
          <>
            <TextView
              title="Mensaje fijado"
              help="Queda fijo encima del chat: normas, tu menu, de que va el directo..."
              initial={s.pinned ?? ''}
              max={LIVE_LIMITS.pinnedMax}
              multiline
              onSave={(text) =>
                act(
                  () => setPinnedMessageAction(streamId, text),
                  () => room.setLiveState((prev) => ({ ...prev, pinned: text.trim() || null })),
                )
              }
              onClear={
                s.pinned
                  ? () =>
                      act(
                        () => setPinnedMessageAction(streamId, null),
                        () => room.setLiveState((prev) => ({ ...prev, pinned: null })),
                      )
                  : undefined
              }
              busy={busy}
            />
          </>
        )}
        {view === 'tipmenu' && (
          <>
            <TipMenuEditor
              initial={s.tipMenu}
              busy={busy}
              onScreen={s.tipMenuOnScreen}
              onToggleScreen={(on) =>
                act(
                  () => setTipMenuOnScreenAction(streamId, on),
                  () => room.setLiveState((prev) => ({ ...prev, tipMenuOnScreen: on })),
                )
              }
              onSave={(items) =>
                act(
                  () => setLiveTipMenuAction(items),
                  () => room.setLiveState((prev) => ({ ...prev, tipMenu: items })),
                )
              }
            />
          </>
        )}
        {view === 'access' && (
          <>
            <AccessView
              current={s.access}
              busy={busy}
              onSave={(mode, ticketTokens, freeForSubscribers) =>
                act(
                  () => setLiveAccessAction(streamId, { mode, ticketTokens, freeForSubscribers }),
                  () =>
                    room.setLiveState((prev) => ({
                      ...prev,
                      access: { mode, ticketTokens: mode === 'PAID' ? ticketTokens : null, freeForSubscribers },
                    })),
                )
              }
            />
          </>
        )}
        {view === 'layout' && (
          <div className="space-y-3 text-sm">
            <p className="text-white/75">
              Puedes mover la <b>meta</b>, la <b>encuesta</b>, el <b>mensaje fijado</b> y tus <b>Especiales</b> a cualquier sitio de la pantalla:
              cierra este panel y arrastralos desde el asa dorada <Move className="inline h-3.5 w-3.5 text-champagne-gold" /> de
              su esquina.
            </p>
            <p className="text-white/55">Tus fans los ven exactamente donde los dejes, en cualquier pantalla.</p>
            <Button
              variant="outline"
              className="w-full"
              disabled={busy || Object.keys(s.layout).length === 0}
              onClick={() =>
                act(
                  async () => {
                    const r = await setWidgetLayoutAction(streamId, null);
                    return { ...r, message: r.ok ? 'Paneles en su sitio de siempre.' : undefined };
                  },
                  () => room.setLiveState((prev) => ({ ...prev, layout: {} })),
                )
              }
            >
              Devolver los paneles a su sitio
            </Button>
          </div>
        )}
        {view === 'viewers' && (
          <>
            <ViewersView streamId={streamId} />
          </>
        )}
        {view === 'words' && (
          <>
            <WordsView
              initial={s.blockedWords}
              busy={busy}
              onSave={(words) =>
                act(
                  () => setLiveBlockedWordsAction(words),
                  () => room.setLiveState((prev) => ({ ...prev, blockedWords: words })),
                )
              }
            />
          </>
        )}
        </div>
      </aside>
    </>
  );
}

/** Acciones rapidas sobre un espectador (al tocar su nombre en el chat). */
export function ViewerActionsSheet({
  streamId,
  author,
  onClose,
  onReply,
}: {
  streamId: string;
  author: { identity: string; name: string };
  onClose: () => void;
  /** Responderle en el chat. */
  onReply?: (name: string) => void;
}) {
  const [busy, start] = useTransition();
  function run(action: 'MUTE' | 'KICK') {
    if (action === 'KICK' && !window.confirm(`¿Expulsar a ${author.name}? No podra volver a este directo.`)) return;
    start(async () => {
      const r = await sanctionViewerAction(streamId, author.identity, action);
      if (r.ok) {
        toast.success(r.message ?? 'Hecho');
        onClose();
      } else toast.error(r.error ?? 'No se pudo.');
    });
  }
  return (
    <>
      <button type="button" aria-label="Cerrar" className="absolute inset-0 z-20 bg-black/45 backdrop-blur-[2px]" onClick={onClose} />
      <div className="absolute left-1/2 top-1/2 z-30 w-[min(20rem,calc(100%-2rem))] -translate-x-1/2 -translate-y-1/2 animate-in zoom-in-95 fade-in rounded-3xl bg-gradient-to-b from-[#1c0a10] to-[#111] p-5 text-white shadow-2xl ring-1 ring-champagne-gold/20 duration-200">
        <div className="mb-4 flex items-center gap-3">
          <Avatar className="h-11 w-11 ring-2 ring-champagne-gold/40">
            <AvatarFallback>{initials(author.name)}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="truncate font-semibold">{author.name}</p>
            <p className="text-xs text-white/55">¿Que hacemos con este fan?</p>
          </div>
        </div>
        <div className="space-y-2">
          {onReply && (
            <button
              type="button"
              onClick={() => onReply(author.name)}
              className="flex w-full items-center gap-3 rounded-2xl bg-white/[0.06] px-4 py-3 text-left text-sm ring-1 ring-white/[0.06] transition hover:bg-white/10"
            >
              <Reply className="h-4 w-4 text-champagne-gold" />
              <span className="flex-1">Responder en el chat</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => run('MUTE')}
            disabled={busy}
            className="flex w-full items-center gap-3 rounded-2xl bg-white/[0.06] px-4 py-3 text-left text-sm ring-1 ring-white/[0.06] transition hover:bg-white/10 disabled:opacity-50"
          >
            <VolumeX className="h-4 w-4 text-champagne-gold" />
            <span className="flex-1">Silenciar en este directo</span>
          </button>
          <button
            type="button"
            onClick={() => run('KICK')}
            disabled={busy}
            className="flex w-full items-center gap-3 rounded-2xl bg-fantazy-red/15 px-4 py-3 text-left text-sm text-[#ff8a9a] ring-1 ring-fantazy-red/30 transition hover:bg-fantazy-red/25 disabled:opacity-50"
          >
            <UserX className="h-4 w-4" />
            <span className="flex-1">Expulsar del directo</span>
          </button>
          <button type="button" onClick={onClose} className="w-full pt-1 text-center text-xs text-white/50 hover:text-white">
            Cancelar
          </button>
        </div>
      </div>
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <p className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-champagne-gold/80">
        {title}
        <span className="h-px flex-1 bg-gradient-to-r from-champagne-gold/30 to-transparent" />
      </p>
      <div className="grid grid-cols-2 gap-2">{children}</div>
    </section>
  );
}

/** Tarjeta de una opcion: icono, nombre y su estado actual. */
function Tile({
  icon: Icon,
  label,
  sub,
  active,
  disabled,
  wide,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  sub?: string;
  active?: boolean;
  disabled?: boolean;
  /** Ocupa las dos columnas. */
  wide?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'group flex min-w-0 items-center gap-3 rounded-2xl p-3 text-left ring-1 transition active:scale-[0.98] disabled:opacity-35',
        wide && 'col-span-2',
        active
          ? 'bg-gradient-to-br from-champagne-gold/20 to-fantazy-red/10 ring-champagne-gold/50'
          : 'bg-white/[0.04] ring-white/[0.06] hover:bg-white/[0.07] hover:ring-white/15',
      )}
    >
      <span
        className={cn(
          'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition',
          active ? 'bg-champagne-gold text-black' : 'bg-white/[0.07] text-champagne-gold group-hover:bg-white/10',
        )}
      >
        <Icon className="h-[18px] w-[18px]" />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[13px] font-semibold leading-tight">{label}</span>
        {sub && <span className="block truncate text-[11px] text-white/50">{sub}</span>}
      </span>
    </button>
  );
}

function StatusChip({ label, value, tone }: { label: string; value: string; tone: 'live' | 'warn' | 'gold' | 'neutral' }) {
  return (
    <div className="rounded-2xl bg-white/[0.04] px-2.5 py-2 ring-1 ring-white/[0.06]">
      <p className="text-[9px] font-semibold uppercase tracking-[0.15em] text-white/40">{label}</p>
      <p
        className={cn(
          'mt-0.5 flex items-center gap-1.5 truncate text-[12px] font-bold',
          tone === 'live' && 'text-state-connected',
          tone === 'warn' && 'text-amber-400',
          tone === 'gold' && 'text-champagne-gold',
          tone === 'neutral' && 'text-white/85',
        )}
      >
        {tone === 'live' && <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-state-connected" />}
        {value}
      </p>
    </div>
  );
}


function GiftsView({ streamId }: { streamId: string }) {
  const [data, setData] = useState<LiveGiftsData | null>(null);
  useEffect(() => {
    void getLiveGiftsAction(streamId).then((r) => {
      if (r.ok && r.data) setData(r.data);
      else toast.error(r.error ?? 'No se pudieron cargar.');
    });
  }, [streamId]);
  if (!data) return <Loader2 className="mx-auto my-8 h-5 w-5 animate-spin text-white/60" />;
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold">Total del directo</p>
        <span className="flex items-center gap-1 font-semibold text-champagne-gold">
          <Coins className="h-4 w-4" /> {formatTokens(data.totalTokens)}
        </span>
      </div>
      {data.topFans.length > 0 && (
        <ol className="space-y-1.5">
          {data.topFans.map((fan, i) => (
            <li key={fan.userId} className="flex items-center gap-3 rounded-2xl bg-white/5 px-3 py-2">
              <span className="w-5 text-center">{['🥇', '🥈', '🥉'][i] ?? i + 1}</span>
              <Avatar className="h-8 w-8">
                <AvatarImage src={fan.avatar ?? undefined} />
                <AvatarFallback>{initials(fan.name)}</AvatarFallback>
              </Avatar>
              <span className="min-w-0 flex-1 truncate text-sm font-semibold">{fan.name}</span>
              <span className="text-sm font-bold text-champagne-gold">{formatTokens(fan.tokens)}</span>
            </li>
          ))}
        </ol>
      )}
      {data.gifts.length === 0 ? (
        <p className="py-4 text-center text-sm text-white/60">Aun no hay regalos en este directo.</p>
      ) : (
        <ul className={cn(card, 'divide-y divide-white/[0.06]')}>
          {data.gifts.map((g) => (
            <li key={g.id} className="flex items-center gap-3 px-3 py-2 text-sm">
              <span className="text-xl">{g.emoji ?? '🎁'}</span>
              <span className="min-w-0 flex-1">
                <span className="font-semibold">{g.from}</span>
                {g.request && <span className="block truncate text-xs text-white/60">Pidio: {g.request}</span>}
              </span>
              <span className="text-right">
                <span className="block font-semibold text-champagne-gold">{g.tokens}</span>
                <span className="text-[10px] text-white/45">{relativeTime(g.at)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PollView({ streamId, room }: { streamId: string; room: Room }) {
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [busy, start] = useTransition();
  const open = room.poll && !room.poll.closed ? room.poll : null;

  function launch() {
    start(async () => {
      const r = await createLivePollAction(streamId, { question, options });
      if (r.ok && r.data) {
        room.setPoll(r.data);
        setQuestion('');
        setOptions(['', '']);
        toast.success('Encuesta lanzada.');
      } else toast.error(r.error ?? 'No se pudo.');
    });
  }

  return (
    <div className="space-y-3">
      {open ? (
        <div className="space-y-2">
          <p className="text-sm text-white/70">Hay una encuesta en curso. Los resultados se actualizan en vivo.</p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              className="flex-1"
              disabled={busy}
              onClick={() =>
                start(async () => {
                  const r = await closeLivePollAction(streamId, open.id);
                  if (r.ok && r.data) room.setPoll(r.data);
                })
              }
            >
              Cerrar votacion
            </Button>
            <Button
              variant="outline"
              className="flex-1"
              disabled={busy}
              onClick={() =>
                start(async () => {
                  const r = await hideLivePollAction(streamId);
                  if (r.ok) room.setPoll(null);
                })
              }
            >
              Quitar de pantalla
            </Button>
          </div>
        </div>
      ) : (
        <>
          <Input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="¿Que hago ahora?" maxLength={LIVE_LIMITS.pollTextMax} className={field} />
          {options.map((opt, i) => (
            <div key={i} className="flex gap-2">
              <Input
                value={opt}
                onChange={(e) => setOptions((prev) => prev.map((o, j) => (j === i ? e.target.value : o)))}
                placeholder={`Opcion ${i + 1}`}
                maxLength={LIVE_LIMITS.pollTextMax}
                className={field}
              />
              {options.length > LIVE_LIMITS.pollOptionsMin && (
                <Button variant="ghost" size="icon" onClick={() => setOptions((prev) => prev.filter((_, j) => j !== i))} aria-label="Quitar opcion">
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
          ))}
          {options.length < LIVE_LIMITS.pollOptionsMax && (
            <button type="button" onClick={() => setOptions((prev) => [...prev, ''])} className="flex items-center gap-1 text-sm text-champagne-gold">
              <Plus className="h-4 w-4" /> Añadir opcion
            </button>
          )}
          <Button variant="brand" className="w-full" onClick={launch} disabled={busy || !question.trim() || options.filter((o) => o.trim()).length < 2}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />} Lanzar encuesta
          </Button>
          {room.poll?.closed && (
            <button type="button" className="w-full text-center text-xs text-white/60 hover:text-white" onClick={() => void hideLivePollAction(streamId).then(() => room.setPoll(null))}>
              Quitar los resultados de la ultima encuesta
            </button>
          )}
        </>
      )}
    </div>
  );
}

function TextView({
  title,
  help,
  initial,
  max,
  multiline,
  onSave,
  onClear,
  busy,
}: {
  title: string;
  help: string;
  initial: string;
  max: number;
  multiline?: boolean;
  onSave: (text: string) => void;
  onClear?: () => void;
  busy: boolean;
}) {
  const [text, setText] = useState(initial);
  return (
    <div className="space-y-3">
      <p className="text-xs text-white/60">{help}</p>
      {multiline ? (
        <textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={max} rows={3} className={cn('w-full resize-none rounded-md border p-2 text-sm', field)} />
      ) : (
        <Input value={text} onChange={(e) => setText(e.target.value)} maxLength={max} className={field} />
      )}
      <div className="flex gap-2">
        {onClear && (
          <Button variant="outline" className="flex-1" onClick={onClear} disabled={busy}>
            Quitar
          </Button>
        )}
        <Button variant="brand" className="flex-1" onClick={() => onSave(text)} disabled={busy || text.trim() === initial.trim()}>
          {busy && <Loader2 className="h-4 w-4 animate-spin" />} Guardar
        </Button>
      </div>
    </div>
  );
}

function TipMenuEditor({
  initial,
  busy,
  onSave,
  onScreen,
  onToggleScreen,
}: {
  initial: TipMenuItem[];
  busy: boolean;
  onSave: (items: TipMenuItem[]) => void;
  /** Se ve como panel sobre el directo. */
  onScreen: boolean;
  onToggleScreen: (on: boolean) => void;
}) {
  const [items, setItems] = useState<{ id: string; label: string; tokens: string; postId?: string }[]>(
    initial.length
      ? initial.map((i) => ({ ...i, tokens: String(i.tokens) }))
      : [{ id: crypto.randomUUID(), label: '', tokens: '' }],
  );
  // Selector de contenido exclusivo (sus publicaciones "Exclusivo para directos").
  const [picker, setPicker] = useState<LiveExclusiveInfo[] | null>(null);
  const [loadingPicker, setLoadingPicker] = useState(false);
  const valid = items.filter((i) => i.label.trim() && Number(i.tokens) > 0);
  const inMenu = new Set(items.map((i) => i.postId).filter(Boolean));

  async function openPicker() {
    setLoadingPicker(true);
    const r = await getMyLiveExclusivesAction();
    setLoadingPicker(false);
    if (r.ok && r.data) setPicker(r.data);
    else toast.error(r.error ?? 'No se pudo cargar tu contenido.');
  }

  function addExclusive(info: LiveExclusiveInfo) {
    setItems((prev) => [
      // Si solo habia una fila vacia, se sustituye.
      ...prev.filter((i) => i.label.trim() || i.tokens),
      { id: crypto.randomUUID(), label: info.label, tokens: String(info.priceTokens), postId: info.postId },
    ]);
    setPicker(null);
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-white/60">
        Acciones y contenido con precio que tus fans piden con un toque. Se guarda para todos tus directos.
      </p>
      <button
        type="button"
        onClick={() => onToggleScreen(!onScreen)}
        disabled={busy || initial.length === 0}
        className={cn(
          'flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left ring-1 transition disabled:opacity-40',
          onScreen ? 'bg-champagne-gold/15 ring-champagne-gold/50' : 'bg-white/[0.04] ring-white/[0.06] hover:bg-white/[0.07]',
        )}
      >
        <LayoutDashboard className={cn('h-5 w-5', onScreen ? 'text-champagne-gold' : 'text-white/70')} />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">Mostrar en pantalla</span>
          <span className="block text-[11px] text-white/55">
            {initial.length === 0
              ? 'Guarda antes alguna accion'
              : onScreen
                ? 'Visible: muevelo con el asa dorada'
                : 'Tus fans lo veran como un panel sobre tu directo'}
          </span>
        </span>
        <span className={cn('relative h-6 w-11 shrink-0 rounded-full transition', onScreen ? 'bg-state-connected' : 'bg-white/20')}>
          <span className={cn('absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all', onScreen ? 'left-[22px]' : 'left-0.5')} />
        </span>
      </button>

      {items.map((item, i) => (
        <div key={item.id} className="flex items-center gap-2">
          {item.postId && (
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-champagne-gold/15" title="Contenido exclusivo">
              <Package className="h-4 w-4 text-champagne-gold" />
            </span>
          )}
          <Input
            value={item.label}
            onChange={(e) => setItems((prev) => prev.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
            placeholder="Saludo con tu nombre"
            maxLength={LIVE_LIMITS.tipLabelMax}
            className={field}
          />
          <div className="relative w-28 shrink-0">
            <Coins className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-champagne-gold" />
            <Input
              type="number"
              min={1}
              value={item.tokens}
              // El precio de un exclusivo es el de su publicacion.
              disabled={Boolean(item.postId)}
              title={item.postId ? 'Precio de la publicacion (se cambia desde ella)' : undefined}
              onChange={(e) => setItems((prev) => prev.map((x, j) => (j === i ? { ...x, tokens: e.target.value } : x)))}
              placeholder="50"
              className={cn('pl-8', field)}
            />
          </div>
          <Button variant="ghost" size="icon" onClick={() => setItems((prev) => prev.filter((_, j) => j !== i))} aria-label="Quitar">
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ))}

      {items.length < LIVE_LIMITS.tipMenuMax && (
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          <button
            type="button"
            onClick={() => setItems((prev) => [...prev, { id: crypto.randomUUID(), label: '', tokens: '' }])}
            className="flex items-center gap-1 text-sm text-champagne-gold"
          >
            <Plus className="h-4 w-4" /> Añadir accion
          </button>
          <button type="button" onClick={() => void openPicker()} className="flex items-center gap-1 text-sm text-champagne-gold">
            {loadingPicker ? <Loader2 className="h-4 w-4 animate-spin" /> : <Package className="h-4 w-4" />} Añadir contenido
            exclusivo
          </button>
        </div>
      )}

      {picker && (
        <div className="space-y-2 rounded-2xl bg-white/[0.04] p-3 ring-1 ring-champagne-gold/20">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-champagne-gold">Tu contenido exclusivo de directo</p>
            <button type="button" onClick={() => setPicker(null)} className="text-white/50 hover:text-white" aria-label="Cerrar">
              <X className="h-4 w-4" />
            </button>
          </div>
          {picker.length === 0 ? (
            <p className="text-xs text-white/60">
              Aun no tienes packs de directo. Crealos en Contenido › Para directos y podras venderlos aqui.{' '}
              <Link href="/dashboard/model/contenido?tab=directos" target="_blank" className="font-semibold text-champagne-gold hover:underline">
                Crear un pack
              </Link>
            </p>
          ) : (
            <ul className="max-h-60 space-y-1.5 overflow-y-auto">
              {picker.map((info) => {
                const added = inMenu.has(info.postId);
                return (
                  <li key={info.postId}>
                    <button
                      type="button"
                      disabled={added}
                      onClick={() => addExclusive(info)}
                      className="flex w-full items-center gap-3 rounded-xl bg-white/[0.04] p-2 text-left transition hover:bg-white/[0.08] disabled:opacity-50"
                    >
                      <span className="relative h-11 w-11 shrink-0 overflow-hidden rounded-lg bg-gradient-to-br from-fantazy-red/40 to-champagne-gold/30">
                        {info.previews[0] && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={info.previews[0]} alt="" className="h-full w-full scale-110 object-cover blur-sm" />
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold">{info.label}</span>
                        <span className="block text-[11px] text-white/55">{exclusiveSummary(info) || 'Contenido'}</span>
                      </span>
                      <span className="shrink-0 text-xs font-bold text-champagne-gold">
                        {added ? 'Ya en el menu' : `${formatTokens(info.priceTokens)} tk`}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="text-[11px] text-white/45">
            Regla: lo que vendes en directo tiene que ser exclusivo del directo. Cada fan solo puede comprarlo una vez; si ya
            lo tiene, le sugerimos otro tuyo que aun no tenga.
          </p>
        </div>
      )}

      <Button
        variant="brand"
        className="w-full"
        disabled={busy}
        onClick={() =>
          onSave(
            valid.map((i) => ({
              id: i.id,
              label: i.label.trim(),
              tokens: Math.round(Number(i.tokens)),
              ...(i.postId ? { postId: i.postId } : {}),
            })),
          )
        }
      >
        {busy && <Loader2 className="h-4 w-4 animate-spin" />} Guardar menu
      </Button>
    </div>
  );
}

function AccessView({
  current,
  busy,
  onSave,
}: {
  current: { mode: LiveAccessModeValue; ticketTokens: number | null; freeForSubscribers: boolean };
  busy: boolean;
  onSave: (mode: LiveAccessModeValue, ticketTokens: number | null, freeForSubscribers: boolean) => void;
}) {
  const [mode, setMode] = useState<LiveAccessModeValue>(current.mode);
  const [price, setPrice] = useState(String(current.ticketTokens ?? 50));
  const [freeSubs, setFreeSubs] = useState(current.freeForSubscribers);
  const options: { value: LiveAccessModeValue; label: string; help: string }[] = [
    { value: 'PUBLIC', label: 'Todos', help: 'Cualquiera con cuenta puede entrar gratis.' },
    { value: 'SUBSCRIBERS', label: 'Solo suscriptores', help: 'Solo tus suscriptores activos.' },
    { value: 'PAID', label: 'De pago', help: 'Pagan una entrada en tokens (una vez por directo).' },
  ];
  return (
    <div className="space-y-3">
      <ul className="space-y-2">
        {options.map((o) => (
          <li key={o.value}>
            <button
              type="button"
              onClick={() => setMode(o.value)}
              className={cn('w-full rounded-2xl px-4 py-3 text-left ring-1 transition', mode === o.value ? 'bg-white/10 ring-champagne-gold' : 'bg-white/5 ring-transparent hover:bg-white/10')}
            >
              <span className="block text-sm font-semibold">{o.label}</span>
              <span className="block text-xs text-white/60">{o.help}</span>
            </button>
          </li>
        ))}
      </ul>
      {mode === 'PAID' && (
        <div className="space-y-2 rounded-2xl bg-white/5 p-3">
          <label className="block space-y-1 text-xs text-white/70">
            Precio de la entrada (tokens)
            <Input type="number" min={LIVE_LIMITS.ticketMin} value={price} onChange={(e) => setPrice(e.target.value)} className={field} />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={freeSubs} onChange={(e) => setFreeSubs(e.target.checked)} className="h-4 w-4 accent-[#C9A876]" />
            Mis suscriptores entran gratis
          </label>
        </div>
      )}
      {mode !== 'PUBLIC' && mode !== current.mode && (
        <p className="text-xs text-amber-400">Quien este viendo y no tenga acceso saldra del directo y vera como entrar.</p>
      )}
      <Button variant="brand" className="w-full" disabled={busy} onClick={() => onSave(mode, mode === 'PAID' ? Number(price) : null, freeSubs)}>
        {busy && <Loader2 className="h-4 w-4 animate-spin" />} Aplicar
      </Button>
    </div>
  );
}

function ViewersView({ streamId }: { streamId: string }) {
  const [list, setList] = useState<LiveViewerRow[] | null>(null);
  const [busy, start] = useTransition();
  function load() {
    void getLiveViewersAction(streamId).then((r) => {
      if (r.ok && r.data) setList(r.data);
      else toast.error(r.error ?? 'No se pudo cargar.');
    });
  }
  useEffect(load, [streamId]); // eslint-disable-line react-hooks/exhaustive-deps

  function sanction(userId: string, name: string, action: 'MUTE' | 'UNMUTE' | 'KICK') {
    if (action === 'KICK' && !window.confirm(`¿Expulsar a ${name}? No podra volver a este directo.`)) return;
    start(async () => {
      const r = await sanctionViewerAction(streamId, userId, action);
      if (r.ok) {
        toast.success(r.message ?? 'Hecho');
        load();
      } else toast.error(r.error ?? 'No se pudo.');
    });
  }

  if (!list) return <Loader2 className="mx-auto my-8 h-5 w-5 animate-spin text-white/60" />;
  return (
    <div className="space-y-3">
      <p className="text-sm font-semibold">{list.length} viendote ahora</p>
      <p className="text-xs text-white/60">Tambien puedes tocar el nombre de alguien en el chat.</p>
      {list.length === 0 ? (
        <p className="py-4 text-center text-sm text-white/60">Aun no hay nadie viendote.</p>
      ) : (
        <ul className={cn(card, 'divide-y divide-white/[0.06]')}>
          {list.map((v) => (
            <li key={v.userId} className="flex items-center gap-3 px-3 py-2">
              <Avatar className="h-8 w-8">
                <AvatarImage src={v.avatar ?? undefined} />
                <AvatarFallback>{initials(v.name)}</AvatarFallback>
              </Avatar>
              <span className="min-w-0 flex-1 truncate text-sm">
                {v.name}
                {v.muted && <span className="ml-1.5 text-[10px] text-amber-400">silenciado</span>}
              </span>
              <Button size="icon" variant="ghost" disabled={busy} onClick={() => sanction(v.userId, v.name, v.muted ? 'UNMUTE' : 'MUTE')} aria-label={v.muted ? 'Quitar silencio' : 'Silenciar'} title={v.muted ? 'Quitar silencio' : 'Silenciar'}>
                {v.muted ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
              </Button>
              <Button size="icon" variant="ghost" disabled={busy} onClick={() => sanction(v.userId, v.name, 'KICK')} aria-label="Expulsar" title="Expulsar">
                <UserX className="h-4 w-4 text-destructive" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function WordsView({ initial, busy, onSave }: { initial: string[]; busy: boolean; onSave: (words: string[]) => void }) {
  const [words, setWords] = useState(initial);
  const [draft, setDraft] = useState('');
  function add() {
    const parts = draft.split(',').map((w) => w.trim()).filter(Boolean);
    if (parts.length) setWords((prev) => [...new Set([...prev, ...parts.map((p) => p.toLowerCase())])]);
    setDraft('');
  }
  return (
    <div className="space-y-3">
      <p className="text-xs text-white/60">
        Los mensajes con estas palabras no se ven en el chat de tus directos. Da igual mayusculas o acentos. Se guarda
        para todos tus directos.
      </p>
      <div className="flex gap-2">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), add())}
          placeholder="Escribe y pulsa Enter (o separa con comas)"
          className={field}
        />
        <Button variant="outline" onClick={add}>
          Añadir
        </Button>
      </div>
      {words.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {words.map((w) => (
            <button
              key={w}
              type="button"
              onClick={() => setWords((prev) => prev.filter((x) => x !== w))}
              className="flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-1 text-xs hover:bg-destructive/40"
              title="Quitar"
            >
              {w} ×
            </button>
          ))}
        </div>
      )}
      <Button variant="brand" className="w-full" disabled={busy} onClick={() => onSave(words)}>
        {busy && <Loader2 className="h-4 w-4 animate-spin" />} Guardar filtro
      </Button>
    </div>
  );
}
