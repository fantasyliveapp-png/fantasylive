import type { Metadata } from 'next';
import Link from 'next/link';
import { Eye, Radio } from 'lucide-react';

import { AdminPageHeader } from '@/components/admin/admin-shell';
import { Empty, Panel, PersonLink, Pill } from '@/components/admin/admin-ui';
import { EndStreamButton } from '@/components/admin/supervision-actions';
import { personOf } from '@/lib/admin-supervision';
import { requireAdmin } from '@/lib/auth/guards';
import { prisma } from '@/lib/prisma';
import { tokensToPayoutCents } from '@/lib/tokens';
import { formatDateTime, formatMoney, relativeTime } from '@/lib/utils';

export const metadata: Metadata = { title: 'Directos' };
export const dynamic = 'force-dynamic';

const streamSelect = {
  id: true,
  title: true,
  status: true,
  source: true,
  viewerCount: true,
  viewerPeak: true,
  tokensEarned: true,
  startedAt: true,
  endedAt: true,
  createdAt: true,
  model: {
    select: {
      slug: true,
      user: {
        select: {
          id: true,
          name: true,
          username: true,
          image: true,
          modelProfile: { select: { stageName: true, avatarUrl: true } },
        },
      },
    },
  },
} as const;

/** DIRECTOS: los que estan en el aire (para vigilarlos o cortarlos) y el historial. */
export default async function AdminLivePage() {
  await requireAdmin();
  const [live, past] = await Promise.all([
    prisma.liveStream.findMany({
      where: { status: { in: ['LIVE', 'PREPARING'] } },
      orderBy: [{ status: 'asc' }, { viewerCount: 'desc' }],
      select: streamSelect,
    }),
    prisma.liveStream.findMany({
      where: { status: 'ENDED' },
      orderBy: { endedAt: 'desc' },
      take: 40,
      select: streamSelect,
    }),
  ]);

  return (
    <>
      <AdminPageHeader
        title="Directos"
        description="Entra a cualquier directo para vigilarlo. Si incumple las normas, cortalo: se le avisa con el motivo."
      />

      <div className="space-y-6">
        <Panel title="En el aire ahora" aside={`${live.filter((s) => s.status === 'LIVE').length} en vivo`}>
          {live.length === 0 ? (
            <Empty>No hay nadie emitiendo ahora mismo.</Empty>
          ) : (
            <ul className="divide-y divide-white/[0.06]">
              {live.map((s) => {
                const p = personOf(s.model.user);
                return (
                  <li key={s.id} className="flex flex-wrap items-center gap-4 px-5 py-3.5">
                    <div className="w-48 min-w-0">
                      <PersonLink id={p.id} name={p.name} username={p.username} image={p.image} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm">{s.title || 'Sin titulo'}</p>
                      <p className="flex items-center gap-2 text-[11px] text-muted-foreground">
                        {s.status === 'LIVE' ? (
                          <Pill tone="bad">
                            <Radio className="h-3 w-3" /> En vivo
                          </Pill>
                        ) : (
                          <Pill tone="warn">Preparando</Pill>
                        )}
                        {s.startedAt && `desde ${relativeTime(s.startedAt)}`} · {s.viewerCount} mirando ·{' '}
                        {s.source === 'OBS_RTMP' ? 'OBS' : 'Navegador'}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Link
                        href={`/live/${s.model.slug}`}
                        target="_blank"
                        className="inline-flex h-9 items-center gap-1.5 rounded-md border border-white/[0.08] px-3 text-sm hover:bg-white/[0.04]"
                      >
                        <Eye className="h-4 w-4" /> Mirar
                      </Link>
                      <EndStreamButton streamId={s.id} />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        <Panel title="Historial" aside="Ultimos 40">
          {past.length === 0 ? (
            <Empty>Aun no ha habido directos.</Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                  <tr className="border-b border-white/[0.06]">
                    <th className="px-5 py-2 font-medium">Creador</th>
                    <th className="px-3 py-2 font-medium">Titulo</th>
                    <th className="px-3 py-2 font-medium">Inicio</th>
                    <th className="px-3 py-2 font-medium">Duracion</th>
                    <th className="px-3 py-2 text-right font-medium">Pico</th>
                    <th className="px-5 py-2 text-right font-medium">Ganado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.06]">
                  {past.map((s) => {
                    const p = personOf(s.model.user);
                    const mins =
                      s.startedAt && s.endedAt
                        ? Math.max(0, Math.round((s.endedAt.getTime() - s.startedAt.getTime()) / 60000))
                        : null;
                    return (
                      <tr key={s.id}>
                        <td className="px-5 py-2.5">
                          <PersonLink id={p.id} name={p.name} image={p.image} size="sm" />
                        </td>
                        <td className="max-w-[16rem] truncate px-3 py-2.5 text-muted-foreground">
                          {s.title || '—'}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-muted-foreground">
                          {formatDateTime(s.startedAt ?? s.createdAt)}
                        </td>
                        <td className="px-3 py-2.5 text-muted-foreground">
                          {mins === null ? '—' : mins >= 60 ? `${Math.floor(mins / 60)} h ${mins % 60} min` : `${mins} min`}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{s.viewerPeak}</td>
                        <td className="px-5 py-2.5 text-right tabular-nums">
                          {formatMoney(tokensToPayoutCents(s.tokensEarned))}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>
    </>
  );
}
