import type { Metadata } from 'next';

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
import { prisma } from '@/lib/prisma';
import { getWalletSummary } from '@/lib/tokens';
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

const METHOD_LABELS: Record<string, string> = {
  BANK_TRANSFER: 'Transferencia bancaria',
  PAYPAL: 'PayPal',
  CRYPTO: 'Cripto',
  PAXUM: 'Paxum',
};

export default async function PayoutsPage() {
  const { user, profile } = await requireModel();

  const [wallet, payouts] = await Promise.all([
    getWalletSummary(user.id),
    prisma.payoutRequest.findMany({
      where: { modelId: profile.id },
      orderBy: { requestedAt: 'desc' },
    }),
  ]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Retiros</h1>
        <p className="mt-2 text-muted-foreground">
          Convierte tus tokens en dinero. Minimo{' '}
          {formatTokens(config.economy.minPayoutTokens)} tokens por solicitud.
        </p>
      </div>

      <PayoutRequestForm
        balance={wallet.balance}
        minTokens={config.economy.minPayoutTokens}
        centsPerToken={config.economy.modelPayoutCentsPerToken}
        kycApproved={profile.kycStatus === 'APPROVED'}
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
                      {METHOD_LABELS[payout.method] ?? payout.method}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {payout.destination}
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
          )}
        </CardContent>
      </Card>
    </div>
  );
}
