import type { Metadata } from 'next';
import type { Gender, ModelTier, Orientation, Prisma } from '@prisma/client';

import { ModelCard } from '@/components/models/model-card';
import { ModelFilters } from '@/components/models/model-filters';
import { prisma } from '@/lib/prisma';

export const metadata: Metadata = { title: 'Descubrir creadores' };
export const dynamic = 'force-dynamic';

const PAGE_SIZE = 24;

interface SearchParams {
  gender?: string;
  orientation?: string;
  tier?: string;
  online?: string;
  tag?: string;
  q?: string;
  sort?: string;
  page?: string;
}

export default async function ModelsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const page = Math.max(1, Number(params.page) || 1);

  const where: Prisma.ModelProfileWhereInput = {
    kycStatus: 'APPROVED',
    user: { status: 'ACTIVE' },
  };

  if (params.gender) {
    where.gender = { in: params.gender.split(',') as Gender[] };
  }
  if (params.orientation) {
    where.orientation = { in: params.orientation.split(',') as Orientation[] };
  }
  if (params.tier) {
    where.tier = { in: params.tier.split(',') as ModelTier[] };
  }
  if (params.online === '1') {
    where.isOnline = true;
  }
  if (params.tag) {
    where.tags = { has: params.tag };
  }
  if (params.q) {
    where.OR = [
      { stageName: { contains: params.q, mode: 'insensitive' } },
      { headline: { contains: params.q, mode: 'insensitive' } },
      { tags: { has: params.q.toLowerCase() } },
    ];
  }

  const orderBy: Prisma.ModelProfileOrderByWithRelationInput[] =
    params.sort === 'price_asc'
      ? [{ privateRatePerMinute: 'asc' }]
      : params.sort === 'price_desc'
        ? [{ privateRatePerMinute: 'desc' }]
        : params.sort === 'rating'
          ? [{ ratingAvg: 'desc' }, { ratingCount: 'desc' }]
          : params.sort === 'new'
            ? [{ createdAt: 'desc' }]
            : [{ isOnline: 'desc' }, { ratingAvg: 'desc' }];

  const [models, total] = await Promise.all([
    prisma.modelProfile.findMany({
      where,
      orderBy,
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        slug: true,
        stageName: true,
        headline: true,
        gender: true,
        orientation: true,
        tier: true,
        country: true,
        avatarUrl: true,
        coverUrl: true,
        isOnline: true,
        isVipEnabled: true,
        isAvailableForVip: true,
        vipRatePerMinute: true,
        privateRatePerMinute: true,
        ratingAvg: true,
        ratingCount: true,
        tags: true,
      },
    }),
    prisma.modelProfile.count({ where }),
  ]);

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="container py-10">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Descubrir creadores</h1>
        <p className="mt-2 text-muted-foreground">
          {total} {total === 1 ? 'creador verificado' : 'creadores verificados'} en
          la plataforma.
        </p>
      </div>

      <ModelFilters />

      {models.length === 0 ? (
        <div className="mt-16 text-center">
          <p className="text-lg font-medium">No hay resultados</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Prueba a quitar algun filtro o buscar otro termino.
          </p>
        </div>
      ) : (
        <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {models.map((model) => (
            <ModelCard key={model.id} model={model} />
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <nav className="mt-12 flex items-center justify-center gap-2">
          {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => {
            const qs = new URLSearchParams(params as Record<string, string>);
            qs.set('page', String(p));
            return (
              <a
                key={p}
                href={`/models?${qs.toString()}`}
                className={`flex h-9 min-w-9 items-center justify-center rounded-lg px-3 text-sm font-medium transition-colors ${
                  p === page
                    ? 'bg-primary text-primary-foreground'
                    : 'border border-border hover:bg-muted'
                }`}
              >
                {p}
              </a>
            );
          })}
        </nav>
      )}
    </div>
  );
}
