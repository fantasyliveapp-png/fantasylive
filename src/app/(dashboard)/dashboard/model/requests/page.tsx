import type { Metadata } from 'next';

import { RequestsManager } from '@/components/model/requests-manager';
import { requireModel } from '@/lib/auth/guards';
import { prisma } from '@/lib/prisma';

export const metadata: Metadata = { title: 'Pedidos a medida' };
export const dynamic = 'force-dynamic';

export default async function ModelRequestsPage() {
  const { profile } = await requireModel();

  const [requests, unpublishedPackages] = await Promise.all([
    prisma.contentRequest.findMany({
      where: { modelId: profile.id },
      orderBy: { createdAt: 'desc' },
      include: { user: { select: { name: true, email: true } } },
    }),
    prisma.contentPackage.findMany({
      where: { modelId: profile.id, isPublished: false },
      select: { id: true, title: true, assetCount: true },
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Pedidos a medida</h1>
        <p className="mt-2 text-muted-foreground">
          Cotiza lo que te piden, cobra por adelantado y entrega subiendo un
          paquete oculto desde{' '}
          <span className="font-medium text-foreground">Contenido</span>.
        </p>
      </div>

      <RequestsManager
        requests={requests.map((r) => ({
          id: r.id,
          status: r.status,
          description: r.description,
          quotedTokens: r.quotedTokens,
          modelNote: r.modelNote,
          createdAt: r.createdAt.toISOString(),
          userName: r.user.name ?? r.user.email,
        }))}
        unpublishedPackages={unpublishedPackages}
      />
    </div>
  );
}
