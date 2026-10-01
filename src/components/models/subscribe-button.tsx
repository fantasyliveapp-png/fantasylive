'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Coins, Crown, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  cancelSubscriptionAction,
  subscribeAction,
} from '@/server/actions/subscriptions';
import { cn } from '@/lib/utils';
import { useJoinPrompt } from '@/components/providers/join-prompt';

export function SubscribeButton({
  modelId,
  slug,
  priceTokens,
  initialSubscribed,
  isAuthenticated,
  className,
  label,
}: {
  modelId: string;
  slug: string;
  priceTokens: number;
  initialSubscribed: boolean;
  isAuthenticated: boolean;
  className?: string;
  /** Texto del boton (por defecto "Suscribirme · X/mes"). */
  label?: string;
}) {
  const router = useRouter();
  const joinPrompt = useJoinPrompt();
  const [subscribed, setSubscribed] = useState(initialSubscribed);
  const [confirming, setConfirming] = useState(false);
  const [isPending, startTransition] = useTransition();

  function openFlow() {
    if (!isAuthenticated) {
      joinPrompt('para suscribirte');
      return;
    }
    if (subscribed) {
      cancel();
      return;
    }
    setConfirming(true);
  }

  function confirmSubscribe() {
    startTransition(async () => {
      const result = await subscribeAction(modelId, slug);
      if (result.ok) {
        setSubscribed(true);
        setConfirming(false);
        toast.success(result.message ?? 'Suscripcion activada');
        router.refresh();
      } else {
        toast.error(result.error ?? 'No se pudo activar la suscripcion');
      }
    });
  }

  function cancel() {
    startTransition(async () => {
      const result = await cancelSubscriptionAction(modelId, slug);
      if (result.ok) {
        setSubscribed(false);
        toast.success(result.message ?? 'Suscripcion cancelada');
        router.refresh();
      } else {
        toast.error(result.error ?? 'No se pudo cancelar');
      }
    });
  }

  return (
    <>
      <Button
        variant={subscribed ? 'outline' : 'brand'}
        onClick={openFlow}
        disabled={isPending}
        className={cn('gap-1.5', className)}
      >
        {isPending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Crown className="h-4 w-4" />
        )}
        {subscribed ? 'Suscriptor' : (label ?? `Suscribirme · ${priceTokens}/mes`)}
      </Button>

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Suscripcion mensual</DialogTitle>
            <DialogDescription>
              Se descontaran{' '}
              <strong className="text-token">{priceTokens} tokens</strong> y se
              renueva cada 30 dias (sin renovacion automatica: al vencer podes
              volver a suscribirte). Incluye el contenido exclusivo y el
              descuento en llamadas mientras este activa.
            </DialogDescription>
          </DialogHeader>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirming(false)}>
              Cancelar
            </Button>
            <Button variant="token" onClick={confirmSubscribe} disabled={isPending}>
              {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              <Coins className="h-4 w-4" />
              Pagar {priceTokens} tokens
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
