import type { Metadata } from 'next';
import { BadgeCheck } from 'lucide-react';

import { KycReviewList } from '@/components/admin/kyc-review-list';
import { Card, CardContent } from '@/components/ui/card';
import { requireAdmin } from '@/lib/auth/guards';
import { prisma } from '@/lib/prisma';

export const metadata: Metadata = { title: 'Verificaciones KYC' };
export const dynamic = 'force-dynamic';

export default async function AdminKycPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  await requireAdmin();
  const { status } = await searchParams;

  const verifications = await prisma.kycVerification.findMany({
    where: status ? { status: status as any } : { status: 'PENDING' },
    orderBy: { submittedAt: 'asc' },
    include: {
      model: {
        select: {
          id: true,
          stageName: true,
          slug: true,
          gender: true,
          country: true,
          user: { select: { email: true, createdAt: true } },
        },
      },
      reviewer: { select: { name: true, email: true } },
    },
  });

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">
          Verificaciones de identidad
        </h1>
        <p className="mt-2 text-muted-foreground">
          Comprueba que la persona del selfie coincide con el documento y que es
          mayor de 18 anos antes de aprobar.
        </p>
      </div>

      {verifications.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <BadgeCheck className="mx-auto h-8 w-8 text-emerald-500" />
            <p className="mt-3 font-medium">No hay verificaciones pendientes</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Todas las solicitudes han sido revisadas.
            </p>
          </CardContent>
        </Card>
      ) : (
        <KycReviewList
          items={verifications.map((v) => ({
            id: v.id,
            status: v.status,
            fullLegalName: v.fullLegalName,
            birthDate: v.birthDate.toISOString(),
            country: v.country,
            documentType: v.documentType,
            documentNumber: v.documentNumber,
            submittedAt: v.submittedAt.toISOString(),
            hasBack: Boolean(v.documentBackKey),
            hasNote: Boolean(v.handwrittenNoteKey),
            model: {
              stageName: v.model.stageName,
              slug: v.model.slug,
              email: v.model.user.email,
              country: v.model.country,
              registeredAt: v.model.user.createdAt.toISOString(),
            },
          }))}
        />
      )}
    </div>
  );
}
