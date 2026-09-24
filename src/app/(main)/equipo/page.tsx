import type { Metadata } from 'next';
import Link from 'next/link';
import { ChevronRight, ShieldCheck, UsersRound, Wallet } from 'lucide-react';

import { InviteResponse, LeaveTeamButton } from '@/components/team/team-controls';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { requireUser } from '@/lib/auth/guards';
import { getMyTeams } from '@/lib/chat-team';
import { config } from '@/lib/config';
import { prisma } from '@/lib/prisma';
import { splitPayoutFee, tokensToPayoutCents, withdrawableTokens } from '@/lib/tokens';
import { formatMoney, initials } from '@/lib/utils';

export const metadata: Metadata = { title: 'Equipo' };
export const dynamic = 'force-dynamic';

/**
 * EQUIPO (lado del chatter): invitaciones, creadoras para las que lleva los
 * mensajes y lo que ha ganado.
 */
export default async function ChatterTeamPage() {
  const user = await requireUser('/equipo');
  const [teams, wallet, earned, paid] = await Promise.all([
    getMyTeams(user.id),
    prisma.wallet.findUnique({ where: { userId: user.id } }),
    prisma.transaction.aggregate({
      where: { userId: user.id, type: 'CHATTER_EARNING' },
      _sum: { tokens: true },
    }),
    prisma.transaction.aggregate({
      where: { userId: user.id, type: 'PAYOUT' },
      _sum: { amountCents: true },
    }),
  ]);
  const invites = teams.filter((t) => t.status === 'INVITED');
  const active = teams.filter((t) => t.status === 'ACTIVE');
  const earnedTokens = earned._sum.tokens ?? 0;
  const pendingTokens = wallet ? withdrawableTokens(wallet) : 0;
  const isCreator = Boolean(user.modelProfileId);

  return (
    <div className="container max-w-2xl space-y-6 py-6">
      <h1 className="font-heading text-3xl uppercase tracking-wide">Equipo</h1>

      {invites.length > 0 && (
        <section className="space-y-2">
          <h2 className="px-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Invitaciones
          </h2>
          {invites.map((t) => (
            <div
              key={t.id}
              className="space-y-3 rounded-2xl border border-primary/40 bg-primary/5 p-4"
            >
              <div className="flex items-center gap-3">
                <Avatar className="h-10 w-10">
                  {t.model.avatarUrl && <AvatarImage src={t.model.avatarUrl} alt="" />}
                  <AvatarFallback>{initials(t.model.stageName)}</AvatarFallback>
                </Avatar>
                <span className="min-w-0 flex-1 text-sm">
                  <strong>{t.model.stageName}</strong> quiere que lleves sus mensajes. Cobrarias el{' '}
                  <strong>{t.percent}%</strong> de lo que ella gane en cada venta que hagas en sus
                  chats.
                </span>
              </div>
              <div className="flex justify-end">
                <InviteResponse id={t.id} />
              </div>
            </div>
          ))}
        </section>
      )}

      <section className="space-y-2">
        <h2 className="px-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          Llevas los mensajes de
        </h2>
        {active.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border/60 px-6 py-10 text-center text-sm text-muted-foreground">
            <UsersRound className="h-6 w-6" />
            Cuando una creadora te invite a su equipo, aparecera aqui.
          </div>
        ) : (
          <ul className="divide-y divide-border/60 overflow-hidden rounded-2xl border border-border/60 bg-card">
            {active.map((t) => (
              <li key={t.id} className="flex items-center gap-3 px-4 py-3">
                <Avatar className="h-10 w-10">
                  {t.model.avatarUrl && <AvatarImage src={t.model.avatarUrl} alt="" />}
                  <AvatarFallback>{initials(t.model.stageName)}</AvatarFallback>
                </Avatar>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{t.model.stageName}</span>
                  <span className="block text-xs text-muted-foreground">
                    Cobras el {t.percent}%
                  </span>
                </span>
                <LeaveTeamButton id={t.id} />
                <Link
                  href={`/mensajes?equipo=${t.model.id}`}
                  className="inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground"
                >
                  Bandeja <ChevronRight className="h-4 w-4" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3 rounded-2xl border border-border/60 bg-card p-4">
        <p className="flex items-center gap-2 font-semibold">
          <Wallet className="h-4 w-4 text-primary" /> Lo que has ganado
        </p>
        <div className="grid grid-cols-3 gap-2 text-center text-xs">
          <Mini label="Total ganado" value={formatMoney(tokensToPayoutCents(earnedTokens))} />
          <Mini label="Por cobrar" value={formatMoney(tokensToPayoutCents(pendingTokens))} />
          <Mini label="Ya cobrado" value={formatMoney(paid._sum.amountCents ?? 0)} />
        </div>
        <p className="text-xs text-muted-foreground">
          {isCreator
            ? 'Lo que ganas como chatter se suma a tu saldo de creadora y lo retiras igual, desde tu panel.'
            : `Te pagamos cada semana a partir de ${formatMoney(tokensToPayoutCents(config.economy.minPayoutTokens))}. Al cobrar se descuenta un ${config.economy.payoutFeePercent}%: si tienes ${formatMoney(tokensToPayoutCents(pendingTokens))}, recibes ${formatMoney(tokensToPayoutCents(splitPayoutFee(pendingTokens).netTokens))}.`}
        </p>
      </section>

      <section className="space-y-2 rounded-2xl border border-border/60 bg-card p-4 text-sm">
        <p className="flex items-center gap-2 font-semibold">
          <ShieldCheck className="h-4 w-4 text-primary" /> Normas
        </p>
        <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
          <li>Escribes en nombre de la creadora. Ella ve todo lo que escribes.</li>
          <li>Nada de pedir pagos, telefonos o redes fuera de FantasyLive ni prometer citas.</li>
          <li>Cuenta como venta tuya cada archivo de pago que envies y el fan desbloquee.</li>
          <li>Si incumples las normas, la creadora o el equipo de FantasyLive pueden quitarte.</li>
        </ul>
      </section>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-muted/40 p-2">
      <p className="text-muted-foreground">{label}</p>
      <p className="font-bold">{value}</p>
    </div>
  );
}
