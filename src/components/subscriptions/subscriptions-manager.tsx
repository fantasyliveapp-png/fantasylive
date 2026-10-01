'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { CalendarClock, Coins, Crown, Images, Loader2, RotateCcw, X } from 'lucide-react';
import { toast } from 'sonner';
import type { Gender } from '@prisma/client';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { cancelSubscriptionAction, subscribeAction } from '@/server/actions/subscriptions';
import { onlineLabel } from '@/lib/gender-words';
import { cn, formatDate, formatTokens, initials } from '@/lib/utils';

export interface SubscriptionRow {
  id: string;
  modelId: string;
  modelSlug: string;
  modelStageName: string;
  modelAvatarUrl: string | null;
  modelIsOnline: boolean;
  modelGender: Gender;
  priceTokens: number;
  discountPercent: number;
  startedAt: string;
  currentPeriodEnd: string;
  cancelledAt: string | null;
  isActive: boolean;
  /** Publicaciones solo para suscriptores que tiene la creadora. */
  exclusivePosts: number;
  /** Lo que cuesta volver hoy (null = ya no ofrece suscripcion). */
  renewPriceTokens: number | null;
}

/**
 * Suscripciones del fan: activas (cuanto le queda, cancelar) y anteriores
 * (volver a suscribirse al precio de hoy). No hay renovacion automatica.
 */
export function SubscriptionsManager({ subscriptions }: { subscriptions: SubscriptionRow[] }) {
  const active = subscriptions.filter((s) => s.isActive);
  const past = subscriptions.filter((s) => !s.isActive);
  const monthly = active.reduce((sum, s) => sum + s.priceTokens, 0);

  if (subscriptions.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border/60 px-6 py-12 text-center">
        <Crown className="h-8 w-8 text-muted-foreground" />
        <p className="font-medium">No tienes suscripciones</p>
        <p className="max-w-xs text-sm text-muted-foreground">
          Suscríbete a un creador desde su perfil para ver su contenido exclusivo y tener
          descuento en sus privados.
        </p>
        <Link href="/feed" className="text-sm font-medium text-primary hover:underline">
          Descubrir creadores
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {active.length > 0 && (
        <p className="rounded-xl border border-border/60 bg-card px-3.5 py-2.5 text-center text-sm text-muted-foreground">
          <span className="font-semibold text-foreground">{active.length}</span>{' '}
          {active.length === 1 ? 'suscripción activa' : 'suscripciones activas'} ·{' '}
          <span className="font-semibold text-foreground">{formatTokens(monthly)}</span> tokens al mes
        </p>
      )}

      <section className="space-y-3">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          Activas ({active.length})
        </h2>
        {active.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border/60 p-6 text-center text-sm text-muted-foreground">
            Ahora mismo no tienes ninguna activa.
          </p>
        ) : (
          active.map((sub) => <SubscriptionCard key={sub.id} sub={sub} />)
        )}
      </section>

      {past.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Anteriores ({past.length})
          </h2>
          {past.map((sub) => (
            <SubscriptionCard key={sub.id} sub={sub} />
          ))}
        </section>
      )}
    </div>
  );
}

function daysLeft(iso: string) {
  return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000));
}

function SubscriptionCard({ sub }: { sub: SubscriptionRow }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  // Cancelar y volver a suscribirse cobran o quitan acceso: siempre se confirma.
  const [confirm, setConfirm] = useState<'cancel' | 'renew' | null>(null);
  const left = daysLeft(sub.currentPeriodEnd);

  function run(fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) {
    startTransition(async () => {
      const result = await fn();
      if (result.ok) {
        toast.success(result.message ?? 'Hecho');
        setConfirm(null);
        router.refresh();
      } else {
        toast.error(result.error ?? 'No se pudo completar');
      }
    });
  }

  return (
    <article
      className={cn(
        'space-y-3 rounded-2xl border bg-card p-3.5',
        sub.isActive ? 'border-primary/30' : 'border-border/60 opacity-90',
      )}
    >
      <div className="flex items-center gap-3">
        <Link href={`/models/${sub.modelSlug}`} className="relative shrink-0">
          <Avatar className="h-11 w-11">
            {sub.modelAvatarUrl && <AvatarImage src={sub.modelAvatarUrl} alt="" />}
            <AvatarFallback>{initials(sub.modelStageName)}</AvatarFallback>
          </Avatar>
          {sub.modelIsOnline && (
            <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-card bg-state-connected" />
          )}
        </Link>
        <div className="min-w-0 flex-1">
          <Link href={`/models/${sub.modelSlug}`} className="block truncate font-semibold hover:underline">
            {sub.modelStageName}
          </Link>
          <p className="text-xs text-muted-foreground">
            {sub.modelIsOnline ? onlineLabel(sub.modelGender, true) : `Desde ${formatDate(sub.startedAt)}`}
          </p>
        </div>
        <span
          className={cn(
            'shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold',
            sub.isActive ? 'bg-state-connected/15 text-state-connected' : 'bg-muted text-muted-foreground',
          )}
        >
          {sub.isActive ? 'Activa' : sub.cancelledAt ? 'Cancelada' : 'Vencida'}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs">
        <span className="flex items-center gap-1.5 rounded-lg bg-muted/50 px-2.5 py-2 text-muted-foreground">
          <Coins className="h-3.5 w-3.5 text-token" />
          {formatTokens(sub.priceTokens)} tk/mes
        </span>
        <span className="flex items-center gap-1.5 rounded-lg bg-muted/50 px-2.5 py-2 text-muted-foreground">
          <CalendarClock className="h-3.5 w-3.5" />
          {sub.isActive
            ? left <= 1
              ? 'Termina mañana'
              : `Quedan ${left} días`
            : `Terminó el ${formatDate(sub.currentPeriodEnd)}`}
        </span>
        {sub.exclusivePosts > 0 && (
          <Link
            href={`/models/${sub.modelSlug}`}
            className="flex items-center gap-1.5 rounded-lg bg-muted/50 px-2.5 py-2 text-muted-foreground hover:text-foreground"
          >
            <Images className="h-3.5 w-3.5" />
            {sub.exclusivePosts} exclusivas
          </Link>
        )}
        {sub.discountPercent > 0 && (
          <span className="flex items-center gap-1.5 rounded-lg bg-muted/50 px-2.5 py-2 text-token">
            <Crown className="h-3.5 w-3.5" />
            −{sub.discountPercent}% en privados
          </span>
        )}
      </div>

      {sub.isActive && (
        <p className="text-[11px] text-muted-foreground">
          No se renueva sola: el {formatDate(sub.currentPeriodEnd)} termina y podrás volver a
          suscribirte.
        </p>
      )}

      {confirm === 'cancel' ? (
        <div className="space-y-2 rounded-xl border border-destructive/40 bg-destructive/10 p-2.5 text-xs">
          <p>
            Si cancelas pierdes el acceso <b>ahora mismo</b>, aunque te queden {left} días, y no se
            devuelven los tokens.
          </p>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" className="flex-1" onClick={() => setConfirm(null)}>
              Mantener
            </Button>
            <Button
              size="sm"
              variant="destructive"
              className="flex-1"
              disabled={isPending}
              onClick={() => run(() => cancelSubscriptionAction(sub.modelId, sub.modelSlug))}
            >
              {isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Sí, cancelar
            </Button>
          </div>
        </div>
      ) : confirm === 'renew' && sub.renewPriceTokens !== null ? (
        <div className="space-y-2 rounded-xl border border-primary/40 bg-primary/10 p-2.5 text-xs">
          <p>
            Se cobrarán <b>{formatTokens(sub.renewPriceTokens)} tokens</b> de tu saldo y tendrás un mes
            de acceso.
          </p>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" className="flex-1" onClick={() => setConfirm(null)}>
              Ahora no
            </Button>
            <Button
              size="sm"
              variant="brand"
              className="flex-1"
              disabled={isPending}
              onClick={() => run(() => subscribeAction(sub.modelId, sub.modelSlug))}
            >
              {isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Suscribirme
            </Button>
          </div>
        </div>
      ) : sub.isActive ? (
        <Button
          variant="ghost"
          size="sm"
          className="w-full text-destructive hover:text-destructive"
          onClick={() => setConfirm('cancel')}
        >
          <X className="h-3.5 w-3.5" />
          Cancelar suscripción
        </Button>
      ) : sub.renewPriceTokens !== null ? (
        <Button variant="outline" size="sm" className="w-full" onClick={() => setConfirm('renew')}>
          <RotateCcw className="h-3.5 w-3.5" />
          Volver a suscribirme · {formatTokens(sub.renewPriceTokens)} tk
        </Button>
      ) : (
        <p className="text-center text-[11px] text-muted-foreground">
          Ya no ofrece suscripción.
        </p>
      )}
    </article>
  );
}
