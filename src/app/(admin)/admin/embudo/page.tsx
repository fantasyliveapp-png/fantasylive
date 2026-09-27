import type { Metadata } from 'next';
import Link from 'next/link';
import { Mail } from 'lucide-react';

import { AdminPageHeader, AdminTabs } from '@/components/admin/admin-shell';
import { Empty, Panel, PersonLink, Pill } from '@/components/admin/admin-ui';
import { requireAdmin } from '@/lib/auth/guards';
import { KYC_STATUS_LABELS } from '@/lib/constants';
import { creatorLabel, founderLabel } from '@/lib/gender-words';
import { prisma } from '@/lib/prisma';
import { cn, formatTokens } from '@/lib/utils';

export const metadata: Metadata = { title: 'Embudo de creadores' };
export const dynamic = 'force-dynamic';

type Step = 'signup' | 'kyc' | 'verified' | 'posted' | 'sold';

const STEPS: { key: Step; label: string; hint: string; stuck: string }[] = [
  { key: 'signup', label: 'Se hicieron creadores', hint: 'Crearon su perfil', stuck: 'No han enviado su verificacion' },
  { key: 'kyc', label: 'Enviaron verificacion', hint: 'Mandaron su documento', stuck: 'Verificacion pendiente o rechazada' },
  { key: 'verified', label: 'Verificados', hint: 'Ya pueden publicar', stuck: 'Verificados pero sin publicar nada' },
  { key: 'posted', label: 'Empezaron', hint: 'Publicaron o hicieron su primer directo o llamada', stuck: 'Empezaron pero aun no venden' },
  { key: 'sold', label: 'Vendieron', hint: 'Ya ganaron dinero', stuck: '' },
];

const PERIODS = [
  { value: '', label: 'Ultimos 30 dias' },
  { value: '90', label: '90 dias' },
  { value: 'todo', label: 'Desde siempre' },
];

/**
 * EMBUDO DE CREADORAS: de las que se registran como creadora, cuantas
 * llegan a vender, en que paso se quedan y quienes estan atascadas para
 * escribirles.
 */
export default async function AdminFunnelPage({
  searchParams,
}: {
  searchParams: Promise<{ periodo?: string; paso?: string }>;
}) {
  await requireAdmin();
  const sp = await searchParams;
  const periodo = PERIODS.some((p) => p.value === sp.periodo) ? (sp.periodo ?? '') : '';
  const days = periodo === 'todo' ? null : periodo === '90' ? 90 : 30;

  const creators = await prisma.modelProfile.findMany({
    where: days ? { createdAt: { gte: new Date(Date.now() - days * 86_400_000) } } : {},
    orderBy: { createdAt: 'asc' },
    take: 5000,
    select: {
      id: true,
      stageName: true,
      avatarUrl: true,
      createdAt: true,
      kycStatus: true,
      postsCount: true,
      totalTokensEarned: true,
      founderNumber: true,
      gender: true,
      user: {
        select: { id: true, username: true, email: true, referredById: true, recruitedById: true },
      },
    },
  });

  const reached = (c: (typeof creators)[number], step: Step) => {
    switch (step) {
      case 'signup':
        return true;
      case 'kyc':
        return c.kycStatus !== 'NOT_SUBMITTED';
      case 'verified':
        return c.kycStatus === 'APPROVED';
      // Cada paso incluye a las del siguiente (quien vende por llamadas sin
      // publicar cuenta como activa), asi los % nunca pasan de 100.
      case 'posted':
        return c.kycStatus === 'APPROVED' && (c.postsCount > 0 || c.totalTokensEarned > 0);
      case 'sold':
        return c.kycStatus === 'APPROVED' && c.totalTokensEarned > 0;
    }
  };
  const origin = (c: (typeof creators)[number]) =>
    c.user.recruitedById ? 'recruiter' : c.user.referredById ? 'creator' : 'direct';

  const counts = STEPS.map((s) => {
    const list = creators.filter((c) => reached(c, s.key));
    return {
      ...s,
      n: list.length,
      byOrigin: {
        creator: list.filter((c) => origin(c) === 'creator').length,
        recruiter: list.filter((c) => origin(c) === 'recruiter').length,
        direct: list.filter((c) => origin(c) === 'direct').length,
      },
    };
  });
  const top = Math.max(1, counts[0]!.n);

  // Atascadas: llegaron a un paso y no al siguiente.
  const stuckStep = (STEPS.slice(0, -1).find((s) => s.key === sp.paso) ?? STEPS[0]!).key;
  const nextStep = STEPS[STEPS.findIndex((s) => s.key === stuckStep) + 1]!.key;
  const stuck = creators
    .filter((c) => reached(c, stuckStep) && !reached(c, nextStep))
    .slice(0, 100);

  const qs = (extra: Record<string, string>) => {
    const p = new URLSearchParams();
    if (periodo) p.set('periodo', periodo);
    for (const [k, v] of Object.entries(extra)) if (v) p.set(k, v);
    const s = p.toString();
    return `/admin/embudo${s ? `?${s}` : ''}`;
  };

  return (
    <>
      <AdminPageHeader
        title="Embudo de creadores"
        description="Cuantos de los que se hacen creadores llegan a vender, en que paso se quedan y quienes estan atascados para que les escribas."
        tabs={<AdminTabs basePath="/admin/embudo" param="periodo" current={periodo} tabs={PERIODS} />}
      />

      <div className="space-y-6">
        <Panel title="De registro a primera venta" aside={`${formatTokens(counts[0]!.n)} creadores en el periodo`}>
          <div className="space-y-4 p-5">
            {counts.map((s, i) => {
              const prev = i > 0 ? counts[i - 1]!.n : null;
              const pctStep = prev ? Math.round((s.n / prev) * 100) : null;
              return (
                <div key={s.key}>
                  <div className="mb-1.5 flex items-baseline justify-between gap-3 text-sm">
                    <span>
                      <span className="font-medium">{s.label}</span>{' '}
                      <span className="text-xs text-muted-foreground">{s.hint}</span>
                    </span>
                    <span className="shrink-0 tabular-nums">
                      <span className="text-lg font-semibold">{s.n}</span>
                      {pctStep !== null && (
                        <span
                          className={cn(
                            'ml-2 text-xs',
                            pctStep >= 60 ? 'text-state-connected' : pctStep >= 30 ? 'text-amber-500' : 'text-destructive',
                          )}
                        >
                          {pctStep}% del paso anterior
                        </span>
                      )}
                    </span>
                  </div>
                  <div className="h-7 overflow-hidden rounded-md bg-white/[0.04]">
                    <div className="flex h-full" style={{ width: `${Math.max(2, (s.n / top) * 100)}%` }}>
                      <div className="h-full bg-primary" style={{ flex: s.byOrigin.direct || 0.0001 }} title={`Por su cuenta: ${s.byOrigin.direct}`} />
                      <div className="h-full bg-champagne-gold" style={{ flex: s.byOrigin.creator || 0.0001 }} title={`Invitados por otro creador: ${s.byOrigin.creator}`} />
                      <div className="h-full bg-sky-500" style={{ flex: s.byOrigin.recruiter || 0.0001 }} title={`Por reclutador: ${s.byOrigin.recruiter}`} />
                    </div>
                  </div>
                </div>
              );
            })}
            <div className="flex flex-wrap gap-4 pt-1 text-[11px] text-muted-foreground">
              <Legend cls="bg-primary" label="Llegaron por su cuenta" />
              <Legend cls="bg-champagne-gold" label="Invitados por otro creador" />
              <Legend cls="bg-sky-500" label="Traidas por un reclutador" />
            </div>
          </div>
        </Panel>

        <Panel title="Atascadas">
          <div className="flex gap-1 overflow-x-auto border-b border-white/[0.06] px-3">
            {STEPS.slice(0, -1).map((s) => (
              <Link
                key={s.key}
                href={qs({ paso: s.key === 'signup' ? '' : s.key })}
                className={cn(
                  '-mb-px shrink-0 border-b-2 px-3 py-2.5 text-xs font-medium',
                  stuckStep === s.key
                    ? 'border-primary text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground',
                )}
              >
                {s.stuck}
              </Link>
            ))}
          </div>
          {stuck.length === 0 ? (
            <Empty>Nadie atascada en este paso.</Empty>
          ) : (
            <ul className="divide-y divide-white/[0.06]">
              {stuck.map((c) => {
                const days = Math.floor((Date.now() - c.createdAt.getTime()) / 86_400_000);
                return (
                  <li key={c.id} className="flex flex-wrap items-center gap-4 px-5 py-2.5">
                    <div className="w-52 min-w-0">
                      <PersonLink id={c.user.id} name={c.stageName} username={c.user.username} image={c.avatarUrl} />
                    </div>
                    <div className="flex flex-1 flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      {stuckStep === 'kyc' && (
                        <Pill tone={c.kycStatus === 'REJECTED' ? 'bad' : 'warn'}>{KYC_STATUS_LABELS[c.kycStatus]}</Pill>
                      )}
                      {c.founderNumber && <Pill tone="gold">{founderLabel(c.gender)} #{c.founderNumber}</Pill>}
                      <span>
                        {creatorLabel(c.gender)} desde hace {days} {days === 1 ? 'dia' : 'dias'}
                        {origin(c) !== 'direct' && ` · ${origin(c) === 'creator' ? 'invitada' : 'de reclutador'}`}
                      </span>
                    </div>
                    <a
                      href={`mailto:${c.user.email}`}
                      className="inline-flex items-center gap-1.5 rounded-md bg-white/[0.06] px-2.5 py-1.5 text-xs hover:bg-white/[0.1]"
                    >
                      <Mail className="h-3.5 w-3.5" /> {c.user.email}
                    </a>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      </div>
    </>
  );
}

function Legend({ cls, label }: { cls: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={cn('h-2.5 w-2.5 rounded-sm', cls)} /> {label}
    </span>
  );
}
