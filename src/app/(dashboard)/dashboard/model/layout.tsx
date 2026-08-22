import {
  DashboardSidebar,
  type SidebarSection,
} from '@/components/layout/dashboard-sidebar';
import { OnlineToggle } from '@/components/model/online-toggle';
import { Badge } from '@/components/ui/badge';
import { requireModel } from '@/lib/auth/guards';
import { KYC_STATUS_LABELS } from '@/lib/constants';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

const KYC_VARIANT: Record<string, any> = {
  APPROVED: 'success',
  PENDING: 'warning',
  REJECTED: 'destructive',
  NOT_SUBMITTED: 'muted',
  EXPIRED: 'destructive',
};

export default async function ModelDashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { profile } = await requireModel();

  const [pendingBookings, pendingRequests] = await Promise.all([
    prisma.booking.count({
      where: { modelId: profile.id, status: 'PENDING_CONFIRMATION' },
    }),
    prisma.contentRequest.count({
      where: { modelId: profile.id, status: { in: ['PENDING', 'PAID'] } },
    }),
  ]);

  const sections: SidebarSection[] = [
    {
      links: [
        {
          href: '/dashboard/model',
          label: 'Resumen',
          icon: 'layout',
          exact: true,
        },
        {
          href: '/dashboard/model/bookings',
          label: 'Reservas',
          icon: 'calendar',
          badge: pendingBookings,
        },
        { href: '/dashboard/model/content', label: 'Contenido', icon: 'images' },
        {
          href: '/dashboard/model/requests',
          label: 'Pedidos a medida',
          icon: 'gift',
          badge: pendingRequests,
        },
        { href: '/dashboard/model/messages', label: 'Mensajes', icon: 'messageCircle' },
      ],
    },
    {
      title: 'Ingresos',
      links: [
        { href: '/dashboard/model/earnings', label: 'Ganancias', icon: 'coins' },
        { href: '/dashboard/model/payouts', label: 'Retiros', icon: 'wallet' },
      ],
    },
    {
      title: 'Cuenta',
      links: [
        { href: '/dashboard/model/rates', label: 'Tarifas y perfil', icon: 'settings' },
        { href: '/dashboard/model/kyc', label: 'Verificacion KYC', icon: 'badgeCheck' },
      ],
    },
  ];

  return (
    <div className="container py-8">
      <div className="grid gap-8 lg:grid-cols-[240px_1fr]">
        <aside className="space-y-6">
          <div className="rounded-xl border border-border bg-card p-4">
            <p className="truncate font-semibold">{profile.stageName}</p>
            <Badge
              variant={KYC_VARIANT[profile.kycStatus] ?? 'muted'}
              className="mt-2"
            >
              KYC: {KYC_STATUS_LABELS[profile.kycStatus]}
            </Badge>
            <div className="mt-4">
              <OnlineToggle
                isOnline={profile.isOnline}
                isAvailableForVip={profile.isAvailableForVip}
                isVipEnabled={profile.isVipEnabled}
                canStream={profile.kycStatus === 'APPROVED'}
              />
            </div>
          </div>

          <DashboardSidebar sections={sections} />
        </aside>

        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}
