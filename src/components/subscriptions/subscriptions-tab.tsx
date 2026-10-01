import Link from 'next/link';
import { ChevronDown, Crown, Settings2 } from 'lucide-react';

import { InfiniteFeed } from '@/components/feed/infinite-feed';
import { SubscriptionsManager, type SubscriptionRow } from '@/components/subscriptions/subscriptions-manager';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { getVisibilityContext } from '@/lib/geo';
import { getSubscriptionsFeed } from '@/lib/posts';
import { cn, formatTokens, initials } from '@/lib/utils';

const FIRST_PAGE = 10;

/**
 * Pestana "Suscripciones" del perfil del fan: lo que paga, para verlo. Arriba
 * sus creadores (para filtrar), la gestion plegada y debajo el feed con sus
 * publicaciones exclusivas para suscriptores.
 */
export async function SubscriptionsTab({
  viewerId,
  baseHref,
  subscriptions,
  creatorSlug,
}: {
  viewerId: string;
  /** /u/<usuario>?tab=suscripciones */
  baseHref: string;
  subscriptions: SubscriptionRow[];
  creatorSlug: string | null;
}) {
  const active = subscriptions.filter((s) => s.isActive);
  const monthly = active.reduce((sum, s) => sum + s.priceTokens, 0);

  // Sin ninguna activa no hay nada que ver: directamente la gestion
  // (vacio o "volver a suscribirme").
  if (active.length === 0) return <SubscriptionsManager subscriptions={subscriptions} />;

  const selected = active.find((s) => s.modelSlug === creatorSlug) ?? null;
  const { filter: geoFilter } = await getVisibilityContext();
  const posts = await getSubscriptionsFeed({
    viewerId,
    geoFilter,
    modelId: selected?.modelId ?? null,
    take: FIRST_PAGE,
  });

  return (
    <div className="space-y-5">
      {/* Sus creadores: tocar uno filtra el feed */}
      <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
        <CreatorChip href={baseHref} active={!selected} label="Todas">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
            <Crown className="h-6 w-6 text-primary" />
          </span>
        </CreatorChip>
        {active.map((s) => (
          <CreatorChip
            key={s.id}
            href={`${baseHref}&de=${s.modelSlug}`}
            active={selected?.id === s.id}
            label={s.modelStageName}
          >
            <Avatar className="h-14 w-14 border-2 border-background">
              {s.modelAvatarUrl && <AvatarImage src={s.modelAvatarUrl} alt="" />}
              <AvatarFallback>{initials(s.modelStageName)}</AvatarFallback>
            </Avatar>
          </CreatorChip>
        ))}
      </div>

      {/* Gestion: plegada, lo importante es el contenido */}
      <details className="group rounded-2xl border border-border/60 bg-card">
        <summary className="flex cursor-pointer list-none items-center gap-2 px-3.5 py-3 text-sm">
          <Settings2 className="h-4 w-4 text-muted-foreground" />
          <span className="flex-1">
            <span className="font-medium">Gestionar suscripciones</span>
            <span className="text-muted-foreground">
              {' '}
              · {active.length} {active.length === 1 ? 'activa' : 'activas'} · {formatTokens(monthly)} tk/mes
            </span>
          </span>
          <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" />
        </summary>
        <div className="border-t border-border/60 p-3">
          <SubscriptionsManager subscriptions={subscriptions} />
        </div>
      </details>

      {posts.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border/60 px-6 py-10 text-center text-sm text-muted-foreground">
          {selected
            ? `${selected.modelStageName} aún no tiene publicaciones solo para suscriptores.`
            : 'Tus creadores aún no han publicado nada solo para suscriptores. Te avisaremos cuando lo hagan.'}
          <Link
            href={`/models/${selected?.modelSlug ?? active[0]!.modelSlug}`}
            className="mt-3 block font-medium text-primary hover:underline"
          >
            Ver su perfil
          </Link>
        </div>
      ) : (
        <InfiniteFeed
          key={selected?.modelId ?? 'all'}
          kind="subscriptions"
          modelId={selected?.modelId ?? null}
          initialPosts={posts}
          isAuthenticated
        />
      )}
    </div>
  );
}

function CreatorChip({
  href,
  active,
  label,
  children,
}: {
  href: string;
  active: boolean;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <Link href={href} scroll={false} className="flex w-[68px] shrink-0 flex-col items-center gap-1.5">
      <span
        className={cn(
          'rounded-full p-[2px]',
          active ? 'bg-gradient-to-tr from-primary via-fantazy-red to-champagne-gold' : 'bg-border',
        )}
      >
        {children}
      </span>
      <span className={cn('w-full truncate text-center text-[11px]', active ? 'font-semibold' : 'text-muted-foreground')}>
        {label}
      </span>
    </Link>
  );
}
