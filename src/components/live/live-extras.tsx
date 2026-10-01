'use client';

import { useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import {
  BarChart3,
  Check,
  ChevronLeft,
  ChevronRight,
  Coins,
  Crown,
  Film,
  Images,
  Loader2,
  Lock,
  Move,
  Package,
  Pause,
  Pin,
  Sparkles,
  Star,
  Ticket,
  Users,
  X,
} from 'lucide-react';

import { glass } from '@/components/live/live-chat';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import type { LiveExclusiveInfo, LivePaywall, LivePollState, TipMenuItem, WidgetPos } from '@/lib/live-state';
import { cn, formatTokens, initials } from '@/lib/utils';

/**
 * Piezas del directo que comparten la creadora y el espectador: mensaje
 * fijado, pausa, encuesta, muro de acceso y menu de propinas.
 */

export function PinnedMessage({ text, className }: { text: string; className?: string }) {
  return (
    <div className={cn('flex max-w-full items-start gap-2 rounded-2xl px-3 py-2 text-[13px] text-white', glass, className)}>
      <Pin className="mt-0.5 h-3.5 w-3.5 shrink-0 rotate-45 text-champagne-gold" />
      <p className="min-w-0 break-words">{text}</p>
    </div>
  );
}

/** Lo que ven los fans mientras la creadora esta en pausa. */
export function PausedOverlay({ host }: { host?: boolean }) {
  return (
    <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/80 p-6 text-center backdrop-blur-md">
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-white/10">
        <Pause className="h-7 w-7 text-white" />
      </span>
      <p className="font-heading text-2xl uppercase tracking-wide text-white">Vuelvo enseguida</p>
      <p className="max-w-xs text-sm text-white/70">
        {host
          ? 'Tus fans ven esta pantalla. Tu imagen y tu voz no se estan emitiendo.'
          : 'El directo sigue abierto: no te vayas.'}
      </p>
    </div>
  );
}

/** Encuesta en pantalla: votar (fan) o ver resultados en vivo (creadora). */
export function LivePollCard({
  poll,
  myVote,
  onVote,
  voting,
  onClose,
  onDismiss,
  host,
}: {
  poll: LivePollState;
  myVote: number | null;
  onVote?: (option: number) => void;
  voting?: boolean;
  /** Creadora: cerrar la votacion. */
  onClose?: () => void;
  /** Creadora: quitarla de la pantalla. / Fan: ocultarla para si. */
  onDismiss?: () => void;
  host?: boolean;
}) {
  const showResults = host || myVote !== null || poll.closed;
  return (
    <div className={cn('pointer-events-auto w-64 max-w-full space-y-2 rounded-2xl p-3 text-white', glass)}>
      <div className="flex items-start gap-2">
        <BarChart3 className="mt-0.5 h-4 w-4 shrink-0 text-champagne-gold" />
        <p className="min-w-0 flex-1 text-sm font-semibold leading-snug">{poll.question}</p>
        {onDismiss && (
          <button type="button" onClick={onDismiss} aria-label="Ocultar encuesta" className="text-white/60 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
      <ul className="space-y-1.5">
        {poll.options.map((option, i) => {
          const pct = poll.total > 0 ? Math.round((poll.counts[i]! / poll.total) * 100) : 0;
          const mine = myVote === i;
          return (
            <li key={i}>
              <button
                type="button"
                disabled={showResults || voting || !onVote}
                onClick={() => onVote?.(i)}
                className={cn(
                  'relative w-full overflow-hidden rounded-xl px-3 py-2 text-left text-[13px] transition',
                  showResults ? 'bg-white/10' : 'bg-white/15 hover:bg-white/25 active:scale-[0.98]',
                  mine && 'ring-1 ring-champagne-gold',
                )}
              >
                {showResults && (
                  <span
                    className={cn('absolute inset-y-0 left-0', mine ? 'bg-champagne-gold/40' : 'bg-white/15')}
                    style={{ width: `${pct}%` }}
                  />
                )}
                <span className="relative flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate">{option}</span>
                  {showResults && <span className="font-semibold tabular-nums">{pct}%</span>}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="flex items-center justify-between text-[11px] text-white/60">
        <span>
          {poll.total} {poll.total === 1 ? 'voto' : 'votos'}
          {poll.closed && ' · cerrada'}
        </span>
        {host && !poll.closed && onClose && (
          <button type="button" onClick={onClose} className="font-semibold text-champagne-gold hover:underline">
            Cerrar votacion
          </button>
        )}
      </div>
    </div>
  );
}

/** Pantalla de un directo de suscriptores o de pago al que aun no se tiene acceso. */
export function LivePaywallNotice({
  paywall,
  modelName,
  balance,
  buying,
  onBuy,
}: {
  paywall: LivePaywall;
  modelName: string;
  balance: number;
  buying: boolean;
  onBuy: () => void;
}) {
  const price = paywall.ticketTokens ?? 0;
  return (
    <div className="absolute inset-0 z-40 flex flex-col items-center justify-center gap-4 bg-black/85 p-6 text-center backdrop-blur-xl">
      <span className="flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-fantazy-red to-champagne-gold">
        {paywall.mode === 'SUBSCRIBERS' ? <Crown className="h-8 w-8 text-white" /> : <Ticket className="h-8 w-8 text-white" />}
      </span>
      <div>
        <p className="font-heading text-2xl uppercase tracking-wide text-white">
          {paywall.mode === 'SUBSCRIBERS' ? 'Solo suscriptores' : 'Directo de pago'}
        </p>
        <p className="mt-1 max-w-xs text-sm text-white/75">
          {paywall.mode === 'SUBSCRIBERS'
            ? `${modelName} esta haciendo un directo solo para sus suscriptores.`
            : `Entra al directo de ${modelName} por ${formatTokens(price)} tokens.${
                paywall.freeForSubscribers ? ' Sus suscriptores entran gratis.' : ''
              }`}
        </p>
      </div>
      <div className="flex w-full max-w-xs flex-col gap-2">
        {paywall.mode === 'PAID' && (
          <>
            <Button variant="brand" size="lg" onClick={onBuy} disabled={buying || balance < price}>
              {buying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
              Entrar por {formatTokens(price)} tokens
            </Button>
            <p className="flex items-center justify-center gap-1 text-xs text-white/60">
              <Coins className="h-3.5 w-3.5 text-champagne-gold" /> Tienes {formatTokens(balance)} tokens
            </p>
            {balance < price && (
              <Link href="/wallet">
                <Button variant="outline" className="w-full">
                  Comprar tokens
                </Button>
              </Link>
            )}
          </>
        )}
        {(paywall.mode === 'SUBSCRIBERS' || paywall.freeForSubscribers) && (
          <Link href={`/models/${paywall.modelSlug}`}>
            <Button variant={paywall.mode === 'SUBSCRIBERS' ? 'brand' : 'outline'} size="lg" className="w-full">
              <Crown className="h-4 w-4" /> Suscribirme
            </Button>
          </Link>
        )}
        <Link href="/live" className="text-sm text-white/60 hover:text-white">
          Ver otros directos
        </Link>
      </div>
    </div>
  );
}

/** Menu de propinas: acciones con precio que el fan pide con un toque. */
export function TipMenuList({
  items,
  balance,
  disabled,
  onPick,
  owned,
}: {
  items: TipMenuItem[];
  balance: number;
  disabled?: boolean;
  onPick: (item: TipMenuItem) => void;
  /** Ids de entradas de contenido exclusivo que este fan ya tiene. */
  owned?: Set<string>;
}) {
  return (
    <ul className="space-y-1.5">
      {items.map((item) => (
        <li key={item.id}>
          <button
            type="button"
            // Un exclusivo siempre se puede abrir: se ve lo que trae antes de pagar.
            disabled={disabled || (!item.postId && item.tokens > balance)}
            onClick={() => onPick(item)}
            className="flex w-full items-center gap-3 rounded-2xl bg-white/5 px-3 py-2.5 text-left text-sm text-white transition hover:bg-white/10 active:scale-[0.99] disabled:opacity-40"
          >
            {item.postId ? (
              owned?.has(item.id) ? (
                <Check className="h-4 w-4 shrink-0 text-state-connected" />
              ) : (
                <Package className="h-4 w-4 shrink-0 text-champagne-gold" />
              )
            ) : (
              <Star className="h-4 w-4 shrink-0 text-champagne-gold" />
            )}
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
            <span className="flex items-center gap-1 font-semibold text-champagne-gold">
              <Coins className="h-3.5 w-3.5" />
              {formatTokens(item.tokens)}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/**
 * Panel colocado por la creadora sobre el directo (meta, encuesta, fijado).
 * Ella lo arrastra por el asa dorada; los fans lo ven en el mismo sitio,
 * porque la posicion va en fracciones del escenario y no en pixeles.
 */
export function LiveWidget({
  pos,
  editable,
  onMove,
  label,
  className,
  children,
}: {
  pos: WidgetPos;
  /** Creadora: puede arrastrarlo. */
  editable?: boolean;
  onMove?: (pos: WidgetPos) => void;
  /** Nombre del panel, para el asa ("Mover encuesta"). */
  label: string;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const grabRef = useRef<{ dx: number; dy: number } | null>(null);
  const [dragPos, setDragPos] = useState<WidgetPos | null>(null);
  const current = dragPos ?? pos;

  function place(clientX: number, clientY: number) {
    const el = ref.current;
    const stage = el?.closest('[data-live-stage]')?.getBoundingClientRect();
    if (!el || !stage || !grabRef.current) return null;
    const box = el.getBoundingClientRect();
    const x = (clientX - grabRef.current.dx - stage.left) / stage.width;
    const y = (clientY - grabRef.current.dy - stage.top) / stage.height;
    return {
      x: Math.min(Math.max(0, x), Math.max(0, 1 - box.width / stage.width)),
      y: Math.min(Math.max(0.04, y), Math.max(0.04, 1 - box.height / stage.height - 0.01)),
    };
  }

  return (
    <div
      ref={ref}
      className={cn('absolute z-[12]', dragPos && 'opacity-90', className)}
      style={{ left: `${current.x * 100}%`, top: `${current.y * 100}%` }}
    >
      {editable && (
        <button
          type="button"
          aria-label={`Mover ${label}`}
          title={`Arrastra para mover ${label}`}
          className="absolute -right-2 -top-2 z-10 flex h-7 w-7 cursor-grab touch-none items-center justify-center rounded-full bg-champagne-gold text-black shadow-lg ring-2 ring-black/40 active:cursor-grabbing"
          onPointerDown={(e) => {
            e.preventDefault();
            const box = ref.current!.getBoundingClientRect();
            grabRef.current = { dx: e.clientX - box.left, dy: e.clientY - box.top };
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            if (!grabRef.current) return;
            const next = place(e.clientX, e.clientY);
            if (next) setDragPos(next);
          }}
          onPointerUp={() => {
            grabRef.current = null;
            if (dragPos) onMove?.(dragPos);
            setDragPos(null);
          }}
          onPointerCancel={() => {
            grabRef.current = null;
            setDragPos(null);
          }}
        >
          <Move className="h-3.5 w-3.5" />
        </button>
      )}
      {children}
    </div>
  );
}

/** Ficha de la creadora al tocar su foto: quien es y que puedes hacer. */
export function CreatorCard({
  model,
  onClose,
  actions,
}: {
  model: {
    slug: string;
    stageName: string;
    avatarUrl: string | null;
    coverUrl: string | null;
    headline: string | null;
    bio: string | null;
    followersCount: number;
    country: string | null;
  };
  onClose: () => void;
  /** Botones (seguir, mensaje, llamada privada) que pinta quien la usa. */
  actions?: ReactNode;
}) {
  return (
    <>
      <button type="button" aria-label="Cerrar" className="absolute inset-0 z-40 bg-black/50 backdrop-blur-[2px]" onClick={onClose} />
      <div className="absolute inset-x-3 top-1/2 z-50 mx-auto max-w-sm -translate-y-1/2 animate-in zoom-in-95 fade-in overflow-hidden rounded-3xl bg-[#121114] text-white shadow-2xl ring-1 ring-champagne-gold/20 duration-200">
        <div className="relative h-24 bg-gradient-to-br from-fantazy-red/60 via-[#3a1520] to-champagne-gold/40">
          {model.coverUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={model.coverUrl} alt="" className="h-full w-full object-cover opacity-60" />
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar ficha"
            className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/70"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="px-5 pb-5">
          <Avatar className="-mt-10 h-20 w-20 border-4 border-[#121114] ring-2 ring-champagne-gold/60">
            <AvatarImage src={model.avatarUrl ?? undefined} />
            <AvatarFallback>{initials(model.stageName)}</AvatarFallback>
          </Avatar>
          <p className="mt-2 font-heading text-2xl uppercase tracking-wide">{model.stageName}</p>
          <p className="flex items-center gap-3 text-xs text-white/60">
            <span className="flex items-center gap-1">
              <Users className="h-3.5 w-3.5" /> {formatTokens(model.followersCount)} seguidores
            </span>
            {model.country && <span>· {model.country}</span>}
          </p>
          {model.headline && <p className="mt-3 text-sm font-medium text-white/90">{model.headline}</p>}
          {model.bio && <p className="mt-1 line-clamp-3 text-sm text-white/65">{model.bio}</p>}
          {actions && <div className="mt-4 space-y-2">{actions}</div>}
          <Link href={`/models/${model.slug}`} className="mt-3 block text-center text-sm font-semibold text-champagne-gold hover:underline">
            Ver perfil completo
          </Link>
        </div>
      </div>
    </>
  );
}

/**
 * Menu de propinas como panel sobre el directo. El fan lo pliega si le
 * molesta y pide con un toque; la creadora lo ve igual, sin poder pedir.
 */
export function TipMenuPanel({
  items,
  balance,
  disabled,
  onPick,
  owned,
}: {
  items: TipMenuItem[];
  balance?: number;
  disabled?: boolean;
  /** Sin onPick (creadora) solo se enseña. */
  onPick?: (item: TipMenuItem) => void;
  /** Ids de entradas de contenido exclusivo que este fan ya tiene. */
  owned?: Set<string>;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className={cn('w-full overflow-hidden rounded-2xl text-white', glass)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
        aria-expanded={open}
      >
        <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-gradient-to-br from-fantazy-red to-champagne-gold">
          <Star className="h-3.5 w-3.5 fill-white text-white" />
        </span>
        <span className="flex-1 text-[13px] font-bold">Especiales</span>
        <span className="text-[11px] text-white/55">{open ? 'Ocultar' : `${items.length}`}</span>
      </button>
      {open && (
        <ul className="max-h-48 space-y-1 overflow-y-auto px-1.5 pb-1.5 [scrollbar-width:none]">
          {items.map((item) => {
            const isOwned = Boolean(item.postId && owned?.has(item.id));
            // Un exclusivo se abre aunque no llegue el saldo: primero se ve que trae.
            const tooExpensive = !item.postId && balance != null && item.tokens > balance;
            return (
              <li key={item.id}>
                <button
                  type="button"
                  disabled={!onPick || disabled || tooExpensive}
                  onClick={() => onPick?.(item)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-xl bg-white/[0.06] px-2.5 py-1.5 text-left text-[12px] transition',
                    onPick && 'hover:bg-white/15 active:scale-[0.98]',
                    tooExpensive && 'opacity-40',
                  )}
                >
                  {item.postId && <Package className="h-3.5 w-3.5 shrink-0 text-champagne-gold" />}
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  {isOwned ? (
                    <span className="flex shrink-0 items-center gap-0.5 font-bold text-state-connected">
                      <Check className="h-3 w-3" /> Tuyo
                    </span>
                  ) : (
                    <span className="flex shrink-0 items-center gap-0.5 font-bold text-champagne-gold">
                      <Coins className="h-3 w-3" />
                      {formatTokens(item.tokens)}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** "4:32" a partir de segundos. */
function formatClock(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = String(seconds % 60).padStart(2, '0');
  return `${m}:${s}`;
}

/** "12 fotos · 3 videos · 4:32" */
export function exclusiveSummary(info: LiveExclusiveInfo) {
  return [
    info.photos > 0 && `${info.photos} ${info.photos === 1 ? 'foto' : 'fotos'}`,
    info.videos > 0 && `${info.videos} ${info.videos === 1 ? 'video' : 'videos'}`,
    info.videoSeconds > 0 && formatClock(info.videoSeconds),
  ]
    .filter(Boolean)
    .join(' · ');
}

/** Miniaturas difuminadas con candado (o un degradado si no hay miniatura). */
function BlurredStrip({ info, small }: { info: LiveExclusiveInfo; small?: boolean }) {
  const slots = info.previews.length > 0 ? info.previews : [null];
  return (
    <div className={cn('grid gap-1.5', small ? 'grid-cols-4' : slots.length === 1 ? 'grid-cols-1' : 'grid-cols-2')}>
      {slots.slice(0, 4).map((src, i) => (
        <div
          key={i}
          className={cn(
            'relative overflow-hidden rounded-xl bg-gradient-to-br from-fantazy-red/40 via-[#2a1018] to-champagne-gold/30',
            small ? 'aspect-square' : slots.length === 1 ? 'aspect-video' : 'aspect-square',
          )}
        >
          {src && (
            // La miniatura ya viene difuminada del servidor (32 px); el
            // desenfoque extra es solo estetico.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={src} alt="" className="h-full w-full scale-110 object-cover blur-md" />
          )}
          {!info.owned && (
            <span className="absolute inset-0 flex items-center justify-center">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-black/50 backdrop-blur">
                <Lock className="h-4 w-4 text-white" />
              </span>
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * Ficha de un contenido exclusivo de directo: que trae, en borroso, y
 * comprar. Si el fan ya lo tiene, "Ver" y la sugerencia de otro que no tiene.
 */
export function LiveExclusiveSheet({
  info,
  suggestion,
  balance,
  buying,
  onBuy,
  onView,
  onClose,
}: {
  info: LiveExclusiveInfo;
  suggestion: LiveExclusiveInfo | null;
  balance: number;
  buying: boolean;
  onBuy: (postId: string) => void;
  onView: (postId: string) => void;
  onClose: () => void;
}) {
  return (
    <>
      <button type="button" aria-label="Cerrar" className="absolute inset-0 z-40 bg-black/50 backdrop-blur-[2px]" onClick={onClose} />
      <div className="absolute inset-x-0 bottom-0 z-50 max-h-[88%] overflow-y-auto animate-in slide-in-from-bottom rounded-t-[28px] bg-[#141416] px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 text-white ring-1 ring-champagne-gold/20 duration-200">
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-white/20" />
        <div className="mb-3 flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-fantazy-red to-champagne-gold">
            <Package className="h-5 w-5 text-white" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-champagne-gold">Exclusivo del directo</p>
            <p className="truncate text-lg font-semibold leading-tight">{info.label}</p>
            <p className="mt-0.5 flex items-center gap-2 text-xs text-white/60">
              {info.photos > 0 && <Images className="h-3.5 w-3.5" />}
              {info.videos > 0 && <Film className="h-3.5 w-3.5" />}
              {exclusiveSummary(info) || 'Contenido'}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="rounded-full p-1.5 text-white/60 hover:bg-white/10">
            <X className="h-5 w-5" />
          </button>
        </div>

        <BlurredStrip info={info} />
        {info.body && info.body !== info.label && <p className="mt-3 line-clamp-3 text-sm text-white/70">{info.body}</p>}

        {info.owned ? (
          <>
            <button
              type="button"
              onClick={() => onView(info.postId)}
              className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-state-connected/15 font-semibold text-state-connected ring-1 ring-state-connected/40"
            >
              <Check className="h-5 w-5" /> Ya lo tienes · Ver
            </button>
            {suggestion ? (
              <div className="mt-4 rounded-2xl bg-gradient-to-br from-champagne-gold/15 to-fantazy-red/10 p-3 ring-1 ring-champagne-gold/30">
                <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-champagne-gold">
                  <Sparkles className="h-3.5 w-3.5" /> Aun no tienes este otro
                </p>
                <div className="flex items-center gap-3">
                  <div className="w-24 shrink-0">
                    <BlurredStrip info={suggestion} small />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{suggestion.label}</p>
                    <p className="text-[11px] text-white/60">{exclusiveSummary(suggestion)}</p>
                  </div>
                </div>
                <button
                  type="button"
                  disabled={buying || suggestion.priceTokens > balance}
                  onClick={() => onBuy(suggestion.postId)}
                  className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-fantazy-red to-champagne-gold text-sm font-bold disabled:opacity-40"
                >
                  {buying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
                  Desbloquear por {formatTokens(suggestion.priceTokens)} tokens
                </button>
              </div>
            ) : (
              <p className="mt-3 text-center text-xs text-white/50">Ya tienes todo su contenido exclusivo. ¡Eres de los mejores fans!</p>
            )}
          </>
        ) : (
          <>
            <button
              type="button"
              disabled={buying || info.priceTokens > balance}
              onClick={() => onBuy(info.postId)}
              className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-fantazy-red to-champagne-gold font-bold shadow-[0_0_20px_rgb(192_39_60/0.35)] disabled:opacity-40"
            >
              {buying ? <Loader2 className="h-5 w-5 animate-spin" /> : <Lock className="h-5 w-5" />}
              Desbloquear por {formatTokens(info.priceTokens)} tokens
            </button>
            <p className="mt-2 flex items-center justify-center gap-1 text-xs text-white/55">
              <Coins className="h-3.5 w-3.5 text-champagne-gold" /> Tienes {formatTokens(balance)} tokens
              {info.priceTokens > balance && (
                <Link href="/wallet" className="ml-1 font-semibold text-champagne-gold hover:underline">
                  Recargar
                </Link>
              )}
            </p>
            <p className="mt-1 text-center text-[11px] text-white/40">Se paga una vez y es tuyo para siempre.</p>
          </>
        )}
      </div>
    </>
  );
}

/** Visor de un exclusivo ya comprado (fotos con marca de agua, videos). */
export function ExclusiveGallery({
  items,
  loading,
  onClose,
}: {
  items: { id: string; url: string | null; mimeType: string }[];
  loading: boolean;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(0);
  const current = items[Math.min(index, Math.max(0, items.length - 1))];
  return (
    <div className="absolute inset-0 z-[60] flex flex-col bg-black">
      <div className="flex items-center justify-between p-3 text-white">
        <span className="text-sm text-white/70">{items.length > 0 ? `${index + 1} / ${items.length}` : ''}</span>
        <button type="button" onClick={onClose} aria-label="Cerrar" className="rounded-full bg-white/10 p-2 hover:bg-white/20">
          <X className="h-5 w-5" />
        </button>
      </div>
      <div className="relative flex flex-1 items-center justify-center">
        {loading || !current ? (
          <Loader2 className="h-6 w-6 animate-spin text-white/60" />
        ) : current.url ? (
          current.mimeType.startsWith('video/') ? (
            <video src={current.url} controls playsInline className="max-h-full max-w-full" />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={current.url} alt="" className="max-h-full max-w-full object-contain" />
          )
        ) : (
          <p className="text-sm text-white/60">No se pudo cargar este archivo.</p>
        )}
        {items.length > 1 && (
          <>
            <button
              type="button"
              aria-label="Anterior"
              onClick={() => setIndex((i) => (i - 1 + items.length) % items.length)}
              className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <button
              type="button"
              aria-label="Siguiente"
              onClick={() => setIndex((i) => (i + 1) % items.length)}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
