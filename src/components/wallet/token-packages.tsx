'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { Check, Coins, Loader2, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import type { TokenPackage } from '@prisma/client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useTranslate } from '@/components/providers/i18n-provider';
import { purchaseTokensAction } from '@/server/actions/wallet';
import { formatMoney, formatTokens } from '@/lib/utils';

/**
 * El dialogo de espera solo aparece tras pulsar Comprar, asi que su codigo
 * (Radix Dialog incluido) se descarga en ese momento y no lastra la carga
 * inicial del monedero.
 */
const CheckoutDialog = dynamic(
  () =>
    import('@/components/wallet/checkout-dialog').then(
      (mod) => mod.CheckoutDialog,
    ),
  { ssr: false },
);

/** Cada cuanto se relee el saldo mientras la pasarela sigue abierta. */
const POLL_MS = 4000;
/**
 * Cuando se deja de sondear. No se pierde nada al rendirse: el webhook
 * acredita igual, y el saldo aparecera en la siguiente carga de la pagina.
 */
const POLL_TIMEOUT_MS = 10 * 60 * 1000;

interface Checkout {
  url: string;
  /** Saldo justo antes de abrir la pasarela; si sube, el pago entro. */
  balanceAtStart: number;
  /** El navegador impidio abrir la pestana y hay que ofrecer un boton. */
  blocked: boolean;
}

export function TokenPackages({
  packages,
  balance,
}: {
  packages: TokenPackage[];
  balance: number;
}) {
  const t = useTranslate();
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [checkout, setCheckout] = useState<Checkout | null>(null);
  const [, startTransition] = useTransition();
  const checkoutWindow = useRef<Window | null>(null);

  const closeCheckout = useCallback(() => {
    checkoutWindow.current = null;
    setCheckout(null);
  }, []);

  /**
   * Mientras el pago sigue abierto, relee el saldo periodicamente.
   *
   * La acreditacion puede llegar por dos caminos -la vuelta del usuario a
   * /api/payments/paypal/capture o el webhook- y ninguno de los dos puede
   * avisar a esta pestana, que se quedo atras.
   */
  useEffect(() => {
    if (!checkout) return;

    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
        window.clearInterval(timer);
        return;
      }
      router.refresh();
    }, POLL_MS);

    return () => window.clearInterval(timer);
  }, [checkout, router]);

  /** El saldo subio: el pago entro, venga por donde venga. */
  useEffect(() => {
    if (!checkout || balance <= checkout.balanceAtStart) return;

    toast.success(
      t('wallet.credited', {
        tokens: formatTokens(balance - checkout.balanceAtStart),
      }),
    );
    checkoutWindow.current?.close();
    closeCheckout();
  }, [balance, checkout, closeCheckout, t]);

  function buy(pkg: TokenPackage) {
    setPendingId(pkg.id);

    // La pestana se abre AQUI, todavia dentro del gesto del usuario. Abrirla
    // despues del await la convertiria en un popup y el navegador la bloquea.
    const opened = window.open('about:blank', '_blank');
    // Corta el acceso de la pasarela a esta pagina via window.opener.
    if (opened) opened.opener = null;
    checkoutWindow.current = opened;

    startTransition(async () => {
      const result = await purchaseTokensAction(pkg.id);
      setPendingId(null);

      if (!result.ok) {
        opened?.close();
        checkoutWindow.current = null;
        toast.error(result.error ?? t('wallet.purchaseFailed'));
        return;
      }

      if (result.redirectUrl) {
        const usable = Boolean(opened) && !opened?.closed;
        if (usable) opened?.location.replace(result.redirectUrl);

        setCheckout({
          url: result.redirectUrl,
          balanceAtStart: balance,
          blocked: !usable,
        });
        return;
      }

      // Modo mock: los tokens ya estan acreditados, no hay pasarela que abrir.
      opened?.close();
      checkoutWindow.current = null;
      toast.success(result.message ?? t('wallet.credited', { tokens: '' }));
      router.refresh();
    });
  }

  function reopen() {
    if (!checkout) return;
    // Nace de un clic, asi que esta vez no lo bloquea el navegador.
    const opened = window.open(checkout.url, '_blank');
    if (opened) opened.opener = null;
    checkoutWindow.current = opened;
    if (opened) setCheckout({ ...checkout, blocked: false });
  }

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {packages.map((pkg) => {
          const total = pkg.tokens + pkg.bonusTokens;
          const pricePerToken = pkg.priceCents / total;
          const isPending = pendingId === pkg.id;

          return (
            <Card
              key={pkg.id}
              className={
                pkg.isPopular
                  ? 'relative border-primary transition-shadow hover:shadow-lg hover:shadow-primary/10'
                  : 'relative transition-shadow hover:shadow-lg'
              }
            >
              {pkg.isPopular && (
                <Badge
                  variant="vip"
                  className="absolute -top-2.5 left-1/2 -translate-x-1/2 gap-1"
                >
                  <Sparkles className="h-3 w-3" />
                  {t('wallet.mostPopular')}
                </Badge>
              )}

              <CardContent className="pt-6">
                <p className="text-sm font-medium text-muted-foreground">
                  {pkg.name}
                </p>

                <div className="mt-3 flex items-baseline gap-1.5">
                  <Coins className="h-5 w-5 text-token" />
                  <span className="text-3xl font-bold text-token">
                    {formatTokens(total)}
                  </span>
                </div>

                {pkg.bonusTokens > 0 && (
                  <Badge variant="success" className="mt-2 gap-1">
                    <Check className="h-3 w-3" />
                    {t('wallet.bonus', { tokens: pkg.bonusTokens })}
                  </Badge>
                )}

                <p className="mt-4 text-2xl font-semibold">
                  {formatMoney(pkg.priceCents, pkg.currency)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t('wallet.perToken', {
                    amount: (pricePerToken / 100).toFixed(3),
                  })}
                </p>

                {pkg.description && (
                  <p className="mt-3 min-h-[32px] text-xs text-muted-foreground">
                    {pkg.description}
                  </p>
                )}

                <Button
                  variant={pkg.isPopular ? 'brand' : 'outline'}
                  className="mt-4 w-full"
                  onClick={() => buy(pkg)}
                  disabled={pendingId !== null || checkout !== null}
                >
                  {isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {t('wallet.opening')}
                    </>
                  ) : (
                    t('wallet.buy')
                  )}
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {checkout && (
        <CheckoutDialog
          blocked={checkout.blocked}
          onClose={closeCheckout}
          onReopen={reopen}
        />
      )}
    </>
  );
}
