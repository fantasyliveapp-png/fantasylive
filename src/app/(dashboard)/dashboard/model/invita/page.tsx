import type { Metadata } from 'next';
import {
  BadgeCheck,
  Clock,
  Crown,
  Heart,
  Infinity as InfinityIcon,
  Sparkles,
  Users,
  Wallet,
} from 'lucide-react';

import { ReferralLink } from '@/components/model/referral-link';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { requireModel } from '@/lib/auth/guards';
import { effectiveTerms } from '@/lib/deals';
import { founderLabel, gw } from '@/lib/gender-words';
import { config } from '@/lib/config';
import { prisma } from '@/lib/prisma';
import {
  AMBASSADOR_MONTHS,
  FAN_LINK_MONTHS,
  FAN_LINK_PLATFORM_PERCENT,
  FOUNDER_SPOTS,
} from '@/lib/referrals';
import { tokensToNetPayoutCents } from '@/lib/tokens';
import { cn, formatMoney, initials } from '@/lib/utils';

export const metadata: Metadata = { title: 'Invita y gana' };
export const dynamic = 'force-dynamic';

/**
 * INVITA Y GANA (programa de referidos de la creadora).
 *
 * Sus dos enlaces (fans y creadoras), lo que ya ha ganado, a quien ha
 * traido y si es Fundadora. Todo se paga de la comision de la plataforma y
 * solo cuando ya ha entrado dinero: nada por registrarse.
 */
export default async function InvitePage() {
  const { user, profile } = await requireModel();
  // Si tiene trato, sus % negociados; si no, los estandar.
  const terms = effectiveTerms(profile);
  const ambassadorPercent = terms.ambassadorPercent;
  const base = config.app.url.replace(/\/$/, '');
  const fanLink = `${base}/r/${profile.slug}`;
  const creatorLink = `${base}/r/${profile.slug}/creador`;

  const [referred, earned, foundersTaken] = await Promise.all([
    prisma.user.findMany({
      where: { referredById: user.id },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        createdAt: true,
        modelProfile: {
          select: { stageName: true, avatarUrl: true, kycStatus: true, slug: true },
        },
      },
    }),
    prisma.transaction.aggregate({
      where: { userId: user.id, type: 'REFERRAL_EARNING' },
      _sum: { tokens: true },
    }),
    prisma.modelProfile.count({ where: { founderNumber: { not: null } } }),
  ]);

  const fans = referred.filter((r) => !r.modelProfile);
  const creators = referred.filter((r) => r.modelProfile);
  const earnedCents = tokensToNetPayoutCents(earned._sum.tokens ?? 0);
  const isFounder = profile.founderNumber != null;
  const spotsLeft = Math.max(0, FOUNDER_SPOTS - foundersTaken);
  const normalShare = 100 - terms.platformPercent;
  const fanShare = 100 - Math.min(FAN_LINK_PLATFORM_PERCENT, terms.platformPercent);

  return (
    <div className="space-y-5">
      <header>
        <h1 className="font-heading text-3xl uppercase tracking-wide">Invita y gana</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Trae a tus fans y a otros creadores. Ganas mas, sin pagar nada.
        </p>
      </header>

      {/* Estado de Fundadora */}
      <section
        className={cn(
          'relative overflow-hidden rounded-3xl border p-5',
          isFounder ? 'border-champagne-gold/50 bg-champagne-gold/10' : 'border-border/60 bg-card',
        )}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute -right-16 -top-16 h-44 w-44 rounded-full bg-champagne-gold/20 blur-3xl"
        />
        <div className="relative flex items-center gap-4">
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-tr from-champagne-gold to-amber-300 text-black">
            <Crown className="h-7 w-7" />
          </span>
          <div className="min-w-0">
            {isFounder ? (
              <>
                <p className="font-heading text-xl uppercase tracking-wide">
                  {founderLabel(profile.gender)} #{profile.founderNumber}
                </p>
                <p className="text-sm text-muted-foreground">
                  Eres {gw(profile.gender, { f: 'de las', m: 'de los', pl: 'de los' })} {FOUNDER_SPOTS}{' '}
                  {gw(profile.gender, { f: 'primeras', m: 'primeros', pl: 'primeros' })}: tu insignia y lo que
                  ganas por cada creador que invites son{' '}
                  <strong className="text-foreground">para siempre</strong>.
                </p>
              </>
            ) : (
              <>
                <p className="font-heading text-xl uppercase tracking-wide">Programa Fundadores</p>
                <p className="text-sm text-muted-foreground">
                  {spotsLeft > 0
                    ? `Los ${FOUNDER_SPOTS} primeros perfiles verificados llevan la insignia de fundacion y ganan por invitar creadores para siempre. Quedan ${spotsLeft} plazas.`
                    : `Las ${FOUNDER_SPOTS} plazas de fundacion ya estan cogidas. Ganas por cada creador que invites durante ${AMBASSADOR_MONTHS} meses.`}
                </p>
              </>
            )}
          </div>
        </div>
      </section>

      {/* Lo ganado */}
      <section className="grid grid-cols-3 gap-2">
        <Stat icon={Wallet} label="Ganado invitando" value={formatMoney(earnedCents)} highlight />
        <Stat icon={Heart} label="Fans traidos" value={String(fans.length)} />
        <Stat icon={Users} label="Creadores" value={String(creators.length)} />
      </section>

      {/* Enlace para fans */}
      <section className="space-y-3 rounded-2xl border border-border/60 bg-card p-4">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
            <Heart className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h2 className="font-semibold">Tus fans, mas ganancia</h2>
            <p className="text-sm text-muted-foreground">
              Ponlo en tu Instagram, TikTok o X.{' '}
              {fanShare > normalShare ? (
                <>
                  Los fans que entren por aqui te dejan mas: por cada {formatMoney(1000)} que gasten contigo
                  ganas <strong className="text-foreground">{formatMoney(fanShare * 10)}</strong> en vez de{' '}
                  {formatMoney(normalShare * 10)}, durante sus primeros {FAN_LINK_MONTHS} meses.
                </>
              ) : (
                <>
                  Los fans que entren por aqui llegan directo a tu perfil: por cada {formatMoney(1000)} que
                  gasten contigo ganas <strong className="text-foreground">{formatMoney(fanShare * 10)}</strong>.
                </>
              )}
            </p>
          </div>
        </div>
        <ReferralLink url={fanLink} shareText="Encuentrame en Fantasy Live" />
      </section>

      {/* Enlace para creadoras */}
      <section className="space-y-3 rounded-2xl border border-border/60 bg-card p-4">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-champagne-gold/15 text-champagne-gold">
            <Sparkles className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h2 className="font-semibold">Invita a otros creadores</h2>
            <p className="text-sm text-muted-foreground">
              Cuando un creador que invites venda, ganas{' '}
              <strong className="text-foreground">{formatMoney(ambassadorPercent * 100)} por cada {formatMoney(10000)} que venda</strong>{' '}
              {isFounder ? 'para siempre' : `durante ${AMBASSADOR_MONTHS} meses`}. A esa persona no le
              quitamos nada.
            </p>
          </div>
        </div>
        <ReferralLink url={creatorLink} shareText="Unete a Fantasy Live como creador" />
        <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <BadgeCheck className="h-3.5 w-3.5" />
          Cuenta cuando verifica su identidad y hace su primera venta.
        </p>
      </section>

      {/* Creadoras invitadas */}
      {creators.length > 0 && (
        <section>
          <h2 className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Creadores que has invitado
          </h2>
          <ul className="divide-y divide-border/60 overflow-hidden rounded-2xl border border-border/60 bg-card">
            {creators.map((c) => {
              const m = c.modelProfile!;
              const verified = m.kycStatus === 'APPROVED';
              return (
                <li key={c.id} className="flex items-center gap-3 px-4 py-3">
                  <Avatar className="h-10 w-10">
                    {m.avatarUrl && <AvatarImage src={m.avatarUrl} alt="" />}
                    <AvatarFallback>{initials(m.stageName)}</AvatarFallback>
                  </Avatar>
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold">{m.stageName}</span>
                  <span
                    className={cn(
                      'flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium',
                      verified
                        ? 'bg-state-connected/15 text-state-connected'
                        : 'bg-amber-500/15 text-amber-500',
                    )}
                  >
                    {verified ? <BadgeCheck className="h-3 w-3" /> : <Clock className="h-3 w-3" />}
                    {verified ? 'Activa' : 'Verificandose'}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <InfinityIcon className="h-3.5 w-3.5" />
        Lo que ganas invitando se suma a tu dinero y se retira igual que el resto.
      </p>
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
