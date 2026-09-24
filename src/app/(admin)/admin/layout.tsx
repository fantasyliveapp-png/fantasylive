import { AdminShell } from '@/components/admin/admin-shell';
import { getAdminCounts } from '@/lib/admin-overview';
import { requireAdmin } from '@/lib/auth/guards';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

/** El admin tiene su propio marco, separado de la app de fans. */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireAdmin();
  const [counts, me] = await Promise.all([
    getAdminCounts(),
    prisma.user.findUnique({
      where: { id: user.id },
      select: { name: true, username: true, email: true, image: true },
    }),
  ]);

  return (
    <AdminShell
      counts={counts}
      admin={{
        name: me?.name ?? me?.username ?? 'Admin',
        email: me?.email ?? user.email,
        image: me?.image ?? null,
      }}
    >
      {children}
    </AdminShell>
  );
}
