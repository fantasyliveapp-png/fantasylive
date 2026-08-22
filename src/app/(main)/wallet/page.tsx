import type { Metadata } from 'next';
import { ArrowDownRight, ArrowUpRight, Coins, TrendingUp } from 'lucide-react';

import { TokenPackages } from '@/components/wallet/token-packages';
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
import { requireUser } from '@/lib/auth/guards';
import { TRANSACTION_TYPE_LABELS } from '@/lib/constants';
import { prisma } from '@/lib/prisma';
import { getWalletSummary } from '@/lib/tokens';
import { formatDateTime, formatTokens } from '@/lib/utils';

export const metadata: Metadata = { title: 'Monedero' };
export const dynamic = 'force-dynamic';

export default async function WalletPage({
  searchParams,
}: {
  searchParams: Promise<{ purchase?: string; reason?: string }>;
}) {
  const params = await searchParams;
  const user = await requireUser('/wallet');

  const [wallet, packages, transactions] = await Promise.all([
    getWalletSummary(user.id),
    prisma.tokenPackage.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
    }),
    prisma.transaction.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      take: 40,
    }),
  ]);

  return (
    <div className="container py-10">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Monedero</h1>
        <p className="mt-2 text-muted-foreground">
          Los tokens sirven para llamadas VIP, privados, contenido y propinas.
        </p>
      </div>

      {params.purchase === 'success' && (
        <div className="mb-6 rounded-lg border border-emerald-600/30 bg-emerald-600/10 px-4 py-3 text-sm text-emerald-400">
          Pago confirmado. Tus tokens se acreditaran en unos segundos.
        </div>
      )}
      {params.reason === 'insufficient' && (
        <div className="mb-6 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          Tu ultima llamada termino por falta de saldo. Recarga para continuar.
        </div>
      )}

      {/* Resumen */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="border-token/40 bg-token/5">
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <Coins className="h-4 w-4 text-token" />
              Saldo disponible
            </div>
            <p className="mt-2 text-4xl font-bold text-token">
              {formatTokens(wallet.balance)}
            </p>
          </CardContent>
        </Card>

        <SummaryCard
          icon={ArrowDownRight}
          label="Comprado"
          value={wallet.lifetimePurchased}
          tone="text-emerald-400"
        />
        <SummaryCard
          icon={ArrowUpRight}
          label="Gastado"
          value={wallet.lifetimeSpent}
          tone="text-rose-400"
        />
        <SummaryCard
          icon={TrendingUp}
          label="Ganado"
          value={wallet.lifetimeEarned}
          tone="text-sky-400"
        />
      </div>

      {/* Paquetes */}
      <section className="mt-12">
        <h2 className="text-xl font-semibold">Recargar tokens</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Pago seguro. Los tokens no caducan.
        </p>
        <div className="mt-6">
          <TokenPackages packages={packages} />
        </div>
      </section>

      {/* Historial */}
      <section className="mt-14">
        <Card>
          <CardHeader>
            <CardTitle>Historial de movimientos</CardTitle>
          </CardHeader>
          <CardContent>
            {transactions.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Todavia no tienes movimientos.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fecha</TableHead>
                    <TableHead>Concepto</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead className="text-right">Tokens</TableHead>
                    <TableHead className="text-right">Saldo</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {transactions.map((tx) => (
                    <TableRow key={tx.id}>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {formatDateTime(tx.createdAt)}
                      </TableCell>
                      <TableCell className="max-w-[280px] truncate text-sm">
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
                      <TableCell className="text-right text-sm text-muted-foreground">
                        {tx.balanceAfter !== null
                          ? formatTokens(tx.balanceAfter)
                          : '-'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

function SummaryCard({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof Coins;
  label: string;
  value: number;
  tone: string;
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <Icon className={`h-4 w-4 ${tone}`} />
          {label}
        </div>
        <p className="mt-2 text-3xl font-bold">{formatTokens(value)}</p>
      </CardContent>
    </Card>
  );
}
