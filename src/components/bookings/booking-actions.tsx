'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Loader2, Video, X } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  cancelBookingAction,
  confirmBookingAction,
  settleBookingAction,
  startBookingCallAction,
} from '@/server/actions/bookings';

export function BookingActions({
  bookingId,
  status,
  canJoin,
  existingSessionId,
  role,
}: {
  bookingId: string;
  status: string;
  canJoin: boolean;
  existingSessionId: string | null;
  role: 'USER' | 'MODEL';
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function run(fn: () => Promise<any>, successFallback = 'Hecho') {
    startTransition(async () => {
      const result = await fn();
      if (result.ok) {
        toast.success(result.message ?? successFallback);
        if (result.sessionId) {
          router.push(`/call/${result.sessionId}`);
          return;
        }
        router.refresh();
      } else {
        toast.error(result.error ?? 'No se pudo completar la accion');
      }
    });
  }

  const canCancel = ['PENDING_CONFIRMATION', 'CONFIRMED'].includes(status);

  return (
    <div className="flex flex-wrap items-center gap-2">
      {role === 'MODEL' && status === 'PENDING_CONFIRMATION' && (
        <Button
          size="sm"
          variant="brand"
          disabled={isPending}
          onClick={() => run(() => confirmBookingAction(bookingId), 'Confirmada')}
        >
          {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          Confirmar
        </Button>
      )}

      {(canJoin || existingSessionId) && status !== 'COMPLETED' && (
        <Button
          size="sm"
          variant="brand"
          disabled={isPending}
          onClick={() =>
            existingSessionId
              ? router.push(`/call/${existingSessionId}`)
              : run(() => startBookingCallAction(bookingId), 'Abriendo sala')
          }
        >
          <Video className="h-4 w-4" />
          Entrar
        </Button>
      )}

      {role === 'MODEL' && status === 'IN_PROGRESS' && (
        <Button
          size="sm"
          variant="outline"
          disabled={isPending}
          onClick={() => run(() => settleBookingAction(bookingId), 'Liquidada')}
        >
          Liquidar
        </Button>
      )}

      {canCancel && (
        <Button
          size="sm"
          variant="ghost"
          className="text-destructive hover:text-destructive"
          disabled={isPending}
          onClick={() => run(() => cancelBookingAction(bookingId), 'Cancelada')}
        >
          <X className="h-4 w-4" />
          Cancelar
        </Button>
      )}
    </div>
  );
}
