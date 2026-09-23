import type { Metadata } from 'next';
import type { Prisma } from '@prisma/client';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { requireAdmin } from '@/lib/auth/guards';
import { TRANSACTION_TYPE_LABELS } from '@/lib/constants';
import { prisma } from '@/lib/prisma';
import { formatDateTime, formatMoney, formatTokens } from '@/lib/utils';

export const metadata: Metadata = { title: 'Transacciones' };
export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;

export default async function AdminTransactionsPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; page?: string }>;
}) {
  await requireAdmin();
  const params = await searchParams;
  const page = Math.max(1, Number(params.page) || 1);

  const where: Prisma.TransactionWhereInput = params.type
    ? { type: params.type as any }
    : {};

  const [transactions, total, byType] = await Promise.all([
    prisma.transaction.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        user: {
          select: {
            name: true,
            email: true,
            role: true,
            modelProfile: { select: { stageName: true } },
          },
        },
      },
    }),
    prisma.transaction.count({ where }),
    prisma.transaction.groupBy({
      by: ['type'],
      _sum: { tokens: true, amountCents: true },
      _count: true,
    }),
  ]);

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Transacciones</h1>
        <p className="mt-2 text-muted-foreground">
          {formatTokens(total)} movimientos registrados en el libro mayor.
        </p>
      </div>

      {/* Resumen por tipo */}
      <Card>
        <CardHeader>
          <CardTitle>Resumen por tipo</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {byType
              .sort((a, b) => Math.abs(b._sum.tokens ?? 0) - Math.abs(a._sum.tokens ?? 0))
              .map((row) => (
                <a
                  key={row.type}
                  href={`/admin/transactions?type=${row.type}`}
                  className={`rounded-lg border p-3 transition-colors hover:border-primary/50 ${
                    params.type === row.type ? 'border-primary' : 'border-border'
                  }`}
                >
                  <p className="text-xs font-medium text-muted-foreground">
                    {TRANSACTION_TYPE_LABELS[row.type]}
                  </p>
                  <p
                    className={`mt-1 text-lg font-bold ${
                      (row._sum.tokens ?? 0) >= 0
                        ? 'text-emerald-400'
                        : 'text-rose-400'
                    }`}
                  >
                    {formatTokens(row._sum.tokens ?? 0)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {row._count} movimientos
                    {row._sum.amountCents
                      ? ` · ${formatMoney(row._sum.amountCents)}`
                      : ''}
                  </p>
                </a>
              ))}
          </div>

          {params.type && (
            <a
              href="/admin/transactions"
              className="mt-4 inline-block text-sm text-primary hover:underline"
            >
              Quitar filtro
            </a>
          )}
        </CardContent>
      </Card>

      {/* Libro mayor */}
      <Card>
        <CardHeader>
          <CardTitle>Libro mayor</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fecha</TableHead>
                <TableHead>Cuenta</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Concepto</TableHead>
                <TableHead className="text-right">Tokens</TableHead>
                <TableHead className="text-right">Comision</TableHead>
                <TableHead className="text-right">Fiat</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {transactions.map((tx) => (
                <TableRow key={tx.id}>
                  <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                    {formatDateTime(tx.createdAt)}
                  </TableCell>
                  <TableCell className="max-w-[180px]">
                    <p className="truncate text-sm">
                      {tx.user.modelProfile?.stageName ?? tx.user.name ?? '-'}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {tx.user.email}
                    </p>
                  </TableCell>
                  <TableCell>
                    <Badge variant="muted" className="whitespace-nowrap">
                      {TRANSACTION_TYPE_LABELS[tx.type]}
                    </Badge>
                  </TableCell>
                  <TableCell className="max-w-[220px] truncate text-xs text-muted-foreground">
                    {tx.description ?? '-'}
                  </TableCell>
                  <TableCell
                    className={`text-right font-semibold ${
                      tx.tokens >= 0 ? 'text-emerald-400' : 'text-rose-400'
                    }`}
                  >
                    {tx.tokens >= 0 ? '+' : ''}
                    {formatTokens(tx.tokens)}
                  </TableCell>
                  <TableCell className="text-right text-xs text-muted-foreground">
                    {tx.platformFeeTokens > 0
                      ? formatTokens(tx.platformFeeTokens)
                      : '-'}
                  </TableCell>
                  <TableCell className="text-right text-xs">
                    {tx.amountCents
                      ? formatMoney(tx.amountCents, tx.currency ?? 'USD')
                      : '-'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {totalPages > 1 && (
            <nav className="mt-6 flex flex-wrap items-center justify-center gap-2">
              {Array.from({ length: Math.min(totalPages, 20) }, (_, i) => i + 1).map(
                (p) => (
                  <a
                    key={p}
                    href={`/admin/transactions?${params.type ? `type=${params.type}&` : ''}page=${p}`}
                    className={`flex h-9 min-w-9 items-center justify-center rounded-lg px-3 text-sm font-medium transition-colors ${
                      p === page
                        ? 'bg-primary text-primary-foreground'
                        : 'border border-border hover:bg-muted'
                    }`}
                  >
                    {p}
                  </a>
                ),
              )}
            </nav>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
