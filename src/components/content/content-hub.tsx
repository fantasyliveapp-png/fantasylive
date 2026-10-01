import Link from 'next/link';
import { Crown, Eye, Globe, Heart, Lock, Play, Plus, Radio, MessageCircle, Clock } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { ContentCard } from '@/lib/creator-content';
import { cn } from '@/lib/utils';

/**
 * Panel "Contenido" de la creadora: lo PRIVADO que vende (Boveda para el chat
 * y packs para los directos). Lo publico se ve y se gestiona en el feed y en
 * su perfil.
 */

export type ContentTab = 'chat' | 'directos';

const BASE = '/dashboard/model/contenido';

export function ContentTabs({
  tab,
  counts,
}: {
  tab: ContentTab;
  counts: { chat: number; directos: number };
}) {
  return (
    <div className="flex gap-1 border-b border-border/60">
      <MainTab
        href={BASE}
        active={tab === 'chat'}
        icon={<MessageCircle className="h-4 w-4" />}
        label="Para chat"
        count={counts.chat}
      />
      <MainTab
        href={`${BASE}?tab=directos`}
        active={tab === 'directos'}
        icon={<Radio className="h-4 w-4" />}
        label="Para directos"
        count={counts.directos}
      />
    </div>
  );
}

function MainTab({
  href,
  active,
  icon,
  label,
  count,
}: {
  href: string;
  active: boolean;
  icon: React.ReactNode;
  label: string;
  count: number;
}) {
  return (
    <Link
      href={href}
      className={cn(
        '-mb-px flex items-center gap-1.5 border-b-2 px-4 py-2.5 text-sm font-semibold transition-colors',
        active ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
      )}
    >
      {icon}
      {label}
      <span className="text-xs font-normal text-muted-foreground">{count}</span>
    </Link>
  );
}

/** Regla corta que se ve encima de cada seccion. */
export function ContentRule({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-xl border border-border/60 bg-muted/30 px-3.5 py-2.5 text-xs text-muted-foreground">
      {children}
    </p>
  );
}

const VISIBILITY: Record<ContentCard['visibility'], { label: string; icon: typeof Globe; tone: string }> = {
  PUBLIC: { label: 'Gratis', icon: Globe, tone: 'bg-white/15 text-white' },
  LOCKED: { label: 'De pago', icon: Lock, tone: 'bg-champagne-gold/90 text-black' },
  SUBSCRIBERS: { label: 'Suscriptores', icon: Crown, tone: 'bg-primary/90 text-white' },
};

export function ContentTile({ card, footer }: { card: ContentCard; footer?: React.ReactNode }) {
  const vis = VISIBILITY[card.visibility];
  return (
    <div className="overflow-hidden rounded-xl border border-border/60 bg-card">
      <div className="relative aspect-[4/5] bg-muted">
        {card.thumbUrl &&
          (card.thumbIsVideo ? (
            <video src={card.thumbUrl} muted preload="metadata" className="h-full w-full object-cover" />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={card.thumbUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
          ))}
        {!card.thumbUrl && (
          <span className="absolute inset-0 flex items-center justify-center p-4 text-center text-xs text-muted-foreground">
            {card.title}
          </span>
        )}
        <span
          className={cn(
            'absolute left-1.5 top-1.5 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold',
            vis.tone,
          )}
        >
          <vis.icon className="h-3 w-3" />
          {card.visibility === 'LOCKED' ? `${card.priceTokens} tk` : vis.label}
        </span>
        {card.scheduledFor && (
          <span className="absolute right-1.5 top-1.5 inline-flex items-center gap-1 rounded-full bg-black/70 px-2 py-0.5 text-[10px] text-white">
            <Clock className="h-3 w-3" /> Programada
          </span>
        )}
        {card.videos > 0 && (
          <Play className="absolute bottom-1.5 right-1.5 h-4 w-4 text-white drop-shadow" />
        )}
      </div>
      <div className="space-y-1 p-2.5">
        <p className="truncate text-sm font-medium">{card.title}</p>
        <p className="text-[11px] text-muted-foreground">{mediaSummary(card)}</p>
        {footer ?? (
          <p className="flex items-center gap-2.5 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-0.5">
              <Eye className="h-3 w-3" /> {card.views}
            </span>
            <span className="inline-flex items-center gap-0.5">
              <Heart className="h-3 w-3" /> {card.likes}
            </span>
            {card.visibility === 'LOCKED' && (
              <span className="ml-auto font-medium text-foreground">
                {card.sales} {card.sales === 1 ? 'venta' : 'ventas'}
              </span>
            )}
          </p>
        )}
      </div>
    </div>
  );
}

export function mediaSummary(c: { photos: number; videos: number }) {
  const parts: string[] = [];
  if (c.photos) parts.push(`${c.photos} ${c.photos === 1 ? 'foto' : 'fotos'}`);
  if (c.videos) parts.push(`${c.videos} ${c.videos === 1 ? 'vídeo' : 'vídeos'}`);
  return parts.join(' · ') || 'Solo texto';
}

export function EmptyState({ text, cta }: { text: string; cta?: React.ReactNode }) {
  return (
    <div className="space-y-4 rounded-2xl border border-dashed border-border/60 px-6 py-12 text-center">
      <p className="text-sm text-muted-foreground">{text}</p>
      {cta}
    </div>
  );
}
