import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, LifeBuoy } from 'lucide-react';

import { TicketReplyBox } from '@/components/support/support-forms';
import { requireUser } from '@/lib/auth/guards';
import { prisma } from '@/lib/prisma';
import { SUPPORT_STATUS_LABELS, supportCategoryLabel } from '@/lib/support';
import { cn, formatDateTime } from '@/lib/utils';

export const metadata: Metadata = { title: 'Consulta de soporte' };
export const dynamic = 'force-dynamic';

export default async function SupportTicketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser(`/soporte/${id}`);
  const ticket = await prisma.supportTicket.findFirst({
    where: { id, userId: user.id },
    select: {
      id: true,
      subject: true,
      category: true,
      status: true,
      createdAt: true,
      messages: {
        orderBy: { createdAt: 'asc' },
        select: { id: true, body: true, fromStaff: true, createdAt: true },
      },
    },
  });
  if (!ticket) notFound();

  return (
    <div className="container max-w-2xl space-y-5 py-6">
      <Link href="/soporte" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Soporte
      </Link>
      <div>
        <h1 className="text-xl font-semibold">{ticket.subject}</h1>
        <p className="text-xs text-muted-foreground">
          {supportCategoryLabel(ticket.category)} · {SUPPORT_STATUS_LABELS[ticket.status]}
        </p>
      </div>

      <ol className="space-y-3">
        {ticket.messages.map((m) => (
          <li key={m.id} className={cn('flex flex-col', m.fromStaff ? 'items-start' : 'items-end')}>
            <span className="mb-0.5 flex items-center gap-1 px-1 text-[11px] text-muted-foreground">
              {m.fromStaff && <LifeBuoy className="h-3 w-3 text-primary" />}
              {m.fromStaff ? 'Equipo de FantasyLive' : 'Tu'} · {formatDateTime(m.createdAt)}
            </span>
            <p
              className={cn(
                'max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-4 py-2.5 text-sm',
                m.fromStaff ? 'rounded-bl-md bg-muted' : 'rounded-br-md bg-primary/20',
              )}
            >
              {m.body}
            </p>
          </li>
        ))}
      </ol>

      {ticket.status === 'CLOSED' && (
        <p className="text-center text-xs text-muted-foreground">
          Esta consulta esta cerrada. Si nos escribes, se vuelve a abrir.
        </p>
      )}
      <TicketReplyBox ticketId={ticket.id} />
    </div>
  );
}
