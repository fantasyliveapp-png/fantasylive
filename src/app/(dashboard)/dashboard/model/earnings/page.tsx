import type { Metadata } from 'next';
import { Coins, Gift, Images, Video } from 'lucide-react';

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
import { requireModel } from '@/lib/auth/guards';
import { TRANSACTION_TYPE_LABELS } from '@/lib/constants';
import { prisma } from '@/lib/prisma';
import { getWalletSummary, tokensToPayoutCents } from '@/lib/tokens';
import { formatDateTime, formatMoney, formatTokens } from '@/lib/utils';

export const metadata: Metadata = { title: 'Ganancias' };
export const dynamic = 'force-dynamic';

export default async function EarningsPage() {
  const { user } = await requireModel();

  const earningTypes = [
    'CALL_EARNING',
    'CONTENT_EARNING',
    'TIP_EARNING',
  ] as const;

  const [wallet, byType, transactions, monthly] = await Promise.all([
    getWalletSummary(user.id),
    prisma.transaction.groupBy({
      by: ['type'],
      where: { userId: user.id, type: { in: [...earningTypes] } },
      _sum: { tokens: true },
      _count: true,
    }),
    prisma.transaction.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    }),
    prisma.$queryRaw<Array<{ month: string; tokens: bigint }>>`
      SELECT to_char(date_trunc('month', "createdAt"), 'YYYY-MM') AS month,
             SUM(tokens)::bigint AS tokens
      FROM transactions
      WHERE "userId" = ${user.id}
        AND type IN ('CALL_EARNING', 'CONTENT_EARNING', 'TIP_EARNING')
      GROUP BY 1
      ORDER BY 1 DESC
      LIMIT 6
    `,
  ]);

  const sumFor = (type: string) =>
    byType.find((b) => b.type === type)?._sum.tokens ?? 0;

  const maxMonthly = Math.max(
    ...monthly.map((m) => Number(m.tokens)),
    1,
  );

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Ganancias</h1>
        <p className="mt-2 text-muted-foreground">
          Desglose de todos tus ingresos en la plataforma.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="border-token/40 bg-token/5">
          <CardContent className="pt-6">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Disponible para retirar
            </p>
            <p className="mt-2 text-3xl font-bold text-token">
              {formatTokens(wallet.balance)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              ≈ {formatMoney(tokensToPayoutCents(wallet.balance))}
            </p>
          </CardContent>
        </Card>

        <EarningCard
          icon={Video}
          label="Llamadas"
          tokens={sumFor('CALL_EARNING')}
        />
        <EarningCard
          icon={Images}
          label="Contenido"
          tokens={sumFor('CONTENT_EARNING')}
        />
        <EarningCard icon={Gift} label="Propinas" tokens={sumFor('TIP_EARNING')} />
      </div>

      {/* Grafico mensual simple */}
      <Card>
        <CardHeader>
          <CardTitle>Ingresos por mes</CardTitle>
        </CardHeader>
        <CardContent>
          {monthly.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Aun no hay datos suficientes.
            </p>
          ) : (
            <div className="space-y-3">
              {monthly.map((row) => {
                const tokens = Number(row.tokens);
                const width = Math.round((tokens / maxMonthly) * 100);
                return (
                  <div key={row.month} className="flex items-center gap-3">
                    <span className="w-16 shrink-0 text-xs text-muted-foreground">
                      {row.month}
                    </span>
                    <div className="h-6 flex-1 overflow-hidden rounded-md bg-muted">
                      <div
                        className="h-full gradient-brand"
                        style={{ width: `${Math.max(width, 2)}%` }}
                      />
                    </div>
                    <span className="w-24 shrink-0 text-right text-sm font-semibold text-token">
                      {formatTokens(tokens)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Historial */}
      <Card>
        <CardHeader>
          <CardTitle>Movimientos recientes</CardTitle>
        </CardHeader>
        <CardContent>
          {transactions.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Sin movimientos todavia.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Concepto</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead className="text-right">Tokens</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {transactions.map((tx) => (
                  <TableRow key={tx.id}>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {formatDateTime(tx.createdAt)}
                    </TableCell>
                    <TableCell className="max-w-[300px] truncate text-sm">
                      {tx.description ?? '-'}
                    </TableCell>
                    <TableCell>
                      <Badge variant="muted" className="whitespace-nowrap">
                        {TRANSACTION_TYPE_LABELS[tx.type]}
                      </Badge>
                    </TableCell>
                    <TableCell
                      className={`text-right font-semibold ${
                        tx.tokens >= 0 ? 'text-emerald-400' : 'text-rose-400'
                      }`}
                    >
                      {tx.tokens >= 0 ? '+' : ''}
                      {formatTokens(tx.tokens)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function EarningCard({
  icon: Icon,
  label,
  tokens,
}: {
  icon: typeof Coins;
  label: string;
  tokens: number;
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <Icon className="h-4 w-4" /> {label}
        </p>
        <p className="mt-2 text-3xl font-bold">{formatTokens(tokens)}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          ≈ {formatMoney(tokensToPayoutCents(tokens))}
        </p>
      </CardContent>
    </Card>
  );
}
