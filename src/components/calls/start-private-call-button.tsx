'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CalendarDays, Coins, Loader2, Video } from 'lucide-react';
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
import {
  formatRate,
  formatRateNumber,
  tokensForMinutes,
} from '@/lib/rates';
import { useJoinPrompt } from '@/components/providers/join-prompt';

export function StartPrivateCallButton({
  slug,
  stageName,
  isOnline,
  canBook = false,
  rateCentitokens,
  minMinutes,
  isAuthenticated,
  size = 'lg',
  className = 'w-full',
  variant = 'full',
  label,
  compact = false,
}: {
  slug: string;
  stageName: string;
  /** Tiene "Recibo llamadas" activado ahora mismo. */
  isOnline: boolean;
  /** Acepta citas: si no se le puede llamar, se ofrece reservar. */
  canBook?: boolean;
  rateCentitokens: number;
  minMinutes: number;
  isAuthenticated: boolean;
  size?: ButtonProps['size'];
  className?: string;
  /** 'icon': boton redondo para la cabecera del chat. */
  variant?: 'full' | 'icon';
  /** Texto del boton (por defecto "Llamar ahora · X/min"). */
  label?: string;
  /** Sin llamada disponible: "No disponible" y "Reservar" en una sola fila. */
  compact?: boolean;
}) {
  const router = useRouter();
  const joinPrompt = useJoinPrompt();
  const [confirming, setConfirming] = useState(false);
  const [isPending, startTransition] = useTransition();

  function openConfirm() {
    if (!isAuthenticated) {
      joinPrompt('para hacer una videollamada');
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

  const dialogOnly = variant === 'icon';

  if (dialogOnly && !isOnline) {
    return (
      <span
        title={`${stageName} no recibe llamadas ahora`}
        className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground/50"
      >
        <Video className="h-5 w-5" />
      </span>
    );
  }

  if (!isOnline && compact) {
    return (
      <div className={cn('grid gap-2', canBook && 'grid-cols-2')}>
        <Button variant="secondary" size={size} className="w-full" disabled>
          <Video className="h-4 w-4" />
          No disponible
        </Button>
        {canBook && (
          <Link href="#reservar" className="block">
            <Button variant="outline" size={size} className="w-full">
              <CalendarDays className="h-4 w-4" />
              Reservar
            </Button>
          </Link>
        )}
      </div>
    );
  }

  if (!isOnline) {
    return (
      <div className="space-y-2">
        <Button variant="secondary" size={size} className={cn(className)} disabled>
          <Video className="h-5 w-5" />
          No recibe llamadas ahora
        </Button>
        {canBook && (
          <Link href="#reservar" className="block">
            <Button variant="outline" className="w-full">
              <CalendarDays className="h-4 w-4" />
              Reservar videollamada
            </Button>
          </Link>
        )}
      </div>
    );
  }

  return (
    <>
      {dialogOnly ? (
        <button
          type="button"
          onClick={openConfirm}
          disabled={isPending}
          title={`Videollamada · ${formatRateNumber(rateCentitokens)}/min`}
          aria-label={`Llamar a ${stageName}`}
          className="relative flex h-9 w-9 items-center justify-center rounded-full bg-state-connected/15 text-state-connected hover:bg-state-connected/25"
        >
          {isPending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Video className="h-5 w-5" />}
          <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-state-connected" />
        </button>
      ) : (
      <Button
        variant="brand"
        size={size}
        className={cn(className)}
        onClick={openConfirm}
        disabled={isPending}
      >
        {isPending ? (
          <Loader2 className="h-5 w-5 animate-spin" />
        ) : (
          <Video className="h-5 w-5" />
        )}
        {label ?? `Llamar ahora · ${formatRateNumber(rateCentitokens)}/min`}
      </Button>
      )}

      <Dialog open={confirming} onOpenChange={(o) => !isPending && setConfirming(o)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Llamar a {stageName}</DialogTitle>
            <DialogDescription>
              Le sonará en su pantalla; si no contesta en 30 segundos, no se te
              cobra nada. Una vez conectados pagas{' '}
              <strong className="text-token">{formatRate(rateCentitokens)}</strong>.
              <span className="mt-2 block">
                Mínimo <strong>{minMinutes} min</strong> (
                {tokensForMinutes(rateCentitokens, minMinutes)} tokens): si cuelgas tú
                antes, se cobra el mínimo; si cuelga {stageName} antes, solo pagas el
                tiempo usado.
              </span>
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
