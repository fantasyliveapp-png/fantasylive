import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft, ChevronRight, Coins, Inbox, MessageCircle, UsersRound } from 'lucide-react';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { requireUser } from '@/lib/auth/guards';
import { getInbox, type InboxThread } from '@/lib/chat';
import { getMyTeams } from '@/lib/chat-team';
import { cn, initials, relativeTime } from '@/lib/utils';

export const metadata: Metadata = { title: 'Mensajes' };
export const dynamic = 'force-dynamic';

/**
 * MENSAJES
 *
 * Una sola bandeja para todos: chats con fans, con creadoras y entre
 * personas. Las solicitudes (de quien no sigues) van en su pestana hasta que
 * las aceptas, como en Instagram.
 */
export default async function MessagesPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; equipo?: string }>;
}) {
  const user = await requireUser('/mensajes');
  const { tab, equipo } = await searchParams;
  const teams = await getMyTeams(user.id);
  const activeTeams = teams.filter((t) => t.status === 'ACTIVE');
  const invites = teams.filter((t) => t.status === 'INVITED');

  // Bandeja de una creadora para la que lleva los mensajes (chatter).
  const team = equipo ? activeTeams.find((t) => t.model.id === equipo) : undefined;
  if (team) {
    const teamThreads = await getInbox(team.model.userId, team.model.id, {
      onlyCreatorChats: true,
    });
    return (
      <div className="container max-w-2xl space-y-4 py-6">
        <div className="flex items-center gap-3">
          <Link href="/mensajes" className="rounded-full p-1.5 hover:bg-muted" aria-label="Volver">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <Avatar className="h-10 w-10">
            {team.model.avatarUrl && <AvatarImage src={team.model.avatarUrl} alt="" />}
            <AvatarFallback>{initials(team.model.stageName)}</AvatarFallback>
          </Avatar>
          <span className="min-w-0">
            <span className="block truncate font-semibold">Bandeja de {team.model.stageName}</span>
            <span className="block text-xs text-muted-foreground">
              Escribes como ella · cobras el {team.percent}% de lo que vendas
            </span>
          </span>
        </div>
        {teamThreads.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border/60 px-6 py-14 text-center text-sm text-muted-foreground">
            Aun no tiene conversaciones con fans.
          </div>
        ) : (
          <ul className="divide-y divide-border/60 overflow-hidden rounded-2xl border border-border/60 bg-card">
            {teamThreads.map((t) => (
              <ThreadRow key={t.key} thread={t} />
            ))}
          </ul>
        )}
      </div>
    );
  }

  const threads = await getInbox(user.id, user.modelProfileId);

  const requests = threads.filter((t) => t.isRequest);
  const chats = threads.filter((t) => !t.isRequest);
  const showRequests = tab === 'solicitudes';
  const list = showRequests ? requests : chats;

  return (
    <div className="container max-w-2xl space-y-4 py-6">
      <h1 className="font-heading text-3xl uppercase tracking-wide">Mensajes</h1>

      {(activeTeams.length > 0 || invites.length > 0) && (
        <div className="space-y-2">
          {invites.length > 0 && (
            <Link
              href="/equipo"
              className="flex items-center gap-3 rounded-2xl border border-primary/40 bg-primary/10 px-4 py-3 text-sm"
            >
              <UsersRound className="h-5 w-5 shrink-0 text-primary" />
              <span className="flex-1">
                {invites.length === 1
                  ? `${invites[0]!.model.stageName} te invita a llevar sus mensajes`
                  : `Tienes ${invites.length} invitaciones para llevar mensajes`}
              </span>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </Link>
          )}
          {activeTeams.map((t) => (
            <Link
              key={t.id}
              href={`/mensajes?equipo=${t.model.id}`}
              className="flex items-center gap-3 rounded-2xl border border-border/60 bg-card px-4 py-3 text-sm hover:bg-muted/40"
            >
              <Avatar className="h-9 w-9">
                {t.model.avatarUrl && <AvatarImage src={t.model.avatarUrl} alt="" />}
                <AvatarFallback>{initials(t.model.stageName)}</AvatarFallback>
              </Avatar>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">Bandeja de {t.model.stageName}</span>
                <span className="block text-xs text-muted-foreground">Llevas sus mensajes</span>
              </span>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </Link>
          ))}
          {activeTeams.length > 0 && (
            <Link href="/equipo" className="block px-1 text-xs text-primary hover:underline">
              Ver lo que has ganado como chatter
            </Link>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 border-b border-border/60">
        <TabLink href="/mensajes" active={!showRequests} label="Chats" />
        <TabLink
          href="/mensajes?tab=solicitudes"
          active={showRequests}
          label="Solicitudes"
          count={requests.length}
        />
      </div>

      {showRequests && requests.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Mensajes de personas que no sigues. No sabran que los has visto hasta que
          respondas o aceptes.
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
            {showRequests ? 'No tienes solicitudes' : 'Aun no tienes conversaciones'}
          </p>
          {!showRequests && (
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
            {t.pendingOut ? 'Solicitud enviada · esperando respuesta' : t.preview || 'Sin mensajes'}
          </span>
        </span>
        {t.unread && !t.isRequest && <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-primary" />}
      </Link>
    </li>
  );
}
