import type { Metadata } from 'next';
import { Coins, DollarSign, PieChart } from 'lucide-react';

import { PayoutRequestForm } from '@/components/model/payout-request-form';
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
import { config } from '@/lib/config';
import { PAYOUT_STATUS_LABELS } from '@/lib/constants';
import { PAYOUT_METHOD_LABELS } from '@/lib/payout-methods';
import { prisma } from '@/lib/prisma';
import { getWalletSummary, tokensToPayoutCents } from '@/lib/tokens';
import { formatDateTime, formatMoney, formatTokens } from '@/lib/utils';

export const metadata: Metadata = { title: 'Retiros' };
export const dynamic = 'force-dynamic';

const STATUS_VARIANT: Record<string, any> = {
  REQUESTED: 'warning',
  APPROVED: 'secondary',
  PROCESSING: 'secondary',
  PAID: 'success',
  REJECTED: 'destructive',
};

const OPEN_STATUSES = ['REQUESTED', 'APPROVED', 'PROCESSING'] as const;

export default async function PayoutsPage() {
  const { user, profile } = await requireModel();

  const [wallet, payouts] = await Promise.all([
    getWalletSummary(user.id),
    prisma.payoutRequest.findMany({
      where: { modelId: profile.id },
      orderBy: { requestedAt: 'desc' },
      take: 50,
    }),
  ]);

  const hasOpenRequest = payouts.some((p) =>
    (OPEN_STATUSES as readonly string[]).includes(p.status),
  );

  const centsPerToken = config.economy.modelPayoutCentsPerToken;
  const availableCents = tokensToPayoutCents(wallet.balance);
  const withdrawnCents = tokensToPayoutCents(wallet.lifetimeWithdrawn);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Retiros</h1>
        <p className="mt-2 text-muted-foreground">
          Convierte tus tokens en dolares. Minimo{' '}
          {formatTokens(config.economy.minPayoutTokens)} tokens por solicitud.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <SummaryCard
          icon={<Coins className="h-4 w-4 text-token" />}
          label="Tokens disponibles"
          value={formatTokens(wallet.balance)}
          hint={`${formatMoney(centsPerToken)} por token`}
        />
        <SummaryCard
          icon={<DollarSign className="h-4 w-4 text-emerald-400" />}
          label="Equivale a"
          value={formatMoney(availableCents)}
          hint={`Retirado hasta hoy: ${formatMoney(withdrawnCents)}`}
          highlight
        />
        <SummaryCard
          icon={<PieChart className="h-4 w-4 text-primary" />}
          label="Tu reparto"
          value={`${config.economy.modelRevenueSharePercent}%`}
          hint={`La plataforma retiene el ${config.economy.platformCommissionPercent}% de cada gasto`}
        />
      </div>

      <PayoutRequestForm
        balance={wallet.balance}
        minTokens={config.economy.minPayoutTokens}
        centsPerToken={centsPerToken}
        kycApproved={profile.kycStatus === 'APPROVED'}
        hasOpenRequest={hasOpenRequest}
      />

      <Card>
        <CardHeader>
          <CardTitle>Historial de retiros</CardTitle>
        </CardHeader>
        <CardContent>
          {payouts.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Todavia no has solicitado ningun retiro.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fecha</TableHead>
                    <TableHead>Metodo</TableHead>
                    <TableHead>Destino</TableHead>
                    <TableHead className="text-right">Tokens</TableHead>
                    <TableHead className="text-right">Importe</TableHead>
                    <TableHead>Estado</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payouts.map((payout) => (
                    <TableRow key={payout.id}>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {formatDateTime(payout.requestedAt)}
                      </TableCell>
                      <TableCell className="text-sm">
                        {PAYOUT_METHOD_LABELS[payout.method] ?? payout.method}
                      </TableCell>
                      {/* Solo la mascara: los datos completos estan cifrados y
                          no se descifran para mostrar el historial. */}
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {payout.destinationMasked ?? 'Guardado cifrado'}
                      </TableCell>
                      <TableCell className="text-right font-semibold">
                        {formatTokens(payout.tokens)}
                      </TableCell>
                      <TableCell className="text-right font-semibold text-emerald-400">
                        {formatMoney(payout.amountCents, payout.currency)}
                      </TableCell>
                      <TableCell>
                        <Badge variant={STATUS_VARIANT[payout.status] ?? 'muted'}>
                          {PAYOUT_STATUS_LABELS[payout.status]}
                        </Badge>
                        {payout.rejectionReason && (
                          <p className="mt-1 max-w-[200px] text-xs text-destructive">
                            {payout.rejectionReason}
                          </p>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SummaryCard({
  icon,
  label,
  value,
  hint,
  highlight = false,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint: string;
  highlight?: boolean;
}) {
  return (
    <Card className={highlight ? 'border-emerald-500/40 bg-emerald-500/5' : undefined}>
      <CardContent className="pt-6">
        <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {icon}
          {label}
        </p>
        <p
          className={`mt-2 text-3xl font-bold ${highlight ? 'text-emerald-400' : ''}`}
        >
          {value}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
      </CardContent>
    </Card>
  );
}
