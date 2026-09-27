import Link from 'next/link';
import { Bot, Coins, Crown, Star } from 'lucide-react';
import type { Gender, ModelTier, Orientation } from '@prisma/client';

import { Badge } from '@/components/ui/badge';
import { GENDER_LABELS, ORIENTATION_LABELS } from '@/lib/constants';
import { onlineLabel } from '@/lib/gender-words';
import { cn } from '@/lib/utils';
import { formatRateNumber } from '@/lib/rates';

export interface ModelCardData {
  id: string;
  slug: string;
  stageName: string;
  headline?: string | null;
  gender: Gender;
  orientation: Orientation;
  tier: ModelTier;
  country?: string | null;
  avatarUrl?: string | null;
  coverUrl?: string | null;
  isOnline: boolean;
  /// Emitiendo un directo ahora mismo. Distinto de isOnline, que solo dice
  /// que tiene la sesion abierta y esta disponible.
  isLive?: boolean;
  /// Perfil atendido por IA. Se etiqueta en la tarjeta para que se sepa antes
  /// de entrar, no despues de pagar por escribirle.
  isAi: boolean;
  isVipEnabled: boolean;
  isAvailableForVip: boolean;
  vipRateCentitokens: number;
  privateRateCentitokens: number;
  ratingAvg: number;
  ratingCount: number;
  tags: string[];
}

export function ModelCard({ model }: { model: ModelCardData }) {
  const image =
    model.coverUrl || model.avatarUrl || '/placeholder-model.svg';

  return (
    <Link
      href={`/models/${model.slug}`}
      className="group relative block overflow-hidden rounded-xl border border-border bg-card transition-all hover:border-primary/50"
    >
      <div className="relative aspect-[3/4] overflow-hidden bg-muted">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={image}
          alt={model.stageName}
          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
          loading="lazy"
        />

        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent" />

        {/* Estado */}
        <div className="absolute left-3 top-3 flex flex-col gap-1.5">
          {model.isLive ? (
            <Badge variant="live" className="gap-1.5">
              <span className="live-dot !h-2 !w-2 bg-white" />
              EN DIRECTO
            </Badge>
          ) : model.isOnline ? (
            <Badge variant="connected" className="gap-1.5">
              <span className="h-2 w-2 rounded-full bg-onix-black/60" />
              {onlineLabel(model.gender, true)}
            </Badge>
          ) : (
            <Badge variant="muted">Offline</Badge>
          )}

          {model.tier !== 'STANDARD' && (
            <Badge variant="vip" className="gap-1">
              <Crown className="h-3 w-3" />
              {model.tier}
            </Badge>
          )}

          {model.isAi && (
            <Badge variant="muted" className="gap-1">
              <Bot className="h-3 w-3" />
              IA
            </Badge>
          )}
        </div>

        {/* Rating */}
        {model.ratingCount > 0 && (
          <div className="absolute right-3 top-3 flex items-center gap-1 rounded-full bg-black/60 px-2 py-1 text-xs font-medium text-white backdrop-blur">
            <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
            {model.ratingAvg.toFixed(1)}
          </div>
        )}

        {/* Info */}
        <div className="absolute inset-x-0 bottom-0 p-4">
          <h3 className="truncate font-semibold text-white">
            {model.stageName}
          </h3>
          <p className="mt-0.5 truncate text-xs text-white/70">
            {GENDER_LABELS[model.gender]} &middot;{' '}
            {ORIENTATION_LABELS[model.orientation]}
            {model.country ? ` · ${model.country}` : ''}
          </p>

          <div className="mt-2.5 flex items-center gap-2">
            {model.isAvailableForVip && (
              <span
                className={cn(
                  'inline-flex items-center gap-1 rounded-full bg-token px-2 py-0.5 text-[11px] font-semibold text-token-foreground',
                )}
              >
                <Coins className="h-3 w-3" />
                {formatRateNumber(model.vipRateCentitokens)}/min VIP
              </span>
            )}
            <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-medium text-white backdrop-blur">
              {formatRateNumber(model.privateRateCentitokens)}/min privado
            </span>
          </div>
        </div>
      </div>
    </Link>
  );
}
