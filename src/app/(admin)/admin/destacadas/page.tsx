import type { Metadata } from 'next';
import type { Prisma } from '@prisma/client';
import { Crown, Sparkles } from 'lucide-react';

import { AdminPageHeader } from '@/components/admin/admin-shell';
import { FeatureButtons } from '@/components/admin/admin-tools';
import { Empty, Panel, PersonLink, Pill, SearchBox } from '@/components/admin/admin-ui';
import { requireAdmin } from '@/lib/auth/guards';
import { prisma } from '@/lib/prisma';
import { tokensToPayoutCents } from '@/lib/tokens';
import { formatMoney, formatTokens, relativeTime } from '@/lib/utils';

export const metadata: Metadata = { title: 'Destacadas' };
export const dynamic = 'force-dynamic';

const select = {
  id: true,
  stageName: true,
  avatarUrl: true,
  founderNumber: true,
  featuredUntil: true,
  followersCount: true,
  postsCount: true,
  totalTokensEarned: true,
  createdAt: true,
  user: { select: { id: true, username: true } },
} satisfies Prisma.ModelProfileSelect;

type Row = Prisma.ModelProfileGetPayload<{ select: typeof select }>;

/**
 * DESTACADAS: el equipo da un empujon en Descubrir a las creadoras que
 * elige (p. ej. Fundadoras nuevas). No tapa los gustos de cada fan: solo
 * hace que salgan mas a menudo.
 */
export default async function AdminFeaturedPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  await requireAdmin();
  const { q } = await searchParams;
  const now = new Date();
  const term = q?.trim().replace(/^@/, '');

  const [featured, candidates] = await Promise.all([
    prisma.modelProfile.findMany({
      where: { featuredUntil: { gt: now } },
      orderBy: { featuredUntil: 'asc' },
      select,
    }),
    prisma.modelProfile.findMany({
      where: {
        kycStatus: 'APPROVED',
        OR: [{ featuredUntil: null }, { featuredUntil: { lte: now } }],
        ...(term
          ? {
              AND: [
                {
                  OR: [
                    { stageName: { contains: term, mode: 'insensitive' } },
                    { user: { username: { contains: term, mode: 'insensitive' } } },
                  ],
                },
              ],
            }
          : {}),
      },
      // Sin busqueda: las verificadas mas nuevas, que son las que mas lo necesitan.
      orderBy: { createdAt: 'desc' },
      take: 20,
      select,
    }),
  ]);

  return (
    <>
      <AdminPageHeader
        title="Destacadas"
        description="Dale visibilidad extra en Descubrir a las creadoras que elijas, durante 7 o 30 dias. Ideal para Fundadoras nuevas o para quien este empezando."
      />

      <div className="space-y-6">
        <Panel title="Destacadas ahora" aside={`${featured.length}`}>
          {featured.length === 0 ? (
            <Empty>No hay ninguna creadora destacada.</Empty>
          ) : (
            <ul className="divide-y divide-white/[0.06]">
              {featured.map((m) => (
                <CreatorRow key={m.id} m={m} featured />
              ))}
            </ul>
          )}
        </Panel>

        <Panel
          title={term ? `Resultados para "${term}"` : 'Verificadas mas nuevas'}
          aside={<SearchBox action="/admin/destacadas" placeholder="Buscar creadora..." defaultValue={q} />}
        >
          {candidates.length === 0 ? (
            <Empty>No hay creadoras verificadas que coincidan.</Empty>
          ) : (
            <ul className="divide-y divide-white/[0.06]">
              {candidates.map((m) => (
                <CreatorRow key={m.id} m={m} />
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </>
  );
}

function CreatorRow({ m, featured }: { m: Row; featured?: boolean }) {
  const daysLeft = m.featuredUntil
    ? Math.ceil((m.featuredUntil.getTime() - Date.now()) / 86_400_000)
    : 0;
  return (
    <li className="flex flex-wrap items-center gap-4 px-5 py-3">
      <div className="w-52 min-w-0">
        <PersonLink id={m.user.id} name={m.stageName} username={m.user.username} image={m.avatarUrl} />
      </div>
      <div className="flex flex-1 flex-wrap items-center gap-2 text-xs text-muted-foreground">
        {m.founderNumber && (
          <Pill tone="gold">
            <Crown className="h-3 w-3" /> #{m.founderNumber}
          </Pill>
        )}
        {featured && (
          <Pill tone="brand">
            <Sparkles className="h-3 w-3" /> {daysLeft} {daysLeft === 1 ? 'dia' : 'dias'} mas
          </Pill>
        )}
        <span>
          {formatTokens(m.followersCount)} seguidores · {formatTokens(m.postsCount)} publicaciones ·{' '}
          {formatMoney(tokensToPayoutCents(m.totalTokensEarned))} ganado · alta {relativeTime(m.createdAt)}
        </span>
      </div>
      <FeatureButtons modelId={m.id} featured={Boolean(featured)} />
    </li>
  );
}
