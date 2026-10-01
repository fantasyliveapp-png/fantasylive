import type { Metadata } from 'next';
import Link from 'next/link';
import { CalendarDays, Coins, Gift, Inbox, MessageCircle } from 'lucide-react';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { requireUser } from '@/lib/auth/guards';
import { getInbox, type InboxThread } from '@/lib/chat';
import { cn, initials, relativeTime } from '@/lib/utils';

export const metadata: Metadata = { title: 'Mensajes' };
export const dynamic = 'force-dynamic';

type Filter = 'todos' | 'sin-responder' | 'pedidos' | 'reservas';

const FILTERS: { id: Filter; label: string; match: (t: InboxThread) => boolean }[] = [
  { id: 'todos', label: 'Todos', match: () => true },
  { id: 'sin-responder', label: 'Sin responder', match: (t) => t.unread },
  { id: 'pedidos', label: 'Con pedido', match: (t) => t.deal?.kind === 'request' },
  { id: 'reservas', label: 'Con reserva', match: (t) => t.deal?.kind === 'booking' },
];

/**
 * MENSAJES
 *
 * Una sola bandeja para todos: chats con fans, con creadores y entre
 * personas. Los pedidos a medida y las citas viven DENTRO de cada chat (como
 * tarjetas), y aqui cada conversacion dice si tiene alguno en marcha. Las
 * solicitudes de quien no sigues esperan en "Por aceptar".
 */
export default async function MessagesPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; filtro?: string }>;
}) {
  const user = await requireUser('/mensajes');
  const { tab, filtro: rawFiltro } = await searchParams;
  // Enlaces antiguos: ?filtro=citas.
  const filtro = rawFiltro === 'citas' ? 'reservas' : rawFiltro;
  const threads = await getInbox(user.id, user.modelProfileId);

  const requests = threads.filter((t) => t.isRequest);
  const chats = threads.filter((t) => !t.isRequest);
  const showRequests = tab === 'por-aceptar' || tab === 'solicitudes';
  const filter: Filter = FILTERS.some((f) => f.id === filtro) ? (filtro as Filter) : 'todos';
  const current = FILTERS.find((f) => f.id === filter)!;
  // Lo que te toca hacer (entregar, confirmar, pagar...) va primero.
  const list = showRequests
    ? requests
    : chats
        .filter(current.match)
        .sort((a, b) => Number(Boolean(b.deal?.action)) - Number(Boolean(a.deal?.action)));

  return (
    <div className="container max-w-2xl space-y-4 py-6">
      <h1 className="font-heading text-3xl uppercase tracking-wide">Mensajes</h1>

      <div className="grid grid-cols-2 border-b border-border/60">
        <TabLink href="/mensajes" active={!showRequests} label="Chats" />
        <TabLink
          href="/mensajes?tab=por-aceptar"
          active={showRequests}
          label="Por aceptar"
          count={requests.length}
        />
      </div>

      {!showRequests && (
        <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 [scrollbar-width:none]">
          {FILTERS.map((f) => {
            const n = chats.filter(f.match).length;
            if (f.id !== 'todos' && n === 0) return null;
            return (
              <Link
                key={f.id}
                href={f.id === 'todos' ? '/mensajes' : `/mensajes?filtro=${f.id}`}
                scroll={false}
                className={cn(
                  'shrink-0 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors',
                  filter === f.id
                    ? 'border-foreground bg-foreground text-background'
                    : 'border-border/60 text-muted-foreground hover:text-foreground',
                )}
              >
                {f.label}
                {f.id !== 'todos' && <span className="ml-1 text-xs opacity-70">{n}</span>}
              </Link>
            );
          })}
        </div>
      )}

      {showRequests && requests.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Mensajes de quien aún no conoces. No sabrán que los has visto hasta que respondas o
          aceptes.
        </p>
      )}

      {list.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border/60 px-6 py-14 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            {showRequests ? (
              <Inbox className="h-5 w-5 text-muted-foreground" />
            ) : (
              <MessageCircle className="h-5 w-5 text-muted-foreground" />
            )}
          </span>
          <p className="font-medium">
            {showRequests
              ? 'Nadie espera que le aceptes'
              : filter === 'todos'
                ? 'Aún no tienes conversaciones'
                : 'Nada en este filtro'}
          </p>
          {!showRequests && filter === 'todos' && (
            <p className="max-w-xs text-sm text-muted-foreground">
              Entra en el perfil de alguien y toca &laquo;Mensaje&raquo; para empezar.
            </p>
          )}
        </div>
      ) : (
        <ul className="divide-y divide-border/60 overflow-hidden rounded-2xl border border-border/60 bg-card">
          {list.map((t) => (
            <ThreadRow key={t.key} thread={t} />
          ))}
        </ul>
      )}
    </div>
  );
}

function TabLink({
  href,
  active,
  label,
  count,
}: {
  href: string;
  active: boolean;
  label: string;
  count?: number;
}) {
  return (
    <Link
      href={href}
      className={cn(
        'flex items-center justify-center gap-2 border-b-2 py-3 text-sm font-medium transition-colors',
        active ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground',
      )}
    >
      {label}
      {count !== undefined && count > 0 && (
        <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-bold text-primary-foreground">
          {count}
        </span>
      )}
    </Link>
  );
}

function ThreadRow({ thread: t }: { thread: InboxThread }) {
  const DealIcon = t.deal?.kind === 'booking' ? CalendarDays : Gift;
  return (
    <li>
      <Link href={t.href} className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/40">
        <Avatar className="h-12 w-12 shrink-0">
          {t.image && <AvatarImage src={t.image} alt="" />}
          <AvatarFallback>{initials(t.name)}</AvatarFallback>
        </Avatar>
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span className={cn('truncate text-sm', t.unread ? 'font-semibold' : 'font-medium')}>
              {t.name}
            </span>
            {t.paid && <Coins className="h-3 w-3 shrink-0 text-token" aria-label="Chat de pago" />}
            <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">
              {relativeTime(t.lastAt)}
            </span>
          </span>
          <span
            className={cn(
              'mt-0.5 block truncate text-xs',
              t.unread ? 'text-foreground/80' : 'text-muted-foreground',
            )}
          >
            {t.pendingOut ? 'Solicitud enviada · esperando respuesta' : t.preview || (t.deal ? '' : 'Sin mensajes')}
          </span>
          {t.deal && (
            <span
              className={cn(
                'mt-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold',
                t.deal.action ? 'bg-primary text-primary-foreground' : 'bg-champagne-gold/15 text-champagne-gold',
              )}
            >
              <DealIcon className="h-3 w-3" />
              {t.deal.label}
            </span>
          )}
        </span>
        {t.unread && !t.isRequest && <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-primary" />}
      </Link>
    </li>
  );
}
