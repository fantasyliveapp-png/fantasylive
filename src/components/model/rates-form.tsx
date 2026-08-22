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
import { formatMoney } from '@/lib/utils';

/** Centavos que cobra la modelo por token (mitad del precio de venta por defecto). */
const PAYOUT_CENTS_PER_TOKEN = 5;

export function RatesForm({
  vipRatePerMinute: initialVip,
  privateRatePerMinute: initialPrivate,
  minPrivateMinutes: initialMin,
  isVipEnabled: initialVipEnabled,
  acceptsBookings: initialBookings,
  subscriptionEnabled: initialSubEnabled,
  subscriptionPriceTokens: initialSubPrice,
  subscriptionDiscountPercent: initialSubDiscount,
  messagingEnabled: initialMsgEnabled,
  messagePriceTokens: initialMsgPrice,
  kycApproved,
}: {
  vipRatePerMinute: number;
  privateRatePerMinute: number;
  minPrivateMinutes: number;
  isVipEnabled: boolean;
  acceptsBookings: boolean;
  subscriptionEnabled: boolean;
  subscriptionPriceTokens: number;
  subscriptionDiscountPercent: number;
  messagingEnabled: boolean;
  messagePriceTokens: number;
  kycApproved: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [vipRate, setVipRate] = useState(initialVip);
  const [privateRate, setPrivateRate] = useState(initialPrivate);
  const [minMinutes, setMinMinutes] = useState(initialMin);
  const [vipEnabled, setVipEnabled] = useState(initialVipEnabled);
  const [bookings, setBookings] = useState(initialBookings);
  const [subEnabled, setSubEnabled] = useState(initialSubEnabled);
  const [subPrice, setSubPrice] = useState(initialSubPrice);
  const [subDiscount, setSubDiscount] = useState(initialSubDiscount);
  const [msgEnabled, setMsgEnabled] = useState(initialMsgEnabled);
  const [msgPrice, setMsgPrice] = useState(initialMsgPrice);

  function save() {
    startTransition(async () => {
      const result = await updateRatesAction({
        vipRatePerMinute: vipRate,
        privateRatePerMinute: privateRate,
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
          Tu ganancia neta es del 70% de los tokens consumidos. Los importes en
          dolares son estimados sobre {PAYOUT_CENTS_PER_TOKEN} centavos por token.
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
                min={1}
                max={1000}
                value={vipRate}
                onChange={(e) => setVipRate(Number(e.target.value))}
                className="pl-9"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Ganas ~
              {formatMoney(
                Math.round(vipRate * 0.7 * PAYOUT_CENTS_PER_TOKEN),
              )}{' '}
              por minuto en directo.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="privateRate">Privado reservado (tokens/min)</Label>
            <div className="relative">
              <Coins className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-token" />
              <Input
                id="privateRate"
                type="number"
                min={1}
                max={2000}
                value={privateRate}
                onChange={(e) => setPrivateRate(Number(e.target.value))}
                className="pl-9"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Ganas ~
              {formatMoney(
                Math.round(privateRate * 0.7 * PAYOUT_CENTS_PER_TOKEN),
              )}{' '}
              por minuto reservado.
            </p>
          </div>
        </div>

        <div className="space-y-2 sm:max-w-xs">
          <Label htmlFor="minMinutes">Duracion minima de un privado (min)</Label>
          <Input
            id="minMinutes"
            type="number"
            min={5}
            max={120}
            value={minMinutes}
            onChange={(e) => setMinMinutes(Number(e.target.value))}
          />
          <p className="text-xs text-muted-foreground">
            Reserva minima: {minMinutes * privateRate} tokens.
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
                  Ganas ~
                  {formatMoney(
                    Math.round(subPrice * 0.7 * PAYOUT_CENTS_PER_TOKEN),
                  )}{' '}
                  por suscriptor cada mes.
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
                  {Math.max(
                    1,
                    Math.round(privateRate * (1 - subDiscount / 100)),
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
                Ganas ~
                {formatMoney(Math.round(msgPrice * 0.7 * PAYOUT_CENTS_PER_TOKEN))}{' '}
                por cada conversacion nueva.
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
