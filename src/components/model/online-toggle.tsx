'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Crown, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import type { Gender } from '@prisma/client';

import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { onlineLabel } from '@/lib/gender-words';
import { cn } from '@/lib/utils';
import { setOnlineStatusAction } from '@/server/actions/model';

export function OnlineToggle({
  isOnline,
  isAvailableForVip,
  isVipEnabled,
  canStream,
  gender,
  variant = 'compact',
}: {
  isOnline: boolean;
  isAvailableForVip: boolean;
  isVipEnabled: boolean;
  canStream: boolean;
  /** Genero del perfil, para "desconectada" / "desconectado". */
  gender?: Gender | null;
  /** "hero": boton grande para el inicio del panel. */
  variant?: 'compact' | 'hero';
}) {
  const router = useRouter();
  const [online, setOnline] = useState(isOnline);
  const [vip, setVip] = useState(isAvailableForVip);
  const [isPending, startTransition] = useTransition();

  // Hay dos interruptores en pantalla (menu lateral e inicio): al cambiar uno,
  // el refresh trae el estado nuevo y el otro se pone al dia.
  useEffect(() => {
    setOnline(isOnline);
    setVip(isAvailableForVip);
  }, [isOnline, isAvailableForVip]);

  function update(nextOnline: boolean, nextVip: boolean) {
    setOnline(nextOnline);
    setVip(nextVip);

    startTransition(async () => {
      const result = await setOnlineStatusAction({
        isOnline: nextOnline,
        isAvailableForVip: nextVip,
      });

      if (result.ok) {
        toast.success(result.message ?? 'Estado actualizado');
        router.refresh();
      } else {
        // Revierte el optimismo si el servidor lo rechaza
        setOnline(isOnline);
        setVip(isAvailableForVip);
        toast.error(result.error ?? 'No se pudo cambiar el estado');
      }
    });
  }

  if (variant === 'hero') {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => update(!online, !online ? vip : false)}
          disabled={isPending || !canStream}
          className={cn(
            'flex items-center gap-2.5 rounded-full border py-2 pl-2 pr-4 text-sm font-semibold transition-all disabled:cursor-not-allowed disabled:opacity-60',
            online
              ? 'border-state-connected/50 bg-state-connected/15 text-foreground'
              : 'border-border bg-muted/60 text-muted-foreground hover:text-foreground',
          )}
          aria-pressed={online}
        >
          {/* Interruptor dibujado: se entiende sin leer. */}
          <span
            className={cn(
              'relative h-6 w-11 rounded-full transition-colors',
              online ? 'bg-state-connected' : 'bg-muted-foreground/40',
            )}
          >
            <span
              className={cn(
                'absolute top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-white shadow transition-all',
                online ? 'left-[22px]' : 'left-0.5',
              )}
            >
              {isPending && <Loader2 className="h-3 w-3 animate-spin text-black" />}
            </span>
          </span>
          {online ? 'Estas en linea' : `Estas ${onlineLabel(gender, false).toLowerCase()}`}
        </button>

        {isVipEnabled && online && (
          <button
            type="button"
            onClick={() => update(online, !vip)}
            disabled={isPending || !canStream}
            className={cn(
              'flex items-center gap-1.5 rounded-full border px-3 py-2 text-xs font-medium transition-colors',
              vip
                ? 'border-primary/60 bg-primary/15 text-foreground'
                : 'border-border text-muted-foreground hover:text-foreground',
            )}
            aria-pressed={vip}
          >
            <Crown className="h-3.5 w-3.5 text-primary" />
            {vip ? 'Recibiendo VIP' : 'Aceptar VIP'}
          </button>
        )}

        {!canStream && (
          <p className="w-full text-xs text-muted-foreground">
            Verifica tu identidad para poder conectarte.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor="online" className="flex items-center gap-2 text-sm">
          {isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <span
              className={online ? 'live-dot' : 'h-2.5 w-2.5 rounded-full bg-muted-foreground'}
            />
          )}
          {online ? 'En linea' : onlineLabel(gender, false)}
        </Label>
        <Switch
          id="online"
          checked={online}
          disabled={isPending || !canStream}
          onCheckedChange={(v) => update(v, v ? vip : false)}
        />
      </div>

      {isVipEnabled && (
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor="vip" className="flex items-center gap-2 text-sm">
            <Crown className="h-3.5 w-3.5 text-primary" />
            Cola VIP
          </Label>
          <Switch
            id="vip"
            checked={vip}
            disabled={isPending || !online || !canStream}
            onCheckedChange={(v) => update(online, v)}
          />
        </div>
      )}

      {!canStream && (
        <p className="text-xs text-muted-foreground">
          Necesitas el KYC aprobado para poder emitir.
        </p>
      )}
    </div>
  );
}
