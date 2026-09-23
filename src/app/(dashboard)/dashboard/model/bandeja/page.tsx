import type { Metadata } from 'next';
import Link from 'next/link';
import {
  CalendarDays,
  ChevronRight,
  Gift,
  Inbox,
  MessageCircle,
  Paperclip,
  type LucideIcon,
} from 'lucide-react';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { requireModel } from '@/lib/auth/guards';
import { prisma } from '@/lib/prisma';
import { splitEarnings, tokensToPayoutCents } from '@/lib/tokens';
import { cn, formatDateTime, formatMoney, initials, relativeTime } from '@/lib/utils';

export const metadata: Metadata = { title: 'Bandeja' };
export const dynamic = 'force-dynamic';

type Kind = 'message' | 'request' | 'booking';
type Filter = 'todo' | 'mensajes' | 'pedidos' | 'citas';

interface InboxItem {
  id: string;
  kind: Kind;
  name: string;
  image: string | null;
  preview: string;
  at: Date;
  href: string;
  /** Espera algo de la creadora (responder, poner precio, confirmar...). */
  needsAction: boolean;
  /** Que toca hacer, o en que estado esta. */
  status: string;
  amountTokens?: number | null;
}

const KIND: Record<Kind, { icon: LucideIcon; label: string }> = {
  message: { icon: MessageCircle, label: 'Mensaje' },
  request: { icon: Gift, label: 'Pedido' },
  booking: { icon: CalendarDays, label: 'Cita' },
};

const FILTER_KIND: Record<Exclude<Filter, 'todo'>, Kind> = {
  mensajes: 'message',
  pedidos: 'request',
  citas: 'booking',
};

/**
 * BANDEJA
 *
 * Todo lo que los fans le piden a la creadora en una sola lista: mensajes,
 * pedidos a medida y citas. Arriba lo que espera respuesta; cada fila lleva a
 * la pantalla donde se resuelve (el chat, el pedido o la reserva).
 */
export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ tipo?: string }>;
}) {
  const { user, profile } = await requireModel();
  const { tipo } = await searchParams;
  const filter: Filter =
    tipo === 'mensajes' || tipo === 'pedidos' || tipo === 'citas' ? tipo : 'todo';

  const [conversations, requests, bookings, bookingsEver] = await Promise.all([
    prisma.conversation.findMany({
      where: { modelId: profile.id },
      orderBy: { lastMessageAt: 'desc' },
      take: 40,
      select: {
        id: true,
        lastMessageAt: true,
        user: { select: { name: true, image: true } },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { body: true, senderId: true, attachment: { select: { id: true } } },
        },
      },
    }),
    prisma.contentRequest.findMany({
      where: { modelId: profile.id, status: { in: ['PENDING', 'QUOTED', 'PAID'] } },
      orderBy: { createdAt: 'desc' },
      take: 40,
      select: {
        id: true,
        status: true,
        description: true,
        quotedTokens: true,
        createdAt: true,
        paidAt: true,
        user: { select: { name: true, image: true } },
      },
    }),
    prisma.booking.findMany({
      where: {
        modelId: profile.id,
        OR: [
          { status: 'PENDING_CONFIRMATION' },
          { status: 'CONFIRMED', startsAt: { gte: new Date() } },
        ],
      },
      orderBy: { startsAt: 'asc' },
      take: 40,
      select: {
        id: true,
        status: true,
        startsAt: true,
        durationMinutes: true,
        totalTokens: true,
        createdAt: true,
        user: { select: { name: true, image: true } },
      },
    }),
    prisma.booking.count({ where: { modelId: profile.id } }),
  ]);

  const items: InboxItem[] = [
    ...conversations.map((c): InboxItem => {
      const last = c.messages[0];
      const fromFan = Boolean(last && last.senderId !== user.id);
      const text = last?.body?.trim() || (last?.attachment ? 'Archivo adjunto' : 'Conversacion abierta');
      return {
        id: c.id,
        kind: 'message',
        name: c.user.name ?? 'Fan',
        image: c.user.image,
        preview: last && !fromFan ? `Tu: ${text}` : text,
        at: c.lastMessageAt,
        href: `/dashboard/model/messages/${c.id}`,
        needsAction: fromFan,
        status: fromFan ? 'Responder' : 'Respondido',
      };
    }),
    ...requests.map((r): InboxItem => ({
      id: r.id,
      kind: 'request',
      name: r.user.name ?? 'Fan',
      image: r.user.image,
      preview: r.description,
      at: r.paidAt ?? r.createdAt,
      href: '/dashboard/model/requests',
      needsAction: r.status !== 'QUOTED',
      status:
        r.status === 'PENDING'
          ? 'Ponle precio'
          : r.status === 'PAID'
            ? 'Pagado · entregalo'
            : 'Esperando pago',
      amountTokens: r.quotedTokens,
    })),
    ...bookings.map((b): InboxItem => ({
      id: b.id,
      kind: 'booking',
      name: b.user.name ?? 'Fan',
      image: b.user.image,
      preview: `Videollamada el ${formatDateTime(b.startsAt)} · ${b.durationMinutes} min`,
      at: b.createdAt,
      href: '/dashboard/model/bookings',
      needsAction: b.status === 'PENDING_CONFIRMATION',
      status: b.status === 'PENDING_CONFIRMATION' ? 'Confirmar' : 'Confirmada',
      amountTokens: b.totalTokens,
    })),
  ];

  // Solo se ofrecen los filtros de lo que la creadora usa de verdad.
  const available: Exclude<Filter, 'todo'>[] = [];
  if (profile.messagingEnabled || conversations.length > 0) available.push('mensajes');
  if (requests.length > 0) available.push('pedidos');
  if (profile.acceptsBookings || bookingsEver > 0) available.push('citas');

  const visible = items
    .filter((i) => filter === 'todo' || i.kind === FILTER_KIND[filter])
    .sort((a, b) =>
      a.needsAction === b.needsAction ? b.at.getTime() - a.at.getTime() : a.needsAction ? -1 : 1,
    );
  const waiting = visible.filter((i) => i.needsAction);
  const rest = visible.filter((i) => !i.needsAction);

  const countOf = (f: Filter) =>
    items.filter((i) => i.needsAction && (f === 'todo' || i.kind === FILTER_KIND[f])).length;

  const chips: { value: Filter; label: string }[] = [
    { value: 'todo', label: 'Todo' },
    ...available.map((v) => ({
      value: v,
      label: v === 'mensajes' ? 'Mensajes' : v === 'pedidos' ? 'Pedidos' : 'Citas',
    })),
  ];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-heading text-3xl uppercase tracking-wide">Bandeja</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Todo lo que tus fans te piden, en un solo sitio.
        </p>
      </div>

      {chips.length > 1 && (
        <div className="flex gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {chips.map((chip) => {
            const active = filter === chip.value;
            const count = countOf(chip.value);
            return (
              <Link
                key={chip.value}
                href={chip.value === 'todo' ? '/dashboard/model/bandeja' : `/dashboard/model/bandeja?tipo=${chip.value}`}
                className={cn(
                  'flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors',
                  active
                    ? 'border-foreground bg-foreground text-background'
                    : 'border-border/60 text-muted-foreground hover:text-foreground',
                )}
              >
                {chip.label}
                {count > 0 && (
                  <span
                    className={cn(
                      'flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[10px] font-bold',
                      active ? 'bg-primary text-primary-foreground' : 'bg-primary/15 text-primary',
                    )}
                  >
                    {count}
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      )}

      {visible.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border/60 px-6 py-14 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <Inbox className="h-5 w-5 text-muted-foreground" />
          </span>
          <p className="font-medium">Tu bandeja esta vacia</p>
          <p className="max-w-xs text-sm text-muted-foreground">
            Aqui apareceran los mensajes, pedidos y citas de tus fans.
          </p>
        </div>
      ) : (
        <>
          {waiting.length > 0 && (
            <InboxSection title={`Esperan tu respuesta · ${waiting.length}`} items={waiting} />
          )}
          {rest.length > 0 && (
            <InboxSection title={waiting.length > 0 ? 'Lo demas' : 'Al dia'} items={rest} muted />
          )}
        </>
      )}
    </div>
  );
}

function InboxSection({
  title,
  items,
  muted,
}: {
  title: string;
  items: InboxItem[];
  muted?: boolean;
}) {
  return (
    <section>
      <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        {title}
      </h2>
      <ul className="divide-y divide-border/60 overflow-hidden rounded-2xl border border-border/60 bg-card">
        {items.map((item) => {
          const Kind = KIND[item.kind];
          return (
            <li key={`${item.kind}-${item.id}`}>
              <Link
                href={item.href}
                className="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/40"
              >
                <span className="relative shrink-0">
                  <Avatar className="h-11 w-11">
                    {item.image && <AvatarImage src={item.image} alt="" />}
                    <AvatarFallback>{initials(item.name)}</AvatarFallback>
                  </Avatar>
                  <span className="absolute -bottom-0.5 -right-0.5 flex h-5 w-5 items-center justify-center rounded-full border-2 border-card bg-muted">
                    <Kind.icon className="h-2.5 w-2.5 text-muted-foreground" />
                  </span>
                </span>

                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-2">
                    <span className={cn('truncate text-sm', item.needsAction ? 'font-semibold' : 'font-medium')}>
                      {item.name}
                    </span>
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {relativeTime(item.at)}
                    </span>
                  </span>
                  <span
                    className={cn(
                      'mt-0.5 flex items-center gap-1 truncate text-xs',
                      item.needsAction && !muted ? 'text-foreground/80' : 'text-muted-foreground',
                    )}
                  >
                    {item.preview === 'Archivo adjunto' && <Paperclip className="h-3 w-3 shrink-0" />}
                    <span className="truncate">{item.preview}</span>
                  </span>
                </span>

                <span className="flex shrink-0 flex-col items-end gap-1">
                  <span
                    className={cn(
                      'rounded-full px-2.5 py-1 text-[11px] font-semibold',
                      item.needsAction
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted text-muted-foreground',
                    )}
                  >
                    {item.status}
                  </span>
                  {item.amountTokens ? (
                    // Lo que le llega a ella, no lo que paga el fan.
                    <span className="text-[11px] font-semibold text-state-connected">
                      +{formatMoney(
                        tokensToPayoutCents(splitEarnings(item.amountTokens).modelTokens),
                      )}
                    </span>
                  ) : null}
                </span>
                <ChevronRight className="hidden h-4 w-4 shrink-0 text-muted-foreground sm:block" />
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
