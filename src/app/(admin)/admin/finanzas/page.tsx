import type { Metadata } from 'next';
import { Download } from 'lucide-react';

import { AdminPageHeader } from '@/components/admin/admin-shell';
import { Panel } from '@/components/admin/admin-ui';
import { requireAdmin } from '@/lib/auth/guards';
import { getLiabilities, getMonthlyFinance } from '@/lib/finance';
import { cn, formatMoney, formatTokens } from '@/lib/utils';

export const metadata: Metadata = { title: 'Finanzas' };
export const dynamic = 'force-dynamic';

/** FINANZAS: numeros por mes, lo que se debe hoy y descargas para el contador. */
export default async function AdminFinancePage() {
  await requireAdmin();
  const [rows, owed] = await Promise.all([getMonthlyFinance(12), getLiabilities()]);
  const current = rows[0]!;
  const monthName = (m: string) =>
    new Intl.DateTimeFormat('es', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
      new Date(`${m}-01T00:00:00Z`),
    );
  const total = rows.reduce(
    (a, r) => ({
      sales: a.sales + r.salesCents,
      creators: a.creators + r.creatorEarnedCents,
      referral: a.referral + r.referralCents,
      commission: a.commission + r.commissionCents,
      paid: a.paid + r.payoutsPaidCents,
      fees: a.fees + r.payoutFeesCents,
    }),
    { sales: 0, creators: 0, referral: 0, commission: 0, paid: 0, fees: 0 },
  );

  return (
    <>
      <AdminPageHeader
        title="Finanzas"
        description="Lo que entra, lo que ganan las creadoras, lo que te quedas y lo que debes. Descarga los CSV para tu contador."
        actions={
          <a
            href="/admin/finanzas/export"
            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-white/[0.06] px-3 text-sm font-medium hover:bg-white/[0.1]"
          >
            <Download className="h-4 w-4" /> Resumen 12 meses (CSV)
          </a>
        }
      />

      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label={`Ventas en ${monthName(current.month)}`} value={formatMoney(current.salesCents)} hint={`${current.purchases} compras`} />
          <Stat label="Tu comision este mes" value={formatMoney(current.commissionCents + current.payoutFeesCents)} hint="Ventas + comision de retiros" />
          <Stat
            label="Debes a creadoras"
            value={formatMoney(owed.earnedNotWithdrawnCents + owed.payoutsPendingCents)}
            hint={`${formatMoney(owed.payoutsPendingCents)} en ${owed.payoutsPendingCount} retiros pedidos`}
            warn
          />
          <Stat
            label="Tokens sin gastar"
            value={formatTokens(owed.unspentTokens)}
            hint="Comprados por fans; no se pueden retirar"
          />
        </div>

        <Panel title="Mes a mes" aside="Ultimos 12 meses · USD">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                <tr className="border-b border-white/[0.06]">
                  <th className="px-5 py-2 font-medium">Mes</th>
                  <th className="px-3 py-2 text-right font-medium">Ventas</th>
                  <th className="px-3 py-2 text-right font-medium">Creadoras ganaron</th>
                  <th className="px-3 py-2 text-right font-medium">Referidos</th>
                  <th className="px-3 py-2 text-right font-medium">Tu comision</th>
                  <th className="px-3 py-2 text-right font-medium">Retiros pagados</th>
                  <th className="px-5 py-2 text-right font-medium">Detalle</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.06] tabular-nums">
                {rows.map((r) => {
                  const empty = !r.salesCents && !r.creatorEarnedCents && !r.payoutsPaidCents;
                  return (
                    <tr key={r.month} className={cn(empty && 'text-muted-foreground')}>
                      <td className="px-5 py-2.5 first-letter:uppercase">{monthName(r.month)}</td>
                      <td className="px-3 py-2.5 text-right font-medium">{formatMoney(r.salesCents)}</td>
                      <td className="px-3 py-2.5 text-right">{formatMoney(r.creatorEarnedCents)}</td>
                      <td className="px-3 py-2.5 text-right">{formatMoney(r.referralCents)}</td>
                      <td className="px-3 py-2.5 text-right text-state-connected">
                        {formatMoney(r.commissionCents + r.payoutFeesCents)}
                      </td>
                      <td className="px-3 py-2.5 text-right">{formatMoney(r.payoutsPaidCents)}</td>
                      <td className="px-5 py-2.5 text-right">
                        <a
                          href={`/admin/finanzas/export?mes=${r.month}`}
                          className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                        >
                          <Download className="h-3 w-3" /> CSV
                        </a>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t border-white/[0.1] font-semibold tabular-nums">
                  <td className="px-5 py-2.5">Total 12 meses</td>
                  <td className="px-3 py-2.5 text-right">{formatMoney(total.sales)}</td>
                  <td className="px-3 py-2.5 text-right">{formatMoney(total.creators)}</td>
                  <td className="px-3 py-2.5 text-right">{formatMoney(total.referral)}</td>
                  <td className="px-3 py-2.5 text-right text-state-connected">
                    {formatMoney(total.commission + total.fees)}
                  </td>
                  <td className="px-3 py-2.5 text-right">{formatMoney(total.paid)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        </Panel>

        <Panel title="Como leer esto">
          <ul className="space-y-1.5 px-5 py-4 text-xs text-muted-foreground">
            <li>
              <span className="text-foreground">Ventas:</span> dinero real que pagaron los fans por
              tokens (antes de lo que cobre la pasarela de pago).
            </li>
            <li>
              <span className="text-foreground">Creadoras ganaron:</span> lo que se llevaron por sus
              ventas, al valor de retiro. Es dinero que les debes hasta que lo retiran.
            </li>
            <li>
              <span className="text-foreground">Tu comision:</span> tu parte de cada venta mas la
              comision del 10% al retirar, ya descontado lo que cobran embajadoras y reclutadores.
            </li>
            <li>
              <span className="text-foreground">Tokens sin gastar:</span> los fans ya pagaron por
              ellos pero aun no los usaron. Tenlo en cuenta por si piden devoluciones.
            </li>
            <li>
              El CSV de cada mes trae todos los movimientos, uno por linea, para tu contador.
            </li>
          </ul>
        </Panel>
      </div>
    </>
  );
}

function Stat({
  label,
  value,
  hint,
  warn,
}: {
  label: string;
  value: string;
  hint?: string;
  warn?: boolean;
}) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-[#141417] p-4">
      <p className="text-xs text-muted-foreground first-letter:uppercase">{label}</p>
      <p className={cn('mt-1.5 text-2xl font-semibold tabular-nums', warn && 'text-amber-500')}>{value}</p>
      {hint && <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}
