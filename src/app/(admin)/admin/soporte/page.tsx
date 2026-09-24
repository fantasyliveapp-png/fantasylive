import type { Metadata } from 'next';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import type { SupportStatus } from '@prisma/client';

import { AdminPageHeader, AdminTabs } from '@/components/admin/admin-shell';
import { Empty, Panel, Pill } from '@/components/admin/admin-ui';
import { personOf } from '@/lib/admin-supervision';
import { requireAdmin } from '@/lib/auth/guards';
import { prisma } from '@/lib/prisma';
import { supportCategoryLabel } from '@/lib/support';
import { relativeTime } from '@/lib/utils';

export const metadata: Metadata = { title: 'Soporte' };
export const dynamic = 'force-dynamic';

const TABS: { value: string; label: string; status: SupportStatus }[] = [
  { value: '', label: 'Por responder', status: 'OPEN' },
  { value: 'ANSWERED', label: 'Respondidas', status: 'ANSWERED' },
  { value: 'CLOSED', label: 'Cerradas', status: 'CLOSED' },
];

/** SOPORTE: consultas de fans y creadoras. Las mas antiguas sin responder, primero. */
export default async function AdminSupportPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  await requireAdmin();
  const { status } = await searchParams;
  const tab = TABS.find((t) => t.value === (status ?? '')) ?? TABS[0]!;

  const tickets = await prisma.supportTicket.findMany({
    where: { status: tab.status },
    orderBy: { updatedAt: tab.status === 'OPEN' ? 'asc' : 'desc' },
    take: 100,
    select: {
      id: true,
      subject: true,
      category: true,
      updatedAt: true,
      user: {
        select: {
          id: true,
          name: true,
          username: true,
          image: true,
          modelProfile: { select: { stageName: true, avatarUrl: true } },
        },
      },
      messages: { orderBy: { createdAt: 'desc' }, take: 1, select: { body: true } },
      _count: { select: { messages: true } },
    },
  });

  return (
    <>
      <AdminPageHeader
        title="Soporte"
        description="Consultas que te escriben fans y creadoras desde /soporte. Cuando respondes, les llega una notificacion."
        tabs={<AdminTabs basePath="/admin/soporte" current={tab.value} tabs={TABS} />}
      />
      <Panel>
        {tickets.length === 0 ? (
          <Empty>{tab.status === 'OPEN' ? 'No hay consultas esperando. Todo al dia.' : 'Nada por aqui.'}</Empty>
        ) : (
          <ul className="divide-y divide-white/[0.06]">
            {tickets.map((t) => {
              const u = personOf(t.user);
              return (
                <li key={t.id}>
                  <Link
                    href={`/admin/soporte/${t.id}`}
                    className="flex items-center gap-4 px-5 py-3 transition-colors hover:bg-white/[0.03]"
                  >
                    {u.image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={u.image} alt="" className="h-8 w-8 shrink-0 rounded-full object-cover" />
                    ) : (
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-bold uppercase">
                        {u.name.slice(0, 1)}
                      </span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium">{t.subject}</span>
                        <Pill>{supportCategoryLabel(t.category)}</Pill>
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {u.name}: {t.messages[0]?.body}
                      </span>
                    </span>
                    <span className="shrink-0 text-right text-[11px] text-muted-foreground">
                      {relativeTime(t.updatedAt)}
                      <span className="block">{t._count.messages} mensajes</span>
                    </span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </>
  );
}
