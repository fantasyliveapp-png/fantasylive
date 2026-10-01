'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CalendarDays, Check, Coins, Gift, Loader2, PhoneMissed, Send, Video, X } from 'lucide-react';
import { toast } from 'sonner';
import type { BookingStatus, ContentRequestStatus } from '@prisma/client';

import { Button } from '@/components/ui/button';
import { cn, formatDateTime, formatTokens } from '@/lib/utils';
import { cancelBookingAction, confirmBookingAction } from '@/server/actions/bookings';
import {
  cancelContentRequestAction,
  declineContentRequestAction,
  payContentRequestAction,
  quoteContentRequestAction,
} from '@/server/actions/content-requests';

/**
 * TARJETAS DE PEDIDOS Y CITAS dentro del chat: todo lo que se negocia con un
 * fan se hace aqui, sin salir de la conversacion. La tarjeta cambia de estado
 * (pedido -> precio -> pagado -> entregado; cita -> confirmada).
 */

export type DealView =
  | {
      kind: 'request';
      id: string;
      createdAt: string;
      status: ContentRequestStatus;
      description: string;
      quotedTokens: number | null;
      modelNote: string | null;
    }
  | {
      kind: 'booking';
      id: string;
      createdAt: string;
      status: BookingStatus;
      startsAt: string;
      durationMinutes: number;
      totalTokens: number;
      userNote: string | null;
    }
  | {
      /** Videollamada directa (las de una cita van en su tarjeta). */
      kind: 'call';
      id: string;
      createdAt: string;
      outcome: 'done' | 'live' | 'missed' | 'declined' | 'cancelled';
      seconds: number;
      /** Fan: lo que pago. Creador: lo que gano. */
      tokens: number;
    }
  | {
      /** Cupon personal que el creador le envio al fan. */
      kind: 'coupon';
      id: string;
      createdAt: string;
      target: 'CALL' | 'CONTENT';
      percentOff: number;
      endsAt: string | null;
      status: 'live' | 'used' | 'expired';
    };

type Result = { ok: boolean; error?: string; message?: string };

function useRun() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  function run(fn: () => Promise<Result>, after?: () => void) {
    startTransition(async () => {
      const r = await fn();
      if (r.ok) {
        if (r.message) toast.success(r.message);
        after?.();
        router.refresh();
      } else toast.error(r.error ?? 'No se pudo completar.');
    });
  }
  return { run, isPending };
}

export function DealCard({
  deal,
  isCreator,
  onDeliver,
}: {
  deal: DealView;
  isCreator: boolean;
  /** Creador: empezar a entregar este pedido (adjuntar o desde la Boveda). */
  onDeliver: (deal: Extract<DealView, { kind: 'request' }>) => void;
}) {
  if (deal.kind === 'call') return <CallRow deal={deal} isCreator={isCreator} />;
  if (deal.kind === 'coupon') return <CouponCard deal={deal} isCreator={isCreator} />;
  return deal.kind === 'request' ? (
    <RequestCard deal={deal} isCreator={isCreator} onDeliver={onDeliver} />
  ) : (
    <BookingCard deal={deal} isCreator={isCreator} />
  );
}

/** Una linea discreta en el hilo, como en cualquier app de mensajes. */
function CallRow({ deal, isCreator }: { deal: Extract<DealView, { kind: 'call' }>; isCreator: boolean }) {
  const mins = deal.seconds < 60 ? '<1' : String(Math.round(deal.seconds / 60));
  const at = new Date(deal.createdAt);
  const clock = at.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
  // De hoy, solo la hora; si no, tambien el dia.
  const time =
    at.toDateString() === new Date().toDateString()
      ? clock
      : `${at.toLocaleDateString('es', { day: 'numeric', month: 'short' })} ${clock}`;
  const bad = deal.outcome === 'missed' || deal.outcome === 'declined';
  const text =
    deal.outcome === 'done'
      ? `Videollamada · ${mins} min`
      : deal.outcome === 'live'
        ? 'Videollamada en curso'
        : deal.outcome === 'missed'
          ? isCreator
            ? 'Llamada perdida'
            : 'No contestó la llamada'
          : deal.outcome === 'declined'
            ? isCreator
              ? 'Rechazaste la llamada'
              : 'Llamada rechazada'
            : 'Llamada cancelada';
  return (
    <div className="flex justify-center">
      <span
        className={cn(
          'inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs',
          bad && isCreator ? 'border-rose-500/40 text-rose-500' : 'border-border/60 text-muted-foreground',
        )}
      >
        {bad ? <PhoneMissed className="h-3.5 w-3.5" /> : <Video className="h-3.5 w-3.5" />}
        <span className="font-medium">{text}</span>
        {deal.outcome === 'done' && deal.tokens > 0 && (
          <span className={cn('font-semibold', isCreator ? 'text-state-connected' : 'text-token')}>
            {isCreator ? '+' : ''}
            {formatTokens(deal.tokens)} tk
          </span>
        )}
        <span className="opacity-70">{time}</span>
      </span>
    </div>
  );
}

/** Cupon del creador: el fan ve el descuento y como usarlo. */
function CouponCard({ deal, isCreator }: { deal: Extract<DealView, { kind: 'coupon' }>; isCreator: boolean }) {
  const what = deal.target === 'CALL' ? 'tu próxima videollamada' : 'el próximo contenido que desbloquees';
  const until = deal.endsAt
    ? new Date(deal.endsAt).toLocaleString('es', { weekday: 'short', hour: '2-digit', minute: '2-digit' })
    : null;
  const badge =
    deal.status === 'used'
      ? { label: 'Usado', tone: 'bg-state-connected/15 text-state-connected' }
      : deal.status === 'live'
        ? { label: until ? `Hasta ${until}` : 'Activo', tone: 'bg-champagne-gold/15 text-champagne-gold' }
        : { label: 'Caducado', tone: 'bg-muted text-muted-foreground' };
  return (
    <Shell icon={<Gift className="h-4 w-4" />} title="Cupón" badge={badge} muted={deal.status !== 'live'}>
      <p className="font-heading text-2xl text-champagne-gold">−{deal.percentOff}%</p>
      <p className="text-sm">
        {isCreator ? (
          <>Le enviaste un descuento en {deal.target === 'CALL' ? 'su próxima videollamada' : 'tu contenido'}.</>
        ) : (
          <>En {what}. Se aplica solo al pagar{deal.target === 'CALL' ? ': llama con el botón de arriba' : ''}.</>
        )}
      </p>
    </Shell>
  );
}

const REQUEST_STEP: Record<ContentRequestStatus, { label: string; tone: string }> = {
  PENDING: { label: 'Esperando precio', tone: 'bg-amber-500/15 text-amber-500' },
  QUOTED: { label: 'Esperando pago', tone: 'bg-token/15 text-token' },
  PAID: { label: 'Pagado · por entregar', tone: 'bg-primary/15 text-primary' },
  DELIVERED: { label: 'Entregado', tone: 'bg-state-connected/15 text-state-connected' },
  DECLINED: { label: 'Rechazado', tone: 'bg-muted text-muted-foreground' },
  CANCELLED: { label: 'Cancelado', tone: 'bg-muted text-muted-foreground' },
};

function RequestCard({
  deal,
  isCreator,
  onDeliver,
}: {
  deal: Extract<DealView, { kind: 'request' }>;
  isCreator: boolean;
  onDeliver: (deal: Extract<DealView, { kind: 'request' }>) => void;
}) {
  const { run, isPending } = useRun();
  const [editing, setEditing] = useState(false);
  const [price, setPrice] = useState(deal.quotedTokens ?? 100);
  const [note, setNote] = useState(deal.modelNote ?? '');
  const [confirmPay, setConfirmPay] = useState(false);
  const step = REQUEST_STEP[deal.status];
  const open = deal.status === 'PENDING' || deal.status === 'QUOTED';

  return (
    <Shell icon={<Gift className="h-4 w-4" />} title="Pedido a medida" badge={step} muted={!open && deal.status !== 'PAID'}>
      <p className="whitespace-pre-wrap break-words text-sm">{deal.description}</p>
      {deal.quotedTokens != null && deal.status !== 'PENDING' && (
        <p className="flex items-center gap-1.5 text-sm font-semibold text-token">
          <Coins className="h-4 w-4" /> {formatTokens(deal.quotedTokens)} tokens
        </p>
      )}
      {deal.modelNote && <p className="text-xs text-muted-foreground">Nota: {deal.modelNote}</p>}

      {/* CREADOR */}
      {isCreator && (deal.status === 'PENDING' || editing) && (
        <div className="space-y-2 border-t border-border/60 pt-2.5">
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              Precio
              <input
                type="number"
                min={1}
                value={price}
                onChange={(e) => setPrice(Math.max(1, Number(e.target.value) || 1))}
                className="h-8 w-20 rounded-md border border-input bg-background px-2 text-sm"
              />
              tk
            </label>
          </div>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={200}
            placeholder="Nota (opcional): qué incluye, cuándo lo entregas…"
            className="h-9 w-full rounded-md border border-input bg-background px-2.5 text-sm"
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="brand"
              className="flex-1"
              disabled={isPending}
              onClick={() =>
                run(() => quoteContentRequestAction({ requestId: deal.id, quotedTokens: price, note }), () =>
                  setEditing(false),
                )
              }
            >
              {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              Enviar precio
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={isPending}
              onClick={() => (editing ? setEditing(false) : run(() => declineContentRequestAction({ requestId: deal.id })))}
            >
              {editing ? 'Cancelar' : 'Rechazar'}
            </Button>
          </div>
        </div>
      )}
      {isCreator && deal.status === 'QUOTED' && !editing && (
        <div className="flex gap-2 border-t border-border/60 pt-2.5">
          <Button size="sm" variant="secondary" className="flex-1" onClick={() => setEditing(true)}>
            Cambiar precio
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={isPending}
            onClick={() => run(() => declineContentRequestAction({ requestId: deal.id }))}
          >
            Rechazar
          </Button>
        </div>
      )}
      {isCreator && deal.status === 'PAID' && (
        <Button size="sm" variant="brand" className="w-full" onClick={() => onDeliver(deal)}>
          <Gift className="h-3.5 w-3.5" /> Entregar ahora
        </Button>
      )}

      {/* FAN */}
      {!isCreator && deal.status === 'PENDING' && (
        <div className="flex items-center justify-between gap-2 border-t border-border/60 pt-2.5 text-xs text-muted-foreground">
          Te avisamos cuando le ponga precio.
          <Button size="sm" variant="ghost" disabled={isPending} onClick={() => run(() => cancelContentRequestAction(deal.id))}>
            Cancelar
          </Button>
        </div>
      )}
      {!isCreator && deal.status === 'QUOTED' && deal.quotedTokens != null && (
        <div className="space-y-2 border-t border-border/60 pt-2.5">
          {confirmPay ? (
            <>
              <p className="text-xs">
                Se descontarán <b>{formatTokens(deal.quotedTokens)} tokens</b> de tu monedero. Te lo
                entregará en este chat.
              </p>
              <div className="flex gap-2">
                <Button size="sm" variant="ghost" className="flex-1" onClick={() => setConfirmPay(false)}>
                  Ahora no
                </Button>
                <Button
                  size="sm"
                  variant="token"
                  className="flex-1"
                  disabled={isPending}
                  onClick={() => run(() => payContentRequestAction(deal.id), () => setConfirmPay(false))}
                >
                  {isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Pagar
                </Button>
              </div>
            </>
          ) : (
            <div className="flex gap-2">
              <Button size="sm" variant="token" className="flex-1" onClick={() => setConfirmPay(true)}>
                <Coins className="h-3.5 w-3.5" /> Pagar {formatTokens(deal.quotedTokens)} tk
              </Button>
              <Button size="sm" variant="ghost" disabled={isPending} onClick={() => run(() => cancelContentRequestAction(deal.id))}>
                Cancelar
              </Button>
            </div>
          )}
        </div>
      )}
      {!isCreator && deal.status === 'PAID' && (
        <p className="border-t border-border/60 pt-2.5 text-xs text-muted-foreground">
          Pagado. Te lo entregará aquí mismo, en este chat.
        </p>
      )}
    </Shell>
  );
}

const BOOKING_STEP: Partial<Record<BookingStatus, { label: string; tone: string }>> = {
  PENDING_CONFIRMATION: { label: 'Por confirmar', tone: 'bg-amber-500/15 text-amber-500' },
  CONFIRMED: { label: 'Confirmada', tone: 'bg-state-connected/15 text-state-connected' },
  IN_PROGRESS: { label: 'En curso', tone: 'bg-primary/15 text-primary' },
  COMPLETED: { label: 'Hecha', tone: 'bg-muted text-muted-foreground' },
};

function BookingCard({ deal, isCreator }: { deal: Extract<DealView, { kind: 'booking' }>; isCreator: boolean }) {
  const { run, isPending } = useRun();
  const [confirmCancel, setConfirmCancel] = useState(false);
  const step = BOOKING_STEP[deal.status] ?? { label: 'Cancelada', tone: 'bg-muted text-muted-foreground' };
  const active = deal.status === 'PENDING_CONFIRMATION' || deal.status === 'CONFIRMED' || deal.status === 'IN_PROGRESS';
  const manageHref = isCreator ? '/dashboard/model/bookings' : '/bookings';

  return (
    <Shell icon={<CalendarDays className="h-4 w-4" />} title="Videollamada reservada" badge={step} muted={!active}>
      <p className="text-sm font-medium">
        {formatDateTime(deal.startsAt)} · {deal.durationMinutes} min
      </p>
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Coins className="h-3.5 w-3.5 text-token" /> {formatTokens(deal.totalTokens)} tokens{' '}
        {deal.status === 'PENDING_CONFIRMATION' ? 'retenidos' : ''}
      </p>
      {deal.userNote && <p className="text-xs text-muted-foreground">«{deal.userNote}»</p>}

      {active && (
        <div className="space-y-2 border-t border-border/60 pt-2.5">
          {confirmCancel ? (
            <>
              <p className="text-xs">
                {isCreator
                  ? 'Se le devolverán todos sus tokens.'
                  : 'Si faltan menos de 2 horas se devuelve solo la mitad.'}
              </p>
              <div className="flex gap-2">
                <Button size="sm" variant="ghost" className="flex-1" onClick={() => setConfirmCancel(false)}>
                  No
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  className="flex-1"
                  disabled={isPending}
                  onClick={() => run(() => cancelBookingAction(deal.id), () => setConfirmCancel(false))}
                >
                  {isCreator && deal.status === 'PENDING_CONFIRMATION' ? 'Sí, rechazar' : 'Sí, cancelar'}
                </Button>
              </div>
            </>
          ) : (
            <div className="flex gap-2">
              {isCreator && deal.status === 'PENDING_CONFIRMATION' && (
                <Button
                  size="sm"
                  variant="brand"
                  className="flex-1"
                  disabled={isPending}
                  onClick={() => run(() => confirmBookingAction(deal.id))}
                >
                  {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                  Confirmar
                </Button>
              )}
              {deal.status !== 'PENDING_CONFIRMATION' && (
                <Link href={manageHref} className="flex-1">
                  <Button size="sm" variant="secondary" className="w-full">
                    Ir a la videollamada
                  </Button>
                </Link>
              )}
              {deal.status !== 'IN_PROGRESS' && (
                <Button size="sm" variant="ghost" onClick={() => setConfirmCancel(true)}>
                  <X className="h-3.5 w-3.5" />
                  {isCreator && deal.status === 'PENDING_CONFIRMATION' ? 'Rechazar' : 'Cancelar'}
                </Button>
              )}
            </div>
          )}
          {!isCreator && deal.status === 'PENDING_CONFIRMATION' && !confirmCancel && (
            <p className="text-xs text-muted-foreground">Esperando a que la confirme.</p>
          )}
        </div>
      )}
    </Shell>
  );
}

function Shell({
  icon,
  title,
  badge,
  muted,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  badge: { label: string; tone: string };
  muted?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex justify-center">
      <div
        className={cn(
          'w-full max-w-sm space-y-2 rounded-2xl border bg-card p-3.5',
          muted ? 'border-border/40 opacity-75' : 'border-champagne-gold/40',
        )}
      >
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-champagne-gold/15 text-champagne-gold">
            {icon}
          </span>
          <span className="flex-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</span>
          <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold', badge.tone)}>{badge.label}</span>
        </div>
        {children}
      </div>
    </div>
  );
}
