import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ShieldCheck } from 'lucide-react';

import { DistributorBadge } from '@/components/distributors/distributor-badge';
import { ContactDistributorButton } from '@/components/distributors/distributor-forms';
import { BuyFromDistributor } from '@/components/distributors/p2p';
import { getCurrentUser } from '@/lib/auth/guards';
import { config } from '@/lib/config';
import { countryFlag, countryName, normalizeCountryCode } from '@/lib/countries';
import { formatLocal, PAYMENT_METHODS, paymentMethodLabel } from '@/lib/distributor-shared';
import { distributorStats, expireSales, operatingBlock } from '@/lib/distributors';
import { prisma } from '@/lib/prisma';
import { cn } from '@/lib/utils';
import { pageMeta } from '@/lib/seo';

export const metadata: Metadata = pageMeta('Distribuidores oficiales', 'Compra tokens en tu país y en tu moneda con un distribuidor oficial, con métodos de pago locales y compra protegida.');
export const dynamic = 'force-dynamic';

/**
 * DISTRIBUIDORES OFICIALES: comprar tokens sin tarjeta, pagando en tu moneda.
 * Filtro por pais y metodo; cada metodo con los paquetes y precios que pone
 * el distribuidor. La compra es protegida: /compra-tokens/[id].
 */
export default async function DistributorsPage({
  searchParams,
}: {
  searchParams: Promise<{ pais?: string; metodo?: string }>;
}) {
  if (!config.distributors.enabled) notFound();
  await expireSales();
  const params = await searchParams;
  const viewer = await getCurrentUser();
  const viewerCountry = viewer
    ? ((await prisma.user.findUnique({ where: { id: viewer.id }, select: { country: true } }))?.country ?? null)
    : null;

  const distributors = await prisma.distributor.findMany({
    where: { status: 'ACTIVE', idVerifiedAt: { not: null }, sanctionsCheckedAt: { not: null }, contractSignedAt: { not: null } },
    include: {
      accounts: {
        where: { active: true },
        orderBy: { createdAt: 'asc' },
        include: { packages: { where: { active: true }, orderBy: { tokens: 'asc' } } },
      },
    },
  });
  const myOpen = viewer
    ? await prisma.distributorSale.findMany({
        where: { fanId: viewer.id, status: { in: ['AWAITING_PAYMENT', 'PAID', 'DISPUTED'] } },
        orderBy: { createdAt: 'desc' },
        select: { id: true, tokens: true, amount: true, currency: true, status: true },
      })
    : [];
  // Solo metodos con paquetes; los no disponibles salen al final, sin poder comprar.
  const usable = distributors
    .filter((d) => !operatingBlock(d))
    .map((d) => ({ ...d, accounts: d.accounts.filter((a) => a.packages.some((p) => p.tokens <= d.stockTokens)) }))
    .filter((d) => d.accounts.length > 0);
  const stats = await distributorStats(usable.map((d) => d.id));

  const countries = [...new Set(usable.flatMap((d) => d.accounts.map((a) => a.country)))].sort((a, b) =>
    countryName(a).localeCompare(countryName(b), 'es'),
  );
  const requested = normalizeCountryCode(params.pais ?? '');
  const country =
    params.pais === 'todos'
      ? null
      : requested && countries.includes(requested)
        ? requested
        : viewerCountry && countries.includes(viewerCountry)
          ? viewerCountry
          : null;
  const accountsIn = (d: (typeof usable)[number]) =>
    d.accounts.filter((a) => !country || a.country === country);
  const methodKeys = new Set(usable.flatMap((d) => accountsIn(d).map((a) => a.method)));
  const methods = PAYMENT_METHODS.filter((m) => methodKeys.has(m.key));
  const method = methods.some((m) => m.key === params.metodo) ? params.metodo! : null;

  const list = usable
    .map((d) => ({ d, accounts: accountsIn(d).filter((a) => !method || a.method === method) }))
    .filter((x) => x.accounts.length > 0)
    .sort(
      (a, b) =>
        Number(b.d.isAvailable) - Number(a.d.isAvailable) ||
        (stats.get(b.d.id)?.sales ?? 0) - (stats.get(a.d.id)?.sales ?? 0),
    );

  const href = (p: { pais?: string | null; metodo?: string | null }) => {
    const q = new URLSearchParams();
    const pais = p.pais === undefined ? country : p.pais;
    const metodo = p.metodo === undefined ? method : p.metodo;
    q.set('pais', pais ?? 'todos');
    if (metodo) q.set('metodo', metodo);
    return `/distribuidores?${q.toString()}`;
  };

  return (
    <div className="container max-w-2xl space-y-5 py-8">
      <header>
        <h1 className="font-heading text-3xl uppercase tracking-wide">Comprar tokens sin tarjeta</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Compra a un distribuidor oficial y paga en tu moneda con Nequi, OXXO, Pago Móvil, transferencia… Todo dentro de
          Fantasy Live y con compra protegida.
        </p>
      </header>

      {myOpen.length > 0 && (
        <section className="space-y-2 rounded-2xl border border-primary/40 bg-primary/5 p-4 text-sm">
          <p className="font-semibold">Tus compras en curso</p>
          {myOpen.map((o) => (
            <Link key={o.id} href={`/compra-tokens/${o.id}`} className="flex items-center justify-between rounded-xl bg-background/60 px-3 py-2 hover:bg-background">
              <span>
                {o.tokens} tokens · {formatLocal(o.amount, o.currency)}
              </span>
              <span className="text-xs font-semibold text-primary">
                {o.status === 'AWAITING_PAYMENT' ? 'Pagar ahora' : o.status === 'PAID' ? 'Esperando confirmación' : 'En revisión'}
              </span>
            </Link>
          ))}
        </section>
      )}

      <section className="space-y-2 rounded-2xl border border-state-connected/40 bg-state-connected/5 p-4 text-sm">
        <p className="flex items-center gap-2 font-semibold">
          <ShieldCheck className="h-4 w-4 text-state-connected" /> Así te protegemos
        </p>
        <ol className="list-decimal space-y-0.5 pl-5 text-muted-foreground">
          <li>Creas el pedido y tus tokens quedan reservados.</li>
          <li>Pagas al distribuidor con el método que elegiste y marcas «Ya pagué».</li>
          <li>Él confirma el pago y los tokens llegan a tu monedero al momento.</li>
        </ol>
        <p className="text-muted-foreground">
          Cada distribuidor pone sus paquetes y precios en su moneda: compara antes de comprar.
        </p>
      </section>

      {/* Filtros */}
      <div className="space-y-3">
        <div className="flex flex-wrap gap-1.5">
          <Chip href={href({ pais: null, metodo: null })} active={!country}>
            🌎 Todos
          </Chip>
          {countries.map((c) => (
            <Chip key={c} href={href({ pais: c, metodo: null })} active={country === c}>
              {countryFlag(c)} {countryName(c)}
            </Chip>
          ))}
        </div>
        {methods.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            <Chip href={href({ metodo: null })} active={!method} small>
              Cualquier método
            </Chip>
            {methods.map((m) => (
              <Chip key={m.key} href={href({ metodo: m.key })} active={method === m.key} small>
                {m.label}
              </Chip>
            ))}
          </div>
        )}
      </div>

      {list.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border/60 p-8 text-center text-sm text-muted-foreground">
          {usable.length === 0 ? 'Aún no hay distribuidores disponibles.' : 'No hay distribuidores con ese filtro.'}
        </p>
      ) : (
        <ul className="space-y-3">
          {list.map(({ d, accounts }) => {
            const st = stats.get(d.id);
            return (
              <li key={d.id} className="space-y-3 rounded-2xl border border-border/60 bg-card p-4">
                <div className="flex items-start gap-3">
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-1.5 font-semibold">
                      {d.legalName} <DistributorBadge compact />
                    </span>
                    {!d.isAvailable && (
                      <span className="mt-0.5 inline-block rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                        No disponible ahora
                      </span>
                    )}
                    <span className="block text-xs text-muted-foreground">
                      {st && st.sales > 0
                        ? `${st.sales} ${st.sales === 1 ? 'venta' : 'ventas'}${st.positive != null ? ` · ${st.positive}% positivas` : ''}`
                        : 'Nuevo distribuidor'}
                    </span>
                  </span>
                  <ContactDistributorButton distributorId={d.id} isAuthenticated={Boolean(viewer)} />
                </div>
                <ul className="divide-y divide-border/60 rounded-xl bg-muted/30 text-sm">
                  {accounts.map((a) => (
                    <li key={a.id} className="space-y-1.5 px-3 py-2">
                      <p className="font-medium">
                        {countryFlag(a.country)} {paymentMethodLabel(a.method)} · {a.currency}
                      </p>
                      <div className="flex flex-wrap gap-1">
                        {a.packages.filter((p) => p.tokens <= d.stockTokens).map((p) => (
                          <span key={p.id} className="rounded-full bg-background/70 px-2 py-0.5 text-xs">
                            <strong className="text-token">{p.tokens} tk</strong> · {formatLocal(p.price, a.currency)}
                          </span>
                        ))}
                      </div>
                    </li>
                  ))}
                </ul>
                <BuyFromDistributor
                  options={accounts.map((a) => ({
                    id: a.id,
                    method: a.method,
                    currency: a.currency,
                    packages: a.packages
                      .filter((p) => p.tokens <= d.stockTokens)
                      .map((p) => ({ id: p.id, tokens: p.tokens, price: p.price })),
                  }))}
                  isAuthenticated={Boolean(viewer)}
                  preferredMethod={method}
                  available={d.isAvailable}
                />
              </li>
            );
          })}
        </ul>
      )}

      <p className="text-xs text-muted-foreground">
        Solo son oficiales los que llevan la insignia. Nunca compres fuera de esta página ni des tu contraseña. Si alguien
        te pide pagar por fuera de un pedido, avísanos desde{' '}
        <Link href="/soporte" className="underline">
          Soporte
        </Link>
        .
      </p>
    </div>
  );
}

function Chip({
  href,
  active,
  small,
  children,
}: {
  href: string;
  active: boolean;
  small?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      scroll={false}
      className={cn(
        'rounded-full border font-medium transition-colors',
        small ? 'px-2.5 py-1 text-xs' : 'px-3 py-1.5 text-sm',
        active ? 'border-primary bg-primary/10 text-foreground' : 'border-border/60 text-muted-foreground hover:text-foreground',
      )}
    >
      {children}
    </Link>
  );
}
