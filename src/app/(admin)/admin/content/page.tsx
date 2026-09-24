import type { Metadata } from 'next';
import Link from 'next/link';
import { Flag, Images, Lock, Play, Type } from 'lucide-react';

import { AdminPageHeader, AdminTabs } from '@/components/admin/admin-shell';
import { Empty, Panel, SearchBox } from '@/components/admin/admin-ui';
import { getAdminContent, type ContentFilter } from '@/lib/admin-supervision';
import { requireAdmin } from '@/lib/auth/guards';
import { formatTokens, relativeTime } from '@/lib/utils';

export const metadata: Metadata = { title: 'Contenido' };
export const dynamic = 'force-dynamic';

const FILTERS: { value: ContentFilter; label: string }[] = [
  { value: '', label: 'Todo' },
  { value: 'pago', label: 'De pago' },
  { value: 'reportadas', label: 'Denunciadas' },
  { value: 'retiradas', label: 'Retiradas' },
];

/**
 * CONTENIDO: todas las publicaciones de todas las creadoras, sin muro de
 * pago ni difuminado, para comprobar que cumplen las normas.
 */
export default async function AdminContentPage({
  searchParams,
}: {
  searchParams: Promise<{ f?: string; q?: string; page?: string }>;
}) {
  await requireAdmin();
  const sp = await searchParams;
  const filter = (FILTERS.some((f) => f.value === sp.f) ? sp.f : '') as ContentFilter;
  const page = Math.max(1, Number(sp.page) || 1);
  const { items, total, pages } = await getAdminContent({ filter, q: sp.q, page });

  const pageHref = (p: number) => {
    const qs = new URLSearchParams();
    if (filter) qs.set('f', filter);
    if (sp.q) qs.set('q', sp.q);
    if (p > 1) qs.set('page', String(p));
    const s = qs.toString();
    return `/admin/content${s ? `?${s}` : ''}`;
  };

  return (
    <>
      <AdminPageHeader
        title="Contenido"
        description="Todas las publicaciones tal cual son, sin difuminar ni muro de pago. Abre una para ver todos sus archivos, comentarios y denuncias, o retirarla."
        actions={
          <SearchBox
            action="/admin/content"
            placeholder="Buscar creadora..."
            defaultValue={sp.q}
            hidden={{ f: filter || undefined }}
          />
        }
        tabs={<AdminTabs basePath="/admin/content" param="f" current={filter} tabs={FILTERS} />}
      />

      <p className="mb-4 text-xs text-muted-foreground">
        {formatTokens(total)} publicaciones{sp.q ? ` de "${sp.q}"` : ''}
      </p>

      {items.length === 0 ? (
        <Panel>
          <Empty>No hay publicaciones con este filtro.</Empty>
        </Panel>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
          {items.map((p) => (
            <li key={p.id}>
              <Link
                href={`/admin/content/${p.id}`}
                className="group block overflow-hidden rounded-xl border border-white/[0.06] bg-[#141417] transition-colors hover:border-white/20"
              >
                <div className="relative aspect-[4/5] bg-black">
                  {p.media?.url ? (
                    p.media.isVideo ? (
                      <video
                        src={`${p.media.url}#t=0.5`}
                        muted
                        preload="metadata"
                        playsInline
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.media.url} alt="" className="h-full w-full object-cover" loading="lazy" />
                    )
                  ) : (
                    <div className="flex h-full items-center justify-center p-4">
                      <p className="line-clamp-6 text-center text-xs text-muted-foreground">
                        <Type className="mx-auto mb-2 h-4 w-4" />
                        {p.body ?? 'Encuesta'}
                      </p>
                    </div>
                  )}

                  <div className="absolute left-2 top-2 flex flex-wrap gap-1">
                    {p.removed && (
                      <span className="rounded bg-destructive px-1.5 py-0.5 text-[10px] font-bold uppercase text-white">
                        Retirada
                      </span>
                    )}
                    {p.reports > 0 && (
                      <span className="flex items-center gap-0.5 rounded bg-amber-500 px-1.5 py-0.5 text-[10px] font-bold text-black">
                        <Flag className="h-2.5 w-2.5" />
                        {p.reports}
                      </span>
                    )}
                    {p.scheduled && (
                      <span className="rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-white">
                        Programada
                      </span>
                    )}
                  </div>
                  <div className="absolute right-2 top-2 flex gap-1">
                    {p.visibility !== 'PUBLIC' && (
                      <span className="flex items-center gap-0.5 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-white">
                        <Lock className="h-2.5 w-2.5" />
                        {p.visibility === 'LOCKED' ? p.priceTokens : 'Susc.'}
                      </span>
                    )}
                    {p.media?.isVideo && (
                      <span className="rounded bg-black/70 p-1 text-white">
                        <Play className="h-2.5 w-2.5" />
                      </span>
                    )}
                    {p.assetCount > 1 && (
                      <span className="flex items-center gap-0.5 rounded bg-black/70 px-1.5 py-0.5 text-[10px] text-white">
                        <Images className="h-2.5 w-2.5" />
                        {p.assetCount}
                      </span>
                    )}
                  </div>
                </div>
                <div className="px-2.5 py-2">
                  <p className="truncate text-xs font-medium">{p.creator.name}</p>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {relativeTime(p.createdAt)} · {formatTokens(p.views)} vistas
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {pages > 1 && (
        <div className="mt-6 flex items-center justify-center gap-3 text-sm">
          {page > 1 && (
            <Link href={pageHref(page - 1)} className="rounded-lg bg-white/[0.06] px-3 py-1.5 hover:bg-white/[0.1]">
              Anterior
            </Link>
          )}
          <span className="text-muted-foreground">
            Pagina {page} de {pages}
          </span>
          {page < pages && (
            <Link href={pageHref(page + 1)} className="rounded-lg bg-white/[0.06] px-3 py-1.5 hover:bg-white/[0.1]">
              Siguiente
            </Link>
          )}
        </div>
      )}
    </>
  );
}
