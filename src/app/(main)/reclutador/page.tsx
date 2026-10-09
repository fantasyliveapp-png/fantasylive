import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { BadgeCheck, Handshake, ShieldCheck, TrendingUp, Users, Wallet } from 'lucide-react';

import { PayoutRequestForm } from '@/components/model/payout-request-form';
import { ReferralLink } from '@/components/model/referral-link';
import {
  MonthlyEarnings,
  PaymentHistory,
  RecruitEarnings,
} from '@/components/recruiter/recruiter-stats';
import { requireUser } from '@/lib/auth/guards';
import { config } from '@/lib/config';
import { PAYOUT_STATUS_LABELS } from '@/lib/constants';
import { OPEN_PAYOUT_STATUSES } from '@/lib/payout-requests';
import { PAYOUT_METHOD_LABELS } from '@/lib/payout-methods';
import { prisma } from '@/lib/prisma';
import { getRecruiterOverview, termsLabel } from '@/lib/recruiters';
import { getWalletSummary, tokensToPayoutCents, withdrawableTokens } from '@/lib/tokens';
import { cn, formatDateTime, formatMoney } from '@/lib/utils';

export const metadata: Metadata = { title: 'Panel de reclutador' };
export const dynamic = 'force-dynamic';

/**
 * PANEL DE RECLUTADOR: su enlace, sus condiciones, lo que ha ganado con cada
 * creadora que trajo (y en que punto esta), mes a mes, y lo que ha cobrado.
 */
export default async function RecruiterPage() {
  const user = await requireUser('/reclutador');
  const recruiter = await prisma.recruiter.findUnique({
    where: { userId: user.id },
    select: { id: true },
  });
  if (!recruiter) notFound();
  const [r, wallet, requests] = await Promise.all([
    getRecruiterOverview(recruiter.id).then((o) => o!),
    getWalletSummary(user.id),
    prisma.payoutRequest.findMany({
      where: { recruiterId: recruiter.id },
      orderBy: { requestedAt: 'desc' },
      take: 20,
      select: {
        id: true,
        requestedAt: true,
        method: true,
        destinationMasked: true,
        amountCents: true,
        status: true,
        rejectionReason: true,
      },
    }),
  ]);
  const hasOpenRequest = requests.some((p) =>
    (OPEN_PAYOUT_STATUSES as readonly string[]).includes(p.status),
  );
  const link = `${config.app.url.replace(/\/$/, '')}/reclutar/${r.code}`;
  const minPayoutCents = tokensToPayoutCents(config.economy.minPayoutTokens);

  return (
    <div className="container max-w-3xl space-y-5 py-6">
      <header>
        <h1 className="font-heading text-3xl uppercase tracking-wide">Panel de reclutador</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Trae creadores a Fantasy Live y gana con cada venta que hagan.
        </p>
      </header>

      {!r.active && (
        <p className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
          Tu cuenta de reclutador esta en pausa: tu enlace no registra nuevos creadores. Habla con el
          equipo.
        </p>
      )}

      <section className="flex items-start gap-3 rounded-2xl border border-primary/30 bg-primary/5 p-4">
        <Handshake className="h-5 w-5 shrink-0 text-primary" />
        <div>
          <p className="text-sm font-semibold">Tus condiciones</p>
          <p className="text-sm text-muted-foreground">{termsLabel(r)}.</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Cuenta desde que cada creador se hace creador. Solo se paga por ventas reales: nada
            por registrarse.
          </p>
        </div>
      </section>

      <section className="space-y-2 rounded-2xl border border-border/60 bg-card p-4">
        <p className="text-sm font-semibold">Tu enlace para creadores</p>
        <ReferralLink url={link} shareText="Unete a Fantasy Live como creador" />
        <p className="text-[11px] text-muted-foreground">
          Quien lo abra y se registre en los proximos 30 dias queda como tuya.
        </p>
      </section>

      <section className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Stat
          icon={TrendingUp}
          label="Este mes"
          value={formatMoney(r.totals.earnedThisMonthCents)}
          hint={`Mes pasado: ${formatMoney(r.totals.earnedLastMonthCents)}`}
        />
        <Stat
          icon={Wallet}
          label="Total ganado"
          value={formatMoney(r.totals.earnedCents)}
          hint={`${r.totals.salesCount} ventas`}
        />
        <Stat
          icon={Wallet}
          label="Por cobrar"
          value={formatMoney(r.totals.pendingCents)}
          hint={
            config.economy.payoutFeePercent > 0
              ? `Recibes ${formatMoney(r.totals.payNowCents)} (−${config.economy.payoutFeePercent}% al cobrar)`
              : undefined
          }
          highlight
        />
        <Stat icon={Wallet} label="Ya cobrado" value={formatMoney(r.totals.paidCents)} />
        <Stat icon={Users} label="Registradas" value={String(r.totals.registered)} />
        <Stat icon={BadgeCheck} label="Verificadas" value={String(r.totals.verified)} />
      </section>

      <PayoutRequestForm
        recruiter
        balance={withdrawableTokens(wallet)}
        minTokens={config.economy.minPayoutTokens}
        centsPerToken={config.economy.modelPayoutCentsPerToken}
        feePercent={config.economy.payoutFeePercent}
        kycApproved
        hasOpenRequest={hasOpenRequest}
      />

      {requests.length > 0 && (
        <section>
          <h2 className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Tus solicitudes de retiro
          </h2>
          <ul className="divide-y divide-border/60 overflow-hidden rounded-2xl border border-border/60 bg-card">
            {requests.map((p) => (
              <li key={p.id} className="flex items-start gap-3 px-4 py-3 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{formatDateTime(p.requestedAt)}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {PAYOUT_METHOD_LABELS[p.method] ?? p.method}
                    {p.destinationMasked ? ` · ${p.destinationMasked}` : ''}
                  </p>
                  {p.rejectionReason && (
                    <p className="mt-0.5 text-xs text-destructive">{p.rejectionReason}</p>
                  )}
                </div>
                <div className="text-right">
                  <p className="font-semibold tabular-nums">{formatMoney(p.amountCents)}</p>
                  <p
                    className={cn(
                      'text-[11px]',
                      p.status === 'PAID'
                        ? 'text-state-connected'
                        : p.status === 'REJECTED'
                          ? 'text-destructive'
                          : 'text-muted-foreground',
                    )}
                  >
                    {PAYOUT_STATUS_LABELS[p.status]}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2 className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          Tus ganancias por creador
        </h2>
        <RecruitEarnings
          recruits={r.recruits}
          months={r.months}
          emptyText="Aun nadie se ha registrado con tu enlace."
        />
      </section>

      <MonthlyEarnings monthly={r.monthly} />

      <section>
        <h2 className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          Tus cobros
        </h2>
        <PaymentHistory payments={r.payments} />
      </section>

      <section className="space-y-2 rounded-2xl border border-border/60 bg-card p-4 text-sm">
        <p className="flex items-center gap-2 font-semibold">
          <ShieldCheck className="h-4 w-4 text-primary" /> Como cobras y normas
        </p>
        <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
          <li>
            Pide tu retiro desde esta pagina cuando tengas {formatMoney(minPayoutCents)} o mas,
            por transferencia o en USDT.
            {config.economy.payoutFeePercent > 0
              ? ` Al cobrar se descuenta un ${config.economy.payoutFeePercent}%, igual que a los creadores.`
              : ' Lo recibes integro, sin descuentos.'}
          </li>
          <li>
            Ganas tu % de todo lo que gane cada creador: llamadas, regalos, directos, packs,
            suscripciones, chats y publicaciones.
          </li>
          <li>Cada creador cuenta cuando verifica su identidad y hace su primera venta.</li>
          <li>Nada de spam, nada dirigido a menores y no te hagas pasar por Fantasy Live.</li>
          <li>Si se incumplen las normas, se pausa la cuenta y se pierde lo pendiente.</li>
        </ul>
      </section>
    </div>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  hint,
  highlight,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  hint?: string;
  highlight?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-border/60 bg-card p-3">
      <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </p>
      <p className={cn('mt-1 font-heading text-2xl leading-none', highlight && 'text-state-connected')}>
        {value}
      </p>
      {hint && <p className="mt-1 text-[10px] text-muted-foreground">{hint}</p>}
    </div>
  );
}
