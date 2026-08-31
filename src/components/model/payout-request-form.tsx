'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  Banknote,
  Coins,
  Loader2,
  Mail,
  ShieldCheck,
  Wallet,
} from 'lucide-react';
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
import { COUNTRIES } from '@/lib/countries';
import {
  PAYOUT_METHOD_HINTS,
  PAYOUT_METHOD_LABELS,
  type ActivePayoutMethod,
} from '@/lib/payout-methods';
import { requestPayoutAction } from '@/server/actions/model';
import { formatMoney, formatTokens } from '@/lib/utils';

const METHOD_ICONS = {
  WIRE_TRANSFER: Banknote,
  USDT_TRC20: Coins,
  PAYPAL: Mail,
} as const;

const EMPTY_WIRE = {
  accountHolder: '',
  bankName: '',
  accountNumber: '',
  swiftBic: '',
  bankCountry: '',
  bankAddress: '',
};

export function PayoutRequestForm({
  balance,
  minTokens,
  centsPerToken,
  kycApproved,
  hasOpenRequest,
}: {
  balance: number;
  minTokens: number;
  centsPerToken: number;
  kycApproved: boolean;
  hasOpenRequest: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [tokens, setTokens] = useState(() => Math.min(balance, minTokens));
  const [method, setMethod] = useState<ActivePayoutMethod>('WIRE_TRANSFER');

  const [wire, setWire] = useState(EMPTY_WIRE);
  const [tronAddress, setTronAddress] = useState('');
  const [paypalEmail, setPaypalEmail] = useState('');

  const canRequest = kycApproved && !hasOpenRequest && balance >= minTokens;
  const amountCents = Math.round(tokens * centsPerToken);

  const quickAmounts = useMemo(() => {
    const options = [minTokens, 1000, 2500, 5000].filter(
      (n) => n >= minTokens && n <= balance,
    );
    if (balance >= minTokens) options.push(balance);
    return [...new Set(options)];
  }, [minTokens, balance]);

  function buildDestination() {
    switch (method) {
      case 'WIRE_TRANSFER':
        return {
          method: 'WIRE_TRANSFER' as const,
          accountHolder: wire.accountHolder,
          bankName: wire.bankName,
          accountNumber: wire.accountNumber,
          swiftBic: wire.swiftBic,
          bankCountry: wire.bankCountry,
          bankAddress: wire.bankAddress,
        };
      case 'USDT_TRC20':
        return { method: 'USDT_TRC20' as const, address: tronAddress };
      case 'PAYPAL':
        return { method: 'PAYPAL' as const, email: paypalEmail };
    }
  }

  function submit() {
    startTransition(async () => {
      const result = await requestPayoutAction({
        tokens,
        destination: buildDestination(),
      });

      if (result.ok) {
        toast.success(result.message ?? 'Retiro solicitado');
        setWire(EMPTY_WIRE);
        setTronAddress('');
        setPaypalEmail('');
        router.refresh();
      } else {
        toast.error(result.error ?? 'No se pudo solicitar el retiro');
      }
    });
  }

  const MethodIcon = METHOD_ICONS[method];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Wallet className="h-5 w-5 text-primary" />
          Solicitar retiro
        </CardTitle>
        <CardDescription>
          Tienes {formatTokens(balance)} tokens disponibles, equivalentes a{' '}
          <strong className="text-emerald-400">
            {formatMoney(balance * centsPerToken)}
          </strong>
          .
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-5">
        {!kycApproved && (
          <Notice tone="warning">
            Necesitas la verificacion de identidad (KYC) aprobada antes de poder
            retirar dinero.
          </Notice>
        )}

        {kycApproved && hasOpenRequest && (
          <Notice tone="warning">
            Ya tienes un retiro en curso. Podras solicitar otro en cuanto
            finanzas procese el actual.
          </Notice>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="tokens">Tokens a retirar</Label>
            <Input
              id="tokens"
              type="number"
              inputMode="numeric"
              min={minTokens}
              max={balance}
              step={1}
              value={tokens}
              onChange={(e) =>
                setTokens(Math.max(0, Math.floor(Number(e.target.value) || 0)))
              }
              disabled={!canRequest}
            />
            <p className="text-xs text-muted-foreground">
              Recibiras{' '}
              <strong className="text-emerald-400">
                {formatMoney(amountCents)}
              </strong>{' '}
              ({formatMoney(centsPerToken)} por token)
            </p>
          </div>

          <div className="space-y-2">
            <Label>Metodo de pago</Label>
            <Select
              value={method}
              onValueChange={(v) => setMethod(v as ActivePayoutMethod)}
              disabled={!canRequest}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="WIRE_TRANSFER">
                  {PAYOUT_METHOD_LABELS.WIRE_TRANSFER}
                </SelectItem>
                <SelectItem value="USDT_TRC20">
                  {PAYOUT_METHOD_LABELS.USDT_TRC20}
                </SelectItem>
                <SelectItem value="PAYPAL">
                  {PAYOUT_METHOD_LABELS.PAYPAL}
                </SelectItem>
              </SelectContent>
            </Select>
            <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
              <MethodIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {PAYOUT_METHOD_HINTS[method]}
            </p>
          </div>
        </div>

        {quickAmounts.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {quickAmounts.map((amount) => (
              <Button
                key={amount}
                variant="outline"
                size="sm"
                disabled={!canRequest}
                onClick={() => setTokens(amount)}
              >
                {amount === balance ? 'Todo' : formatTokens(amount)}
              </Button>
            ))}
          </div>
        )}

        {/* --- Datos de cobro segun el metodo --- */}
        <div className="space-y-4 rounded-lg border border-border bg-muted/20 p-4">
          {method === 'WIRE_TRANSFER' && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                id="accountHolder"
                label="Titular de la cuenta"
                placeholder="Nombre tal y como figura en el banco"
                value={wire.accountHolder}
                onChange={(v) => setWire((w) => ({ ...w, accountHolder: v }))}
                disabled={!canRequest}
              />
              <Field
                id="bankName"
                label="Banco"
                placeholder="Banco Santander"
                value={wire.bankName}
                onChange={(v) => setWire((w) => ({ ...w, bankName: v }))}
                disabled={!canRequest}
              />
              <Field
                id="accountNumber"
                label="IBAN o numero de cuenta"
                placeholder="ES91 2100 0418 4502 0005 1332"
                value={wire.accountNumber}
                onChange={(v) => setWire((w) => ({ ...w, accountNumber: v }))}
                disabled={!canRequest}
              />
              <Field
                id="swiftBic"
                label="SWIFT / BIC"
                placeholder="BSCHESMM"
                value={wire.swiftBic}
                onChange={(v) => setWire((w) => ({ ...w, swiftBic: v }))}
                disabled={!canRequest}
              />
              <div className="space-y-2">
                <Label>Pais del banco</Label>
                <Select
                  value={wire.bankCountry}
                  onValueChange={(v) => setWire((w) => ({ ...w, bankCountry: v }))}
                  disabled={!canRequest}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecciona un pais" />
                  </SelectTrigger>
                  <SelectContent className="max-h-64">
                    {COUNTRIES.map((c) => (
                      <SelectItem key={c.code} value={c.code}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Field
                id="bankAddress"
                label="Direccion del banco (opcional)"
                placeholder="Calle, ciudad"
                value={wire.bankAddress}
                onChange={(v) => setWire((w) => ({ ...w, bankAddress: v }))}
                disabled={!canRequest}
              />
            </div>
          )}

          {method === 'USDT_TRC20' && (
            <>
              <Field
                id="tronAddress"
                label="Direccion USDT (red TRC20)"
                placeholder="T..."
                value={tronAddress}
                onChange={setTronAddress}
                disabled={!canRequest}
                mono
              />
              <Notice tone="warning">
                Asegurate de que la direccion es de la red <strong>TRON
                (TRC20)</strong>. Un envio a otra red (ERC20, BEP20) se pierde y
                no se puede recuperar. Verificamos el digito de control antes de
                aceptarla.
              </Notice>
            </>
          )}

          {method === 'PAYPAL' && (
            <Field
              id="paypalEmail"
              label="Correo de tu cuenta PayPal"
              placeholder="tucuenta@ejemplo.com"
              type="email"
              value={paypalEmail}
              onChange={setPaypalEmail}
              disabled={!canRequest}
            />
          )}

          <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
            Tus datos de cobro se guardan cifrados y solo los descifra el equipo
            de finanzas al ejecutar el pago.
          </p>
        </div>

        <Button
          variant="brand"
          onClick={submit}
          disabled={
            !canRequest || isPending || tokens < minTokens || tokens > balance
          }
        >
          {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          Solicitar {formatMoney(amountCents)}
        </Button>

        {kycApproved && balance < minTokens && (
          <p className="text-xs text-muted-foreground">
            Te faltan {formatTokens(minTokens - balance)} tokens para alcanzar el
            minimo de retiro ({formatTokens(minTokens)}).
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  placeholder,
  disabled,
  type = 'text',
  mono = false,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  type?: string;
  mono?: boolean;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type={type}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className={mono ? 'font-mono text-sm' : undefined}
      />
    </div>
  );
}

function Notice({
  tone,
  children,
}: {
  tone: 'warning';
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
      <p className="text-sm text-muted-foreground">{children}</p>
    </div>
  );
}
