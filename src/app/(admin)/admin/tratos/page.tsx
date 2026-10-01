import type { Metadata } from 'next';
import Link from 'next/link';

import { AdminPageHeader } from '@/components/admin/admin-shell';
import { requireAdmin } from '@/lib/auth/guards';
import { config } from '@/lib/config';
import { isDealActive, STANDARD_AMBASSADOR_PERCENT } from '@/lib/deals';
import { prisma } from '@/lib/prisma';
import { cn, formatMoney, formatUtcDate } from '@/lib/utils';
import { tokensToPayoutCents } from '@/lib/tokens';

export const metadata: Metadata = { title: 'Tratos' };
export const dynamic = 'force-dynamic';

/**
 * TRATOS: las creadoras con condiciones negociadas (vigentes y terminadas).
 * Se crean y cambian desde la ficha de cada creadora.
 */
export default async function DealsPage() {
  await requireAdmin();
  const deals = await prisma.modelProfile.findMany({
    where: { OR: [{ dealPlatformPercent: { not: null } }, { dealAmbassadorPercent: { not: null } }] },
    orderBy: { dealUpdatedAt: 'desc' },
    select: {
      id: true,
      userId: true,
      stageName: true,
      avatarUrl: true,
      totalTokensEarned: true,
      dealPlatformPercent: true,
      dealAmbassadorPercent: true,
      dealUntil: true,
      dealNotes: true,
      dealUpdatedAt: true,
    },
  });
  const now = new Date();
  const standardPct = config.economy.platformCommissionPercent;

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Tratos con creadores"
        description={
          <>
            Condiciones negociadas con creadores concretos. Estandar: la plataforma se queda el{' '}
            {standardPct}% y cada creador cobra el {STANDARD_AMBASSADOR_PERCENT}% de lo que venden los
            creadores que invita. Para crear o cambiar un trato, abre la ficha del creador en{' '}
            <Link href="/admin/users" className="text-primary hover:underline">
              Usuarios y creadores
            </Link>
            .
          </>
        }
      />

      {deals.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border/60 p-8 text-center text-sm text-muted-foreground">
          Aun no hay tratos.
        </p>
      ) : (
        <ul className="divide-y divide-border/60 overflow-hidden rounded-2xl border border-border/60 bg-card">
          {deals.map((d) => {
            const active = isDealActive(d, now);
            return (
              <li key={d.id}>
                <Link
                  href={`/admin/users/${d.userId}`}
                  className={cn('flex flex-wrap items-center gap-3 px-4 py-3 hover:bg-white/[0.03]', !active && 'opacity-60')}
                >
                  {d.avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={d.avatarUrl} alt="" className="h-10 w-10 rounded-full object-cover" />
                  ) : (
                    <span className="flex h-10 w-10 items-center justify-center rounded-full bg-muted font-bold">
                      {d.stageName.slice(0, 1)}
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 font-semibold">
                      {d.stageName}
                      <span
                        className={cn(
                          'rounded-full px-2 py-0.5 text-[10px] font-medium',
                          active ? 'bg-state-connected/15 text-state-connected' : 'bg-muted text-muted-foreground',
                        )}
                      >
                        {active ? 'Vigente' : 'Terminado'}
                      </span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {d.dealPlatformPercent != null &&
                        `Plataforma ${d.dealPlatformPercent}% (ella ${100 - d.dealPlatformPercent}%)`}
                      {d.dealPlatformPercent != null && d.dealAmbassadorPercent != null && ' · '}
                      {d.dealAmbassadorPercent != null && `Embajadora ${d.dealAmbassadorPercent}%`}
                      {' · '}
                      {d.dealUntil ? `hasta ${formatUtcDate(d.dealUntil)}` : 'sin fecha de fin'}
                    </p>
                    {d.dealNotes && <p className="mt-0.5 truncate text-xs text-muted-foreground">“{d.dealNotes}”</p>}
                  </div>
                  <div className="text-right text-xs text-muted-foreground">
                    <p className="font-semibold text-foreground">{formatMoney(tokensToPayoutCents(d.totalTokensEarned))}</p>
                    <p>ganado en total</p>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
