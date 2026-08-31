import type { Metadata } from 'next';
import { Wallet } from 'lucide-react';

import { PayoutReviewList } from '@/components/admin/payout-review-list';
import { Card, CardContent } from '@/components/ui/card';
import { requireAdmin } from '@/lib/auth/guards';
import { prisma } from '@/lib/prisma';

export const metadata: Metadata = { title: 'Retiros' };
export const dynamic = 'force-dynamic';

export default async function AdminPayoutsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  await requireAdmin();
  const { status } = await searchParams;

  const payouts = await prisma.payoutRequest.findMany({
    where: status
      ? { status: status as any }
      : { status: { in: ['REQUESTED', 'APPROVED', 'PROCESSING'] } },
    orderBy: { requestedAt: 'asc' },
    include: {
      model: {
        select: {
          stageName: true,
          slug: true,
          kycStatus: true,
          totalTokensEarned: true,
          user: { select: { email: true, wallet: { select: { balance: true } } } },
        },
      },
    },
  });

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">
          Solicitudes de retiro
        </h1>
        <p className="mt-2 text-muted-foreground">
          Aprueba, marca como pagado o rechaza. Rechazar devuelve los tokens al
          monedero de la modelo automaticamente.
        </p>
      </div>

      {payouts.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <Wallet className="mx-auto h-8 w-8 text-muted-foreground" />
            <p className="mt-3 font-medium">No hay retiros pendientes</p>
          </CardContent>
        </Card>
      ) : (
        <PayoutReviewList
          payouts={payouts.map((p) => ({
            id: p.id,
            status: p.status,
            tokens: p.tokens,
            amountCents: p.amountCents,
            currency: p.currency,
            method: p.method,
            // Nunca se manda el blob cifrado al cliente: solo la mascara.
            destinationMasked: p.destinationMasked,
            requestedAt: p.requestedAt.toISOString(),
            model: {
              stageName: p.model.stageName,
              slug: p.model.slug,
              email: p.model.user.email,
              kycStatus: p.model.kycStatus,
              totalEarned: p.model.totalTokensEarned,
              currentBalance: p.model.user.wallet?.balance ?? 0,
            },
          }))}
        />
      )}
    </div>
  );
}
