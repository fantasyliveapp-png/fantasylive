import type { Metadata } from 'next';
import type { Prisma } from '@prisma/client';

import { UserModerationTable } from '@/components/admin/user-moderation-table';
import { Card, CardContent } from '@/components/ui/card';
import { requireAdmin } from '@/lib/auth/guards';
import { prisma } from '@/lib/prisma';

export const metadata: Metadata = { title: 'Usuarios y modelos' };
export const dynamic = 'force-dynamic';

const PAGE_SIZE = 30;

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; role?: string; status?: string; page?: string }>;
}) {
  await requireAdmin();
  const params = await searchParams;
  const page = Math.max(1, Number(params.page) || 1);

  const where: Prisma.UserWhereInput = {};
  if (params.q) {
    where.OR = [
      { email: { contains: params.q, mode: 'insensitive' } },
      { name: { contains: params.q, mode: 'insensitive' } },
      { username: { contains: params.q, mode: 'insensitive' } },
    ];
  }
  if (params.role) where.role = params.role as any;
  if (params.status) where.status = params.status as any;

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        email: true,
        name: true,
        image: true,
        role: true,
        status: true,
        isVip: true,
        country: true,
        createdAt: true,
        lastSeenAt: true,
        banReason: true,
        wallet: { select: { balance: true, lifetimeSpent: true } },
        modelProfile: {
          select: { stageName: true, slug: true, kycStatus: true, isOnline: true },
        },
      },
    }),
    prisma.user.count({ where }),
  ]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Usuarios y modelos</h1>
        <p className="mt-2 text-muted-foreground">
          {total} cuentas registradas. Suspende, banea o promociona a VIP.
        </p>
      </div>

      {users.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-sm text-muted-foreground">
            No hay resultados para esa busqueda.
          </CardContent>
        </Card>
      ) : (
        <UserModerationTable
          users={users.map((u) => ({
            id: u.id,
            email: u.email,
            name: u.name,
            image: u.image,
            role: u.role,
            status: u.status,
            isVip: u.isVip,
            country: u.country,
            createdAt: u.createdAt.toISOString(),
            lastSeenAt: u.lastSeenAt?.toISOString() ?? null,
            banReason: u.banReason,
            balance: u.wallet?.balance ?? 0,
            lifetimeSpent: u.wallet?.lifetimeSpent ?? 0,
            stageName: u.modelProfile?.stageName ?? null,
            slug: u.modelProfile?.slug ?? null,
            kycStatus: u.modelProfile?.kycStatus ?? null,
            isOnline: u.modelProfile?.isOnline ?? false,
          }))}
          page={page}
          totalPages={Math.ceil(total / PAGE_SIZE)}
        />
      )}
    </div>
  );
}
