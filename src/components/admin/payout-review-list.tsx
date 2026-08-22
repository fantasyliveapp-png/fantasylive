'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { BadgeCheck, Check, ExternalLink, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { PAYOUT_STATUS_LABELS } from '@/lib/constants';
import { processPayoutAction } from '@/server/actions/admin';
import { formatDateTime, formatMoney, formatTokens } from '@/lib/utils';

interface PayoutRow {
  id: string;
  status: string;
  tokens: number;
  amountCents: number;
  currency: string;
  method: string;
  destination: string;
  requestedAt: string;
  model: {
    stageName: string;
    slug: string;
    email: string;
    kycStatus: string;
    totalEarned: number;
    currentBalance: number;
  };
}

const METHOD_LABELS: Record<string, string> = {
  BANK_TRANSFER: 'Transferencia bancaria',
  PAYPAL: 'PayPal',
  CRYPTO: 'Cripto',
  PAXUM: 'Paxum',
};

const STATUS_VARIANT: Record<string, any> = {
  REQUESTED: 'warning',
  APPROVED: 'secondary',
  PROCESSING: 'secondary',
  PAID: 'success',
  REJECTED: 'destructive',
};

export function PayoutReviewList({ payouts }: { payouts: PayoutRow[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [paying, setPaying] = useState<PayoutRow | null>(null);
  const [externalRef, setExternalRef] = useState('');

  const [rejecting, setRejecting] = useState<PayoutRow | null>(null);
  const [rejectNotes, setRejectNotes] = useState('');

  function process(
    payoutId: string,
    decision: 'APPROVED' | 'PAID' | 'REJECTED',
    extra?: { notes?: string; externalRef?: string },
  ) {
    startTransition(async () => {
      const result = await processPayoutAction({ payoutId, decision, ...extra });

      if (result.ok) {
        toast.success(result.message ?? 'Retiro actualizado');
        setPaying(null);
        setRejecting(null);
        setExternalRef('');
        setRejectNotes('');
        router.refresh();
      } else {
        toast.error(result.error ?? 'No se pudo procesar');
      }
    });
  }

  return (
    <>
      <div className="space-y-4">
        {payouts.map((payout) => (
          <Card key={payout.id}>
            <CardContent className="flex flex-wrap items-center gap-5 py-5">
              <div className="min-w-[200px] flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    href={`/models/${payout.model.slug}`}
                    target="_blank"
                    className="font-semibold hover:underline"
                  >
                    {payout.model.stageName}
                  </Link>
                  {payout.model.kycStatus === 'APPROVED' ? (
                    <BadgeCheck className="h-4 w-4 text-emerald-500" />
                  ) : (
                    <Badge variant="destructive" className="text-[10px]">
                      KYC {payout.model.kycStatus}
                    </Badge>
                  )}
                  <Link href={`/models/${payout.model.slug}`} target="_blank">
                    <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
                  </Link>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {payout.model.email} · Solicitado{' '}
                  {formatDateTime(new Date(payout.requestedAt))}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Ganancias historicas:{' '}
                  {formatTokens(payout.model.totalEarned)} tokens · Saldo actual:{' '}
                  {formatTokens(payout.model.currentBalance)}
                </p>
              </div>

              <div className="min-w-[180px]">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  {METHOD_LABELS[payout.method] ?? payout.method}
                </p>
                <p className="mt-0.5 font-mono text-sm">{payout.destination}</p>
              </div>

              <div className="text-right">
                <p className="text-2xl font-bold text-emerald-400">
                  {formatMoney(payout.amountCents, payout.currency)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatTokens(payout.tokens)} tokens
                </p>
                <Badge
                  variant={STATUS_VARIANT[payout.status] ?? 'muted'}
                  className="mt-1"
                >
                  {PAYOUT_STATUS_LABELS[payout.status as keyof typeof PAYOUT_STATUS_LABELS]}
                </Badge>
              </div>

              <div className="flex flex-wrap gap-2">
                {payout.status === 'REQUESTED' && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={isPending}
                    onClick={() => process(payout.id, 'APPROVED')}
                  >
                    Aprobar
                  </Button>
                )}

                <Button
                  variant="brand"
                  size="sm"
                  disabled={isPending}
                  onClick={() => setPaying(payout)}
                >
                  <Check className="h-4 w-4" />
                  Marcar pagado
                </Button>

                <Button
                  variant="destructive"
                  size="sm"
                  disabled={isPending}
                  onClick={() => setRejecting(payout)}
                >
                  <X className="h-4 w-4" />
                  Rechazar
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Marcar como pagado */}
      <Dialog open={Boolean(paying)} onOpenChange={(o) => !o && setPaying(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Confirmar pago</DialogTitle>
            <DialogDescription>
              Marca este retiro como pagado una vez hayas hecho la transferencia
              real. Los tokens ya fueron descontados al solicitarlo.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="rounded-lg border border-border p-3">
              <p className="text-sm font-medium">{paying?.model.stageName}</p>
              <p className="text-xs text-muted-foreground">
                {formatMoney(paying?.amountCents ?? 0)} via{' '}
                {METHOD_LABELS[paying?.method ?? ''] ?? paying?.method}
              </p>
              <p className="mt-1 font-mono text-xs">{paying?.destination}</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="ref">Referencia de la transferencia</Label>
              <Input
                id="ref"
                value={externalRef}
                onChange={(e) => setExternalRef(e.target.value)}
                placeholder="Ej: TRF-2026-00123"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setPaying(null)}>
              Cancelar
            </Button>
            <Button
              variant="brand"
              disabled={isPending}
              onClick={() =>
                paying && process(paying.id, 'PAID', { externalRef })
              }
            >
              {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Confirmar pago
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rechazar */}
      <Dialog
        open={Boolean(rejecting)}
        onOpenChange={(o) => !o && setRejecting(null)}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Rechazar retiro</DialogTitle>
            <DialogDescription>
              Los {formatTokens(rejecting?.tokens ?? 0)} tokens se devolveran
              automaticamente al monedero de la modelo.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="notes">Motivo</Label>
            <Textarea
              id="notes"
              value={rejectNotes}
              onChange={(e) => setRejectNotes(e.target.value)}
              placeholder="Ej: los datos bancarios no coinciden con el titular verificado."
            />
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setRejecting(null)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              disabled={isPending}
              onClick={() =>
                rejecting &&
                process(rejecting.id, 'REJECTED', { notes: rejectNotes })
              }
            >
              {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Rechazar y devolver tokens
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
