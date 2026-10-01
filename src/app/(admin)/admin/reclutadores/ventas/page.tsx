import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft, ChevronLeft, ChevronRight } from 'lucide-react';

import { AdminPageHeader } from '@/components/admin/admin-shell';
import { SummaryStat } from '@/components/recruiter/recruiter-stats';
import { Button } from '@/components/ui/button';
import { requireAdmin } from '@/lib/auth/guards';
import { getRecruiterSales, type SaleRecruiterStatus } from '@/lib/recruiter-sales';
import { monthLabel } from '@/lib/recruiters';
import { cn, formatDate, formatDateTime, formatMoney } from '@/lib/utils';

export const metadata: Metadata = { title: 'Ventas de reclutados' };
export const dynamic = 'force-dynamic';

const STATUS: Record<Exclude<SaleRecruiterStatus, 'earns' | 'accruing'>, string> = {
  expired: 'Fuera de plazo',
  out_of_quota: 'Fuera de cupo',
  paused: 'Reclutador pausado',
  self: 'Compra del propio reclutador',
  none: 'Sin comision registrada',
};

/**
 * VENTAS DE LAS CREADORAS RECLUTADAS: cada venta con lo que se lleva la
 * creadora, el reclutador (y si le toca o por que no) y la plataforma, y si
 * la parte del reclutador ya se le pago.
 */
export default async function RecruiterSalesPage({
  searchParams,
}: {
  searchParams: Promise<{ r?: string; c?: string; m?: string; p?: string }>;
}) {
  await requireAdmin();
  const sp = await searchParams;
  const data = await getRecruiterSales({
    recruiterId: sp.r || undefined,
    creatorId: sp.c || undefined,
    month: sp.m || undefined,
    page: Number(sp.p) || 1,
  });
  const { summary: s } = data;

  const now = new Date();
  const months = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  });
  const creatorOptions = sp.r ? data.creators.filter((c) => c.recruiterId === sp.r) : data.creators;
  const pageHref = (p: number) => {
    const q = new URLSearchParams();
    if (sp.r) q.set('r', sp.r);
    if (sp.c) q.set('c', sp.c);
    if (sp.m) q.set('m', sp.m);
    q.set('p', String(p));
    return `/admin/reclutadores/ventas?${q}`;
  };

  return (
    <div className="space-y-6">
      <Link
        href={sp.r ? `/admin/reclutadores/${sp.r}` : '/admin/reclutadores'}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> {sp.r ? 'Ficha del reclutador' : 'Reclutadores'}
      </Link>
      <AdminPageHeader
        title="Ventas de creadores reclutados"
        description="Cada venta de los creadores que trajo un reclutador: cuanto se vendio, que se lleva cada parte, si al reclutador le toca comision (o por que no) y si ya se le pago."
      />

      <form method="get" className="flex flex-wrap items-end gap-3 rounded-2xl border border-border/60 bg-card p-4">
        <Select name="r" label="Reclutador" value={sp.r}>
          <option value="">Todos</option>
          {data.recruiters.map((r) => (
            <option key={r.id} value={r.id}>
              @{r.handle}
            </option>
          ))}
        </Select>
        <Select name="c" label="Creador" value={sp.c}>
          <option value="">Todas</option>
          {creatorOptions.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        <Select name="m" label="Mes" value={sp.m}>
          <option value="">Todo</option>
          {months.map((m) => (
            <option key={m} value={m}>
              {monthLabel(m)}
            </option>
          ))}
        </Select>
        <Button type="submit" variant="brand" size="sm">
          Filtrar
        </Button>
        {(sp.r || sp.c || sp.m) && (
          <Link href="/admin/reclutadores/ventas" className="pb-2 text-xs text-muted-foreground hover:text-foreground">
            Quitar filtros
          </Link>
        )}
      </form>

      <section className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <SummaryStat label="Ventas" value={String(s.count)} hint={`${s.withoutCommission} sin comision`} />
        <SummaryStat label="Vendido" value={formatMoney(s.grossCents)} />
        <SummaryStat label="Para los creadores" value={formatMoney(s.creatorCents)} />
        <SummaryStat
          label="Para reclutadores"
          value={formatMoney(s.commission.earnedCents)}
          hint={`Ya en su saldo: ${formatMoney(s.recruiterCents)}`}
          highlight
        />
        <SummaryStat label="Para la plataforma" value={formatMoney(s.platformCents)} />
        <SummaryStat
          label="Reclutador: por pagar"
          value={formatMoney(s.recruiterUnpaidCents)}
          hint={`Ya pagado: ${formatMoney(s.recruiterPaidCents)}`}
        />
      </section>

      {s.count > 0 && (
        <section className="rounded-2xl border border-border/60 bg-card p-4 text-sm">
          <p className="font-semibold">Cuadre de la comision del reclutador</p>
          <dl className="mt-2 space-y-1 tabular-nums">
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Su % de todo lo vendido ({formatMoney(s.grossCents)})</dt>
              <dd className="font-medium">{formatMoney(s.commission.fullCents)}</dd>
            </div>
            {s.commission.excluded.map((x) => (
              <div key={x.reason} className="flex justify-between gap-4">
                <dt className="text-muted-foreground">
                  − No le toca: {STATUS[x.reason].toLowerCase()} ({x.count} ventas)
                </dt>
                <dd>−{formatMoney(x.cents)}</dd>
              </div>
            ))}
            <div className="flex justify-between gap-4 border-t border-border/60 pt-1 font-semibold">
              <dt>Le corresponde</dt>
              <dd className="text-state-connected">{formatMoney(s.commission.earnedCents)}</dd>
            </div>
          </dl>
        </section>
      )}

      {s.anyEstimated && (
        <p className="text-xs text-muted-foreground">
          * Ventas anteriores a que se guardara el desglose: el importe vendido y la parte de la
          plataforma son estimados con la comision actual. La parte del creador y la del
          reclutador son exactas.
        </p>
      )}

      {data.sales.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border/60 p-8 text-center text-sm text-muted-foreground">
          No hay ventas con estos filtros.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border/60 bg-card">
          <table className="w-full min-w-[920px] text-sm">
            <thead>
              <tr className="border-b border-border/60 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-2 font-medium">Fecha</th>
                <th className="px-4 py-2 font-medium">Creador</th>
                <th className="px-4 py-2 font-medium">Venta</th>
                <th className="px-4 py-2 text-right font-medium">Importe</th>
                <th className="px-4 py-2 text-right font-medium">Creador</th>
                <th className="px-4 py-2 font-medium">Reclutador</th>
                <th className="px-4 py-2 text-right font-medium">Plataforma</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {data.sales.map((sale) => (
                <tr key={sale.id} className="align-top">
                  <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{formatDateTime(sale.date)}</td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/reclutadores/ventas?r=${sale.recruiter.id}&c=${sale.creator.id}`}
                      className="font-medium hover:underline"
                    >
                      {sale.creator.name}
                    </Link>
                    <p className="text-xs text-muted-foreground">de @{sale.recruiter.handle}</p>
                  </td>
                  <td className="px-4 py-3">
                    {sale.typeLabel}
                    {sale.fan && <p className="text-xs text-muted-foreground">{sale.fan}</p>}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                    {formatMoney(sale.grossCents)}
                    {sale.estimated && <span className="text-muted-foreground">*</span>}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                    {formatMoney(sale.creatorCents)}
                  </td>
                  <td className="px-4 py-3">
                    <p
                      className={cn(
                        'tabular-nums',
                        sale.status === 'earns' || sale.status === 'accruing'
                          ? 'font-semibold text-state-connected'
                          : 'text-muted-foreground line-through',
                      )}
                    >
                      {formatCommission(sale.commissionCents)}{' '}
                      <span className="text-xs font-normal text-muted-foreground no-underline">
                        ({sale.recruiter.percent}%)
                      </span>
                    </p>
                    <p
                      className={cn(
                        'text-xs',
                        sale.status === 'earns' && !sale.paidOn ? 'text-amber-500' : 'text-muted-foreground',
                      )}
                    >
                      {sale.status === 'earns'
                        ? sale.paidOn
                          ? `Pagado el ${formatDate(sale.paidOn)}`
                          : 'Pendiente de pago'
                        : sale.status === 'accruing'
                          ? 'Se acumula hasta completar 1 token'
                          : `No le toca · ${STATUS[sale.status]}`}
                    </p>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-muted-foreground">
                    {formatMoney(sale.platformCents)}
                    {sale.estimated && '*'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data.pages > 1 && (
        <nav className="flex items-center justify-center gap-3 text-sm">
          {data.page > 1 ? (
            <Link href={pageHref(data.page - 1)} className="inline-flex items-center gap-1 hover:text-primary">
              <ChevronLeft className="h-4 w-4" /> Anterior
            </Link>
          ) : (
            <span />
          )}
          <span className="text-muted-foreground">
            Pagina {data.page} de {data.pages}
          </span>
          {data.page < data.pages && (
            <Link href={pageHref(data.page + 1)} className="inline-flex items-center gap-1 hover:text-primary">
              Siguiente <ChevronRight className="h-4 w-4" />
            </Link>
          )}
        </nav>
      )}

      <section className="rounded-2xl border border-border/60 bg-card p-4 text-xs text-muted-foreground">
        <p className="mb-1 font-semibold text-foreground">Cuando le toca al reclutador</p>
        <ul className="list-disc space-y-0.5 pl-4">
          <li>
            Le toca su % de <b>todo</b> lo que gana el creador: llamadas, reservas, regalos (tambien
            en directo), packs, suscripciones, pedidos a medida, chats y publicaciones. Sale de la
            comision de la plataforma.
          </li>
          <li>
            Si su % de una venta es menos de un token (p. ej. un tramo de llamada), se acumula y se
            le abona al completar el token entero.
          </li>
          <li>
            <b>Fuera de plazo</b>: el creador lleva mas meses de los pactados desde que se hizo
            creador. <b>Fuera de cupo</b>: ya tiene mas creadores de los pactados y este no cuenta.
          </li>
          <li>
            Lo que le toca se acumula en su saldo; se le paga todo junto desde la ficha del
            reclutador (&quot;Anotar pago&quot;) a partir del minimo de retiro.
          </li>
        </ul>
      </section>
    </div>
  );
}

/** Importe de comision con hasta 3 decimales (0,005 US$ de un tramo de llamada). */
function formatCommission(cents: number) {
  return new Intl.NumberFormat('es-ES', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 3,
  }).format(cents / 100);
}

function Select({
  name,
  label,
  value,
  children,
}: {
  name: string;
  label: string;
  value?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="space-y-1 text-xs text-muted-foreground">
      {label}
      <select
        name={name}
        defaultValue={value ?? ''}
        className="block h-9 min-w-40 rounded-md border border-input bg-background px-2 text-sm text-foreground"
      >
        {children}
      </select>
    </label>
  );
}
