import Link from 'next/link';
import { Coins, Crown, Star } from 'lucide-react';
import type { Gender, ModelTier, Orientation } from '@prisma/client';

import { Badge } from '@/components/ui/badge';
import { GENDER_LABELS, ORIENTATION_LABELS } from '@/lib/constants';
import { cn } from '@/lib/utils';

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
  isVipEnabled: boolean;
  isAvailableForVip: boolean;
  vipRatePerMinute: number;
  privateRatePerMinute: number;
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
          {model.isOnline ? (
            <Badge variant="live" className="gap-1.5">
              <span className="live-dot !h-2 !w-2 bg-white" />
              EN VIVO
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
                {model.vipRatePerMinute}/min VIP
              </span>
            )}
            <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-medium text-white backdrop-blur">
              {model.privateRatePerMinute}/min privado
            </span>
          </div>
        </div>
      </div>
    </Link>
  );
}
