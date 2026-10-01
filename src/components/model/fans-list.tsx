'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Crown, MessageCircle, Search, Trophy } from 'lucide-react';

import { SendMessageButton } from '@/components/social/send-message-button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import type { FanRow } from '@/lib/fans';
import { cn, formatTokens, initials, relativeTime } from '@/lib/utils';

type Filter = 'all' | 'top' | 'subs' | 'new' | 'never';

const NEW_DAYS = 7;

/**
 * Fans del creador: quien le sigue, filtrable (los que mas apoyan, sus
 * suscriptores, nuevos, los que aun no compraron) y con "Escribir".
 */
export function FansList({ fans }: { fans: FanRow[] }) {
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');

  const newSince = Date.now() - NEW_DAYS * 86_400_000;
  const counts = useMemo(
    () => ({
      all: fans.length,
      top: fans.filter((f) => f.supportTokens > 0).length,
      subs: fans.filter((f) => f.isSubscribed).length,
      new: fans.filter((f) => new Date(f.followedAt).getTime() > newSince).length,
      never: fans.filter((f) => f.supportTokens === 0).length,
    }),
    [fans, newSince],
  );
  // Puesto de cada fan por lo que ha apoyado (para "Top 3").
  const rank = useMemo(() => {
    const sorted = fans.filter((f) => f.supportTokens > 0).sort((a, b) => b.supportTokens - a.supportTokens);
    return new Map(sorted.map((f, i) => [f.userId, i + 1]));
  }, [fans]);

  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    let list = fans.filter(
      (f) => !term || f.name.toLowerCase().includes(term) || (f.username ?? '').includes(term),
    );
    if (filter === 'top') list = list.filter((f) => f.supportTokens > 0).sort((a, b) => b.supportTokens - a.supportTokens);
    if (filter === 'subs') list = list.filter((f) => f.isSubscribed).sort((a, b) => b.supportTokens - a.supportTokens);
    if (filter === 'new') list = list.filter((f) => new Date(f.followedAt).getTime() > newSince);
    if (filter === 'never') list = list.filter((f) => f.supportTokens === 0);
    return list;
  }, [fans, filter, q, newSince]);

  if (fans.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border/60 px-6 py-12 text-center text-sm text-muted-foreground">
        Aún no te sigue nadie. Publica y haz directos: quien te siga aparecerá aquí.
      </div>
    );
  }

  const filters: { id: Filter; label: string }[] = [
    { id: 'all', label: 'Todos' },
    { id: 'top', label: 'Los que más apoyan' },
    { id: 'subs', label: 'Suscriptores' },
    { id: 'new', label: 'Nuevos' },
    { id: 'never', label: 'Aún sin comprar' },
  ];

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2 text-center">
        <Stat value={counts.all} label="seguidores" />
        <Stat value={counts.subs} label="suscriptores" />
        <Stat value={counts.new} label={`nuevos (${NEW_DAYS} días)`} />
      </div>

      <label className="flex h-10 items-center gap-2 rounded-xl border border-border/60 bg-background px-3">
        <Search className="h-4 w-4 text-muted-foreground" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar fan"
          className="min-w-0 flex-1 bg-transparent text-sm outline-none"
        />
      </label>

      <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 [scrollbar-width:none]">
        {filters.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFilter(f.id)}
            className={cn(
              'shrink-0 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors',
              filter === f.id ? 'border-primary bg-primary/15 text-foreground' : 'border-border/60 text-muted-foreground',
            )}
          >
            {f.label} <span className="text-xs text-muted-foreground">{counts[f.id]}</span>
          </button>
        ))}
      </div>

      {filter === 'never' && shown.length > 0 && (
        <p className="rounded-xl bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          Te siguen pero aún no te han comprado nada: un mensaje con algo para enganchar suele funcionar.
        </p>
      )}

      <ul className="divide-y divide-border/60">
        {shown.map((f) => {
          const pos = rank.get(f.userId);
          return (
            <li key={f.userId} className="flex items-center gap-3 py-3">
              <Link href={f.username ? `/u/${f.username}` : '#'} className="relative shrink-0">
                <Avatar className="h-11 w-11">
                  {f.image && <AvatarImage src={f.image} alt="" />}
                  <AvatarFallback>{initials(f.name)}</AvatarFallback>
                </Avatar>
                {pos && pos <= 3 && (
                  <span
                    className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-champagne-gold text-[10px] font-bold text-black"
                    title={`Top ${pos}`}
                  >
                    {pos}
                  </span>
                )}
              </Link>
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1 truncate font-semibold">
                  {f.name}
                  {f.isSubscribed && <Crown className="h-3.5 w-3.5 shrink-0 text-champagne-gold" aria-label="Suscriptor" />}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {f.supportTokens > 0 ? (
                    <>
                      <Trophy className="mr-0.5 inline h-3 w-3 text-token" />
                      {formatTokens(f.supportTokens)} tk
                      {f.lastPurchaseAt && ` · última compra ${relativeTime(f.lastPurchaseAt)}`}
                    </>
                  ) : (
                    `Te sigue ${relativeTime(f.followedAt)} · aún sin comprar`
                  )}
                </p>
              </div>
              {f.chatHref ? (
                <Link
                  href={f.chatHref}
                  className="flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-border/60 px-3 text-sm font-semibold hover:bg-muted"
                >
                  <MessageCircle className="h-4 w-4" /> Chat
                </Link>
              ) : (
                <SendMessageButton
                  targetUserId={f.userId}
                  targetName={f.name}
                  isAuthenticated
                  className="h-9 shrink-0 rounded-full px-3 text-sm"
                />
              )}
            </li>
          );
        })}
      </ul>
      {shown.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">Nadie en este filtro.</p>}
    </div>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="rounded-xl border border-border/60 bg-card px-2 py-2.5">
      <p className="text-lg font-bold leading-none">{formatTokens(value)}</p>
      <p className="mt-1 text-[11px] text-muted-foreground">{label}</p>
    </div>
  );
}
