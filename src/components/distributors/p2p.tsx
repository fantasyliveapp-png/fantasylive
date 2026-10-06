'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  Camera,
  Check,
  Clock,
  Loader2,
  Package,
  Pencil,
  Plus,
  ShieldCheck,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  X,
} from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  COUNTRY_CURRENCY,
  currenciesFor,
  formatLocal,
  PAYMENT_METHODS,
  paymentMethodLabel,
  RECOMMENDED_MAX_MARGIN,
  SUGGESTED_PACKAGES,
} from '@/lib/distributor-shared';
import { cn, formatTokens } from '@/lib/utils';
import {
  cancelSaleAction,
  createSaleAction,
  disputeSaleAction,
  markSalePaidAction,
  rateSaleAction,
  releaseSaleAction,
  removeAccountAction,
  removePackageAction,
  requestDisputeEvidenceUploadUrlAction,
  requestProofUploadUrlAction,
  resolveDisputeAction,
  saveAccountAction,
  savePackageAction,
  setAvailabilityAction,
  type SaleResult,
} from '@/server/actions/distributor-sales';

function useRun() {
  const router = useRouter();
  const [isPending, start] = useTransition();
  return {
    isPending,
    run(fn: () => Promise<SaleResult>, after?: (r: SaleResult) => void) {
      start(async () => {
        const r = await fn();
        if (r.ok) {
          if (r.message) toast.success(r.message);
          after?.(r);
          router.refresh();
        } else toast.error(r.error ?? 'No se pudo.');
      });
    },
  };
}

function Pill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-full border px-3 py-1 text-xs font-medium',
        active ? 'border-primary bg-primary/10 text-foreground' : 'border-border/60 text-muted-foreground hover:text-foreground',
      )}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// DISTRIBUIDOR: disponible / no disponible
// ---------------------------------------------------------------------------

export function AvailabilityToggle({ available, compact }: { available: boolean; compact?: boolean }) {
  const { run, isPending } = useRun();
  if (compact) {
    return (
      <button
        type="button"
        disabled={isPending}
        onClick={() => run(() => setAvailabilityAction(!available))}
        title={available ? 'Los fans pueden hacerte pedidos. Toca para pausar.' : 'Los fans no pueden hacerte pedidos. Toca para activar.'}
        className={cn(
          'flex shrink-0 items-center gap-2 rounded-full border py-1 pl-1 pr-3 text-xs font-semibold transition-colors',
          available ? 'border-state-connected/50 bg-state-connected/10 text-state-connected' : 'border-border/60 text-muted-foreground',
        )}
      >
        <span className={cn('relative h-5 w-9 rounded-full transition-colors', available ? 'bg-state-connected' : 'bg-muted')}>
          <span className={cn('absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all', available ? 'left-[18px]' : 'left-0.5')} />
        </span>
        {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : available ? 'Disponible' : 'No disponible'}
      </button>
    );
  }
  return (
    <button
      type="button"
      disabled={isPending}
      onClick={() => run(() => setAvailabilityAction(!available))}
      className={cn(
        'flex w-full items-center gap-3 rounded-2xl border p-4 text-left transition-colors',
        available ? 'border-state-connected/50 bg-state-connected/10' : 'border-border/60 bg-card',
      )}
    >
      <span
        className={cn(
          'relative h-7 w-12 shrink-0 rounded-full transition-colors',
          available ? 'bg-state-connected' : 'bg-muted',
        )}
      >
        <span
          className={cn(
            'absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all',
            available ? 'left-6' : 'left-1',
          )}
        />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">{available ? 'Disponible para vender' : 'No disponible'}</span>
        <span className="block text-xs text-muted-foreground">
          {available
            ? 'Los fans te ven y pueden hacerte pedidos. Apágalo cuando no puedas atender.'
            : 'Los fans no pueden hacerte pedidos. Enciéndelo cuando puedas atender.'}
        </span>
      </span>
      {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
    </button>
  );
}

// ---------------------------------------------------------------------------
// DISTRIBUIDOR: metodos de cobro y sus paquetes
// ---------------------------------------------------------------------------

export type PackageView = { id: string; tokens: number; price: number };
export type AccountView = {
  id: string;
  country: string;
  currency: string;
  method: string;
  details: string;
  packages: PackageView[];
};

type EditorContext = {
  countries: string[];
  countryNames: Record<string, string>;
  /** Todos los paises donde puede añadir un metodo (codigo, nombre con bandera). */
  allCountries: { code: string; label: string }[];
  /** Unidades de cada moneda por 1 USD (para la referencia y la ganancia). */
};

/**
 * Metodos de cobro del distribuidor (pais + metodo + moneda + datos) y, en
 * cada uno, sus paquetes con su precio. El precio es libre; se recomienda no
 * ganar mas del 20% por venta.
 */
export function AccountsEditor({ accounts, ...ctx }: { accounts: AccountView[] } & EditorContext) {
  const [editing, setEditing] = useState<string | 'new' | null>(accounts.length === 0 ? 'new' : null);
  const { run, isPending } = useRun();

  return (
    <div className="space-y-3">
      {accounts.map((a) =>
        editing === a.id ? (
          <AccountForm key={a.id} initial={a} {...ctx} onDone={() => setEditing(null)} />
        ) : (
          <div key={a.id} className="space-y-2 rounded-2xl border border-border/60 bg-muted/20 p-3">
            <div className="flex items-start gap-2">
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">
                  {paymentMethodLabel(a.method)} · {ctx.countryNames[a.country] ?? a.country} · {a.currency}
                </span>
                <span className="block truncate text-xs text-muted-foreground">{a.details}</span>
              </span>
              <button type="button" onClick={() => setEditing(a.id)} className="p-1 text-muted-foreground hover:text-foreground" aria-label="Editar método">
                <Pencil className="h-4 w-4" />
              </button>
              <button
                type="button"
                disabled={isPending}
                onClick={() => {
                  if (window.confirm('¿Quitar este método y sus paquetes?')) run(() => removeAccountAction(a.id));
                }}
                className="p-1 text-muted-foreground hover:text-destructive"
                aria-label="Quitar método"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
            <PackagesEditor account={a} {...ctx} />
          </div>
        ),
      )}
      {editing === 'new' ? (
        <AccountForm {...ctx} onDone={() => setEditing(null)} />
      ) : (
        <Button variant="outline" className="w-full" onClick={() => setEditing('new')}>
          <Plus className="h-4 w-4" /> Añadir método de pago
        </Button>
      )}
    </div>
  );
}

function AccountForm({
  initial,
  countries,
  countryNames,
  allCountries,
  onDone,
}: { initial?: AccountView; onDone: () => void } & EditorContext) {
  const [country, setCountry] = useState(initial?.country ?? countries[0] ?? '');
  const [currency, setCurrency] = useState(initial?.currency ?? COUNTRY_CURRENCY[countries[0] ?? ''] ?? 'USD');
  const [method, setMethod] = useState(initial?.method ?? '');
  const [details, setDetails] = useState(initial?.details ?? '');
  const { run, isPending } = useRun();
  const methods = PAYMENT_METHODS.filter((m) => !m.countries || m.countries.includes(country));

  function pickCountry(c: string) {
    setCountry(c);
    setCurrency(COUNTRY_CURRENCY[c] ?? 'USD');
    if (method && !PAYMENT_METHODS.find((m) => m.key === method && (!m.countries || m.countries.includes(c)))) setMethod('');
  }

  return (
    <div className="space-y-3 rounded-2xl border border-primary/40 bg-primary/5 p-3">
      <Field label="País">
        <div className="flex flex-wrap items-center gap-1.5">
          {[...new Set([...countries, ...(country ? [country] : [])])].map((c) => (
            <Pill key={c} active={country === c} onClick={() => pickCountry(c)}>
              {countryNames[c] ?? allCountries.find((x) => x.code === c)?.label ?? c}
            </Pill>
          ))}
          <select
            value=""
            onChange={(e) => e.target.value && pickCountry(e.target.value)}
            className="h-8 rounded-full border border-dashed border-border bg-background px-3 text-xs text-muted-foreground"
            aria-label="Otro país"
          >
            <option value="">+ Otro país</option>
            {allCountries
              .filter((c) => !countries.includes(c.code) && c.code !== country)
              .map((c) => (
                <option key={c.code} value={c.code}>
                  {c.label}
                </option>
              ))}
          </select>
        </div>
      </Field>
      <Field label="Método">
        <div className="flex flex-wrap gap-1.5">
          {methods.map((m) => (
            <Pill key={m.key} active={method === m.key} onClick={() => setMethod(m.key)}>
              {m.label}
            </Pill>
          ))}
        </div>
      </Field>
      <Field label="Moneda en la que cobras">
        <div className="flex gap-1.5">
          {currenciesFor(country).map((c) => (
            <Pill key={c} active={currency === c} onClick={() => setCurrency(c)}>
              {c}
            </Pill>
          ))}
        </div>
      </Field>
      <label className="block space-y-1 text-xs text-muted-foreground">
        Datos para que te paguen (solo los ve el fan dentro de un pedido)
        <Input value={details} onChange={(e) => setDetails(e.target.value)} placeholder="Ej.: Nequi 300 000 0000 · Ana Torres" />
      </label>
      <div className="flex gap-2">
        <Button variant="ghost" size="sm" onClick={onDone}>
          Cancelar
        </Button>
        <Button
          size="sm"
          variant="brand"
          disabled={isPending || !method || details.trim().length < 4}
          onClick={() => run(() => saveAccountAction({ id: initial?.id, country, currency, method, details }), onDone)}
        >
          {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          {initial ? 'Guardar' : 'Guardar y añadir paquetes'}
        </Button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      {children}
    </div>
  );
}

/** Paquetes de un metodo, con lo que gana en cada uno y la recomendacion del 20%. */
function PackagesEditor({ account }: { account: AccountView } & EditorContext) {
  const [editing, setEditing] = useState<PackageView | 'new' | null>(account.packages.length === 0 ? 'new' : null);
  const { run, isPending } = useRun();

  return (
    <div className="space-y-1.5">
      {account.packages.length > 0 && (
        <ul className="space-y-1">
          {account.packages.map((p) =>
            editing !== 'new' && editing?.id === p.id ? (
              <li key={p.id}>
                <PackageForm accountId={account.id} currency={account.currency} initial={p} onDone={() => setEditing(null)} />
              </li>
            ) : (
              <li key={p.id} className="flex items-center gap-2 rounded-xl bg-background/60 px-3 py-2 text-sm">
                <Package className="h-4 w-4 shrink-0 text-token" />
                <span className="flex-1">
                  <strong>{formatTokens(p.tokens)} tokens</strong> = {formatLocal(p.price, account.currency)}
                </span>
                <button type="button" onClick={() => setEditing(p)} className="p-1 text-muted-foreground hover:text-foreground" aria-label="Editar paquete">
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => run(() => removePackageAction(p.id))}
                  className="p-1 text-muted-foreground hover:text-destructive"
                  aria-label="Quitar paquete"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            ),
          )}
        </ul>
      )}
      {editing === 'new' ? (
        <PackageForm accountId={account.id} currency={account.currency} onDone={() => setEditing(null)} />
      ) : (
        <button type="button" onClick={() => setEditing('new')} className="flex items-center gap-1 text-xs font-semibold text-primary">
          <Plus className="h-3.5 w-3.5" /> Añadir paquete
        </button>
      )}
    </div>
  );
}

function PackageForm({
  accountId,
  currency,
  initial,
  onDone,
}: {
  accountId: string;
  currency: string;
  initial?: PackageView;
  onDone: () => void;
}) {
  const [tokens, setTokens] = useState(String(initial?.tokens ?? 100));
  const t = Math.round(Number(tokens) || 0);
  const [price, setPrice] = useState(initial ? String(initial.price / 100) : '');
  const { run, isPending } = useRun();
  const priceCents = Math.round((Number(price.replace(',', '.')) || 0) * 100);

  return (
    <div className="space-y-2 rounded-xl border border-primary/40 bg-primary/5 p-3">
      <div className="flex flex-wrap gap-1.5">
        {SUGGESTED_PACKAGES.map((n) => (
          <Pill
            key={n}
            active={t === n}
            onClick={() => {
              setTokens(String(n));
            }}
          >
            {n} tk
          </Pill>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="space-y-1 text-xs text-muted-foreground">
          Tokens
          <Input type="number" inputMode="numeric" value={tokens} onChange={(e) => setTokens(e.target.value)} />
        </label>
        <label className="space-y-1 text-xs text-muted-foreground">
          Precio ({currency})
          <Input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
        </label>
      </div>
      <p className="rounded-lg bg-background/60 px-3 py-2 text-xs text-muted-foreground">
        Pon tu precio en tu moneda. Recomendamos no ganar más del {RECOMMENDED_MAX_MARGIN}% por venta: los fans comparan y
        compran a quien vende más barato.
      </p>
      <div className="flex gap-2">
        <Button variant="ghost" size="sm" onClick={onDone}>
          Cancelar
        </Button>
        <Button
          size="sm"
          variant="brand"
          disabled={isPending || t <= 0 || priceCents <= 0}
          onClick={() => run(() => savePackageAction({ id: initial?.id, accountId, tokens: t, price: priceCents / 100 }), onDone)}
        >
          {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          Guardar paquete
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// FAN: comprar
// ---------------------------------------------------------------------------

export type BuyOption = { id: string; method: string; currency: string; packages: PackageView[] };

/** Elegir metodo y paquete, aceptar como funciona y crear el pedido. */
export function BuyFromDistributor({
  options,
  isAuthenticated,
  preferredMethod,
  available,
}: {
  options: BuyOption[];
  isAuthenticated: boolean;
  preferredMethod: string | null;
  available: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [optionId, setOptionId] = useState(options.find((o) => o.method === preferredMethod)?.id ?? options[0]?.id ?? '');
  const opt = options.find((o) => o.id === optionId);
  const [packageId, setPackageId] = useState(opt?.packages[0]?.id ?? '');
  const [accepted, setAccepted] = useState(false);
  const { run, isPending } = useRun();
  const pkg = opt?.packages.find((p) => p.id === packageId);

  if (!available) {
    return (
      <Button size="sm" variant="secondary" disabled>
        No disponible ahora
      </Button>
    );
  }
  if (!open) {
    return (
      <Button size="sm" variant="brand" onClick={() => (isAuthenticated ? setOpen(true) : router.push('/login?callbackUrl=%2Fdistribuidores'))}>
        Comprar
      </Button>
    );
  }
  return (
    <div className="mt-2 w-full space-y-3 rounded-xl border border-primary/40 bg-primary/5 p-3">
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-1.5 text-sm font-semibold">
          <ShieldCheck className="h-4 w-4 text-state-connected" /> Compra protegida
        </p>
        <button type="button" onClick={() => setOpen(false)} aria-label="Cerrar" className="text-muted-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>
      <Field label="Cómo pagas">
        <div className="flex flex-wrap gap-1.5">
          {options.map((o) => (
            <Pill
              key={o.id}
              active={o.id === optionId}
              onClick={() => {
                setOptionId(o.id);
                setPackageId(o.packages[0]?.id ?? '');
              }}
            >
              {paymentMethodLabel(o.method)} · {o.currency}
            </Pill>
          ))}
        </div>
      </Field>
      {opt && (
        <Field label="Paquete">
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
            {opt.packages.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setPackageId(p.id)}
                className={cn(
                  'rounded-xl border px-3 py-2 text-left',
                  p.id === packageId ? 'border-primary bg-primary/10' : 'border-border/60 hover:border-primary/50',
                )}
              >
                <span className="block text-sm font-bold text-token">{formatTokens(p.tokens)} tokens</span>
                <span className="block text-xs">{formatLocal(p.price, opt.currency)}</span>
              </button>
            ))}
          </div>
        </Field>
      )}
      <label className="flex items-start gap-2 text-xs text-muted-foreground">
        <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} className="mt-0.5 h-4 w-4 accent-primary" />
        <span>
          Entiendo que pago directamente al distribuidor, un vendedor independiente. Fantasy Live reserva mis tokens y revisa
          las disputas, pero no recibe ni devuelve mi dinero.
        </span>
      </label>
      <Button
        variant="brand"
        className="w-full"
        disabled={isPending || !pkg || !accepted}
        onClick={() => run(() => createSaleAction(packageId, accepted), (r) => r.saleId && router.push(`/compra-tokens/${r.saleId}`))}
      >
        {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
        {pkg && opt ? `Crear pedido · ${formatLocal(pkg.price, opt.currency)}` : 'Elige un paquete'}
      </Button>
      <p className="text-[11px] text-muted-foreground">
        Tus tokens quedan reservados. Tienes 30 minutos para pagar y subir el comprobante.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PEDIDO: acciones de cada parte
// ---------------------------------------------------------------------------

/** Cuenta atras hasta que caduca el pedido. */
export function Countdown({ until }: { until: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);
  const ms = Math.max(0, new Date(until).getTime() - now);
  const m = Math.floor(ms / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return (
    <span className="inline-flex items-center gap-1 font-semibold tabular-nums">
      <Clock className="h-3.5 w-3.5" />
      {m}:{String(s).padStart(2, '0')}
    </span>
  );
}

/** Fan: referencia + captura del comprobante (obligatoria) y "Ya pagué". */
export function FanPayForm({ saleId }: { saleId: string }) {
  const [ref, setRef] = useState('');
  const [proofKey, setProofKey] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const { run, isPending } = useRun();

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const type = file.type || 'image/jpeg';
      const r = await requestProofUploadUrlAction(saleId, file.name, type);
      if (!r.ok || !r.uploadUrl || !r.key) {
        toast.error(r.error ?? 'No se pudo subir.');
        return;
      }
      const up = await fetch(r.uploadUrl, { method: 'PUT', body: file, headers: { 'Content-Type': type } });
      if (!up.ok) {
        toast.error('No se pudo subir la captura.');
        return;
      }
      setProofKey(r.key);
      setPreview(URL.createObjectURL(file));
    } catch {
      toast.error('No se pudo subir la captura.');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  return (
    <div className="space-y-2">
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onFile} />
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        disabled={uploading}
        className={cn(
          'flex w-full items-center gap-3 rounded-xl border border-dashed p-3 text-left text-sm',
          proofKey ? 'border-state-connected/60 bg-state-connected/5' : 'border-border hover:border-primary/60',
        )}
      >
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt="" className="h-12 w-12 rounded-lg object-cover" />
        ) : (
          <span className="flex h-12 w-12 items-center justify-center rounded-lg bg-muted">
            {uploading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Camera className="h-5 w-5" />}
          </span>
        )}
        <span>
          <span className="block font-semibold">{proofKey ? 'Comprobante subido' : 'Sube la captura del comprobante'}</span>
          <span className="block text-xs text-muted-foreground">
            {proofKey ? 'Toca para cambiarla.' : 'Obligatorio: es tu prueba si hay algún problema.'}
          </span>
        </span>
      </button>
      <Input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="Referencia o nº de operación del pago" />
      <Button
        variant="brand"
        className="w-full"
        disabled={isPending || uploading || ref.trim().length < 3 || !proofKey}
        onClick={() => proofKey && run(() => markSalePaidAction(saleId, ref, proofKey))}
      >
        {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
        Ya pagué
      </Button>
      <Button variant="ghost" size="sm" className="w-full" disabled={isPending} onClick={() => run(() => cancelSaleAction(saleId))}>
        Cancelar pedido
      </Button>
    </div>
  );
}

export function ReleaseButtons({ saleId, canCancel }: { saleId: string; canCancel: boolean }) {
  const { run, isPending } = useRun();
  return (
    <div className="space-y-2">
      <Button
        variant="brand"
        className="w-full"
        disabled={isPending}
        onClick={() => {
          if (window.confirm('¿Confirmas que el dinero ya está en tu cuenta? Los tokens se envían al fan y no se puede deshacer.'))
            run(() => releaseSaleAction(saleId));
        }}
      >
        {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
        Me llegó el pago: liberar tokens
      </Button>
      {canCancel && (
        <Button variant="ghost" size="sm" className="w-full" disabled={isPending} onClick={() => run(() => cancelSaleAction(saleId))}>
          Cancelar pedido
        </Button>
      )}
    </div>
  );
}

export function DisputeForm({ saleId, label, hint }: { saleId: string; label: string; hint?: string }) {
  const [open, setOpen] = useState(false);
  const [why, setWhy] = useState('');
  const [evidence, setEvidence] = useState<{ key: string; preview: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const { run, isPending } = useRun();

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const type = file.type || 'image/jpeg';
      const r = await requestDisputeEvidenceUploadUrlAction(saleId, file.name, type);
      if (!r.ok || !r.uploadUrl || !r.key) return void toast.error(r.error ?? 'No se pudo subir.');
      const up = await fetch(r.uploadUrl, { method: 'PUT', body: file, headers: { 'Content-Type': type } });
      if (!up.ok) return void toast.error('No se pudo subir la captura.');
      setEvidence({ key: r.key, preview: URL.createObjectURL(file) });
    } catch {
      toast.error('No se pudo subir la captura.');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  if (!open) {
    return (
      <Button variant="outline" size="sm" className="w-full" onClick={() => setOpen(true)}>
        <AlertTriangle className="h-4 w-4" /> {label}
      </Button>
    );
  }
  return (
    <div className="space-y-2 rounded-xl border border-rose-500/40 bg-rose-500/5 p-3">
      <Input value={why} onChange={(e) => setWhy(e.target.value)} placeholder="Cuéntanos qué pasó" />
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onFile} />
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        disabled={uploading}
        className="flex w-full items-center gap-3 rounded-lg border border-dashed border-border p-2 text-left text-xs hover:border-primary/60"
      >
        {evidence ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={evidence.preview} alt="" className="h-10 w-10 rounded-md object-cover" />
        ) : (
          <span className="flex h-10 w-10 items-center justify-center rounded-md bg-muted">
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
          </span>
        )}
        <span>
          <span className="block font-semibold">{evidence ? 'Prueba subida' : 'Añade una captura como prueba'}</span>
          <span className="block text-muted-foreground">{hint ?? 'Ayuda al equipo a decidir rápido.'}</span>
        </span>
      </button>
      <Button
        variant="outline"
        size="sm"
        className="w-full"
        disabled={isPending || uploading || why.trim().length < 5}
        onClick={() => run(() => disputeSaleAction(saleId, why, evidence?.key ?? null))}
      >
        Abrir disputa
      </Button>
    </div>
  );
}

export function RateSale({ saleId }: { saleId: string }) {
  const { run, isPending } = useRun();
  return (
    <div className="flex gap-2">
      <Button variant="outline" size="sm" className="flex-1" disabled={isPending} onClick={() => run(() => rateSaleAction(saleId, true))}>
        <ThumbsUp className="h-4 w-4" /> Todo bien
      </Button>
      <Button variant="outline" size="sm" className="flex-1" disabled={isPending} onClick={() => run(() => rateSaleAction(saleId, false))}>
        <ThumbsDown className="h-4 w-4" /> Hubo problemas
      </Button>
    </div>
  );
}

export function ResolveDispute({ saleId }: { saleId: string }) {
  const [note, setNote] = useState('');
  const { run, isPending } = useRun();
  const ok = note.trim().length >= 5;
  return (
    <div className="space-y-2">
      <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Por qué decides así (lo verán el fan y el distribuidor)" />
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="brand" disabled={isPending || !ok} onClick={() => run(() => resolveDisputeAction(saleId, 'release', note))}>
          Dar tokens al fan
        </Button>
        <Button size="sm" variant="outline" disabled={isPending || !ok} onClick={() => run(() => resolveDisputeAction(saleId, 'cancel', note))}>
          Cancelar y devolver al distribuidor
        </Button>
      </div>
    </div>
  );
}
