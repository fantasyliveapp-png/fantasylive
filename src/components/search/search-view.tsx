'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  BarChart3,
  Compass,
  Crown,
  Eye,
  Flame,
  Hash,
  Heart,
  Layers,
  Loader2,
  Lock,
  Play,
  Radio,
  Search,
  SearchX,
  Sparkles,
  UserCheck,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import type { ExploreMosaic, MosaicItem } from '@/lib/personal-search';
import type { SearchCreator, SearchResult } from '@/lib/search';
import { TASTE_TAGS } from '@/lib/tastes';
import { cn, formatTokens, initials } from '@/lib/utils';

/**
 * BUSCADOR
 *
 * Sin escribir, un mosaico "Para ti": publicaciones de creadoras elegidas por
 * el recomendador con lo que ha aprendido de ti, cada una con el motivo y tu
 * % de afinidad, filtrables por tus gustos. Al escribir, resultados al
 * momento ordenados tambien por afinidad. La URL se actualiza (?q=) para
 * poder compartir o volver atras.
 */
export function SearchView({
  initialQuery,
  initialResult,
  mosaic,
}: {
  initialQuery: string;
  initialResult: SearchResult | null;
  mosaic: ExploreMosaic;
  isAuthenticated?: boolean;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [result, setResult] = useState<SearchResult | null>(initialResult);
  const [loading, setLoading] = useState(false);
  const input = useRef<HTMLInputElement | null>(null);
  const request = useRef(0);

  // Busqueda con pausa de 250 ms: no una peticion por cada letra.
  useEffect(() => {
    const q = query.trim();
    const url = q ? `/buscar?q=${encodeURIComponent(q)}` : '/buscar';
    window.history.replaceState(window.history.state, '', url);

    if (!q) {
      setResult(null);
      setLoading(false);
      return;
    }
    if (initialResult && q === initialQuery) return;

    setLoading(true);
    const id = ++request.current;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
        const data = (await res.json()) as SearchResult;
        // Solo cuenta la respuesta de la ultima busqueda (las lentas llegan tarde).
        if (id === request.current) setResult(data);
      } finally {
        if (id === request.current) setLoading(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [query]); // eslint-disable-line react-hooks/exhaustive-deps

  const hasQuery = query.trim().length > 0;
  const searchTag = (tag: string) => {
    setQuery(`#${tag}`);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="space-y-6">
      {/* Caja de busqueda, fija arriba */}
      <div className="sticky top-16 z-20 -mx-6 bg-background/90 px-6 py-3 backdrop-blur-xl md:top-0">
        <label className="flex h-12 items-center gap-3 rounded-2xl border border-border/60 bg-muted/50 px-4 transition-colors focus-within:border-primary focus-within:bg-background">
          {loading ? (
            <Loader2 className="h-5 w-5 shrink-0 animate-spin text-muted-foreground" />
          ) : (
            <Search className="h-5 w-5 shrink-0 text-muted-foreground" />
          )}
          <input
            ref={input}
            type="search"
            inputMode="search"
            enterKeyHint="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Nombre, @usuario o #etiqueta"
            className="h-full w-full min-w-0 bg-transparent text-base outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
            aria-label="Buscar"
          />
          {hasQuery && (
            <button
              type="button"
              onClick={() => {
                setQuery('');
                input.current?.focus();
              }}
              className="shrink-0 rounded-full bg-muted-foreground/20 p-1 text-muted-foreground hover:text-foreground"
              aria-label="Borrar busqueda"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </label>
      </div>

      {!hasQuery ? (
        <Mosaic mosaic={mosaic} onTag={searchTag} />
      ) : result && result.creators.length === 0 && result.tags.length === 0 && !loading ? (
        <div className="flex flex-col items-center gap-3 py-12 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <SearchX className="h-5 w-5 text-muted-foreground" />
          </span>
          <p className="font-medium">No encontramos a nadie con &laquo;{query.trim()}&raquo;</p>
          <p className="max-w-xs text-sm text-muted-foreground">
            Prueba con otro nombre o con uno de tus gustos:
          </p>
          <TagChips
            tags={(mosaic.dna.length ? mosaic.dna.map((d) => d.tag) : TASTE_TAGS.map((t) => t.id)).slice(0, 8)}
            onTag={searchTag}
          />
        </div>
      ) : (
        result && (
          <div className="space-y-6">
            {result.tags.length > 0 && (
              <section>
                <SectionTitle icon={Hash}>Etiquetas</SectionTitle>
                <TagChips tags={result.tags} onTag={searchTag} />
              </section>
            )}
            {result.creators.length > 0 && (
              <section>
                <SectionTitle icon={Users}>
                  {result.creators.some((c) => c.match !== undefined)
                    ? 'Creadoras · ordenadas por afinidad contigo'
                    : 'Creadoras'}
                </SectionTitle>
                <CreatorList creators={result.creators} />
              </section>
            )}
          </div>
        )
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mosaico "Para ti" (sin escribir)
// ---------------------------------------------------------------------------

/**
 * Ritmo del mosaico: cada 9 publicaciones, una grande (la que mas encaja
 * abre el mosaico) y una alta; el resto, cuadradas. `grid-flow-dense` rellena
 * los huecos, asi nunca queda una cuadricula plana.
 */
function tileShape(i: number) {
  if (i % 9 === 0) return 'col-span-2 row-span-2';
  if (i % 9 === 5) return 'row-span-2';
  return '';
}

function Mosaic({
  mosaic,
  onTag,
}: {
  mosaic: ExploreMosaic;
  onTag: (tag: string) => void;
}) {
  const [filter, setFilter] = useState<string | null>(null);
  const hasLive = mosaic.items.some((i) => i.post.model.isLive);
  const filters: { id: string; label: string; icon?: LucideIcon }[] = [
    { id: 'all', label: 'Para ti', icon: Sparkles },
    ...(hasLive ? [{ id: 'live', label: 'En directo', icon: Radio }] : []),
    ...mosaic.dna.map((d) => ({ id: d.tag, label: d.label, icon: Hash })),
  ];
  const active = filter ?? 'all';
  const items =
    active === 'all'
      ? mosaic.items
      : active === 'live'
        ? mosaic.items.filter((i) => i.post.model.isLive)
        : mosaic.items.filter((i) => i.tags.includes(active));

  return (
    <div className="space-y-4">
      <div>
        <h2 className="flex items-center gap-2 font-heading text-2xl uppercase tracking-wide">
          <Sparkles className="h-5 w-5 text-primary" />
          Para ti
        </h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {mosaic.personalized
            ? 'Elegido con lo que has visto, te ha gustado y sigues.'
            : 'Lo que mas gusta ahora. Cuanto mas mires, mas a tu medida.'}
        </p>
      </div>

      {filters.length > 1 && (
        <div className="-mx-6 flex gap-2 overflow-x-auto px-6 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {filters.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              aria-pressed={active === f.id}
              className={cn(
                'flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors',
                active === f.id
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border/60 bg-card hover:border-primary/60',
              )}
            >
              {f.icon && <f.icon className="h-3.5 w-3.5" />}
              {f.label}
            </button>
          ))}
        </div>
      )}

      {items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border/60 p-8 text-center text-sm text-muted-foreground">
          Nada de esto por ahora.{' '}
          {active !== 'all' && active !== 'live' && (
            <button
              type="button"
              onClick={() => onTag(active)}
              className="font-medium text-primary hover:underline"
            >
              Buscar creadoras de #{active}
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-flow-dense auto-rows-[118px] grid-cols-3 gap-1.5 sm:auto-rows-[170px] md:grid-cols-4">
          {items.map((item, i) => (
            <MosaicTile key={item.post.id} item={item} shape={tileShape(i)} big={i % 9 === 0} />
          ))}
        </div>
      )}

      <Link
        href="/feed"
        className="flex items-center justify-center gap-1.5 rounded-2xl border border-border/60 py-3 text-sm font-medium transition-colors hover:border-primary/60 hover:text-primary"
      >
        <Compass className="h-4 w-4" />
        Seguir viendo en Descubrir
      </Link>
    </div>
  );
}

function reasonIcon(reason: string): LucideIcon {
  if (reason.startsWith('En directo')) return Radio;
  if (reason === 'La sigues') return UserCheck;
  if (reason === 'La miras a menudo') return Eye;
  if (reason.startsWith('Te gusta')) return Heart;
  if (reason === 'Creadora nueva') return Sparkles;
  return Flame;
}

/**
 * Una publicacion del mosaico: la foto (o su version difuminada si es de
 * pago y no la has desbloqueado), por que te sale, tu % de afinidad y quien
 * la publico. Abre la publicacion en el perfil de la creadora.
 */
function MosaicTile({ item, shape, big }: { item: MosaicItem; shape: string; big: boolean }) {
  const { post } = item;
  const first = post.assets[0];
  const isVideo = first?.mimeType.startsWith('video/');
  const locked = !post.isUnlocked;
  const Reason = reasonIcon(item.reason);

  return (
    <Link
      href={`/models/${post.model.slug}?post=${post.id}`}
      className={cn(
        'group relative overflow-hidden rounded-2xl bg-muted',
        big && 'ring-1 ring-primary/40',
        shape,
      )}
    >
      {/* Fondo */}
      {first ? (
        locked ? (
          first.previewUrl ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={first.previewUrl} alt="" className="h-full w-full scale-110 object-cover" />
          ) : (
            <span className="block h-full w-full bg-gradient-to-br from-primary/30 via-muted to-muted" />
          )
        ) : isVideo ? (
          <video
            src={first.url ? `${first.url}#t=0.1` : undefined}
            muted
            playsInline
            preload="metadata"
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
        ) : (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={first.url ?? undefined}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
        )
      ) : (
        // Sin fotos: el texto (o la pregunta de la encuesta) es la portada.
        // (con margen arriba y abajo para no quedar bajo las etiquetas)
        <span className="flex h-full w-full items-center bg-gradient-to-br from-primary/35 via-card to-champagne-gold/25 px-3 pb-8 pt-8">
          <span
            className={cn(
              'overflow-hidden font-medium leading-snug',
              big ? 'line-clamp-5 text-base' : 'line-clamp-2 text-[11px] sm:line-clamp-4 sm:text-xs',
            )}
          >
            {post.poll && big && <BarChart3 className="mb-1 h-4 w-4 text-primary" />}
            {post.body ?? post.poll?.question}
          </span>
        </span>
      )}

      {/* Candado de pago */}
      {locked && first && (
        <span className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/35">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-black/60">
            {post.visibility === 'SUBSCRIBERS' ? (
              <Crown className="h-4 w-4 text-white" />
            ) : (
              <Lock className="h-4 w-4 text-white" />
            )}
          </span>
          {post.visibility === 'LOCKED' && (
            <span className="rounded-full bg-token px-2 py-0.5 text-[10px] font-bold text-black">
              {formatTokens(post.priceTokens)}
            </span>
          )}
        </span>
      )}

      {/* Arriba: por que te sale y tu afinidad */}
      <span className="absolute inset-x-1.5 top-1.5 flex items-start justify-between gap-1">
        <span
          className={cn(
            'flex min-w-0 items-center gap-1 rounded-full bg-black/55 px-2 py-0.5 text-[10px] font-medium text-white backdrop-blur',
            !big && 'max-sm:hidden',
          )}
        >
          <Reason className="h-3 w-3 shrink-0" />
          <span className="truncate">{item.reason}</span>
        </span>
        {item.match !== null && (
          <span className="shrink-0 rounded-full bg-black/55 px-1.5 py-0.5 text-[10px] font-bold text-white backdrop-blur">
            {item.match}%
          </span>
        )}
      </span>

      {isVideo && !locked && (
        <Play className="absolute right-2 top-8 h-4 w-4 fill-white text-white drop-shadow" />
      )}
      {post.assets.length > 1 && (
        <Layers className="absolute bottom-9 right-2 h-4 w-4 text-white drop-shadow" />
      )}

      {/* Abajo: quien la publico */}
      <span className="absolute inset-x-0 bottom-0 flex items-center gap-1.5 bg-gradient-to-t from-black/80 to-transparent px-2 pb-1.5 pt-6">
        <span
          className={cn(
            'shrink-0 rounded-full p-[1.5px]',
            post.model.isLive
              ? 'bg-gradient-to-tr from-primary via-fantazy-red to-champagne-gold'
              : 'bg-white/30',
          )}
        >
          <Avatar className={cn(big ? 'h-7 w-7' : 'h-5 w-5')}>
            {post.model.avatarUrl && <AvatarImage src={post.model.avatarUrl} alt="" />}
            <AvatarFallback className="text-[8px]">{initials(post.model.stageName)}</AvatarFallback>
          </Avatar>
        </span>
        <span className={cn('truncate font-semibold text-white', big ? 'text-sm' : 'text-[11px]')}>
          {post.model.stageName}
        </span>
      </span>
    </Link>
  );
}

/** Circulito con el % de afinidad. */
function MatchRing({ value, className }: { value: number; className?: string }) {
  const deg = Math.round((value / 100) * 360);
  return (
    <span
      className={cn('flex h-8 w-8 items-center justify-center rounded-full p-[2px]', className)}
      style={{
        background: `conic-gradient(hsl(var(--primary)) ${deg}deg, hsl(var(--muted)) ${deg}deg)`,
      }}
      title={`${value}% de afinidad`}
    >
      <span className="flex h-full w-full items-center justify-center rounded-full bg-card text-[9px] font-bold">
        {value}%
      </span>
    </span>
  );
}

function SectionTitle({
  children,
  icon: Icon,
}: {
  children: React.ReactNode;
  icon?: LucideIcon;
}) {
  return (
    <h2 className="mb-3 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
      {Icon && <Icon className="h-3.5 w-3.5" />}
      {children}
    </h2>
  );
}

function TagChips({ tags, onTag }: { tags: string[]; onTag: (tag: string) => void }) {
  const labels = new Map(TASTE_TAGS.map((t) => [t.id, t.label]));
  return (
    <div className="flex flex-wrap gap-2">
      {tags.map((tag) => (
        <button
          key={tag}
          type="button"
          onClick={() => onTag(tag)}
          className="rounded-full border border-border/60 bg-card px-3.5 py-1.5 text-sm transition-colors hover:border-primary/60 hover:text-primary"
        >
          #{labels.get(tag) ?? tag}
        </button>
      ))}
    </div>
  );
}

function CreatorList({ creators }: { creators: SearchCreator[] }) {
  return (
    <ul className="divide-y divide-border/60 overflow-hidden rounded-2xl border border-border/60 bg-card">
      {creators.map((c) => (
        <li key={c.id}>
          <Link
            href={`/models/${c.slug}`}
            className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/40"
          >
            <span className="relative shrink-0">
              <span
                className={cn(
                  'block rounded-full p-[2px]',
                  c.isLive
                    ? 'bg-gradient-to-tr from-primary via-fantazy-red to-champagne-gold'
                    : 'bg-transparent',
                )}
              >
                <Avatar className="h-12 w-12 border-2 border-card">
                  {c.avatarUrl && <AvatarImage src={c.avatarUrl} alt="" />}
                  <AvatarFallback>{initials(c.stageName)}</AvatarFallback>
                </Avatar>
              </span>
              {!c.isLive && c.isOnline && (
                <span className="absolute bottom-0.5 right-0.5 h-3 w-3 rounded-full border-2 border-card bg-state-connected" />
              )}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2">
                <span className="truncate text-sm font-semibold">{c.stageName}</span>
                {c.isLive && (
                  <span className="shrink-0 rounded bg-primary px-1.5 py-0.5 text-[9px] font-bold uppercase text-primary-foreground">
                    En vivo
                  </span>
                )}
              </span>
              <span className="block truncate text-xs text-muted-foreground">
                @{c.slug} · {formatTokens(c.followersCount)} seguidores
              </span>
              {c.headline && (
                <span className="mt-0.5 block truncate text-xs text-muted-foreground/80">
                  {c.headline}
                </span>
              )}
            </span>
            {c.match !== undefined && <MatchRing value={c.match} className="shrink-0" />}
          </Link>
        </li>
      ))}
    </ul>
  );
}
