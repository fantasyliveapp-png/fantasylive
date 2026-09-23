'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Coins, Crown, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { cancelSubscriptionAction } from '@/server/actions/subscriptions';
import { formatDate, formatTokens, initials } from '@/lib/utils';

interface SubscriptionRow {
  id: string;
  modelId: string;
  modelSlug: string;
  modelStageName: string;
  modelAvatarUrl: string | null;
  modelIsOnline: boolean;
  priceTokens: number;
  discountPercent: number;
  startedAt: string;
  currentPeriodEnd: string;
  cancelledAt: string | null;
  isActive: boolean;
}

export function SubscriptionsManager({
  subscriptions,
}: {
  subscriptions: SubscriptionRow[];
}) {
  const active = subscriptions.filter((s) => s.isActive);
  const past = subscriptions.filter((s) => !s.isActive);

  if (subscriptions.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
        Todavia no te suscribiste a ninguna creadora. Entra al perfil de una
        creadora para suscribirte y acceder a su contenido exclusivo.
      </p>
    );
  }

  return (
    <div className="space-y-10">
      <div>
        <h2 className="section-title text-lg">Activas ({active.length})</h2>
        {active.length === 0 ? (
          <p className="mt-4 rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            No tenes suscripciones activas.
          </p>
        ) : (
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {active.map((sub) => (
              <SubscriptionCard key={sub.id} sub={sub} />
            ))}
          </div>
        )}
      </div>

      {past.length > 0 && (
        <div>
          <h2 className="section-title text-lg">Anteriores ({past.length})</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {past.map((sub) => (
              <SubscriptionCard key={sub.id} sub={sub} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function SubscriptionCard({ sub }: { sub: SubscriptionRow }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function cancel() {
    startTransition(async () => {
      const result = await cancelSubscriptionAction(sub.modelId, sub.modelSlug);
      if (result.ok) {
        toast.success(result.message ?? 'Suscripcion cancelada');
        router.refresh();
      } else {
        toast.error(result.error ?? 'No se pudo cancelar');
      }
    });
  }

  return (
    <Card>
      <CardContent className="space-y-3 pt-6">
        <div className="flex items-start justify-between gap-3">
          <Link
            href={`/models/${sub.modelSlug}`}
            className="flex items-center gap-2.5"
          >
            <Avatar className="h-10 w-10">
              {sub.modelAvatarUrl && (
                <AvatarImage src={sub.modelAvatarUrl} alt="" />
              )}
              <AvatarFallback>{initials(sub.modelStageName)}</AvatarFallback>
            </Avatar>
            <div>
              <p className="text-sm font-medium">{sub.modelStageName}</p>
              <p className="text-xs text-muted-foreground">
                {sub.modelIsOnline ? 'Conectada' : 'Offline'}
              </p>
            </div>
          </Link>
          <Badge variant={sub.isActive ? 'success' : 'muted'}>
            {sub.isActive ? 'Activa' : sub.cancelledAt ? 'Cancelada' : 'Vencida'}
          </Badge>
        </div>

        <div className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2.5 text-sm">
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <Coins className="h-3.5 w-3.5" />
            {formatTokens(sub.priceTokens)} tokens/mes
          </span>
          {sub.discountPercent > 0 && (
            <span className="flex items-center gap-1 text-xs text-token">
              <Crown className="h-3 w-3" />
              -{sub.discountPercent}% en privados
            </span>
          )}
        </div>

        <p className="text-xs text-muted-foreground">
          {sub.isActive
            ? `Se renueva o vence el ${formatDate(sub.currentPeriodEnd)}`
            : `Termino el ${formatDate(sub.currentPeriodEnd)}`}
        </p>

        {sub.isActive ? (
          <Button
            variant="ghost"
            size="sm"
            className="w-full text-destructive hover:text-destructive"
            onClick={cancel}
            disabled={isPending}
          >
            {isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <X className="h-3.5 w-3.5" />
            )}
            Cancelar suscripcion
          </Button>
        ) : (
          <Link href={`/models/${sub.modelSlug}`}>
            <Button variant="outline" size="sm" className="w-full">
              <Crown className="h-3.5 w-3.5" />
              Volver a suscribirme
            </Button>
          </Link>
        )}
      </CardContent>
    </Card>
  );
}
