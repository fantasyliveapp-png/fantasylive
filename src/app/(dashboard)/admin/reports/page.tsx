import type { Metadata } from 'next';
import { ShieldCheck } from 'lucide-react';

import { ReportsReviewList } from '@/components/admin/reports-review-list';
import { Card, CardContent } from '@/components/ui/card';
import { requireAdmin } from '@/lib/auth/guards';
import { prisma } from '@/lib/prisma';

export const metadata: Metadata = { title: 'Reportes y disputas' };
export const dynamic = 'force-dynamic';

export default async function AdminReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  await requireAdmin();
  const { status } = await searchParams;

  const reports = await prisma.report.findMany({
    where: status
      ? { status: status as any }
      : { status: { in: ['OPEN', 'UNDER_REVIEW', 'ESCALATED'] } },
    orderBy: [{ createdAt: 'desc' }],
    take: 60,
    include: {
      reporter: { select: { id: true, name: true, email: true } },
      reported: {
        select: {
          id: true,
          name: true,
          email: true,
          status: true,
          modelProfile: { select: { stageName: true, slug: true } },
        },
      },
      session: {
        select: {
          id: true,
          type: true,
          billedSeconds: true,
          tokensSpent: true,
          createdAt: true,
        },
      },
    },
  });

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Reportes y disputas</h1>
        <p className="mt-2 text-muted-foreground">
          Resuelve incidencias de llamadas, reembolsa tokens y aplica sanciones.
          Los reportes por sospecha de menores tienen prioridad absoluta.
        </p>
      </div>

      {reports.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <ShieldCheck className="mx-auto h-8 w-8 text-emerald-500" />
            <p className="mt-3 font-medium">No hay reportes abiertos</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Todo esta bajo control.
            </p>
          </CardContent>
        </Card>
      ) : (
        <ReportsReviewList
          reports={reports.map((r) => ({
            id: r.id,
            reason: r.reason,
            status: r.status,
            details: r.details,
            createdAt: r.createdAt.toISOString(),
            reporter: {
              id: r.reporter.id,
              name: r.reporter.name,
              email: r.reporter.email,
            },
            reported: {
              id: r.reported.id,
              name: r.reported.modelProfile?.stageName ?? r.reported.name,
              email: r.reported.email,
              status: r.reported.status,
              slug: r.reported.modelProfile?.slug ?? null,
            },
            session: r.session
              ? {
                  id: r.session.id,
                  type: r.session.type,
                  billedSeconds: r.session.billedSeconds,
                  tokensSpent: r.session.tokensSpent,
                  createdAt: r.session.createdAt.toISOString(),
                }
              : null,
          }))}
        />
      )}
    </div>
  );
}
