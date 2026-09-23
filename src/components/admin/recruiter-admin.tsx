'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronDown, Loader2, Pause, Play, Plus, Wallet } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { RecruiterOverview, RecruitStatus } from '@/lib/recruiters';
import { cn, formatMoney } from '@/lib/utils';
import {
  createRecruiterAction,
  payRecruiterAction,
  updateRecruiterAction,
} from '@/server/actions/recruiters';

const MONTH_OPTIONS: { value: string; label: string }[] = [
  { value: '6', label: '6 meses' },
  { value: '12', label: '12 meses' },
  { value: '24', label: '24 meses' },
  { value: 'forever', label: 'Para siempre' },
];

const STATUS: Record<RecruitStatus, { label: string; cls: string }> = {
  registered: { label: 'Registrada', cls: 'bg-muted text-muted-foreground' },
  verifying: { label: 'Verificandose', cls: 'bg-amber-500/15 text-amber-500' },
  active: { label: 'Activa', cls: 'bg-state-connected/15 text-state-connected' },
  out_of_quota: { label: 'Fuera de cupo', cls: 'bg-destructive/15 text-destructive' },
};

function TermsFields({
  percent,
  setPercent,
  months,
  setMonths,
  cap,
  setCap,
}: {
  percent: string;
  setPercent: (v: string) => void;
  months: string;
  setMonths: (v: string) => void;
  cap: string;
  setCap: (v: string) => void;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <label className="space-y-1 text-xs text-muted-foreground">
        % de cada venta (1-10)
        <Input type="number" min={1} max={10} value={percent} onChange={(e) => setPercent(e.target.value)} />
      </label>
      <label className="space-y-1 text-xs text-muted-foreground">
        Durante
        <select
          value={months}
          onChange={(e) => setMonths(e.target.value)}
          className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground"
        >
          {MONTH_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <label className="space-y-1 text-xs text-muted-foreground">
        Cupo de creadoras (vacio = sin tope)
        <Input type="number" min={1} value={cap} onChange={(e) => setCap(e.target.value)} placeholder="Sin tope" />
      </label>
    </div>
  );
}

const toMonths = (v: string) => (v === 'forever' ? null : Number(v));
const toCap = (v: string) => (v.trim() === '' ? null : Number(v));

/** Alta de un reclutador con las condiciones negociadas. */
export function CreateRecruiterForm() {
  const router = useRouter();
  const [account, setAccount] = useState('');
  const [code, setCode] = useState('');
  const [percent, setPercent] = useState('3');
  const [months, setMonths] = useState('12');
  const [cap, setCap] = useState('');
  const [notes, setNotes] = useState('');
  const [isPending, startTransition] = useTransition();

  function submit() {
    startTransition(async () => {
      const r = await createRecruiterAction({
        account,
        code: code.trim() || undefined,
        commissionPercent: Number(percent),
        months: toMonths(months),
        maxCreators: toCap(cap),
        notes: notes.trim() || undefined,
      });
      if (!r.ok) {
        toast.error(r.error ?? 'No se pudo crear.');
        return;
      }
      toast.success(r.message ?? 'Creado');
      setAccount('');
      setCode('');
      setNotes('');
      router.refresh();
    });
  }

  return (
    <section className="space-y-3 rounded-2xl border border-border/60 bg-card p-5">
      <h2 className="font-semibold">Nuevo reclutador</h2>
      <p className="text-xs text-muted-foreground">
        La persona se registra normal en la web y te pasa su @usuario. Aqui le das las condiciones
        que habeis negociado; le aparecera su panel de reclutador con su enlace.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-xs text-muted-foreground">
          @usuario o email de su cuenta
          <Input value={account} onChange={(e) => setAccount(e.target.value)} placeholder="@usuario" />
        </label>
        <label className="space-y-1 text-xs text-muted-foreground">
          Codigo de su enlace (opcional)
          <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Se usa su @usuario" />
        </label>
      </div>
      <TermsFields
        percent={percent}
        setPercent={setPercent}
        months={months}
        setMonths={setMonths}
        cap={cap}
        setCap={setCap}
      />
      <label className="block space-y-1 text-xs text-muted-foreground">
        Notas internas (lo que habeis acordado, contacto, como se le paga…)
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          className="w-full resize-none rounded-md border border-input bg-background p-2 text-sm text-foreground"
        />
      </label>
      <Button variant="brand" onClick={submit} disabled={isPending || !account.trim()}>
        {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
        Crear reclutador
      </Button>
    </section>
  );
}

/** Un reclutador: resumen, a quien trajo, cambiar condiciones, pausar y pagar. */
export function RecruiterRow({ r, baseUrl }: { r: RecruiterOverview; baseUrl: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [percent, setPercent] = useState(String(r.commissionPercent));
  const [months, setMonths] = useState(r.months == null ? 'forever' : String(r.months));
  const [cap, setCap] = useState(r.maxCreators == null ? '' : String(r.maxCreators));
  const [notes, setNotes] = useState(r.notes ?? '');
  const [isPending, startTransition] = useTransition();

  function run(fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) {
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) toast.error(res.error ?? 'No se pudo.');
      else {
        toast.success(res.message ?? 'Hecho');
        router.refresh();
      }
    });
  }

  return (
    <li className={cn('rounded-2xl border bg-card', r.active ? 'border-border/60' : 'border-dashed border-border/60 opacity-70')}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 p-4 text-left"
      >
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate font-semibold">@{r.account.username ?? r.code}</span>
            {!r.active && (
              <span className="rounded bg-muted px-1.5 text-[10px] font-bold uppercase">Pausado</span>
            )}
          </span>
          <span className="block truncate text-xs text-muted-foreground">
            {r.commissionPercent}% · {r.months == null ? 'para siempre' : `${r.months} meses`} ·{' '}
            {r.maxCreators == null ? 'sin tope' : `cupo ${r.maxCreators}`} · {r.totals.verified}/
            {r.totals.registered} verificadas
          </span>
        </span>
        <span className="text-right">
          <span className="block text-sm font-bold text-state-connected">
            {formatMoney(r.totals.pendingCents)}
          </span>
          <span className="block text-[10px] text-muted-foreground">por pagar</span>
        </span>
        <ChevronDown className={cn('h-4 w-4 shrink-0 transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="space-y-4 border-t border-border/60 p-4">
          <p className="break-all font-mono text-xs text-muted-foreground">
            {baseUrl}/reclutar/{r.code}
          </p>
          <div className="grid grid-cols-3 gap-2 text-center text-xs">
            <div className="rounded-xl bg-muted/40 p-2">
              <p className="text-muted-foreground">Ganado total</p>
              <p className="font-bold">{formatMoney(r.totals.earnedCents)}</p>
            </div>
            <div className="rounded-xl bg-muted/40 p-2">
              <p className="text-muted-foreground">Pagado</p>
              <p className="font-bold">{formatMoney(r.totals.paidCents)}</p>
            </div>
            <div className="rounded-xl bg-muted/40 p-2">
              <p className="text-muted-foreground">Por pagar</p>
              <p className="font-bold text-state-connected">{formatMoney(r.totals.pendingCents)}</p>
            </div>
          </div>

          {r.recruits.length > 0 && (
            <ul className="divide-y divide-border/60 rounded-xl border border-border/60 text-sm">
              {r.recruits.map((c) => (
                <li key={c.userId} className="flex items-center gap-2 px-3 py-2">
                  <span className="min-w-0 flex-1 truncate">{c.name}</span>
                  <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-medium', STATUS[c.status].cls)}>
                    {STATUS[c.status].label}
                  </span>
                  <span className="w-16 text-right text-xs">{formatMoney(c.earnedCents)}</span>
                </li>
              ))}
            </ul>
          )}

          <TermsFields
            percent={percent}
            setPercent={setPercent}
            months={months}
            setMonths={setMonths}
            cap={cap}
            setCap={setCap}
          />
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder="Notas internas"
            className="w-full resize-none rounded-md border border-input bg-background p-2 text-sm"
          />
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={isPending}
              onClick={() =>
                run(() =>
                  updateRecruiterAction({
                    id: r.id,
                    commissionPercent: Number(percent),
                    months: toMonths(months),
                    maxCreators: toCap(cap),
                    notes,
                  }),
                )
              }
            >
              Guardar condiciones
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={isPending}
              onClick={() => run(() => updateRecruiterAction({ id: r.id, active: !r.active }))}
            >
              {r.active ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              {r.active ? 'Pausar' : 'Reactivar'}
            </Button>
            <Button
              size="sm"
              variant="brand"
              disabled={isPending || r.totals.pendingCents <= 0}
              onClick={() => {
                const note = window.prompt(
                  `Anotar pago de ${formatMoney(r.totals.pendingCents)} a @${r.account.username}. Como se le pago (referencia):`,
                );
                if (note === null) return;
                run(() => payRecruiterAction({ id: r.id, note }));
              }}
            >
              <Wallet className="h-4 w-4" />
              Anotar pago
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}
