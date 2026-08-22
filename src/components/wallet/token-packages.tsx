'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Coins, Loader2, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import type { TokenPackage } from '@prisma/client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { purchaseTokensAction } from '@/server/actions/wallet';
import { formatMoney, formatTokens } from '@/lib/utils';

export function TokenPackages({ packages }: { packages: TokenPackage[] }) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function buy(pkg: TokenPackage) {
    setPendingId(pkg.id);

    startTransition(async () => {
      const result = await purchaseTokensAction(pkg.id);
      setPendingId(null);

      if (!result.ok) {
        toast.error(result.error ?? 'No se pudo iniciar la compra');
        return;
      }

      // Pasarela real: redirige al checkout
      if (result.redirectUrl) {
        window.location.href = result.redirectUrl;
        return;
      }

      // Modo mock (desarrollo): credito inmediato
      toast.success(result.message ?? 'Tokens acreditados');
      router.refresh();
    });
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
      {packages.map((pkg) => {
        const total = pkg.tokens + pkg.bonusTokens;
        const pricePerToken = pkg.priceCents / total;

        return (
          <Card
            key={pkg.id}
            className={
              pkg.isPopular
                ? 'relative border-primary'
                : 'relative'
            }
          >
            {pkg.isPopular && (
              <Badge
                variant="vip"
                className="absolute -top-2.5 left-1/2 -translate-x-1/2 gap-1"
              >
                <Sparkles className="h-3 w-3" />
                Mas popular
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
                  <Check className="h-3 w-3" />+{pkg.bonusTokens} de regalo
                </Badge>
              )}

              <p className="mt-4 text-2xl font-semibold">
                {formatMoney(pkg.priceCents, pkg.currency)}
              </p>
              <p className="text-xs text-muted-foreground">
                {(pricePerToken / 100).toFixed(3)} $/token
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
                disabled={pendingId !== null}
              >
                {pendingId === pkg.id ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : null}
                Comprar
              </Button>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
