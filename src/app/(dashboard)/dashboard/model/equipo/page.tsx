import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft, ShieldCheck } from 'lucide-react';

import { InviteChatterForm, MemberControls } from '@/components/team/team-controls';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { requireModel } from '@/lib/auth/guards';
import { MAX_CHATTER_PERCENT, startOfMonth, teamSales } from '@/lib/chat-team';
import { prisma } from '@/lib/prisma';
import { cn, formatMoney, initials } from '@/lib/utils';
import { tokensToPayoutCents, tokensToRetailCents } from '@/lib/tokens';

export const metadata: Metadata = { title: 'Mi equipo' };
export const dynamic = 'force-dynamic';

/**
 * MI EQUIPO: personas que llevan los mensajes de la creadora (chatters).
 * Ella decide su % y lo paga de su parte, solo por lo que venden.
 */
export default async function TeamPage() {
  const { user, profile } = await requireModel();
  const [members, sales] = await Promise.all([
    prisma.chatAssistant.findMany({
      where: { modelId: profile.id, status: { in: ['INVITED', 'ACTIVE'] } },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        status: true,
        percent: true,
        userId: true,
        user: { select: { username: true, name: true, image: true } },
      },
    }),
    teamSales(user.id, startOfMonth()),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Link
          href="/dashboard/model/ajustes"
          className="rounded-full p-1.5 hover:bg-muted"
          aria-label="Volver"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="font-heading text-3xl uppercase tracking-wide">Mi equipo</h1>
      </div>

      <p className="text-sm text-muted-foreground">
        Invita a alguien de confianza para que conteste tus mensajes por ti. Escribe en tu nombre y
        cobra un % de lo que venda en tus chats, que sale de lo que tu ganas. No ve tu dinero, tus
        retiros ni tus datos.
      </p>

      <section className="rounded-2xl border border-border/60 bg-card p-4">
        <h2 className="mb-3 font-semibold">Invitar</h2>
        <InviteChatterForm maxPercent={MAX_CHATTER_PERCENT} />
      </section>

      <section>
        <h2 className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          Tu equipo
        </h2>
        {members.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border/60 px-6 py-10 text-center text-sm text-muted-foreground">
            Aun no has invitado a nadie.
          </div>
        ) : (
          <ul className="divide-y divide-border/60 overflow-hidden rounded-2xl border border-border/60 bg-card">
            {members.map((m) => {
              const s = sales.get(m.userId);
              const name = m.user.username ? `@${m.user.username}` : (m.user.name ?? 'Usuario');
              return (
                <li key={m.id} className="space-y-3 p-4">
                  <div className="flex items-center gap-3">
                    <Avatar className="h-10 w-10">
                      {m.user.image && <AvatarImage src={m.user.image} alt="" />}
                      <AvatarFallback>{initials(name)}</AvatarFallback>
                    </Avatar>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{name}</span>
                      <span className="block text-xs text-muted-foreground">
                        Cobra el {m.percent}% de lo que vende
                      </span>
                    </span>
                    <span
                      className={cn(
                        'rounded-full px-2 py-0.5 text-[10px] font-bold uppercase',
                        m.status === 'ACTIVE'
                          ? 'bg-state-connected/15 text-state-connected'
                          : 'bg-amber-500/15 text-amber-500',
                      )}
                    >
                      {m.status === 'ACTIVE' ? 'Activo' : 'Invitado'}
                    </span>
                  </div>
                  {m.status === 'ACTIVE' && (
                    <div className="grid grid-cols-3 gap-2 text-center text-xs">
                      <Mini label="Ventas este mes" value={String(s?.sales ?? 0)} />
                      <Mini
                        label="Vendido"
                        value={formatMoney(tokensToRetailCents(s?.saleTokens ?? 0))}
                      />
                      <Mini
                        label="Su parte"
                        value={formatMoney(tokensToPayoutCents(s?.earnedTokens ?? 0))}
                      />
                    </div>
                  )}
                  <MemberControls id={m.id} percent={m.percent} maxPercent={MAX_CHATTER_PERCENT} />
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="space-y-2 rounded-2xl border border-border/60 bg-card p-4 text-sm">
        <p className="flex items-center gap-2 font-semibold">
          <ShieldCheck className="h-4 w-4 text-primary" /> Como funciona
        </p>
        <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
          <li>
            Ve tu bandeja desde su cuenta, en Mensajes. Tu sigues viendo todo y en cada mensaje sale
            quien lo escribio. El fan no lo ve.
          </li>
          <li>Cuenta como venta suya cada archivo de pago que envie y el fan desbloquee.</li>
          <li>
            Su % se descuenta solo de lo que tu ganas en esa venta. Maximo {MAX_CHATTER_PERCENT}%.
          </li>
          <li>
            Puedes cambiar el % o quitarlo cuando quieras. Los cambios valen para ventas nuevas.
          </li>
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
