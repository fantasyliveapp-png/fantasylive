import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, Receipt } from 'lucide-react';

import { AdminPageHeader } from '@/components/admin/admin-shell';
import { RecruiterRow } from '@/components/admin/recruiter-admin';
import {
  MonthlyEarnings,
  PaymentHistory,
  RecruitEarnings,
  SummaryStat,
} from '@/components/recruiter/recruiter-stats';
import { Button } from '@/components/ui/button';
import { requireAdmin } from '@/lib/auth/guards';
import { config } from '@/lib/config';
import { getRecruiterOverview, termsLabel } from '@/lib/recruiters';
import { tokensToPayoutCents } from '@/lib/tokens';
import { formatDate, formatMoney } from '@/lib/utils';

export const metadata: Metadata = { title: 'Reclutador' };
export const dynamic = 'force-dynamic';

/**
 * FICHA DE UN RECLUTADOR: sus cifras, lo que ha generado cada creadora que
 * trajo, mes a mes, sus pagos, y la gestion (condiciones, pausar, pagar).
 */
export default async function RecruiterDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const r = await getRecruiterOverview(id);
  if (!r) notFound();

  const baseUrl = config.app.url.replace(/\/$/, '');
  const minPayoutCents = tokensToPayoutCents(config.economy.minPayoutTokens);
  const earning = r.recruits.filter((c) => c.earnedCents > 0).length;

  return (
    <div className="space-y-6">
      <Link
        href="/admin/reclutadores"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Reclutadores
      </Link>
      <AdminPageHeader
        title={`@${r.account.username ?? r.code}`}
        description={
          <>
            {r.account.email} · desde {formatDate(r.createdAt)}
            {!r.active && ' · PAUSADO'}
            <br />
            {termsLabel(r)}
          </>
        }
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href={`/admin/reclutadores/ventas?r=${r.id}`}>
              <Receipt className="h-4 w-4" /> Ventas de sus creadores
            </Link>
          </Button>
        }
      />

      <section className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <SummaryStat
          label="Este mes"
          value={formatMoney(r.totals.earnedThisMonthCents)}
          hint={`Mes pasado: ${formatMoney(r.totals.earnedLastMonthCents)}`}
        />
        <SummaryStat
          label="Comision total"
          value={formatMoney(r.totals.earnedCents)}
          hint={`${r.totals.salesCount} ventas`}
        />
        <SummaryStat label="Ya pagado" value={formatMoney(r.totals.paidCents)} hint={`${r.payments.length} pagos`} />
        <SummaryStat
          label="Por pagar"
          value={formatMoney(r.totals.pendingCents)}
          hint={
            config.economy.payoutFeePercent > 0
              ? `Recibe ${formatMoney(r.totals.payNowCents)} (−${config.economy.payoutFeePercent}%)`
              : undefined
          }
          highlight
        />
        <SummaryStat label="Creadores registrados" value={String(r.totals.registered)} />
        <SummaryStat label="Verificadas" value={String(r.totals.verified)} />
        <SummaryStat label="Que ya venden" value={String(earning)} />
        <SummaryStat
          label="Cupo"
          value={r.maxCreators == null ? 'Sin tope' : `${Math.min(r.totals.registered, r.maxCreators)}/${r.maxCreators}`}
        />
      </section>

      <section>
        <h2 className="mb-2.5 text-sm font-semibold">Ganancias por creador</h2>
        <RecruitEarnings
          recruits={r.recruits}
          months={r.months}
          linkProfiles
          emptyText="Aun nadie se ha registrado con su enlace."
        />
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <MonthlyEarnings monthly={r.monthly} />
        <section>
          <h2 className="mb-2.5 text-sm font-semibold">Historial de pagos</h2>
          <PaymentHistory payments={r.payments} showNotes />
        </section>
      </div>

      <section>
        <h2 className="mb-2.5 text-sm font-semibold">Gestionar</h2>
        <ul>
          <RecruiterRow r={r} baseUrl={baseUrl} minPayoutCents={minPayoutCents} detail />
        </ul>
      </section>
    </div>
  );
}
