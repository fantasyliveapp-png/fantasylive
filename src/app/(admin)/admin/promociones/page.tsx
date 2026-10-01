import type { Metadata } from 'next';

import { AdminPageHeader } from '@/components/admin/admin-shell';
import { CreateTokenPromoForm, TokenPromoActions } from '@/components/admin/token-promo-admin';
import { requireAdmin } from '@/lib/auth/guards';
import { prisma } from '@/lib/prisma';
import { maxSafePercentOff, minSafePriceCents, OFFER_RULES } from '@/lib/token-offers';
import { cn, formatDateTime } from '@/lib/utils';

export const metadata: Metadata = { title: 'Promociones de tokens' };
export const dynamic = 'force-dynamic';

/**
 * PROMOCIONES DE TOKENS: descuento en todos los paquetes durante unas fechas.
 * Mientras hay una en curso, los fans la ven en el monedero y en los directos.
 */
export default async function TokenPromosPage() {
  await requireAdmin();
  const [promos, packages] = await Promise.all([
    prisma.tokenPromo.findMany({ orderBy: { createdAt: 'desc' }, take: 50 }),
    prisma.tokenPackage.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
      select: { name: true, tokens: true, bonusTokens: true, priceCents: true },
    }),
  ]);
  const now = new Date();

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Promociones de tokens"
        description="Hora loca, fin de semana o fechas especiales: rebaja los paquetes de tokens durante unas fechas. Mientras dure, los fans la ven en su monedero y en los directos. Ningún paquete baja de su coste: si el % se pasa, en ese paquete se aplica el máximo seguro."
      />
      <CreateTokenPromoForm
        samplePrices={packages.map((p) => ({
          name: p.name,
          tokens: p.tokens + p.bonusTokens,
          priceCents: p.priceCents,
          maxSafe: maxSafePercentOff(p),
          minSafeCents: minSafePriceCents(p.tokens + p.bonusTokens),
        }))}
      />

      <section className="rounded-2xl border border-border/60 bg-card p-5">
        <h2 className="font-semibold">Ofertas automáticas (siempre activas)</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Se aplican solas a cada fan. Nunca se suman: en cada paquete gana la que más le conviene, y ninguna baja
          un paquete por debajo de su coste.
        </p>
        <ul className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
          <li className="rounded-xl bg-muted/40 p-3">
            <span className="font-semibold">Bienvenida</span> · primera compra, paquete más barato: +
            {OFFER_RULES.welcomeBonusPercent}% de tokens.
          </li>
          <li className="rounded-xl bg-muted/40 p-3">
            <span className="font-semibold">Primeras 24 h</span> · primera compra en sus 24 h tras registrarse, dos
            paquetes más baratos: −{OFFER_RULES.first24hPercentOff}%.
          </li>
          <li className="rounded-xl bg-muted/40 p-3">
            <span className="font-semibold">Saldo bajo</span> · le quedan menos de {OFFER_RULES.lowBalanceTokens}{' '}
            tokens (1 vez al día): +{OFFER_RULES.lowBalanceBonusPercent}% de tokens.
          </li>
          <li className="rounded-xl bg-muted/40 p-3">
            <span className="font-semibold">Te echamos de menos</span> · {OFFER_RULES.winbackAfterDays} días sin
            comprar: −{OFFER_RULES.winbackPercentOff}% durante {OFFER_RULES.winbackHours} h, con aviso.
          </li>
        </ul>
      </section>

      {promos.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border/60 p-8 text-center text-sm text-muted-foreground">
          Aun no hay promociones.
        </p>
      ) : (
        <ul className="divide-y divide-border/60 overflow-hidden rounded-2xl border border-border/60 bg-card">
          {promos.map((p) => {
            const status = !p.active
              ? { label: 'Pausada', cls: 'bg-muted text-muted-foreground' }
              : p.endsAt <= now
                ? { label: 'Terminada', cls: 'bg-muted text-muted-foreground' }
                : p.startsAt > now
                  ? { label: 'Programada', cls: 'bg-amber-500/15 text-amber-500' }
                  : { label: 'En curso', cls: 'bg-state-connected/15 text-state-connected' };
            return (
              <li key={p.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <span className="flex h-11 w-14 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-fantazy-red to-champagne-gold text-sm font-bold text-white">
                  −{p.percentOff}%
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 font-semibold">
                    {p.title}
                    <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-medium', status.cls)}>{status.label}</span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatDateTime(p.startsAt)} → {formatDateTime(p.endsAt)}
                  </p>
                </div>
                <TokenPromoActions id={p.id} active={p.active} />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
