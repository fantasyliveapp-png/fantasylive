import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { BadgeCheck, Handshake, ShieldCheck, Users, Wallet } from 'lucide-react';

import { ReferralLink } from '@/components/model/referral-link';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { requireUser } from '@/lib/auth/guards';
import { config } from '@/lib/config';
import { prisma } from '@/lib/prisma';
import { getRecruiterOverview, termsLabel, type RecruitStatus } from '@/lib/recruiters';
import { tokensToPayoutCents } from '@/lib/tokens';
import { cn, formatMoney, initials } from '@/lib/utils';

export const metadata: Metadata = { title: 'Panel de reclutador' };
export const dynamic = 'force-dynamic';

const STATUS: Record<RecruitStatus, { label: string; cls: string }> = {
  registered: { label: 'Registrada', cls: 'bg-muted text-muted-foreground' },
  verifying: { label: 'Verificandose', cls: 'bg-amber-500/15 text-amber-500' },
  active: { label: 'Activa', cls: 'bg-state-connected/15 text-state-connected' },
  out_of_quota: { label: 'Fuera de cupo', cls: 'bg-destructive/15 text-destructive' },
};

/**
 * PANEL DE RECLUTADOR: su enlace, sus condiciones, las creadoras que ha
 * traido (y en que punto estan) y lo que ha ganado y cobrado.
 */
export default async function RecruiterPage() {
  const user = await requireUser('/reclutador');
  const recruiter = await prisma.recruiter.findUnique({
    where: { userId: user.id },
    select: { id: true },
  });
  if (!recruiter) notFound();
  const r = (await getRecruiterOverview(recruiter.id))!;
  const link = `${config.app.url.replace(/\/$/, '')}/reclutar/${r.code}`;
  const minPayoutCents = tokensToPayoutCents(config.economy.minPayoutTokens);

  return (
    <div className="container max-w-2xl space-y-5 py-6">
      <header>
        <h1 className="font-heading text-3xl uppercase tracking-wide">Panel de reclutador</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Trae creadoras a FantasyLive y gana con cada venta que hagan.
        </p>
      </header>

      {!r.active && (
        <p className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
          Tu cuenta de reclutador esta en pausa: tu enlace no registra nuevas creadoras. Habla con el
          equipo.
        </p>
      )}

      <section className="flex items-start gap-3 rounded-2xl border border-primary/30 bg-primary/5 p-4">
        <Handshake className="h-5 w-5 shrink-0 text-primary" />
        <div>
          <p className="text-sm font-semibold">Tus condiciones</p>
          <p className="text-sm text-muted-foreground">{termsLabel(r)}.</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Cuenta desde que cada creadora se hace creadora. Solo se paga por ventas reales: nada
            por registrarse.
          </p>
        </div>
      </section>

      <section className="space-y-2 rounded-2xl border border-border/60 bg-card p-4">
        <p className="text-sm font-semibold">Tu enlace para creadoras</p>
        <ReferralLink url={link} shareText="Unete a FantasyLive como creadora" />
        <p className="text-[11px] text-muted-foreground">
          Quien lo abra y se registre en los proximos 30 dias queda como tuya.
        </p>
      </section>

      <section className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat icon={Users} label="Registradas" value={String(r.totals.registered)} />
        <Stat icon={BadgeCheck} label="Verificadas" value={String(r.totals.verified)} />
        <Stat icon={Wallet} label="Por cobrar" value={formatMoney(r.totals.pendingCents)} highlight />
        <Stat icon={Wallet} label="Ya cobrado" value={formatMoney(r.totals.paidCents)} />
      </section>

      <section>
        <h2 className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          Creadoras que has traido
        </h2>
        {r.recruits.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-border/60 p-6 text-center text-sm text-muted-foreground">
            Aun nadie se ha registrado con tu enlace.
          </p>
        ) : (
          <ul className="divide-y divide-border/60 overflow-hidden rounded-2xl border border-border/60 bg-card">
            {r.recruits.map((c) => (
              <li key={c.userId} className="flex items-center gap-3 px-4 py-3">
                <Avatar className="h-10 w-10">
                  {c.avatarUrl && <AvatarImage src={c.avatarUrl} alt="" />}
                  <AvatarFallback>{initials(c.name)}</AvatarFallback>
                </Avatar>
                <span className="min-w-0 flex-1 truncate text-sm font-semibold">{c.name}</span>
                <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium', STATUS[c.status].cls)}>
                  {STATUS[c.status].label}
                </span>
                <span className="w-16 text-right text-sm font-semibold">{formatMoney(c.earnedCents)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-2 rounded-2xl border border-border/60 bg-card p-4 text-sm">
        <p className="flex items-center gap-2 font-semibold">
          <ShieldCheck className="h-4 w-4 text-primary" /> Como cobras y normas
        </p>
        <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
          <li>Te pagamos lo acumulado cada semana, a partir de {formatMoney(minPayoutCents)}.</li>
          <li>Cada creadora cuenta cuando verifica su identidad y hace su primera venta.</li>
          <li>Nada de spam, nada dirigido a menores y no te hagas pasar por FantasyLive.</li>
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
  highlight,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
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
    </div>
  );
}
