import type { Metadata } from 'next';
import Link from 'next/link';
import { ChevronRight, Flag, ShieldAlert } from 'lucide-react';

import { AdminPageHeader, AdminTabs } from '@/components/admin/admin-shell';
import { Empty, Panel, Pill, SearchBox } from '@/components/admin/admin-ui';
import { getAdminChats } from '@/lib/admin-supervision';
import { requireAdmin } from '@/lib/auth/guards';
import { relativeTime } from '@/lib/utils';

export const metadata: Metadata = { title: 'Mensajes' };
export const dynamic = 'force-dynamic';

/**
 * MENSAJES: todos los chats (fan con creadora y entre personas). Solo
 * lectura; cada chat que se abre queda registrado en la actividad.
 */
export default async function AdminChatsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; f?: string }>;
}) {
  await requireAdmin();
  const sp = await searchParams;
  const onlyReported = sp.f === 'denunciados';
  const chats = await getAdminChats({ q: sp.q, onlyReported });

  return (
    <>
      <AdminPageHeader
        title="Mensajes"
        description="Todas las conversaciones de la plataforma, para revisar denuncias y comprobar que se cumplen las normas."
        actions={
          <SearchBox
            action="/admin/chats"
            placeholder="Buscar por @usuario..."
            defaultValue={sp.q}
            hidden={{ f: sp.f }}
          />
        }
        tabs={
          <AdminTabs
            basePath="/admin/chats"
            param="f"
            current={onlyReported ? 'denunciados' : ''}
            tabs={[
              { value: '', label: 'Recientes' },
              { value: 'denunciados', label: 'Denunciados' },
            ]}
          />
        }
      />

      <div className="mb-4 flex items-start gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-4 py-3 text-xs text-muted-foreground">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
        Son conversaciones privadas: abrelas solo para moderar. Cada chat que abres queda
        registrado con tu nombre en la actividad.
      </div>

      <Panel>
        {chats.length === 0 ? (
          <Empty>{sp.q ? `No hay chats de "${sp.q}".` : 'No hay conversaciones.'}</Empty>
        ) : (
          <ul className="divide-y divide-white/[0.06]">
            {chats.map((c) => (
              <li key={`${c.kind}-${c.id}`}>
                <Link
                  href={`/admin/chats/${c.kind}/${c.id}`}
                  className="group flex items-center gap-4 px-5 py-3 transition-colors hover:bg-white/[0.03]"
                >
                  <div className="flex shrink-0 -space-x-2">
                    {[c.a, c.b].map((p) =>
                      p.image ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          key={p.id}
                          src={p.image}
                          alt=""
                          className="h-8 w-8 rounded-full border-2 border-[#141417] object-cover"
                        />
                      ) : (
                        <span
                          key={p.id}
                          className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-[#141417] bg-muted text-xs font-bold uppercase"
                        >
                          {p.name.slice(0, 1)}
                        </span>
                      ),
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 truncate text-sm font-medium">
                      <span className="truncate">
                        {c.a.name} <span className="text-muted-foreground">y</span> {c.b.name}
                      </span>
                      {c.reports > 0 && (
                        <Pill tone="warn">
                          <Flag className="h-3 w-3" />
                          {c.reports}
                        </Pill>
                      )}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {c.lastBody ?? 'Archivo adjunto'}
                    </p>
                  </div>
                  <div className="hidden shrink-0 text-right sm:block">
                    <Pill tone={c.kind === 'fan' ? 'brand' : 'neutral'}>
                      {c.kind === 'fan' ? 'Fan y creador' : 'Entre personas'}
                    </Pill>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {c.messages} mensajes · {relativeTime(c.lastMessageAt)}
                    </p>
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}
