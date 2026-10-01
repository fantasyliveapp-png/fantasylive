'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Loader2, Pause, Play, Plus } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { countryFlag, countryName } from '@/lib/countries';
import { paymentMethodLabel } from '@/lib/distributor-shared';
import { cn, formatDateTime, formatMoney, formatTokens } from '@/lib/utils';
import {
  cancelOrderAction,
  confirmOrderAction,
  createDistributorAction,
  updateDistributorAction,
  type DistributorActionResult,
} from '@/server/actions/distributors';

function useRun() {
  const router = useRouter();
  const [isPending, start] = useTransition();
  return {
    isPending,
    run(fn: () => Promise<DistributorActionResult>, after?: () => void) {
      start(async () => {
        const r = await fn();
        if (r.ok) {
          toast.success(r.message ?? 'Hecho');
          after?.();
          router.refresh();
        } else toast.error(r.error ?? 'No se pudo.');
      });
    },
  };
}

/** Alta: cuenta existente (email o @usuario) + condiciones. */
export function CreateDistributorForm() {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({
    user: '',
    legalName: '',
    country: '',
    taxId: '',
    publicContact: '',
    dailyLimitTokens: '20000',
  });
  const { run, isPending } = useRun();
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  if (!open) {
    return (
      <Button variant="brand" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" /> Nuevo distribuidor
      </Button>
    );
  }
  return (
    <section className="space-y-3 rounded-2xl border border-border/60 bg-card p-5">
      <h2 className="font-semibold">Nuevo distribuidor</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Cuenta (email o @usuario; debe existir y no ser creador)">
          <Input value={f.user} onChange={set('user')} placeholder="@usuario" />
        </Field>
        <Field label="Nombre legal (persona o empresa del contrato)">
          <Input value={f.legalName} onChange={set('legalName')} />
        </Field>
        <Field label="País donde vive (código, p. ej. MX, CO, AR, US). Los países donde vende se añaden solos con sus métodos de cobro">
          <Input value={f.country} onChange={set('country')} maxLength={2} className="uppercase" />
        </Field>
        <Field label="ID fiscal (opcional)">
          <Input value={f.taxId} onChange={set('taxId')} />
        </Field>
        <Field label="Contacto público (WhatsApp, Telegram, email)">
          <Input value={f.publicContact} onChange={set('publicContact')} />
        </Field>
        <Field label="Máximo que puede vender al día (tokens)">
          <Input type="number" min={100} value={f.dailyLimitTokens} onChange={set('dailyLimitTokens')} />
        </Field>
      </div>
      <div className="flex gap-2">
        <Button variant="ghost" onClick={() => setOpen(false)}>
          Cancelar
        </Button>
        <Button
          variant="brand"
          disabled={isPending}
          onClick={() =>
            run(
              () =>
                createDistributorAction({
                  ...f,
                  country: f.country.toUpperCase(),
                  dailyLimitTokens: Number(f.dailyLimitTokens),
                }),
              () => setOpen(false),
            )
          }
        >
          {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          Crear
        </Button>
      </div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="space-y-1 text-xs text-muted-foreground">
      {label}
      {children}
    </label>
  );
}

type Row = {
  id: string;
  legalName: string;
  country: string;
  account: string;
  publicContact: string;
  status: 'ACTIVE' | 'SUSPENDED';
  countries: string[];
  methods: string[];
  dailyLimitTokens: number;
  stockTokens: number;
  sent30: number;
  idVerified: boolean;
  sanctionsChecked: boolean;
  contractSigned: boolean;
  compliant: boolean;
};

/** Un distribuidor: sus 3 pasos de verificacion, condiciones y pausa. */
export function DistributorRow({ d }: { d: Row }) {
  const { run, isPending } = useRun();
  const [limit, setLimit] = useState(String(d.dailyLimitTokens));
  const steps = [
    { key: 'idVerified', label: 'Identidad verificada', on: d.idVerified },
    { key: 'sanctionsChecked', label: 'Revisado en lista OFAC', on: d.sanctionsChecked },
    { key: 'contractSigned', label: 'Contrato firmado', on: d.contractSigned },
  ] as const;

  return (
    <div className="space-y-3 rounded-2xl border border-border/60 bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-lg">{countryFlag(d.country)}</span>
        <span className="min-w-0 flex-1">
          <span className="block font-semibold">{d.legalName}</span>
          <span className="block text-xs text-muted-foreground">
            {d.account} · {countryName(d.country)} · {d.publicContact}
          </span>
        </span>
        <span
          className={cn(
            'rounded-full px-2 py-0.5 text-[11px] font-medium',
            d.status === 'SUSPENDED'
              ? 'bg-muted text-muted-foreground'
              : d.compliant
                ? 'bg-state-connected/15 text-state-connected'
                : 'bg-amber-500/15 text-amber-500',
          )}
        >
          {d.status === 'SUSPENDED' ? 'En pausa' : d.compliant ? 'Operando' : 'Falta verificación'}
        </span>
      </div>

      <div className="grid gap-2 text-sm sm:grid-cols-3">
        <p>
          Stock: <strong>{formatTokens(d.stockTokens)} tk</strong>
        </p>
        <p>
          Entregado 30 días: <strong>{formatTokens(d.sent30)} tk</strong>
        </p>
        <p>
          Vende en: <strong>{d.countries.map((c) => countryFlag(c)).join(' ')}</strong>
        </p>
      </div>

      <p className="text-xs text-muted-foreground">
        Acepta: {d.methods.length ? d.methods.map(paymentMethodLabel).join(', ') : 'aún no ha elegido métodos de pago'}
      </p>

      <div className="flex flex-wrap gap-1.5">
        {steps.map((s) => (
          <button
            key={s.key}
            type="button"
            disabled={isPending}
            onClick={() => run(() => updateDistributorAction(d.id, { [s.key]: !s.on }))}
            className={cn(
              'flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium',
              s.on ? 'border-state-connected/50 bg-state-connected/10 text-state-connected' : 'border-border/60 text-muted-foreground',
            )}
          >
            {s.on && <Check className="h-3 w-3" />}
            {s.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <label className="space-y-1 text-[11px] text-muted-foreground">
          Máximo de venta al día (tokens)
          <Input type="number" value={limit} onChange={(e) => setLimit(e.target.value)} className="h-9 w-32" />
        </label>
        <Button
          size="sm"
          variant="outline"
          disabled={isPending}
          onClick={() =>
            run(() =>
              updateDistributorAction(d.id, {
                dailyLimitTokens: Number(limit),
              }),
            )
          }
        >
          Guardar
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={isPending}
          onClick={() => run(() => updateDistributorAction(d.id, { status: d.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE' }))}
        >
          {d.status === 'ACTIVE' ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          {d.status === 'ACTIVE' ? 'Pausar' : 'Reactivar'}
        </Button>
      </div>
    </div>
  );
}

/**
 * Lote pendiente: el distribuidor debe enviar el recibo; tú lo miras y
 * confirmas el pago (con la referencia del banco) o lo rechazas con motivo.
 */
export function PendingOrderRow({
  order,
}: {
  order: {
    id: string;
    ref: string;
    who: string;
    tokens: number;
    amountCents: number;
    createdAt: string;
    method: 'WIRE' | 'USDT';
    /** Recibo enviado por el distribuidor (URL firmada) y su referencia. */
    proofUrl: string | null;
    proofIsPdf: boolean;
    proofAt: string | null;
    distributorRef: string | null;
  };
}) {
  const { run, isPending } = useRun();
  const [ref, setRef] = useState(order.distributorRef ?? '');
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const hasProof = Boolean(order.proofUrl);

  return (
    <li className="space-y-3 px-4 py-3 text-sm">
      <div className="flex flex-wrap items-start gap-3">
        {/* Recibo */}
        {order.proofUrl ? (
          <a href={order.proofUrl} target="_blank" rel="noreferrer" className="block shrink-0 overflow-hidden rounded-lg border border-border/60 bg-muted/40" title="Abrir recibo">
            {order.proofIsPdf ? (
              <span className="flex h-20 w-16 flex-col items-center justify-center text-[10px] text-muted-foreground">PDF<br />Abrir</span>
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={order.proofUrl} alt="Recibo" className="h-20 w-16 object-cover" />
            )}
          </a>
        ) : (
          <span className="flex h-20 w-16 shrink-0 items-center justify-center rounded-lg border border-dashed border-border/60 text-center text-[10px] text-muted-foreground">
            Sin recibo
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="block font-semibold">
            {order.who} · {formatTokens(order.tokens)} tk · {formatMoney(order.amountCents)}
          </span>
          <span className="block text-xs text-muted-foreground">
            Lote {order.ref} · {order.method === 'USDT' ? 'USDT' : 'Transferencia'} · pedido {formatDateTime(order.createdAt)}
          </span>
          {hasProof ? (
            <span className="mt-1 block text-xs">
              <span className="font-semibold text-primary">Recibo enviado</span> {order.proofAt && formatDateTime(order.proofAt)} · ref.{' '}
              <span className="font-mono">{order.distributorRef}</span>. Comprueba que el dinero llegó a tu cuenta.
            </span>
          ) : (
            <span className="mt-1 block text-xs text-amber-500">Esperando que el distribuidor pague y envíe el recibo.</span>
          )}
        </span>
      </div>

      {hasProof && !rejecting && (
        <div className="flex flex-wrap items-center gap-2">
          <Input value={ref} onChange={(e) => setRef(e.target.value)} placeholder={order.method === 'USDT' ? 'Hash de la transacción' : 'Ref. de la transferencia'} className="h-9 w-56" />
          <Button size="sm" variant="brand" disabled={isPending || ref.trim().length < 3} onClick={() => run(() => confirmOrderAction(order.id, ref))}>
            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            Pago recibido
          </Button>
          <Button size="sm" variant="ghost" disabled={isPending} onClick={() => setRejecting(true)}>
            Rechazar
          </Button>
        </div>
      )}
      {hasProof && rejecting && (
        <div className="flex flex-wrap items-center gap-2">
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Motivo (lo verá el distribuidor)" className="h-9 min-w-0 flex-1" />
          <Button size="sm" variant="outline" disabled={isPending || reason.trim().length < 5} onClick={() => run(() => cancelOrderAction(order.id, reason))}>
            Rechazar lote
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setRejecting(false)}>
            Volver
          </Button>
        </div>
      )}
      {!hasProof && (
        <Button size="sm" variant="ghost" disabled={isPending} onClick={() => run(() => cancelOrderAction(order.id))}>
          Cancelar pedido
        </Button>
      )}
    </li>
  );
}
