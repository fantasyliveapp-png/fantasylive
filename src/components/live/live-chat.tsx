'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Send, Target, Trophy } from 'lucide-react';
import { toast } from 'sonner';

import { useI18n } from '@/components/providers/i18n-provider';
import type {
  LiveChatMessage,
  LiveGoal,
  LiveHeart,
} from '@/hooks/use-live-room';
import { cn, formatTokens } from '@/lib/utils';

/**
 * Piezas del directo que van encima del video, compartidas por la pantalla
 * del espectador y la de la creadora: las dos tienen que ver lo mismo
 * (mensajes, regalos, meta y corazones) para poder hablarse.
 *
 * Lenguaje visual: capsulas de cristal oscuro sobre el video, rojo de marca
 * para lo social (directo, seguir, corazones) y dorado para el dinero
 * (regalos, meta, tokens). La disposicion es la de TikTok Live para que se
 * entienda sin explicaciones; el acabado es el de FantasyLive.
 */

const GIFT_BURST_MS = 4_500;
const SPOTLIGHT_MS = 2_800;
/** A partir de aqui un regalo ocupa el centro de la pantalla. */
export const SPOTLIGHT_MIN_TOKENS = 200;

/** Capsula de cristal: la base de todo lo que flota sobre el video. */
export const glass =
  'bg-black/30 ring-1 ring-inset ring-white/10 backdrop-blur-xl';

const AVATAR_COLORS = [
  'bg-rose-500',
  'bg-amber-500',
  'bg-emerald-500',
  'bg-sky-500',
  'bg-violet-500',
  'bg-fuchsia-500',
  'bg-teal-500',
  'bg-orange-500',
];

function colorFor(name: string) {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

/** Circulo con la inicial: da identidad a cada persona del chat sin fotos. */
function Initial({ name, className }: { name: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold uppercase text-white',
        colorFor(name),
        className,
      )}
    >
      {name.trim().charAt(0) || '?'}
    </span>
  );
}

/**
 * Chat encima del video: los mensajes nuevos aparecen abajo y los viejos se
 * desvanecen por arriba. Se puede hacer scroll para releer; si se esta abajo
 * del todo, sigue a los mensajes nuevos.
 */
export function LiveChatFeed({
  messages,
  hostLabel,
  className,
}: {
  messages: LiveChatMessage[];
  /** Etiqueta de quien emite, segun su genero ("Creadora" / "Creador"). */
  hostLabel?: string;
  className?: string;
}) {
  const { t } = useI18n();
  const listRef = useRef<HTMLDivElement | null>(null);
  const stickRef = useRef(true);

  useEffect(() => {
    const list = listRef.current;
    if (list && stickRef.current) list.scrollTop = list.scrollHeight;
  }, [messages.length]);

  return (
    <div
      ref={listRef}
      onScroll={(e) => {
        const el = e.currentTarget;
        stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
      }}
      className={cn(
        'flex flex-col gap-1 overflow-y-auto overscroll-contain [mask-image:linear-gradient(to_bottom,transparent,black_30%)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
        className,
      )}
      aria-live="polite"
    >
      {/* Empuja los mensajes hacia abajo cuando aun son pocos. */}
      <div className="flex-1" />

      {messages.length === 0 && (
        <p className="text-[13px] text-white/70 [text-shadow:0_1px_2px_rgb(0_0_0/0.6)]">
          {t('live.chatEmpty')}
        </p>
      )}

      {messages.map((message) =>
        message.kind === 'gift' ? (
          <div
            key={message.id}
            className="flex w-fit max-w-full items-center gap-2 rounded-full bg-gradient-to-r from-champagne-gold/35 to-transparent py-0.5 pl-0.5 pr-3 text-[13px] text-white"
          >
            <Initial name={message.from} />
            <span className="min-w-0 break-words">
              <span className="font-semibold text-champagne-gold">{message.from}</span>{' '}
              {t('live.sentGift')} {message.emoji}{' '}
              <span className="font-bold">x{message.tokens}</span>
            </span>
          </div>
        ) : (
          <div
            key={message.id}
            className="flex max-w-full items-start gap-2 text-[13px] leading-snug text-white [text-shadow:0_1px_2px_rgb(0_0_0/0.6)]"
          >
            <Initial
              name={message.from}
              className={cn(message.isHost && 'ring-2 ring-fantazy-red')}
            />
            <p className="min-w-0 break-words pt-0.5">
              <span className="mr-1.5 font-semibold text-white/65">
                {message.from}
                {message.isHost && (
                  <span className="ml-1 rounded-sm bg-fantazy-red px-1 py-px align-[1px] text-[9px] font-bold uppercase tracking-wide text-white [text-shadow:none]">
                    {hostLabel ?? t('live.host')}
                  </span>
                )}
              </span>
              {message.body}
            </p>
          </div>
        ),
      )}
    </div>
  );
}

/**
 * Caja de escribir en forma de pastilla. Si el envio falla el texto se queda
 * para reintentar en vez de desaparecer como si se hubiera mandado.
 */
export function LiveChatComposer({
  onSend,
  disabled,
  placeholder,
  children,
  className,
}: {
  onSend: (text: string) => Promise<boolean>;
  disabled?: boolean;
  placeholder: string;
  /** Botones redondos a la derecha (regalos, compartir...). */
  children?: ReactNode;
  className?: string;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState('');

  async function submit() {
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    const sent = await onSend(text);
    if (!sent) {
      setDraft(text);
      toast.error(t('live.chatSendFailed'));
    }
  }

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div
        className={cn(
          'flex h-11 min-w-0 flex-1 items-center rounded-full pl-4 pr-1',
          glass,
        )}
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void submit();
            }
          }}
          placeholder={placeholder}
          maxLength={280}
          disabled={disabled}
          enterKeyHint="send"
          className="min-w-0 flex-1 bg-transparent text-sm text-white placeholder:text-white/55 focus:outline-none disabled:opacity-50"
        />
        {draft.trim() && (
          <button
            type="button"
            onClick={() => void submit()}
            disabled={disabled}
            aria-label={t('common.send')}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-fantazy-red text-white transition active:scale-90"
          >
            <Send className="h-4 w-4" />
          </button>
        )}
      </div>
      {children}
    </div>
  );
}

/** Boton redondo de la barra inferior. */
export function StageButton({
  onClick,
  label,
  children,
  className,
}: {
  onClick: () => void;
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn(
        'flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white transition active:scale-90',
        glass,
        className,
      )}
    >
      {children}
    </button>
  );
}

/**
 * Boton de la columna derecha, como los de TikTok: icono grande y una
 * etiqueta o contador debajo.
 */
export function RailButton({
  onClick,
  label,
  caption,
  children,
  className,
}: {
  onClick: () => void;
  label: string;
  caption?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="group flex flex-col items-center gap-1 text-white"
    >
      <span
        className={cn(
          'flex h-11 w-11 items-center justify-center rounded-full transition group-active:scale-90',
          glass,
          className,
        )}
      >
        {children}
      </span>
      {caption !== undefined && (
        <span className="text-[11px] font-semibold [text-shadow:0_1px_2px_rgb(0_0_0/0.7)]">
          {caption}
        </span>
      )}
    </button>
  );
}

/**
 * Meta de tokens: barra que se llena con cada regalo. Al completarse se
 * vuelve dorada y lo dice, para que el publico sepa que lo ha conseguido.
 */
export function GoalBar({
  goal,
  onClick,
  className,
}: {
  goal: LiveGoal;
  onClick?: () => void;
  className?: string;
}) {
  const { t } = useI18n();
  const percent = Math.min(100, Math.round((goal.progress / goal.target) * 100));
  const reached = goal.progress >= goal.target;

  const body = (
    <>
      <div className="flex items-center gap-1.5 text-[11px] font-semibold text-white">
        {reached ? (
          <Trophy className="h-3.5 w-3.5 shrink-0 text-champagne-gold" />
        ) : (
          <Target className="h-3.5 w-3.5 shrink-0 text-champagne-gold" />
        )}
        <span className="min-w-0 flex-1 truncate text-left">
          {reached ? t('live.goalReached') : goal.label}
        </span>
        <span className="shrink-0 tabular-nums text-white/80">
          {formatTokens(Math.min(goal.progress, goal.target))}/{formatTokens(goal.target)}
        </span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/15">
        <div
          className={cn(
            'h-full rounded-full bg-gradient-to-r from-fantazy-red via-rose-400 to-champagne-gold transition-[width] duration-700 ease-out',
            reached && 'animate-pulse',
          )}
          style={{ width: `${percent}%` }}
        />
      </div>
      {reached && (
        <p className="mt-1 truncate text-left text-[10px] text-white/70">{goal.label}</p>
      )}
    </>
  );

  const classes = cn(
    'block w-56 max-w-full rounded-2xl px-3 py-2',
    glass,
    reached && 'ring-champagne-gold/60',
    className,
  );

  return onClick ? (
    <button type="button" onClick={onClick} className={classes}>
      {body}
    </button>
  ) : (
    <div className={classes}>{body}</div>
  );
}

/** Corazones que suben por la derecha, como los "me gusta" de TikTok. */
export function FloatingHearts({ hearts }: { hearts: LiveHeart[] }) {
  if (hearts.length === 0) return null;
  return (
    <div className="pointer-events-none absolute bottom-40 right-4 h-64 w-12">
      {hearts.map((heart) => (
        <svg
          key={heart.id}
          viewBox="0 0 24 24"
          className="absolute bottom-0 left-1 h-9 w-9 animate-heart-float drop-shadow"
          style={{ '--drift': `${heart.drift}px` } as React.CSSProperties}
          aria-hidden
        >
          <path
            fill={heart.color}
            d="M12 21s-7.5-4.6-9.6-9.3C.9 8.4 3 5 6.4 5c2 0 3.5 1.1 4.3 2.5h2.6C14.1 6.1 15.6 5 17.6 5 21 5 23.1 8.4 21.6 11.7 19.5 16.4 12 21 12 21z"
          />
        </svg>
      ))}
    </div>
  );
}

/** Reloj que solo late mientras haya algo reciente que retirar. */
function useRecentClock(messages: LiveChatMessage[], windowMs: number) {
  const [now, setNow] = useState(() => Date.now());
  const newest = messages.at(-1);

  useEffect(() => {
    if (newest?.kind === 'gift') setNow(Date.now());
  }, [newest]);

  const hasRecent = messages.some(
    (m) => m.kind === 'gift' && now - m.at < windowMs,
  );

  useEffect(() => {
    if (!hasRecent) return;
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [hasRecent]);

  return now;
}

/**
 * Regalos recientes a la izquierda. Si la misma persona repite el mismo
 * regalo seguido se agrupa en un combo (x2, x3...) en vez de apilar tarjetas
 * iguales, como en TikTok.
 */
export function GiftBursts({
  messages,
  className,
}: {
  messages: LiveChatMessage[];
  className?: string;
}) {
  const { t } = useI18n();
  const now = useRecentClock(messages, GIFT_BURST_MS);

  const combos = useMemo(() => {
    const groups: { key: string; first: LiveChatMessage; count: number; last: number }[] = [];
    for (const m of messages) {
      if (m.kind !== 'gift' || now - m.at >= GIFT_BURST_MS) continue;
      const key = `${m.from}|${m.emoji}|${m.tokens}`;
      const group = groups.find((g) => g.key === key);
      if (group) {
        group.count += 1;
        group.last = m.at;
      } else {
        groups.push({ key, first: m, count: 1, last: m.at });
      }
    }
    return groups.slice(-2);
  }, [messages, now]);

  if (combos.length === 0) return null;

  return (
    <div className={cn('pointer-events-none absolute left-3 flex flex-col gap-2', className)}>
      {combos.map(({ key, first, count, last }) => (
        <div key={key} className="flex animate-gift-pop items-center gap-1">
          <div className="flex items-center gap-2 rounded-full bg-gradient-to-r from-black/60 via-black/40 to-transparent py-1 pl-1 pr-6">
            <Initial name={first.from} className="h-9 w-9 text-sm" />
            <div className="leading-tight">
              <p className="max-w-[8rem] truncate text-xs font-semibold text-white">
                {first.from}
              </p>
              <p className="text-[11px] text-champagne-gold">
                {t('live.sentGift')} {first.tokens} tokens
              </p>
            </div>
            <span className="-my-2 text-4xl drop-shadow-lg">{first.emoji}</span>
          </div>
          {count > 1 && (
            <span
              key={last}
              className="animate-in zoom-in-150 font-heading text-3xl italic text-champagne-gold [text-shadow:0_2px_6px_rgb(0_0_0/0.6)]"
            >
              x{count}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * Los regalos grandes ocupan el centro de la pantalla un momento: quien paga
 * mucho quiere que se note, y a la creadora no se le puede escapar.
 */
export function GiftSpotlight({
  messages,
  minTokens = SPOTLIGHT_MIN_TOKENS,
}: {
  messages: LiveChatMessage[];
  /** Desde cuantos tokens ocupa el centro (las llamadas usan regalos menores). */
  minTokens?: number;
}) {
  const { t } = useI18n();
  const now = useRecentClock(messages, SPOTLIGHT_MS);

  const big = [...messages]
    .reverse()
    .find(
      (m) =>
        m.kind === 'gift' &&
        (m.tokens ?? 0) >= minTokens &&
        now - m.at < SPOTLIGHT_MS,
    );
  if (!big) return null;

  return (
    <div
      key={big.id}
      className="pointer-events-none absolute inset-0 z-10 flex animate-spotlight flex-col items-center justify-center"
    >
      <div className="absolute h-64 w-64 rounded-full bg-champagne-gold/30 blur-3xl" />
      <span className="relative text-[7rem] leading-none drop-shadow-[0_8px_24px_rgb(0_0_0/0.5)]">
        {big.emoji}
      </span>
      <p className="relative mt-3 max-w-[80%] truncate font-heading text-xl uppercase tracking-wide text-white [text-shadow:0_2px_8px_rgb(0_0_0/0.7)]">
        {big.from}
      </p>
      <p className="relative text-sm font-semibold text-champagne-gold [text-shadow:0_1px_4px_rgb(0_0_0/0.7)]">
        {t('live.sentGift')} {formatTokens(big.tokens ?? 0)} tokens
      </p>
    </div>
  );
}

/**
 * Celebracion al cruzar la meta: solo cuando se cruza delante de quien mira,
 * no al entrar a un directo cuya meta ya estaba cumplida.
 */
export function GoalCelebration({
  goal,
  messages,
}: {
  goal: LiveGoal | null;
  messages: LiveChatMessage[];
}) {
  const { t } = useI18n();
  const [showing, setShowing] = useState(false);
  const prevRef = useRef(goal);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = goal;
    if (!goal || !prev || prev.label !== goal.label || prev.target !== goal.target) return;
    if (prev.progress >= prev.target || goal.progress < goal.target) return;

    // Si el regalo que la completa es de los grandes, primero se luce el
    // regalo y despues la meta, en vez de pisarse en el centro.
    const lastGift = [...messagesRef.current].reverse().find((m) => m.kind === 'gift');
    const wait =
      lastGift &&
      (lastGift.tokens ?? 0) >= SPOTLIGHT_MIN_TOKENS &&
      Date.now() - lastGift.at < SPOTLIGHT_MS
        ? SPOTLIGHT_MS
        : 0;

    // Los temporizadores no dependen de la meta: un regalo que llega justo
    // despues (un combo) no debe cancelar la celebracion.
    timersRef.current.push(
      setTimeout(() => setShowing(true), wait),
      setTimeout(() => setShowing(false), wait + SPOTLIGHT_MS),
    );
  }, [goal]);

  useEffect(() => () => timersRef.current.forEach(clearTimeout), []);

  if (!showing || !goal) return null;

  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex animate-spotlight flex-col items-center justify-center text-center">
      <div className="absolute h-72 w-72 rounded-full bg-champagne-gold/35 blur-3xl" />
      <span className="relative text-[6rem] leading-none">🏆</span>
      <p className="relative mt-3 font-heading text-2xl uppercase tracking-wide text-champagne-gold [text-shadow:0_2px_8px_rgb(0_0_0/0.7)]">
        {t('live.goalReached')}
      </p>
      <p className="relative max-w-[80%] truncate text-sm text-white [text-shadow:0_1px_4px_rgb(0_0_0/0.7)]">
        {goal.label}
      </p>
    </div>
  );
}
