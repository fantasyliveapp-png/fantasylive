'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Boxes, FileText, Loader2, MessageCircle, Receipt, X } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn, formatMoney, formatTokens } from '@/lib/utils';
import { discountForTokens, discountTiers, lotMath, nextDiscountTier } from '@/lib/distributor-shared';
import {
  cancelOrderAction,
  contactDistributorAction,
  requestLotProofUploadUrlAction,
  requestOrderAction,
  submitLotProofAction,
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

/** Comprar un lote: descuento progresivo segun el tamaño, todo en dolares. */
export function DistributorOrderForm({
  tokenValueCents,
  maxDiscountPercent,
  usdt,
  disabled,
}: {
  tokenValueCents: number;
  maxDiscountPercent: number;
  usdt: { network: string } | null;
  disabled: boolean;
}) {
  const [tokens, setTokens] = useState(10_000);
  const [method, setMethod] = useState<'WIRE' | 'USDT'>('WIRE');
  const { run, isPending } = useRun();
  const pct = discountForTokens(tokens, maxDiscountPercent);
  const m = lotMath(tokens, tokenValueCents, pct);
  const next = nextDiscountTier(tokens, maxDiscountPercent);
  const tiers = discountTiers(maxDiscountPercent);
  return (
    <div className="space-y-2">
      {/* Tramos: cuanto mas compras, mas descuento */}
      <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6">
        {tiers.map((t) => {
          const active = discountForTokens(tokens, maxDiscountPercent) === t.percent && tokens >= t.minTokens;
          return (
            <button
              key={t.minTokens}
              type="button"
              onClick={() => setTokens(t.minTokens)}
              className={cn(
                'rounded-xl border px-2 py-1.5 text-center',
                active ? 'border-state-connected bg-state-connected/10' : 'border-border/60 hover:bg-muted/50',
              )}
            >
              <span className={cn('block text-base font-bold', active && 'text-state-connected')}>−{t.percent}%</span>
              <span className="block text-[10px] text-muted-foreground">desde {formatTokens(t.minTokens)}</span>
            </button>
          );
        })}
      </div>
      <label className="flex items-center gap-2 text-sm text-muted-foreground">
        Tokens
        <Input type="number" min={1000} step={1000} value={tokens} onChange={(e) => setTokens(Number(e.target.value) || 0)} className="h-9 w-36" />
      </label>
      <div className="rounded-xl bg-muted/40 px-3 py-2 text-sm">
        <p>
          Descuento <strong className="text-state-connected">−{pct}%</strong> · pagas <strong>{formatMoney(m.costCents)}</strong>{' '}
          (valen {formatMoney(m.retailCents)}) · ahorras <strong className="text-state-connected">{formatMoney(m.profitCents)}</strong>
        </p>
        {next && tokens >= 1000 && (
          <p className="mt-0.5 text-xs text-muted-foreground">
            Pide {formatTokens(next.minTokens - tokens)} tokens más y tu descuento sube al −{next.percent}%.
          </p>
        )}
      </div>
      {usdt && (
        <div className="grid grid-cols-2 gap-1.5">
          {(
            [
              ['WIRE', 'Transferencia'],
              ['USDT', `USDT (${usdt.network})`],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => setMethod(k)}
              className={cn('rounded-xl border px-3 py-2 text-sm font-semibold', method === k ? 'border-primary bg-primary/10' : 'border-border/60')}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      <Button
        variant="outline"
        className="w-full"
        disabled={disabled || isPending || tokens < 1000}
        onClick={() => run(() => requestOrderAction(tokens, usdt ? method : 'WIRE'))}
      >
        {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Boxes className="h-4 w-4" />}
        Pedir {formatTokens(tokens)} tokens · {formatMoney(m.costCents)}
      </Button>
    </div>
  );
}

/** Distribuidor: subir el recibo del pago de un lote (obligatorio para que se confirme). */
export function LotProofForm({ orderId, usdt }: { orderId: string; usdt: boolean }) {
  const [open, setOpen] = useState(false);
  const [ref, setRef] = useState('');
  const [file, setFile] = useState<{ key: string; name: string; preview: string | null } | null>(null);
  const [uploading, setUploading] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const { run, isPending } = useRun();

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setUploading(true);
    try {
      const type = f.type || 'image/jpeg';
      const r = await requestLotProofUploadUrlAction(orderId, f.name, type, f.size);
      if (!r.ok || !r.uploadUrl || !r.key) return void toast.error(r.error ?? 'No se pudo subir.');
      const up = await fetch(r.uploadUrl, { method: 'PUT', body: f, headers: { 'Content-Type': type } });
      if (!up.ok) return void toast.error('No se pudo subir el recibo.');
      setFile({ key: r.key, name: f.name, preview: type.startsWith('image/') ? URL.createObjectURL(f) : null });
    } catch {
      toast.error('No se pudo subir el recibo.');
    } finally {
      setUploading(false);
      if (input.current) input.current.value = '';
    }
  }

  if (!open) {
    return (
      <Button size="sm" variant="brand" className="w-full" onClick={() => setOpen(true)}>
        <Receipt className="h-4 w-4" /> Ya pagué: enviar recibo
      </Button>
    );
  }
  return (
    <div className="space-y-2 rounded-xl border border-primary/40 bg-primary/5 p-3">
      <input ref={input} type="file" accept="image/*,application/pdf" className="hidden" onChange={onFile} />
      <button
        type="button"
        onClick={() => input.current?.click()}
        disabled={uploading}
        className={cn(
          'flex w-full items-center gap-3 rounded-lg border border-dashed p-2 text-left text-xs',
          file ? 'border-state-connected/60 bg-state-connected/5' : 'border-border hover:border-primary/60',
        )}
      >
        {file?.preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={file.preview} alt="" className="h-10 w-10 rounded-md object-cover" />
        ) : (
          <span className="flex h-10 w-10 items-center justify-center rounded-md bg-muted">
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : file ? <FileText className="h-4 w-4" /> : <Receipt className="h-4 w-4" />}
          </span>
        )}
        <span>
          <span className="block font-semibold">{file ? 'Recibo subido' : 'Sube el recibo del pago'}</span>
          <span className="block text-muted-foreground">{file ? file.name : 'Captura o PDF de la transferencia o del envío de USDT.'}</span>
        </span>
      </button>
      <Input
        value={ref}
        onChange={(e) => setRef(e.target.value)}
        placeholder={usdt ? 'Hash de la transacción (TxID)' : 'Referencia o número de la transferencia'}
      />
      <div className="flex gap-2">
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancelar
        </Button>
        <Button
          size="sm"
          variant="brand"
          className="flex-1"
          disabled={isPending || uploading || !file || ref.trim().length < 3}
          onClick={() => run(() => submitLotProofAction(orderId, ref, file!.key))}
        >
          {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          Enviar recibo
        </Button>
      </div>
    </div>
  );
}

export function CancelOrderButton({ id }: { id: string }) {
  const { run, isPending } = useRun();
  return (
    <button
      type="button"
      aria-label="Cancelar pedido"
      disabled={isPending}
      onClick={() => run(() => cancelOrderAction(id))}
      className="rounded-full p-1 text-muted-foreground hover:text-destructive"
    >
      <X className="h-4 w-4" />
    </button>
  );
}

/** Fan: abrir chat con un distribuidor oficial para pedirle tokens. */
export function ContactDistributorButton({
  distributorId,
  isAuthenticated,
  label = 'Escribir',
}: {
  distributorId: string;
  isAuthenticated: boolean;
  label?: string;
}) {
  const router = useRouter();
  const [isPending, start] = useTransition();
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={isPending}
      onClick={() => {
        if (!isAuthenticated) {
          router.push('/login?callbackUrl=%2Fdistribuidores');
          return;
        }
        start(async () => {
          const r = await contactDistributorAction(distributorId);
          if (r.ok && r.href) router.push(r.href);
          else toast.error(r.error ?? 'No se pudo abrir el chat.');
        });
      }}
    >
      {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageCircle className="h-4 w-4" />}
      {label}
    </Button>
  );
}
