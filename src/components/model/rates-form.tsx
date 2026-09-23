'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Coins, Loader2 } from 'lucide-react';
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
import { Switch } from '@/components/ui/switch';
import { updateRatesAction } from '@/server/actions/model';
import {
  MAX_RATE_CENTITOKENS,
  MIN_BILLED_CALL_MINUTES,
  MIN_RATE_CENTITOKENS,
  applyDiscountToRate,
  centitokensToTokens,
  clampRateCentitokens,
  formatRateNumber,
  tokensForMinutes,
  tokensToCentitokens,
} from '@/lib/rates';
import { formatMoney } from '@/lib/utils';

/**
 * Las tarifas se editan en TOKENS con decimales (1,75 - 25) y se guardan en
 * centitokens. El paso de 0,05 evita que el navegador rechace 1,75 por no ser
 * multiplo del step, que es lo que pasaria con step=1.
 */
const RATE_STEP_TOKENS = 0.05;
const MIN_RATE_TOKENS = centitokensToTokens(MIN_RATE_CENTITOKENS);
const MAX_RATE_TOKENS = centitokensToTokens(MAX_RATE_CENTITOKENS);

export function RatesForm({
  vipRateCentitokens: initialVip,
  privateRateCentitokens: initialPrivate,
  minPrivateMinutes: initialMin,
  isVipEnabled: initialVipEnabled,
  acceptsBookings: initialBookings,
  subscriptionEnabled: initialSubEnabled,
  subscriptionPriceTokens: initialSubPrice,
  subscriptionDiscountPercent: initialSubDiscount,
  messagingEnabled: initialMsgEnabled,
  messagePriceTokens: initialMsgPrice,
  kycApproved,
  modelSharePercent,
  payoutCentsPerToken,
}: {
  vipRateCentitokens: number;
  privateRateCentitokens: number;
  minPrivateMinutes: number;
  isVipEnabled: boolean;
  acceptsBookings: boolean;
  subscriptionEnabled: boolean;
  subscriptionPriceTokens: number;
  subscriptionDiscountPercent: number;
  messagingEnabled: boolean;
  messagePriceTokens: number;
  kycApproved: boolean;
  /** % de los tokens gastados que se queda la creadora (60 por defecto). */
  modelSharePercent: number;
  /** Centavos que vale cada token ganado al retirarlo. */
  payoutCentsPerToken: number;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // Texto libre mientras se teclea, para poder escribir "1," sin que el
  // campo salte a 1 en cuanto se pulsa la coma.
  const [vipRateText, setVipRateText] = useState(() =>
    formatRateNumber(initialVip).replace(',', '.'),
  );
  const [privateRateText, setPrivateRateText] = useState(() =>
    formatRateNumber(initialPrivate).replace(',', '.'),
  );

  const vipRate = clampRateCentitokens(tokensToCentitokens(vipRateText));
  const privateRate = clampRateCentitokens(tokensToCentitokens(privateRateText));

  const [minMinutes, setMinMinutes] = useState(initialMin);
  const [vipEnabled, setVipEnabled] = useState(initialVipEnabled);
  const [bookings, setBookings] = useState(initialBookings);
  const [subEnabled, setSubEnabled] = useState(initialSubEnabled);
  const [subPrice, setSubPrice] = useState(initialSubPrice);
  const [subDiscount, setSubDiscount] = useState(initialSubDiscount);
  const [msgEnabled, setMsgEnabled] = useState(initialMsgEnabled);
  const [msgPrice, setMsgPrice] = useState(initialMsgPrice);

  /** Ganancia neta en centavos por minuto a esa tarifa. */
  const earnPerMinuteCents = (rateCentitokens: number) =>
    Math.round(
      (centitokensToTokens(rateCentitokens) *
        modelSharePercent *
        payoutCentsPerToken) /
        100,
    );
  const earnCents = (tokens: number) =>
    Math.round((tokens * modelSharePercent * payoutCentsPerToken) / 100);

  function save() {
    startTransition(async () => {
      const result = await updateRatesAction({
        vipRateCentitokens: vipRate,
        privateRateCentitokens: privateRate,
        minPrivateMinutes: minMinutes,
        isVipEnabled: vipEnabled,
        acceptsBookings: bookings,
        subscriptionEnabled: subEnabled,
        subscriptionPriceTokens: subPrice,
        subscriptionDiscountPercent: subDiscount,
        messagingEnabled: msgEnabled,
        messagePriceTokens: msgPrice,
      });

      if (result.ok) {
        toast.success(result.message ?? 'Tarifas guardadas');
        router.refresh();
      } else {
        toast.error(result.error ?? 'No se pudieron guardar las tarifas');
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Tarifas por minuto</CardTitle>
        <CardDescription>
          Te quedas con el {modelSharePercent}% de los tokens consumidos. Los
          importes en dolares son estimados sobre{' '}
          {formatMoney(payoutCentsPerToken)} por token, antes de la comision de
          retiro. Puedes cobrar entre{' '}
          {formatRateNumber(MIN_RATE_CENTITOKENS)} y{' '}
          {formatRateNumber(MAX_RATE_CENTITOKENS)} tokens por minuto.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        <div className="grid gap-5 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="vipRate">Llamada VIP aleatoria (tokens/min)</Label>
            <div className="relative">
              <Coins className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-token" />
              <Input
                id="vipRate"
                type="number"
                inputMode="decimal"
                min={MIN_RATE_TOKENS}
                max={MAX_RATE_TOKENS}
                step={RATE_STEP_TOKENS}
                value={vipRateText}
                onChange={(e) => setVipRateText(e.target.value)}
                className="pl-9"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              {formatRateNumber(vipRate)} tokens/min &middot; ganas ~
              {formatMoney(earnPerMinuteCents(vipRate))} por minuto en directo.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="privateRate">Privado reservado (tokens/min)</Label>
            <div className="relative">
              <Coins className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-token" />
              <Input
                id="privateRate"
                type="number"
                inputMode="decimal"
                min={MIN_RATE_TOKENS}
                max={MAX_RATE_TOKENS}
                step={RATE_STEP_TOKENS}
                value={privateRateText}
                onChange={(e) => setPrivateRateText(e.target.value)}
                className="pl-9"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              {formatRateNumber(privateRate)} tokens/min &middot; ganas ~
              {formatMoney(earnPerMinuteCents(privateRate))} por minuto
              reservado.
            </p>
          </div>
        </div>

        <div className="space-y-2 sm:max-w-xs">
          <Label htmlFor="minMinutes">Duracion minima de un privado (min)</Label>
          <Input
            id="minMinutes"
            type="number"
            min={MIN_BILLED_CALL_MINUTES}
            max={120}
            value={minMinutes}
            onChange={(e) => setMinMinutes(Number(e.target.value))}
          />
          <p className="text-xs text-muted-foreground">
            Se facturan {minMinutes} minutos como minimo (
            {tokensForMinutes(privateRate, minMinutes)} tokens) aunque la
            llamada se corte antes. El minimo de la plataforma es de{' '}
            {MIN_BILLED_CALL_MINUTES} min.
          </p>
        </div>

        <div className="space-y-4 rounded-lg border border-border p-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <Label htmlFor="vipEnabled">Participar en la sala VIP</Label>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Te emparejamos al azar con usuarios que pagan por minuto.
              </p>
            </div>
            <Switch
              id="vipEnabled"
              checked={vipEnabled}
              disabled={!kycApproved}
              onCheckedChange={setVipEnabled}
            />
          </div>

          <div className="flex items-center justify-between gap-4">
            <div>
              <Label htmlFor="bookings">Aceptar reservas</Label>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Los usuarios podran agendar privados en tu calendario.
              </p>
            </div>
            <Switch
              id="bookings"
              checked={bookings}
              disabled={!kycApproved}
              onCheckedChange={setBookings}
            />
          </div>

          {!kycApproved && (
            <p className="text-xs text-amber-500">
              Necesitas el KYC aprobado para activar estas opciones.
            </p>
          )}
        </div>

        <div className="space-y-4 rounded-lg border border-border p-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <Label htmlFor="subEnabled">Suscripcion mensual (fan club)</Label>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Contenido marcado como exclusivo se desbloquea solo con
                suscripcion activa, y tus suscriptores pagan menos por minuto.
              </p>
            </div>
            <Switch
              id="subEnabled"
              checked={subEnabled}
              disabled={!kycApproved}
              onCheckedChange={setSubEnabled}
            />
          </div>

          {subEnabled && (
            <div className="grid gap-5 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="subPrice">Precio mensual (tokens)</Label>
                <div className="relative">
                  <Coins className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-token" />
                  <Input
                    id="subPrice"
                    type="number"
                    min={1}
                    max={100000}
                    value={subPrice}
                    onChange={(e) => setSubPrice(Number(e.target.value))}
                    className="pl-9"
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  Ganas ~{formatMoney(earnCents(subPrice))} por suscriptor cada
                  mes.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="subDiscount">
                  Descuento en llamadas para suscriptores (%)
                </Label>
                <Input
                  id="subDiscount"
                  type="number"
                  min={0}
                  max={90}
                  value={subDiscount}
                  onChange={(e) => setSubDiscount(Number(e.target.value))}
                />
                <p className="text-xs text-muted-foreground">
                  Tu tarifa de privado les queda en{' '}
                  {formatRateNumber(
                    applyDiscountToRate(privateRate, subDiscount),
                  )}{' '}
                  tokens/min.
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="space-y-4 rounded-lg border border-border p-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <Label htmlFor="msgEnabled">Mensajeria privada</Label>
              <p className="mt-0.5 text-xs text-muted-foreground">
                El primer mensaje de cada usuario se cobra una vez. Despues
                puede seguir escribiendo mientras tenga saldo en su monedero.
              </p>
            </div>
            <Switch
              id="msgEnabled"
              checked={msgEnabled}
              disabled={!kycApproved}
              onCheckedChange={setMsgEnabled}
            />
          </div>

          {msgEnabled && (
            <div className="space-y-2 sm:max-w-xs">
              <Label htmlFor="msgPrice">Precio por abrir conversacion (tokens)</Label>
              <div className="relative">
                <Coins className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-token" />
                <Input
                  id="msgPrice"
                  type="number"
                  min={1}
                  max={100000}
                  value={msgPrice}
                  onChange={(e) => setMsgPrice(Number(e.target.value))}
                  className="pl-9"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Ganas ~{formatMoney(earnCents(msgPrice))} por cada conversacion
                nueva.
              </p>
            </div>
          )}
        </div>

        <Button variant="brand" onClick={save} disabled={isPending}>
          {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          Guardar tarifas
        </Button>
      </CardContent>
    </Card>
  );
}
