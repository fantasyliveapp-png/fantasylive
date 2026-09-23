import type { Metadata } from 'next';

import { UserRequestsManager } from '@/components/content/user-requests-manager';
import { requireUser } from '@/lib/auth/guards';
import { prisma } from '@/lib/prisma';

export const metadata: Metadata = { title: 'Mis pedidos' };
export const dynamic = 'force-dynamic';

export default async function UserRequestsPage() {
  const user = await requireUser('/dashboard/requests');

  const requests = await prisma.contentRequest.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: 'desc' },
    include: { model: { select: { stageName: true, slug: true, avatarUrl: true } } },
  });

  return (
    <div className="container py-10">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Mis pedidos</h1>
        <p className="mt-2 text-muted-foreground">
          Contenido a medida que pediste a tus modelos favoritas.
        </p>
      </div>

      <UserRequestsManager
        requests={requests.map((r) => ({
          id: r.id,
          status: r.status,
          description: r.description,
          quotedTokens: r.quotedTokens,
          modelNote: r.modelNote,
          createdAt: r.createdAt.toISOString(),
          deliveredPackageId: r.deliveredPackageId,
          modelStageName: r.model.stageName,
          modelSlug: r.model.slug,
          modelAvatarUrl: r.model.avatarUrl,
        }))}
      />
    </div>
  );
}
