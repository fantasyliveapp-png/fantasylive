'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Gift, Images, Loader2, Video } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { CREATOR_OFFER_PERCENTS } from '@/lib/creator-offer-rules';
import { cn } from '@/lib/utils';
import { sendCouponAction } from '@/server/actions/creator-offers';

/** Creador, en el chat con un fan: enviarle un cupon (24 h, un uso). */
export function CouponButton({ fanId, fanName }: { fanId: string; fanName: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<'CALL' | 'CONTENT'>('CALL');
  const [percent, setPercent] = useState(20);
  const [isPending, start] = useTransition();

  function send() {
    start(async () => {
      const r = await sendCouponAction(fanId, target, percent);
      if (r.ok) {
        toast.success(r.message ?? 'Cupón enviado');
        setOpen(false);
        router.refresh();
      } else toast.error(r.error ?? 'No se pudo enviar.');
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-9 items-center gap-1.5 rounded-full bg-champagne-gold/15 px-3 text-xs font-semibold text-champagne-gold hover:bg-champagne-gold/25"
      >
        <Gift className="h-4 w-4" />
        Cupón
      </button>
      <Dialog open={open} onOpenChange={(o) => !isPending && setOpen(o)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Cupón para {fanName}</DialogTitle>
            <DialogDescription>
              Solo para este fan. Vale 24 horas y un uso. El descuento sale de tu precio.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  { key: 'CALL', icon: Video, label: 'Videollamada', hint: 'su próxima llamada' },
                  { key: 'CONTENT', icon: Images, label: 'Contenido', hint: 'lo próximo que desbloquee' },
                ] as const
              ).map((o) => (
                <button
                  key={o.key}
                  type="button"
                  onClick={() => setTarget(o.key)}
                  className={cn(
                    'flex flex-col items-center gap-1 rounded-xl border p-3 text-center transition-colors',
                    target === o.key ? 'border-primary bg-primary/10' : 'border-border/60 hover:border-primary/50',
                  )}
                >
                  <o.icon className="h-5 w-5 text-primary" />
                  <span className="text-sm font-semibold">{o.label}</span>
                  <span className="text-[11px] text-muted-foreground">{o.hint}</span>
                </button>
              ))}
            </div>

            <div className="flex flex-wrap gap-1.5">
              {CREATOR_OFFER_PERCENTS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPercent(p)}
                  className={cn(
                    'h-9 min-w-[3.25rem] rounded-full px-3 text-sm font-semibold',
                    p === percent ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/70',
                  )}
                >
                  −{p}%
                </button>
              ))}
            </div>

            <Button variant="brand" className="w-full" onClick={send} disabled={isPending}>
              {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Gift className="h-4 w-4" />}
              Enviar cupón −{percent}%
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
