import {
  DashboardSidebar,
  type SidebarSection,
} from '@/components/layout/dashboard-sidebar';
import { Badge } from '@/components/ui/badge';
import { requireAdmin } from '@/lib/auth/guards';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireAdmin();

  const [pendingKyc, openReports, pendingPayouts] = await Promise.all([
    prisma.kycVerification.count({ where: { status: 'PENDING' } }),
    prisma.report.count({ where: { status: { in: ['OPEN', 'UNDER_REVIEW'] } } }),
    prisma.payoutRequest.count({
      where: { status: { in: ['REQUESTED', 'APPROVED', 'PROCESSING'] } },
    }),
  ]);

  const sections: SidebarSection[] = [
    {
      links: [
        { href: '/admin', label: 'Metricas', icon: 'layout', exact: true },
      ],
    },
    {
      title: 'Moderacion',
      links: [
        {
          href: '/admin/kyc',
          label: 'Verificaciones KYC',
          icon: 'badgeCheck',
          badge: pendingKyc,
        },
        {
          href: '/admin/reports',
          label: 'Reportes y disputas',
          icon: 'flag',
          badge: openReports,
        },
        { href: '/admin/users', label: 'Usuarios y modelos', icon: 'users' },
      ],
    },
    {
      title: 'Finanzas',
      links: [
        {
          href: '/admin/payouts',
          label: 'Retiros',
          icon: 'wallet',
          badge: pendingPayouts,
        },
        { href: '/admin/transactions', label: 'Transacciones', icon: 'receipt' },
      ],
    },
  ];

  return (
    <div className="container py-8">
      <div className="grid gap-8 lg:grid-cols-[240px_1fr]">
        <aside className="space-y-6">
          <div className="rounded-xl border border-border bg-card p-4">
            <p className="font-semibold">Panel de administracion</p>
            <Badge variant="destructive" className="mt-2">
              Acceso restringido
            </Badge>
          </div>
          <DashboardSidebar sections={sections} />
        </aside>

        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}
