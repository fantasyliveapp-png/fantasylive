import type { Metadata } from 'next';

import { AdminPageHeader } from '@/components/admin/admin-shell';
import { AnnouncementForm } from '@/components/admin/admin-tools';
import { Empty, Panel, Pill } from '@/components/admin/admin-ui';
import { requireAdmin } from '@/lib/auth/guards';
import { prisma } from '@/lib/prisma';
import { formatDateTime, formatTokens } from '@/lib/utils';

export const metadata: Metadata = { title: 'Avisos' };
export const dynamic = 'force-dynamic';

const AUDIENCE_LABEL: Record<string, string> = {
  all: 'Todos',
  fans: 'Fans',
  creators: 'Creadoras',
  founders: 'Fundadoras',
};

/** AVISOS A TODOS: una notificacion del equipo a todos o a un grupo. */
export default async function AdminAnnouncementsPage() {
  await requireAdmin();
  const history = await prisma.announcement.findMany({
    orderBy: { createdAt: 'desc' },
    take: 30,
  });

  return (
    <>
      <AdminPageHeader
        title="Avisos"
        description="Manda una notificacion a todos, solo a fans, solo a creadoras o a tus Fundadoras: novedades, promociones o mantenimiento."
      />
      <div className="space-y-6">
        <Panel title="Nuevo aviso">
          <div className="p-5">
            <AnnouncementForm />
          </div>
        </Panel>

        <Panel title="Enviados">
          {history.length === 0 ? (
            <Empty>Aun no has enviado ningun aviso.</Empty>
          ) : (
            <ul className="divide-y divide-white/[0.06]">
              {history.map((a) => (
                <li key={a.id} className="flex items-start gap-4 px-5 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{a.title}</p>
                    {a.body && <p className="line-clamp-2 text-xs text-muted-foreground">{a.body}</p>}
                    {a.link && <p className="text-[11px] text-primary">{a.link}</p>}
                  </div>
                  <div className="shrink-0 text-right">
                    <Pill>{AUDIENCE_LABEL[a.audience] ?? a.audience}</Pill>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {formatTokens(a.sentCount)} personas · {formatDateTime(a.createdAt)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </>
  );
}
