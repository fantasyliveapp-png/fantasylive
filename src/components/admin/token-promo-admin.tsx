'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { BadgePercent, CalendarHeart, Loader2, Pause, Play, ShieldCheck, Trash2, Zap } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { roundOfferPrice } from '@/lib/price-rounding';
import { cn, formatMoney } from '@/lib/utils';
import {
  createTokenPromoAction,
  deleteTokenPromoAction,
  setTokenPromoActiveAction,
} from '@/server/actions/token-promos';

const PERCENTS = [10, 15, 20, 30];
const DURATIONS = [
  { label: '24 h', hours: 24 },
  { label: '3 dias', hours: 72 },
  { label: '1 semana', hours: 168 },
];

/** "2026-10-03T22:00" en hora local, para un input datetime-local. */
function toLocalInput(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Proximo fin de semana: viernes 00:00 a domingo 23:59 (o el actual). */
function weekendRange(now = new Date()) {
  const day = now.getDay(); // 0 domingo, 5 viernes, 6 sabado
  const inWeekend = day === 5 || day === 6 || day === 0;
  const friday = new Date(now);
  friday.setHours(0, 0, 0, 0);
  friday.setDate(friday.getDate() + (inWeekend ? -((day + 2) % 7) : 5 - day));
  const sunday = new Date(friday);
  sunday.setDate(friday.getDate() + 2);
  sunday.setHours(23, 59, 0, 0);
  return { from: inWeekend ? null : friday, to: sunday };
}

type SamplePrice = { name: string; tokens: number; priceCents: number; maxSafe: number; minSafeCents: number };

/** Mismo calculo que el servidor: % recortado al maximo seguro y precio X,99. */
function previewPrice(p: SamplePrice, pct: number) {
  const raw = Math.max(50, Math.round((p.priceCents * (100 - Math.min(pct, p.maxSafe))) / 100));
  const price = roundOfferPrice(raw, p.priceCents, p.minSafeCents) ?? p.priceCents;
  return { price, pct: Math.round((1 - price / p.priceCents) * 100) };
}

/** Nueva promocion: nombre, % y fechas, con vista previa de precios. */
export function CreateTokenPromoForm({ samplePrices }: { samplePrices: SamplePrice[] }) {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [percent, setPercent] = useState('15');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState(() => toLocalInput(new Date(Date.now() + 72 * 3600_000)));
  const [notify, setNotify] = useState(false);
  const [isPending, start] = useTransition();
  const pct = Number(percent) || 0;

  const presets = [
    {
      icon: Zap,
      label: 'Hora loca',
      hint: '−15% · 60 min · aviso a todos',
      apply: () => {
        setTitle('Hora loca');
        setPercent('15');
        setStartsAt('');
        setEndsAt(toLocalInput(new Date(Date.now() + 60 * 60_000)));
        setNotify(true);
      },
    },
    {
      icon: CalendarHeart,
      label: 'Fin de semana',
      hint: '−10% · viernes a domingo',
      apply: () => {
        const { from, to } = weekendRange();
        setTitle('Fin de semana');
        setPercent('10');
        setStartsAt(from ? toLocalInput(from) : '');
        setEndsAt(toLocalInput(to));
        setNotify(true);
      },
    },
    {
      icon: BadgePercent,
      label: 'Fecha especial',
      hint: '−20% · 3 días (San Valentín, Black Friday...)',
      apply: () => {
        setTitle('');
        setPercent('20');
        setStartsAt('');
        setEndsAt(toLocalInput(new Date(Date.now() + 72 * 3600_000)));
        setNotify(true);
      },
    },
  ];

  function submit() {
    start(async () => {
      const r = await createTokenPromoAction({
        title,
        percentOff: pct,
        startsAt: startsAt ? new Date(startsAt).toISOString() : undefined,
        endsAt: new Date(endsAt).toISOString(),
        notify,
      });
      if (!r.ok) toast.error(r.error ?? 'No se pudo crear.');
      else {
        toast.success(r.message ?? 'Creada');
        setTitle('');
        router.refresh();
      }
    });
  }

  return (
    <section className="space-y-4 rounded-2xl border border-border/60 bg-card p-5">
      <h2 className="flex items-center gap-2 font-semibold">
        <BadgePercent className="h-5 w-5 text-champagne-gold" /> Nueva promocion
      </h2>
      <div className="grid gap-2 sm:grid-cols-3">
        {presets.map((p) => (
          <button
            key={p.label}
            type="button"
            onClick={p.apply}
            className="flex items-start gap-2.5 rounded-xl border border-border/60 bg-muted/30 p-3 text-left transition-colors hover:border-champagne-gold/60"
          >
            <p.icon className="mt-0.5 h-4 w-4 shrink-0 text-champagne-gold" />
            <span>
              <span className="block text-sm font-semibold">{p.label}</span>
              <span className="block text-[11px] text-muted-foreground">{p.hint}</span>
            </span>
          </button>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-xs text-muted-foreground">
          Nombre (lo ven los fans)
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Fin de semana loco" maxLength={40} />
        </label>
        <label className="space-y-1 text-xs text-muted-foreground">
          % de descuento en todos los paquetes
          <div className="flex gap-2">
            <Input type="number" min={5} max={80} value={percent} onChange={(e) => setPercent(e.target.value)} className="w-24" />
            {PERCENTS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPercent(String(p))}
                className={cn(
                  'h-10 rounded-md px-3 text-sm font-semibold',
                  pct === p ? 'bg-champagne-gold text-black' : 'bg-muted text-foreground hover:bg-muted/70',
                )}
              >
                {p}%
              </button>
            ))}
          </div>
        </label>
        <label className="space-y-1 text-xs text-muted-foreground">
          Empieza (vacio = ahora mismo)
          <Input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
        </label>
        <label className="space-y-1 text-xs text-muted-foreground">
          Termina
          <div className="flex gap-2">
            <Input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
          </div>
          <div className="flex gap-1.5 pt-1">
            {DURATIONS.map((d) => (
              <button
                key={d.label}
                type="button"
                onClick={() => {
                  const from = startsAt ? new Date(startsAt) : new Date();
                  setEndsAt(toLocalInput(new Date(from.getTime() + d.hours * 3600_000)));
                }}
                className="rounded-full bg-muted px-2.5 py-1 text-[11px] font-medium text-foreground hover:bg-muted/70"
              >
                {d.label}
              </button>
            ))}
          </div>
        </label>
      </div>

      {pct > 0 && samplePrices.length > 0 && (
        <div className="rounded-xl bg-muted/40 p-3">
          <p className="mb-2 text-xs text-muted-foreground">Asi quedan los paquetes (nunca por debajo de su coste):</p>
          <ul className="grid gap-1.5 text-sm sm:grid-cols-2">
            {samplePrices.map((p) => (
              <li key={p.name} className="flex items-center justify-between gap-2">
                <span className="truncate">
                  {p.name} · {p.tokens} tokens
                </span>
                <span className="shrink-0 tabular-nums">
                  <span className="mr-1.5 text-xs text-muted-foreground line-through">{formatMoney(p.priceCents)}</span>
                  <span className="font-semibold text-state-connected">
                    {formatMoney(previewPrice(p, pct).price)}
                  </span>
                  <span className={cn('ml-1.5 text-[11px]', pct > p.maxSafe ? 'text-amber-500' : 'text-muted-foreground')}>
                    −{previewPrice(p, pct).pct}%{pct > p.maxSafe && ' (límite)'}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {pct > 0 && samplePrices.some((p) => pct > p.maxSafe) && (
        <p className="flex items-start gap-2 text-xs text-amber-500">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          En los paquetes marcados se aplica solo el máximo que no te hace perder dinero.
        </p>
      )}

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} className="h-4 w-4 accent-primary" />
        Avisar a todos los fans cuando empiece
      </label>

      <Button variant="brand" onClick={submit} disabled={isPending || !title.trim() || !endsAt}>
        {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <BadgePercent className="h-4 w-4" />}
        Lanzar promocion
      </Button>
    </section>
  );
}

/** Botones de una promocion de la lista. */
export function TokenPromoActions({ id, active }: { id: string; active: boolean }) {
  const router = useRouter();
  const [isPending, start] = useTransition();
  function run(fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) {
    start(async () => {
      const r = await fn();
      if (!r.ok) toast.error(r.error ?? 'No se pudo.');
      else {
        toast.success(r.message ?? 'Hecho');
        router.refresh();
      }
    });
  }
  return (
    <div className="flex gap-1.5">
      <Button size="sm" variant="outline" disabled={isPending} onClick={() => run(() => setTokenPromoActiveAction(id, !active))}>
        {active ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        {active ? 'Pausar' : 'Activar'}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        disabled={isPending}
        aria-label="Borrar"
        onClick={() => {
          if (window.confirm('¿Borrar esta promocion?')) run(() => deleteTokenPromoAction(id));
        }}
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    </div>
  );
}
