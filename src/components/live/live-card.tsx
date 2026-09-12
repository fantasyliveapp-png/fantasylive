import Link from 'next/link';
import { Bot, Crown, Eye, Radio } from 'lucide-react';
import type { LiveStreamSource, ModelTier } from '@prisma/client';

import { Badge } from '@/components/ui/badge';

export interface LiveCardData {
  id: string;
  title: string | null;
  viewerCount: number;
  source: LiveStreamSource;
  model: {
    slug: string;
    stageName: string;
    avatarUrl: string | null;
    coverUrl: string | null;
    country: string | null;
    tier: ModelTier;
    isAi: boolean;
  };
}

/**
 * Tarjeta de un directo en curso. Enlaza por el slug de la creadora y no por
 * el id del stream: asi el enlace sigue siendo valido aunque reinicie la
 * emision, que es lo que la gente comparte.
 */
export function LiveCard({ stream }: { stream: LiveCardData }) {
  const image =
    stream.model.coverUrl || stream.model.avatarUrl || '/placeholder-model.svg';

  return (
    <Link
      href={`/live/${stream.model.slug}`}
      className="group relative block overflow-hidden rounded-xl border border-border bg-card transition-all hover:border-primary/50"
    >
      <div className="relative aspect-video overflow-hidden bg-muted">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={image}
          alt={stream.model.stageName}
          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
          loading="lazy"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/10 to-transparent" />

        <div className="absolute left-3 top-3 flex items-center gap-1.5">
          <Badge variant="live" className="gap-1.5">
            <span className="live-dot !h-2 !w-2 bg-white" />
            EN DIRECTO
          </Badge>
          {stream.model.tier !== 'STANDARD' && (
            <Badge variant="vip" className="gap-1">
              <Crown className="h-3 w-3" />
              {stream.model.tier}
            </Badge>
          )}
          {stream.model.isAi && (
            <Badge variant="muted" className="gap-1">
              <Bot className="h-3 w-3" />
              IA
            </Badge>
          )}
        </div>

        <div className="absolute right-3 top-3 flex items-center gap-1 rounded-full bg-black/60 px-2 py-1 text-xs font-medium text-white backdrop-blur">
          <Eye className="h-3 w-3" />
          {stream.viewerCount}
        </div>

        <div className="absolute inset-x-0 bottom-0 p-4">
          <h3 className="truncate font-semibold text-white">
            {stream.model.stageName}
          </h3>
          <p className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-white/70">
            <Radio className="h-3 w-3" />
            {stream.title || 'Emitiendo ahora'}
            {stream.model.country ? ` · ${stream.model.country}` : ''}
          </p>
        </div>
      </div>
    </Link>
  );
}
