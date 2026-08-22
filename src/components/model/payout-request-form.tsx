'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Loader2, Wallet } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { requestPayoutAction } from '@/server/actions/model';
import { formatMoney, formatTokens } from '@/lib/utils';

type Method = 'BANK_TRANSFER' | 'PAYPAL' | 'CRYPTO' | 'PAXUM';

const METHOD_PLACEHOLDER: Record<Method, string> = {
  BANK_TRANSFER: 'IBAN o numero de cuenta',
  PAYPAL: 'email@paypal.com',
  CRYPTO: 'Direccion de tu wallet (USDT TRC20)',
  PAXUM: 'email de tu cuenta Paxum',
};

export function PayoutRequestForm({
  balance,
  minTokens,
  centsPerToken,
  kycApproved,
}: {
  balance: number;
  minTokens: number;
  centsPerToken: number;
  kycApproved: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [tokens, setTokens] = useState(Math.max(minTokens, 0));
  const [method, setMethod] = useState<Method>('BANK_TRANSFER');
  const [destination, setDestination] = useState('');

  const canRequest = kycApproved && balance >= minTokens;
  const amountCents = Math.round(tokens * centsPerToken);

  function submit() {
    if (destination.trim().length < 4) {
      toast.error('Introduce un destino valido.');
      return;
    }

    startTransition(async () => {
      const result = await requestPayoutAction({
        tokens,
        method,
        destination: destination.trim(),
      });

      if (result.ok) {
        toast.success(result.message ?? 'Retiro solicitado');
        setDestination('');
        router.refresh();
      } else {
        toast.error(result.error ?? 'No se pudo solicitar el retiro');
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Wallet className="h-5 w-5 text-primary" />
          Solicitar retiro
        </CardTitle>
        <CardDescription>
          Saldo disponible: {formatTokens(balance)} tokens (
          {formatMoney(balance * centsPerToken)}). Los pagos se procesan en 3-5
          dias habiles.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-5">
        {!kycApproved && (
          <div className="flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
            <p className="text-sm text-muted-foreground">
              Necesitas la verificacion de identidad (KYC) aprobada antes de
              poder retirar dinero.
            </p>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="tokens">Tokens a retirar</Label>
            <Input
              id="tokens"
              type="number"
              min={minTokens}
              max={balance}
              value={tokens}
              onChange={(e) => setTokens(Number(e.target.value))}
              disabled={!canRequest}
            />
            <p className="text-xs text-muted-foreground">
              Recibiras aproximadamente{' '}
              <strong className="text-emerald-400">
                {formatMoney(amountCents)}
              </strong>
            </p>
          </div>

          <div className="space-y-2">
            <Label>Metodo de pago</Label>
            <Select
              value={method}
              onValueChange={(v) => setMethod(v as Method)}
              disabled={!canRequest}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="BANK_TRANSFER">Transferencia bancaria</SelectItem>
                <SelectItem value="PAYPAL">PayPal</SelectItem>
                <SelectItem value="CRYPTO">Criptomoneda</SelectItem>
                <SelectItem value="PAXUM">Paxum</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="destination">Datos de cobro</Label>
          <Input
            id="destination"
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
            placeholder={METHOD_PLACEHOLDER[method]}
            disabled={!canRequest}
          />
          <p className="text-xs text-muted-foreground">
            Estos datos se almacenan cifrados y solo los ve el equipo de
            finanzas.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {[minTokens, 1000, 2500, balance].map((amount, i) =>
            amount > 0 && amount <= balance ? (
              <Button
                key={`${amount}-${i}`}
                variant="outline"
                size="sm"
                disabled={!canRequest}
                onClick={() => setTokens(amount)}
              >
                {i === 3 ? 'Todo' : formatTokens(amount)}
              </Button>
            ) : null,
          )}
        </div>

        <Button
          variant="brand"
          onClick={submit}
          disabled={!canRequest || isPending || tokens < minTokens || tokens > balance}
        >
          {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          Solicitar {formatMoney(amountCents)}
        </Button>

        {balance < minTokens && kycApproved && (
          <p className="text-xs text-muted-foreground">
            Te faltan {formatTokens(minTokens - balance)} tokens para alcanzar el
            minimo de retiro.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
