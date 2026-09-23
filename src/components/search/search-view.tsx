'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Hash, Loader2, Search, SearchX, Users, X } from 'lucide-react';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import type { SearchCreator, SearchResult } from '@/lib/search';
import { cn, formatTokens, initials } from '@/lib/utils';

/**
 * Buscador de creadoras. Sin texto muestra sugerencias (conectadas ahora,
 * etiquetas, las mas seguidas); al escribir, resultados al momento. La URL se
 * actualiza (?q=) para poder compartir o volver atras a la busqueda.
 */
export function SearchView({
  initialQuery,
  initialResult,
  suggestions,
}: {
  initialQuery: string;
  initialResult: SearchResult | null;
  suggestions: { online: SearchCreator[]; popular: SearchCreator[]; tags: string[] };
}) {
  const [query, setQuery] = useState(initialQuery);
  const [result, setResult] = useState<SearchResult | null>(initialResult);
  const [loading, setLoading] = useState(false);
  const input = useRef<HTMLInputElement | null>(null);
  const request = useRef(0);

  useEffect(() => {
    // Sin autofocus en la carga inicial con resultados (se ven primero).
    if (!initialQuery) input.current?.focus();
  }, [initialQuery]);

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

  return (
    <div className="space-y-6">
      {/* Caja de busqueda, fija bajo la barra superior */}
      <div className="sticky top-16 z-20 -mx-6 lg:top-0 bg-background/90 px-6 py-3 backdrop-blur-xl">
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
        <Suggestions {...suggestions} />
      ) : result && result.creators.length === 0 && result.tags.length === 0 && !loading ? (
        <div className="flex flex-col items-center gap-3 py-12 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <SearchX className="h-5 w-5 text-muted-foreground" />
          </span>
          <p className="font-medium">No encontramos a nadie con &laquo;{query.trim()}&raquo;</p>
          <p className="max-w-xs text-sm text-muted-foreground">
            Prueba con otro nombre o explora por etiqueta.
          </p>
          <TagChips tags={suggestions.tags.slice(0, 8)} />
        </div>
      ) : (
        result && (
          <div className="space-y-6">
            {result.tags.length > 0 && (
              <section>
                <SectionTitle icon={Hash}>Etiquetas</SectionTitle>
                <TagChips tags={result.tags} />
              </section>
            )}
            {result.creators.length > 0 && (
              <section>
                <SectionTitle icon={Users}>Creadoras</SectionTitle>
                <CreatorList creators={result.creators} />
              </section>
            )}
          </div>
        )
      )}
    </div>
  );
}

function Suggestions({
  online,
  popular,
  tags,
}: {
  online: SearchCreator[];
  popular: SearchCreator[];
  tags: string[];
}) {
  return (
    <div className="space-y-7">
      {online.length > 0 && (
        <section>
          <SectionTitle>Conectadas ahora</SectionTitle>
          {/* Fila de avatares como las historias */}
          <div className="-mx-6 flex gap-4 overflow-x-auto px-6 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {online.map((c) => (
              <Link
                key={c.id}
                href={`/models/${c.slug}`}
                className="flex w-[68px] shrink-0 flex-col items-center gap-1.5"
              >
                <span
                  className={cn(
                    'rounded-full p-[2.5px]',
                    c.isLive
                      ? 'bg-gradient-to-tr from-primary via-fantazy-red to-champagne-gold'
                      : 'bg-state-connected',
                  )}
                >
                  <Avatar className="h-16 w-16 border-2 border-background">
                    {c.avatarUrl && <AvatarImage src={c.avatarUrl} alt="" />}
                    <AvatarFallback>{initials(c.stageName)}</AvatarFallback>
                  </Avatar>
                </span>
                <span className="w-full truncate text-center text-[11px]">{c.stageName}</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section>
        <SectionTitle>Explora por etiqueta</SectionTitle>
        <TagChips tags={tags} />
      </section>

      {popular.length > 0 && (
        <section>
          <SectionTitle>Las mas seguidas</SectionTitle>
          <CreatorList creators={popular} />
        </section>
      )}
    </div>
  );
}

function SectionTitle({
  children,
  icon: Icon,
}: {
  children: React.ReactNode;
  icon?: React.ComponentType<{ className?: string }>;
}) {
  return (
    <h2 className="mb-3 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
      {Icon && <Icon className="h-3.5 w-3.5" />}
      {children}
    </h2>
  );
}

function TagChips({ tags }: { tags: string[] }) {
  return (
    <div className="flex flex-wrap justify-center gap-2 sm:justify-start">
      {tags.map((tag) => (
        <Link
          key={tag}
          href={`/models?tag=${encodeURIComponent(tag)}`}
          className="rounded-full border border-border/60 bg-card px-3.5 py-1.5 text-sm capitalize transition-colors hover:border-primary/60 hover:text-primary"
        >
          #{tag}
        </Link>
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
          </Link>
        </li>
      ))}
    </ul>
  );
}
