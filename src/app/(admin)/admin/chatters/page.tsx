import type { Metadata } from 'next';

import { AdminPageHeader } from '@/components/admin/admin-shell';
import { PayChatterButton } from '@/components/admin/admin-tools';
import { Empty, Panel, PersonLink, Pill } from '@/components/admin/admin-ui';
import { requireAdmin } from '@/lib/auth/guards';
import { getChattersForAdmin } from '@/lib/chat-team';
import { config } from '@/lib/config';
import { splitPayoutFee, tokensToPayoutCents } from '@/lib/tokens';
import { formatMoney } from '@/lib/utils';

export const metadata: Metadata = { title: 'Chatters' };
export const dynamic = 'force-dynamic';

/**
 * CHATTERS: personas que llevan los mensajes de una creadora. Cobran un %
 * de lo que venden, sacado de la parte de ella. Si tambien son creadoras
 * retiran solas; al resto se les paga a mano cada semana, como a los
 * reclutadores.
 */
export default async function ChattersAdminPage() {
  await requireAdmin();
  const chatters = await getChattersForAdmin();
  const min = config.economy.minPayoutTokens;

  return (
    <>
      <AdminPageHeader
        title="Chatters"
        description="Personas que contestan los mensajes de una creadora. Su % sale de la parte de ella; a ti no te cambia la comision. En cada chat ves que mensaje escribio cada uno."
      />
      <Panel title="Todos los chatters" aside={`${chatters.length}`}>
        {chatters.length === 0 ? (
          <Empty>Ninguna creadora ha invitado chatters todavia.</Empty>
        ) : (
          <ul className="divide-y divide-white/[0.06]">
            {chatters.map((c) => {
              const payNow = splitPayoutFee(c.pendingTokens).netTokens;
              return (
                <li key={c.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3.5">
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <PersonLink id={c.id} name={c.username ? `@${c.username}` : c.email} />
                      {c.isCreator && <Pill tone="brand">Tambien es creadora</Pill>}
                      {c.status !== 'ACTIVE' && <Pill tone="bad">{c.status}</Pill>}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {c.teams
                        .map(
                          (t) =>
                            `${t.model.stageName} (${t.percent}%${t.status === 'ACTIVE' ? '' : t.status === 'INVITED' ? ', invitado' : ', ya no'})`,
                        )
                        .join(' · ')}
                    </p>
                  </div>
                  <div className="text-right text-xs">
                    <p className="text-muted-foreground">
                      Ganado {formatMoney(tokensToPayoutCents(c.earnedTokens))}
                    </p>
                    <p className="text-sm font-semibold text-state-connected">
                      Por pagar {formatMoney(tokensToPayoutCents(c.pendingTokens))}
                    </p>
                  </div>
                  {c.isCreator ? (
                    <span className="w-28 text-right text-[11px] text-muted-foreground">
                      Retira desde su panel
                    </span>
                  ) : (
                    <PayChatterButton
                      userId={c.id}
                      username={c.username ?? c.email}
                      payNow={formatMoney(tokensToPayoutCents(payNow))}
                      pending={formatMoney(tokensToPayoutCents(c.pendingTokens))}
                      disabled={c.pendingTokens < min}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </>
  );
}
