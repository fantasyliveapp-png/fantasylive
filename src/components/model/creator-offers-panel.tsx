'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Clock, Crown, Flame, Gift, Loader2, PhoneCall, Sparkles, Ticket, Zap, type LucideIcon } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { creatorUsd } from '@/components/money/creator-price';
import {
  CREATOR_OFFER_INFO,
  CREATOR_OFFER_LIMITS,
  CREATOR_OFFER_PERCENTS,
  discountTokens,
} from '@/lib/creator-offer-rules';
import type { EconomyParams } from '@/lib/earnings';
import { formatRateNumber, MIN_RATE_CENTITOKENS } from '@/lib/rates';
import { cn, formatMoney } from '@/lib/utils';
import {
  setStandingOfferAction,
  startFlashSaleAction,
  startHappyHourAction,
  stopOfferAction,
  type OfferActionResult,
} from '@/server/actions/creator-offers';

export interface OfferRow {
  id: string;
  kind: 'HAPPY_HOUR' | 'FLASH_SALE' | 'FIRST_MONTH' | 'FIRST_CALL' | 'COUPON';
  percentOff: number;
  endsAt: string | null;
  uses: number;
  tokensPaid: number;
}

type CouponRow = {
  id: string;
  fanName: string;
  target: 'CALL' | 'CONTENT';
  percentOff: number;
  status: 'live' | 'used' | 'expired';
};

/** "quedan 1 h 20 min" */
function useLeft(endsAt: string | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!endsAt) return;
    const t = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(t);
  }, [endsAt]);
  if (!endsAt) return null;
  const mins = Math.max(0, Math.round((new Date(endsAt).getTime() - now) / 60_000));
  const h = Math.floor(mins / 60);
  return h > 0 ? `quedan ${h} h ${mins % 60} min` : `quedan ${mins} min`;
}

function useRun() {
  const router = useRouter();
  const [isPending, start] = useTransition();
  return {
    isPending,
    run(fn: () => Promise<OfferActionResult>) {
      start(async () => {
        const r = await fn();
        if (r.ok) {
          toast.success(r.message ?? 'Hecho');
          router.refresh();
        } else toast.error(r.error ?? 'No se pudo.');
      });
    },
  };
}

function Chips<T extends number>({
  values,
  value,
  onChange,
  format,
}: {
  values: readonly T[];
  value: T;
  onChange: (v: T) => void;
  format: (v: T) => string;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {values.map((v) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          className={cn(
            'h-9 min-w-[3.25rem] rounded-full px-3 text-sm font-semibold transition-colors',
            v === value ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground hover:bg-muted/70',
          )}
        >
          {format(v)}
        </button>
      ))}
    </div>
  );
}

/** Tarjeta de una oferta: elegir %, (duracion), ver lo que gana y activar. */
function OfferCard({
  icon: Icon,
  kind,
  active,
  example,
  durations,
  durationLabel,
  extra,
  disabledReason,
  onStart,
}: {
  icon: LucideIcon;
  kind: OfferRow['kind'];
  active: OfferRow | null;
  /** Texto "ganas X en vez de Y" para el % elegido. */
  example: (percent: number) => React.ReactNode;
  durations?: readonly number[];
  durationLabel?: (h: number) => string;
  extra?: React.ReactNode;
  disabledReason?: string;
  onStart: (percent: number, hours: number) => Promise<OfferActionResult>;
}) {
  const info = CREATOR_OFFER_INFO[kind];
  const [percent, setPercent] = useState<number>(20);
  const [hours, setHours] = useState<number>(durations?.[0] ?? 0);
  const { run, isPending } = useRun();
  const left = useLeft(active?.endsAt ?? null);

  return (
    <section
      className={cn(
        'space-y-4 rounded-2xl border bg-card p-4 sm:p-5',
        active ? 'border-state-connected/50' : 'border-border/60',
      )}
    >
      <div className="flex items-start gap-3">
        <span
          className={cn(
            'flex h-11 w-11 shrink-0 items-center justify-center rounded-xl',
            active ? 'bg-state-connected/15 text-state-connected' : 'bg-primary/10 text-primary',
          )}
        >
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold">{info.title}</h2>
          <p className="text-sm text-muted-foreground">{info.short}</p>
        </div>
      </div>

      {active ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 rounded-xl bg-state-connected/10 px-3 py-2.5 text-sm">
            <span className="font-semibold text-state-connected">Activa · −{active.percentOff}%</span>
            {left && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Clock className="h-3.5 w-3.5" />
                {left}
              </span>
            )}
            <span className="ml-auto text-xs text-muted-foreground">
              {active.uses} {active.uses === 1 ? 'venta' : 'ventas'} con esta oferta
            </span>
          </div>
          <p className="text-xs text-muted-foreground">{example(active.percentOff)}</p>
          <Button variant="outline" className="w-full" disabled={isPending} onClick={() => run(() => stopOfferAction(active.id))}>
            {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Parar oferta
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">Descuento</p>
            <Chips values={CREATOR_OFFER_PERCENTS} value={percent as (typeof CREATOR_OFFER_PERCENTS)[number]} onChange={setPercent} format={(v) => `−${v}%`} />
          </div>
          {durations && (
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">Duración</p>
              <Chips values={durations} value={hours} onChange={setHours} format={durationLabel ?? ((h) => `${h} h`)} />
            </div>
          )}
          {extra}
          <p className="rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground">{example(percent)}</p>
          <Button
            variant="brand"
            className="w-full"
            disabled={isPending || Boolean(disabledReason)}
            onClick={() => run(() => onStart(percent, hours))}
          >
            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {disabledReason ?? `Activar −${percent}%`}
          </Button>
        </div>
      )}
    </section>
  );
}

export function CreatorOffersPanel({
  economy,
  privateRateCentitokens,
  subscription,
  typicalContentTokens,
  active,
  coupons,
}: {
  economy: EconomyParams;
  privateRateCentitokens: number;
  /** Precio de su suscripcion (null si no la tiene activada). */
  subscription: number | null;
  typicalContentTokens: number;
  active: Record<'HAPPY_HOUR' | 'FLASH_SALE' | 'FIRST_MONTH' | 'FIRST_CALL', OfferRow | null>;
  coupons: CouponRow[];
}) {
  const [notify, setNotify] = useState(true);
  const usd = (t: number) => creatorUsd(t, economy);

  // Ganancia exacta por minuto (la tarifa tiene decimales: centitokens).
  const perMinute = (rate: number) =>
    formatMoney(
      Math.round(
        (rate / 100) *
          ((100 - economy.platformCommissionPercent) / 100) *
          economy.payoutCentsPerToken *
          ((100 - economy.payoutFeePercent) / 100),
      ),
    );
  const rateWith = (p: number) =>
    Math.max(MIN_RATE_CENTITOKENS, Math.round((privateRateCentitokens * (100 - p)) / 100));

  const callExample = (p: number) => (
    <>
      Llamada a <strong>{formatRateNumber(rateWith(p))} tk/min</strong> en vez de {formatRateNumber(privateRateCentitokens)}: ganas{' '}
      <strong className="text-state-connected">{perMinute(rateWith(p))}</strong> por minuto en vez de {perMinute(privateRateCentitokens)}.
    </>
  );

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-heading text-2xl uppercase tracking-wide sm:text-3xl">Ofertas</h1>
        <p className="mt-1 text-sm text-muted-foreground">Atrae fans nuevos y vende más con descuentos de tiempo limitado.</p>
      </div>

      <div className="flex items-start gap-3 rounded-2xl border border-champagne-gold/40 bg-champagne-gold/10 p-4 text-sm">
        <Gift className="mt-0.5 h-5 w-5 shrink-0 text-champagne-gold" />
        <p>
          <strong>Las ofertas salen de tu precio.</strong> El fan paga menos y tú ganas menos por esa venta, a cambio de
          vender más. Debajo de cada una ves lo que ganas en $. No se suman entre sí: el fan recibe la mejor.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <OfferCard
          icon={Zap}
          kind="HAPPY_HOUR"
          active={active.HAPPY_HOUR}
          durations={CREATOR_OFFER_LIMITS.happyHourHours}
          example={callExample}
          onStart={(p, h) => startHappyHourAction(p, h)}
        />
        <OfferCard
          icon={Flame}
          kind="FLASH_SALE"
          active={active.FLASH_SALE}
          durations={CREATOR_OFFER_LIMITS.flashSaleHours}
          durationLabel={(h) => (h === 24 ? '1 día' : `${h / 24} días`)}
          example={(p) => (
            <>
              Un contenido de <strong>{typicalContentTokens} tk</strong> sale a{' '}
              <strong>{discountTokens(typicalContentTokens, p)} tk</strong>: ganas{' '}
              <strong className="text-state-connected">{usd(discountTokens(typicalContentTokens, p))}</strong> en vez de{' '}
              {usd(typicalContentTokens)} por venta.
            </>
          )}
          extra={
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} className="h-4 w-4 accent-primary" />
              Avisar a mis seguidores
            </label>
          }
          onStart={(p, h) => startFlashSaleAction(p, h, notify)}
        />
        <OfferCard
          icon={Crown}
          kind="FIRST_MONTH"
          active={active.FIRST_MONTH}
          disabledReason={subscription == null ? 'Activa tu suscripción en Precios' : undefined}
          example={(p) =>
            subscription == null ? (
              'Primero activa tu suscripción mensual en Precios.'
            ) : (
              <>
                El primer mes cuesta <strong>{discountTokens(subscription, p)} tk</strong> en vez de {subscription}: ganas{' '}
                <strong className="text-state-connected">{usd(discountTokens(subscription, p))}</strong> en vez de{' '}
                {usd(subscription)}. Desde el segundo mes, precio normal.
              </>
            )
          }
          onStart={(p) => setStandingOfferAction('FIRST_MONTH', p)}
        />
        <OfferCard
          icon={PhoneCall}
          kind="FIRST_CALL"
          active={active.FIRST_CALL}
          example={(p) => (
            <>
              Solo para fans que nunca te han llamado. {callExample(p)}
            </>
          )}
          onStart={(p) => setStandingOfferAction('FIRST_CALL', p)}
        />
      </div>

      {/* Cupones: se envian desde el chat */}
      <section className="space-y-3 rounded-2xl border border-border/60 bg-card p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Ticket className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="font-semibold">{CREATOR_OFFER_INFO.COUPON.title}</h2>
            <p className="text-sm text-muted-foreground">
              Abre el chat con ese fan y toca <strong>🎁 Cupón</strong> arriba. Eliges si vale para una videollamada o
              para tu contenido, y el %.
            </p>
          </div>
        </div>
        {coupons.length > 0 && (
          <ul className="divide-y divide-border/60 rounded-xl bg-muted/30 text-sm">
            {coupons.map((c) => (
              <li key={c.id} className="flex items-center gap-2 px-3 py-2">
                <span className="min-w-0 flex-1 truncate">
                  {c.fanName} · −{c.percentOff}% en {c.target === 'CALL' ? 'videollamada' : 'contenido'}
                </span>
                <span
                  className={cn(
                    'shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium',
                    c.status === 'used'
                      ? 'bg-state-connected/15 text-state-connected'
                      : c.status === 'live'
                        ? 'bg-champagne-gold/15 text-champagne-gold'
                        : 'bg-muted text-muted-foreground',
                  )}
                >
                  {c.status === 'used' ? 'Usado' : c.status === 'live' ? 'Sin usar' : 'Caducado'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
