'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Crown, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { setOnlineStatusAction } from '@/server/actions/model';

export function OnlineToggle({
  isOnline,
  isAvailableForVip,
  isVipEnabled,
  canStream,
}: {
  isOnline: boolean;
  isAvailableForVip: boolean;
  isVipEnabled: boolean;
  canStream: boolean;
}) {
  const router = useRouter();
  const [online, setOnline] = useState(isOnline);
  const [vip, setVip] = useState(isAvailableForVip);
  const [isPending, startTransition] = useTransition();

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
          {online ? 'En linea' : 'Desconectada'}
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
