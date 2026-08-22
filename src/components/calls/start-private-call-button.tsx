'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Coins, Loader2, Video } from 'lucide-react';
import { toast } from 'sonner';

import { Button, type ButtonProps } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { startPrivateCallAction } from '@/server/actions/calls';
import { cn } from '@/lib/utils';

export function StartPrivateCallButton({
  slug,
  stageName,
  isOnline,
  ratePerMinute,
  minMinutes,
  isAuthenticated,
  size = 'lg',
  className = 'w-full',
}: {
  slug: string;
  stageName: string;
  isOnline: boolean;
  ratePerMinute: number;
  minMinutes: number;
  isAuthenticated: boolean;
  size?: ButtonProps['size'];
  className?: string;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [isPending, startTransition] = useTransition();

  function openConfirm() {
    if (!isAuthenticated) {
      router.push(`/login?callbackUrl=/models/${slug}`);
      return;
    }
    setConfirming(true);
  }

  function start() {
    startTransition(async () => {
      const result = await startPrivateCallAction(slug);
      if (result.ok) {
        router.push(`/call/${(result.data as any).sessionId}`);
      } else {
        toast.error(result.error ?? 'No se pudo iniciar la llamada');
        setConfirming(false);
      }
    });
  }

  return (
    <>
      <Button
        variant="brand"
        size={size}
        className={cn(className)}
        onClick={openConfirm}
        disabled={isPending || !isOnline}
      >
        {isPending ? (
          <Loader2 className="h-5 w-5 animate-spin" />
        ) : (
          <Video className="h-5 w-5" />
        )}
        {isOnline
          ? `Llamar ahora · ${ratePerMinute}/min`
          : 'Offline · reserva mas abajo'}
      </Button>

      <Dialog open={confirming} onOpenChange={(o) => !isPending && setConfirming(o)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Llamar a {stageName}</DialogTitle>
            <DialogDescription>
              Se cobran{' '}
              <strong className="text-token">{ratePerMinute} tokens/min</strong>,
              minimo {minMinutes} min. El cobro se detiene en cuanto cuelgas.
            </DialogDescription>
          </DialogHeader>

          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setConfirming(false)}
              disabled={isPending}
            >
              Cancelar
            </Button>
            <Button variant="brand" onClick={start} disabled={isPending}>
              {isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Coins className="h-4 w-4" />
              )}
              Confirmar llamada
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
