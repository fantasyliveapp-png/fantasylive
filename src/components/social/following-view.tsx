'use client';

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { Bell, BellOff, BellRing, Check, Crown, Search } from 'lucide-react';
import { toast } from 'sonner';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import type { FollowedCreator } from '@/lib/following';
import { gw } from '@/lib/gender-words';
import { cn, formatTokens, initials } from '@/lib/utils';
import { setFollowNotifyAction, toggleFollowAction } from '@/server/actions/follows';

type Order = 'live' | 'recent' | 'support';

/** Creadores que sigue: en directo primero, campanita y dejar de seguir. */
export function FollowedCreatorsList({ creators, isSelf }: { creators: FollowedCreator[]; isSelf: boolean }) {
  const [q, setQ] = useState('');
  const [order, setOrder] = useState<Order>('live');
  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    const list = term ? creators.filter((c) => c.name.toLowerCase().includes(term) || c.slug.includes(term)) : [...creators];
    return list.sort((a, b) => {
      if (order === 'support') return b.supportTokens - a.supportTokens;
      if (order === 'live') {
        const rank = (c: FollowedCreator) => (c.isLive ? 2 : c.isOnline ? 1 : 0);
        if (rank(b) !== rank(a)) return rank(b) - rank(a);
      }
      return b.followedAt.localeCompare(a.followedAt);
    });
  }, [creators, q, order]);

  if (creators.length === 0) {
    return <Empty text={isSelf ? 'Aún no sigues a ningún creador.' : 'No sigue a ningún creador.'} cta={isSelf} />;
  }

  const liveNow = creators.filter((c) => c.isLive).length;
  return (
    <div className="space-y-3">
      <Toolbar q={q} onQ={setQ} placeholder="Buscar creador">
        <select
          value={order}
          onChange={(e) => setOrder(e.target.value as Order)}
          aria-label="Ordenar"
          className="h-10 rounded-xl border border-border/60 bg-background px-2.5 text-sm"
        >
          <option value="live">En directo primero</option>
          <option value="recent">Más recientes</option>
          {isSelf && <option value="support">A quien más apoyo</option>}
        </select>
      </Toolbar>
      {liveNow > 0 && order === 'live' && !q && (
        <p className="text-xs font-semibold text-rose-500">
          {liveNow} {liveNow === 1 ? 'está' : 'están'} en directo ahora
        </p>
      )}
      <ul className="divide-y divide-border/60">
        {shown.map((c) => (
          <CreatorRow key={c.modelId} creator={c} isSelf={isSelf} showSupport={isSelf && order === 'support'} />
        ))}
      </ul>
      {shown.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">Nadie coincide con «{q}».</p>}
    </div>
  );
}

function CreatorRow({ creator: c, isSelf, showSupport }: { creator: FollowedCreator; isSelf: boolean; showSupport: boolean }) {
  const [following, setFollowing] = useState(true);
  const [prefs, setPrefs] = useState({ live: c.notifyLive, posts: c.notifyPosts });
  const [menu, setMenu] = useState(false);
  const [isPending, startTransition] = useTransition();
  const href = c.isLive ? `/live/${c.slug}` : `/models/${c.slug}`;

  function savePrefs(next: { live: boolean; posts: boolean }) {
    const before = prefs;
    setPrefs(next);
    setMenu(false);
    startTransition(async () => {
      const r = await setFollowNotifyAction(c.modelId, next);
      if (!r.ok) {
        setPrefs(before);
        toast.error(r.error ?? 'No se pudo guardar');
      } else {
        toast.success(
          next.live && next.posts
            ? `Te avisaremos de todo de ${c.name}`
            : next.live
              ? `Solo te avisaremos de los directos de ${c.name}`
              : next.posts
                ? `Solo te avisaremos de las publicaciones de ${c.name}`
                : `Ya no recibirás avisos de ${c.name}`,
        );
      }
    });
  }

  function toggle(undoPrefs?: { live: boolean; posts: boolean }) {
    startTransition(async () => {
      const r = await toggleFollowAction(c.modelId, c.slug);
      if (!r.ok) {
        toast.error(r.error ?? 'No se pudo actualizar');
        return;
      }
      setFollowing(Boolean(r.following));
      if (r.following && undoPrefs) {
        // Al deshacer, la campanita vuelve a como estaba.
        await setFollowNotifyAction(c.modelId, undoPrefs);
        setPrefs(undoPrefs);
      }
      if (!r.following) {
        const saved = prefs;
        toast(`Has dejado de seguir a ${c.name}`, {
          action: { label: 'Deshacer', onClick: () => toggle(saved) },
        });
      }
    });
  }

  const BellIcon = !prefs.live && !prefs.posts ? BellOff : prefs.live && prefs.posts ? BellRing : Bell;
  return (
    <li className="relative flex items-center gap-3 py-3">
      <Link href={href} className="relative shrink-0">
        <span
          className={cn(
            'block rounded-full p-[2px]',
            c.isLive ? 'bg-gradient-to-tr from-rose-600 to-fuchsia-500' : c.isOnline ? 'bg-state-connected' : 'bg-border',
          )}
        >
          <Avatar className="h-12 w-12 border-2 border-background">
            {c.avatarUrl && <AvatarImage src={c.avatarUrl} alt="" />}
            <AvatarFallback>{initials(c.name)}</AvatarFallback>
          </Avatar>
        </span>
        {c.isLive && (
          <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 rounded bg-rose-600 px-1 text-[9px] font-bold uppercase leading-4 text-white">
            Directo
          </span>
        )}
      </Link>
      <Link href={href} className="min-w-0 flex-1">
        <span className="flex items-center gap-1 truncate font-semibold">
          {c.name}
          {c.isSubscribed && <Crown className="h-3.5 w-3.5 shrink-0 text-champagne-gold" aria-label="Suscrito" />}
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          {c.isLive
            ? 'En directo ahora · entrar'
            : showSupport
              ? c.supportTokens > 0
                ? `${gw(c.gender, { f: 'Le', m: 'Le', pl: 'Les' })} has dado ${formatTokens(c.supportTokens)} tk`
                : gw(c.gender, { f: 'Aún no le has comprado nada', m: 'Aún no le has comprado nada', pl: 'Aún no les has comprado nada' })
              : `@${c.slug}${c.isOnline ? ` · ${gw(c.gender, { f: 'conectada', m: 'conectado', pl: 'conectados' })}` : ''}`}
        </span>
      </Link>

      {isSelf && following && (
        <button
          type="button"
          onClick={() => setMenu((v) => !v)}
          disabled={isPending}
          className={cn(
            'flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border/60',
            prefs.live || prefs.posts ? 'text-foreground' : 'text-muted-foreground',
          )}
          aria-label="Avisos"
          aria-expanded={menu}
        >
          <BellIcon className="h-4 w-4" />
        </button>
      )}
      {isSelf && (
        <button
          type="button"
          onClick={() => toggle()}
          disabled={isPending}
          className={cn(
            'h-9 shrink-0 rounded-full px-3.5 text-sm font-semibold transition-colors',
            following ? 'border border-border/60 text-foreground hover:border-destructive/50 hover:text-destructive' : 'bg-primary text-white',
          )}
        >
          {following ? 'Siguiendo' : 'Seguir'}
        </button>
      )}

      {menu && (
        <div className="absolute right-0 top-full z-20 -mt-1 w-60 overflow-hidden rounded-xl border border-border/60 bg-popover shadow-xl">
          <p className="px-3 pb-1 pt-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Avisarme de {c.name}
          </p>
          {(
            [
              { label: 'Directos y publicaciones', live: true, posts: true },
              { label: 'Solo cuando entre en directo', live: true, posts: false },
              { label: 'Solo cuando publique', live: false, posts: true },
              { label: 'Nada', live: false, posts: false },
            ] as const
          ).map((o) => {
            const on = prefs.live === o.live && prefs.posts === o.posts;
            return (
              <button
                key={o.label}
                type="button"
                onClick={() => savePrefs({ live: o.live, posts: o.posts })}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted"
              >
                <span className="flex-1">{o.label}</span>
                {on && <Check className="h-4 w-4 text-primary" />}
              </button>
            );
          })}
        </div>
      )}
    </li>
  );
}

function Toolbar({
  q,
  onQ,
  placeholder,
  children,
}: {
  q: string;
  onQ: (v: string) => void;
  placeholder: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex gap-2">
      <label className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-xl border border-border/60 bg-background px-3">
        <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
        <input
          value={q}
          onChange={(e) => onQ(e.target.value)}
          placeholder={placeholder}
          className="min-w-0 flex-1 bg-transparent text-sm outline-none"
        />
      </label>
      {children}
    </div>
  );
}

function Empty({ text, cta = false }: { text: string; cta?: boolean }) {
  return (
    <div className="rounded-2xl border border-dashed border-border/60 px-6 py-10 text-center text-sm text-muted-foreground">
      {text}
      {cta && (
        <Link href="/feed" className="mt-3 block font-medium text-primary hover:underline">
          Descubrir creadores
        </Link>
      )}
    </div>
  );
}
