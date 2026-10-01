'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Gift, Images, MessageCircle, Play, Radio, ShoppingBag } from 'lucide-react';

import { MediaViewer } from '@/components/content/media-viewer';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import type { PurchaseItem, PurchaseSource } from '@/lib/purchases';
import { cn, formatTokens, initials, relativeTime } from '@/lib/utils';

/**
 * "Mis compras" en el perfil del fan: un feed con todo lo que ha
 * desbloqueado, filtrable por donde lo compro.
 */

const SOURCES: Record<PurchaseSource, { label: string; icon: typeof Images }> = {
  post: { label: 'Publicación', icon: Images },
  live: { label: 'Directo', icon: Radio },
  chat: { label: 'Chat', icon: MessageCircle },
  request: { label: 'Pedido', icon: Gift },
};

const FILTERS: { id: 'all' | PurchaseSource; label: string }[] = [
  { id: 'all', label: 'Todo' },
  { id: 'post', label: 'Publicaciones' },
  { id: 'live', label: 'Directos' },
  { id: 'chat', label: 'Chat' },
  { id: 'request', label: 'Pedidos' },
];

export function PurchasesFeed({ items }: { items: PurchaseItem[] }) {
  const [filter, setFilter] = useState<'all' | PurchaseSource>('all');
  const [viewer, setViewer] = useState<{ item: PurchaseItem; index: number } | null>(null);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: items.length };
    for (const i of items) c[i.source] = (c[i.source] ?? 0) + 1;
    return c;
  }, [items]);
  const shown = filter === 'all' ? items : items.filter((i) => i.source === filter);
  const spent = items.reduce((sum, i) => sum + i.tokens, 0);
  const files = items.reduce((sum, i) => sum + i.media.length, 0);

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border/60 px-6 py-12 text-center">
        <ShoppingBag className="h-8 w-8 text-muted-foreground" />
        <p className="font-medium">Aún no has comprado nada</p>
        <p className="max-w-xs text-sm text-muted-foreground">
          Lo que desbloquees en publicaciones, chats y directos aparecerá aquí para verlo cuando quieras.
        </p>
        <Link href="/feed" className="text-sm font-medium text-primary hover:underline">
          Explorar el feed
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2 text-center">
        <Summary value={items.length} label={items.length === 1 ? 'compra' : 'compras'} />
        <Summary value={files} label="archivos" />
        <Summary value={spent} label="tokens" />
      </div>

      <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 [scrollbar-width:none]">
        {FILTERS.filter((f) => f.id === 'all' || counts[f.id]).map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFilter(f.id)}
            className={cn(
              'shrink-0 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors',
              filter === f.id
                ? 'border-primary bg-primary/15 text-foreground'
                : 'border-border/60 text-muted-foreground hover:text-foreground',
            )}
          >
            {f.label}
            <span className="ml-1 text-xs text-muted-foreground">{counts[f.id] ?? 0}</span>
          </button>
        ))}
      </div>

      <div className="space-y-4">
        {shown.map((item) => (
          <PurchaseCard key={item.id} item={item} onOpen={(index) => setViewer({ item, index })} />
        ))}
      </div>

      {viewer && (
        <MediaViewer
          files={viewer.item.media}
          index={viewer.index}
          onIndex={(index) => setViewer({ ...viewer, index })}
          onClose={() => setViewer(null)}
        />
      )}
    </div>
  );
}

function Summary({ value, label }: { value: number; label: string }) {
  return (
    <div className="rounded-xl border border-border/60 bg-card px-2 py-2.5">
      <p className="text-lg font-bold leading-none">{formatTokens(value)}</p>
      <p className="mt-1 text-[11px] text-muted-foreground">{label}</p>
    </div>
  );
}

function PurchaseCard({ item, onOpen }: { item: PurchaseItem; onOpen: (index: number) => void }) {
  const source = SOURCES[item.source];
  const shown = item.media.slice(0, 4);
  const extra = item.media.length - shown.length;
  return (
    <article className="overflow-hidden rounded-2xl border border-border/60 bg-card">
      <header className="flex items-center gap-3 px-3.5 py-3">
        <Link href={`/models/${item.creator.slug}`} className="shrink-0">
          <Avatar className="h-9 w-9">
            {item.creator.avatarUrl && <AvatarImage src={item.creator.avatarUrl} alt="" />}
            <AvatarFallback>{initials(item.creator.name)}</AvatarFallback>
          </Avatar>
        </Link>
        <div className="min-w-0 flex-1">
          <Link href={`/models/${item.creator.slug}`} className="block truncate text-sm font-semibold hover:underline">
            {item.creator.name}
          </Link>
          <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <source.icon className="h-3 w-3" />
            {source.label} · {relativeTime(item.at)}
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-token/15 px-2 py-0.5 text-[11px] font-semibold text-token">
          {item.tokens > 0 ? `${formatTokens(item.tokens)} tk` : 'Gratis'}
        </span>
      </header>

      {item.title && <p className="line-clamp-2 px-3.5 pb-2.5 text-sm">{item.title}</p>}

      {shown.length > 0 && (
        <div className={cn('grid gap-0.5', shown.length === 1 ? 'grid-cols-1' : 'grid-cols-2')}>
          {shown.map((m, i) => {
            const isVideo = m.mimeType.startsWith('video');
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => onOpen(i)}
                className={cn('relative overflow-hidden bg-muted', shown.length === 1 ? 'aspect-[4/5]' : 'aspect-square')}
              >
                {m.url &&
                  (isVideo ? (
                    <video src={m.url} muted preload="metadata" className="h-full w-full object-cover" />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={m.url} alt="" className="h-full w-full object-cover" loading="lazy" />
                  ))}
                {isVideo && <Play className="absolute left-2 top-2 h-5 w-5 text-white drop-shadow" />}
                {i === shown.length - 1 && extra > 0 && (
                  <span className="absolute inset-0 flex items-center justify-center bg-black/55 text-2xl font-bold text-white">
                    +{extra}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      <footer className="flex items-center justify-between px-3.5 py-2.5 text-xs text-muted-foreground">
        <span>
          {item.media.length} {item.media.length === 1 ? 'archivo' : 'archivos'}
        </span>
        <Link href={item.href} className="font-medium text-primary hover:underline">
          {item.source === 'chat' || item.source === 'request' ? 'Ir al chat' : 'Ver en su perfil'}
        </Link>
      </footer>
    </article>
  );
}
