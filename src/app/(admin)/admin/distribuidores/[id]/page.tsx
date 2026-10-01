import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, Download } from 'lucide-react';

import { AdminPageHeader } from '@/components/admin/admin-shell';
import { DistributorRow } from '@/components/admin/distributor-admin';
import { Kpi, SaleStatus, StatusPill, TableWrap, Td, Th } from '@/components/admin/distributor-dashboard-ui';
import { requireAdmin } from '@/lib/auth/guards';
import { countryFlag, countryName } from '@/lib/countries';
import { averageDiscounts, SALE_LIST_INCLUDE } from '@/lib/distributor-dashboard';
import { formatAmounts, formatLocal, paymentMethodLabel } from '@/lib/distributor-shared';
import { expireSales, isCompliant } from '@/lib/distributors';
import { config } from '@/lib/config';
import { prisma } from '@/lib/prisma';
import { cn, formatDateTime, formatMoney, formatTokens } from '@/lib/utils';

export const metadata: Metadata = { title: 'Ficha de distribuidor' };
export const dynamic = 'force-dynamic';

/** Ficha de un distribuidor: numeros, metodos y precios, lotes, ventas y fans. */
export default async function AdminDistributorPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  await expireSales();
  const { id } = await params;
  const d = await prisma.distributor.findUnique({
    where: { id },
    include: {
      user: { select: { id: true, username: true, email: true, createdAt: true } },
      accounts: {
        orderBy: [{ active: 'desc' }, { createdAt: 'asc' }],
        include: { packages: { where: { active: true }, orderBy: { tokens: 'asc' } } },
      },
    },
  });
  if (!d) notFound();

  const monthAgo = new Date(Date.now() - 30 * 24 * 3600_000);
  const [sales, lots, allSales, sent30, disc] = await Promise.all([
    prisma.distributorSale.findMany({ where: { distributorId: id }, orderBy: { createdAt: 'desc' }, take: 100, include: SALE_LIST_INCLUDE }),
    prisma.distributorOrder.findMany({ where: { distributorId: id }, orderBy: { createdAt: 'desc' }, take: 50 }),
    prisma.distributorSale.findMany({
      where: { distributorId: id },
      select: { fanId: true, tokens: true, amount: true, currency: true, status: true, rating: true, createdAt: true, paidAt: true, completedAt: true, disputeBy: true },
    }),
    prisma.distributorTransfer.aggregate({ where: { distributorId: id, createdAt: { gte: monthAgo } }, _sum: { tokens: true } }),
    averageDiscounts([id]),
  ]);
  const discount = disc.get(id);
  const done = allSales.filter((s) => s.status === 'COMPLETED');
  const done30 = done.filter((s) => (s.completedAt ?? s.createdAt) >= monthAgo);
  const amountsOf = (list: typeof done) => {
    const acc: Record<string, number> = {};
    for (const x of list) acc[x.currency] = (acc[x.currency] ?? 0) + x.amount;
    return acc;
  };
  const paidLots = lots.filter((l) => l.status === 'PAID');
  const rated = done.filter((s) => s.rating != null);
  const rel = done.filter((s) => s.paidAt && s.completedAt).map((s) => (s.completedAt!.getTime() - s.paidAt!.getTime()) / 60_000).sort((a, b) => a - b);
  const medianRel = rel.length ? Math.round(rel[Math.floor(rel.length / 2)]!) : null;

  // Mejores fans
  const fans = new Map<string, { tokens: number; n: number }>();
  for (const s of done) {
    const f = fans.get(s.fanId) ?? { tokens: 0, n: 0 };
    f.tokens += s.tokens;
    f.n += 1;
    fans.set(s.fanId, f);
  }
  const topIds = [...fans.entries()].sort((a, b) => b[1].tokens - a[1].tokens).slice(0, 10);
  const topUsers = await prisma.user.findMany({ where: { id: { in: topIds.map(([fid]) => fid) } }, select: { id: true, username: true, name: true, createdAt: true } });

  return (
    <div className="space-y-6">
      <Link href="/admin/distribuidores" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Distribuidores
      </Link>
      <AdminPageHeader
        title={d.legalName}
        description={
          <>
            {countryFlag(d.country)} {countryName(d.country)} · vende en {d.countries.map((c) => `${countryFlag(c)} ${countryName(c)}`).join(', ')} ·{' '}
            <Link href={`/admin/users/${d.user.id}`} className="underline">{d.user.username ? `@${d.user.username}` : d.user.email}</Link> · contacto:{' '}
            {d.publicContact} · alta {formatDateTime(d.createdAt.toISOString())}
          </>
        }
        actions={
          <>
            <StatusPill d={{ status: d.status, compliant: isCompliant(d), isAvailable: d.isAvailable }} />
            <a href={`/admin/distribuidores/export?tipo=ventas&periodo=todo&dist=${d.id}`} className="flex items-center gap-1 rounded-xl border border-border/60 px-3 py-1.5 text-sm hover:bg-muted/40">
              <Download className="h-4 w-4" /> Ventas CSV
            </a>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Stock para vender" value={`${formatTokens(d.stockTokens)} tk`} sub={`ya pagados · valen ${formatMoney(d.stockTokens * config.economy.tokenValueCents)} en la web`} tone="good" />
        <Kpi label="Te ha comprado" value={formatMoney(paidLots.reduce((n, l) => n + l.amountCents, 0))} sub={`${paidLots.length} ${paidLots.length === 1 ? 'lote' : 'lotes'} · ${formatTokens(paidLots.reduce((n, l) => n + l.tokens, 0))} tk`} />
        <Kpi label="Descuento medio" value={`−${discount.toLocaleString('es')}%`} sub="media de sus lotes pagados" />
        <Kpi label="Entregado 30 días" value={`${formatTokens(sent30._sum.tokens ?? 0)} tk`} sub={`máximo ${formatTokens(d.dailyLimitTokens)} tk al día`} />
        <Kpi label="Ventas completadas" value={String(done.length)} sub={`${done30.length} en 30 días · de ${allSales.length} pedidos`} />
        <Kpi label="Cobró a fans" value={formatAmounts(amountsOf(done))} sub={`${formatTokens(done.reduce((n, x) => n + x.tokens, 0))} tk entregados`} />
        <Kpi label="Fans distintos" value={String(new Set(done.map((x) => x.fanId)).size)} />
        <Kpi
          label="Servicio"
          value={rated.length ? `${Math.round((rated.filter((s) => s.rating === 1).length / rated.length) * 100)}% 👍` : '—'}
          sub={`libera en ${medianRel == null ? '—' : medianRel < 60 ? `${medianRel} min` : `${Math.round(medianRel / 6) / 10} h`} · ${allSales.filter((s) => s.disputeBy).length} ${allSales.filter((s) => s.disputeBy).length === 1 ? 'disputa' : 'disputas'}`}
          tone={allSales.some((s) => s.disputeBy) ? 'warn' : undefined}
        />
      </div>

      {/* Metodos y paquetes */}
      <section className="space-y-2">
        <h2 className="font-semibold">Métodos de cobro y precios ({d.accounts.filter((a) => a.active).length})</h2>
        {d.accounts.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-border/60 p-6 text-center text-sm text-muted-foreground">Aún no ha añadido métodos de cobro.</p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {d.accounts.map((a) => {
              return (
                <div key={a.id} className={cn('space-y-2 rounded-2xl border border-border/60 bg-card p-4 text-sm', !a.active && 'opacity-50')}>
                  <p className="font-semibold">
                    {countryFlag(a.country)} {paymentMethodLabel(a.method)} · {a.currency} {!a.active && <span className="text-xs font-normal">(quitado)</span>}
                  </p>
                  <p className="rounded-lg bg-muted/40 px-2 py-1 font-mono text-xs">{a.details}</p>
                  <ul className="space-y-1">
                    {a.packages.map((p) => (
                      <li key={p.id} className="flex items-center justify-between gap-2">
                        <span>
                          <strong className="text-token">{formatTokens(p.tokens)} tk</strong> · {formatLocal(p.price, a.currency)}
                        </span>
                        <span className="text-xs text-muted-foreground">100 tk a {formatLocal(Math.round((p.price / p.tokens) * 100), a.currency)}</span>
                      </li>
                    ))}
                    {a.packages.length === 0 && <li className="text-xs text-muted-foreground">Sin paquetes.</li>}
                  </ul>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Ventas */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Últimas ventas a fans</h2>
          <Link href={`/admin/distribuidores?tab=ventas&periodo=todo&dist=${d.id}`} className="text-xs font-semibold text-primary">Ver todas con filtros →</Link>
        </div>
        <TableWrap>
          <thead>
            <tr>
              <Th>Fecha</Th>
              <Th>Pedido</Th>
              <Th>Fan</Th>
              <Th>Método</Th>
              <Th right>Tokens</Th>
              <Th right>Pagó</Th>
              <Th right>100 tk a</Th>
              <Th>Estado</Th>
            </tr>
          </thead>
          <tbody>
            {sales.length === 0 ? (
              <tr><Td colSpan={8} className="py-6 text-center text-muted-foreground">Aún no tiene ventas.</Td></tr>
            ) : (
              sales.map((s) => {
                return (
                  <tr key={s.id} className="border-t border-border/40 hover:bg-muted/30">
                    <Td className="whitespace-nowrap">{formatDateTime(s.createdAt.toISOString())}</Td>
                    <Td><Link href={`/compra-tokens/${s.id}`} className="font-mono text-xs hover:underline">{s.id.slice(-8).toUpperCase()}</Link></Td>
                    <Td><Link href={`/admin/users/${s.fan.id}`} className="hover:underline">@{s.fan.username ?? s.fan.name}</Link></Td>
                    <Td className="whitespace-nowrap">{countryFlag(s.account.country)} {paymentMethodLabel(s.account.method)}</Td>
                    <Td right>{formatTokens(s.tokens)}</Td>
                    <Td right className="whitespace-nowrap">{formatLocal(s.amount, s.currency)}</Td>
                    <Td right className="whitespace-nowrap text-muted-foreground">{formatLocal(Math.round((s.amount / s.tokens) * 100), s.currency)}</Td>
                    <Td><SaleStatus status={s.status} /></Td>
                  </tr>
                );
              })
            )}
          </tbody>
        </TableWrap>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Lotes */}
        <section className="space-y-2">
          <h2 className="font-semibold">Lotes comprados</h2>
          <TableWrap>
            <thead>
              <tr>
                <Th>Fecha</Th>
                <Th right>Tokens</Th>
                <Th right>Desc.</Th>
                <Th right>Importe</Th>
                <Th>Recibo</Th>
                <Th>Estado</Th>
              </tr>
            </thead>
            <tbody>
              {lots.length === 0 ? (
                <tr><Td colSpan={6} className="py-6 text-center text-muted-foreground">Sin lotes.</Td></tr>
              ) : (
                lots.map((o) => (
                  <tr key={o.id} className="border-t border-border/40">
                    <Td className="whitespace-nowrap">{formatDateTime(o.createdAt.toISOString())}</Td>
                    <Td right>{formatTokens(o.tokens)}</Td>
                    <Td right>−{o.discountPercent}%</Td>
                    <Td right>{formatMoney(o.amountCents)}</Td>
                    <Td>{o.proofKey ? <a href={`/admin/distribuidores/recibo/${o.id}`} target="_blank" rel="noreferrer" className="text-primary">Ver</a> : '—'}</Td>
                    <Td>{o.status === 'PAID' ? `Pagado${o.paymentMethod === 'USDT' ? ' (USDT)' : ''}` : o.status === 'PENDING' ? (o.proofKey ? 'Recibo por revisar' : 'Esperando pago') : o.rejectReason ? 'Rechazado' : 'Cancelado'}</Td>
                  </tr>
                ))
              )}
            </tbody>
          </TableWrap>
        </section>

        {/* Fans */}
        <section className="space-y-2">
          <h2 className="font-semibold">Fans que más le compran</h2>
          <TableWrap>
            <thead>
              <tr>
                <Th>Fan</Th>
                <Th right>Compras</Th>
                <Th right>Tokens</Th>
                <Th>Cuenta desde</Th>
              </tr>
            </thead>
            <tbody>
              {topIds.length === 0 ? (
                <tr><Td colSpan={4} className="py-6 text-center text-muted-foreground">Sin compras completadas.</Td></tr>
              ) : (
                topIds.map(([fid, f]) => {
                  const u = topUsers.find((x) => x.id === fid);
                  return (
                    <tr key={fid} className="border-t border-border/40">
                      <Td><Link href={`/admin/users/${fid}`} className="hover:underline">@{u?.username ?? u?.name ?? fid}</Link></Td>
                      <Td right>{f.n}</Td>
                      <Td right>{formatTokens(f.tokens)}</Td>
                      <Td>{u ? formatDateTime(u.createdAt.toISOString()) : '—'}</Td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </TableWrap>
        </section>
      </div>

      <section className="space-y-2">
        <h2 className="font-semibold">Verificación y condiciones</h2>
        <DistributorRow
          d={{
            id: d.id,
            legalName: d.legalName,
            country: d.country,
            account: d.user.username ? `@${d.user.username}` : d.user.email,
            publicContact: d.publicContact,
            status: d.status,
            countries: d.countries,
            methods: [...new Set(d.accounts.filter((a) => a.active).map((a) => a.method))],
            dailyLimitTokens: d.dailyLimitTokens,
            stockTokens: d.stockTokens,
            sent30: sent30._sum.tokens ?? 0,
            idVerified: Boolean(d.idVerifiedAt),
            sanctionsChecked: Boolean(d.sanctionsCheckedAt),
            contractSigned: Boolean(d.contractSignedAt),
            compliant: isCompliant(d),
          }}
        />
        {d.notes && <p className="text-xs text-muted-foreground">Notas: {d.notes}</p>}
      </section>
    </div>
  );
}
