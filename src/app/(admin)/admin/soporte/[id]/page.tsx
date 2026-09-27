import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, LifeBuoy } from 'lucide-react';

import { AdminPageHeader } from '@/components/admin/admin-shell';
import { AdminReplyBox } from '@/components/admin/admin-tools';
import { Panel, PersonLink, Pill } from '@/components/admin/admin-ui';
import { personOf } from '@/lib/admin-supervision';
import { requireAdmin } from '@/lib/auth/guards';
import { creatorLabel } from '@/lib/gender-words';
import { prisma } from '@/lib/prisma';
import { SUPPORT_STATUS_LABELS, supportCategoryLabel } from '@/lib/support';
import { cn, formatDate, formatDateTime, formatTokens } from '@/lib/utils';

export const metadata: Metadata = { title: 'Consulta' };
export const dynamic = 'force-dynamic';

export default async function AdminTicketPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const ticket = await prisma.supportTicket.findUnique({
    where: { id },
    select: {
      id: true,
      subject: true,
      category: true,
      status: true,
      createdAt: true,
      user: {
        select: {
          id: true,
          name: true,
          username: true,
          email: true,
          image: true,
          createdAt: true,
          status: true,
          wallet: { select: { balance: true } },
          modelProfile: { select: { stageName: true, avatarUrl: true, kycStatus: true, gender: true } },
        },
      },
      messages: {
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          body: true,
          fromStaff: true,
          createdAt: true,
          author: { select: { name: true, username: true } },
        },
      },
    },
  });
  if (!ticket) notFound();
  const u = personOf(ticket.user);

  return (
    <>
      <Link
        href="/admin/soporte"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Soporte
      </Link>
      <AdminPageHeader
        title={ticket.subject}
        description={`${supportCategoryLabel(ticket.category)} · abierta ${formatDateTime(ticket.createdAt)}`}
        actions={
          <Pill tone={ticket.status === 'OPEN' ? 'warn' : ticket.status === 'ANSWERED' ? 'good' : 'neutral'}>
            {SUPPORT_STATUS_LABELS[ticket.status]}
          </Pill>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
        <Panel title="Conversacion">
          <ol className="max-h-[60vh] space-y-3 overflow-y-auto p-5">
            {ticket.messages.map((m) => (
              <li key={m.id} className={cn('flex flex-col', m.fromStaff ? 'items-end' : 'items-start')}>
                <span className="mb-0.5 flex items-center gap-1 px-1 text-[11px] text-muted-foreground">
                  {m.fromStaff && <LifeBuoy className="h-3 w-3 text-primary" />}
                  {m.fromStaff ? `Equipo (${m.author.name ?? m.author.username})` : u.name} ·{' '}
                  {formatDateTime(m.createdAt)}
                </span>
                <p
                  className={cn(
                    'max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-4 py-2.5 text-sm',
                    m.fromStaff ? 'rounded-br-md bg-primary/20' : 'rounded-bl-md bg-white/[0.06]',
                  )}
                >
                  {m.body}
                </p>
              </li>
            ))}
          </ol>
          <AdminReplyBox ticketId={ticket.id} status={ticket.status} />
        </Panel>

        <Panel title="Quien escribe">
          <div className="space-y-3 px-5 py-4 text-sm">
            <PersonLink id={u.id} name={u.name} username={u.username} image={u.image} />
            <dl className="space-y-1.5 text-xs">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Email</dt>
                <dd className="truncate pl-2">{ticket.user.email}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Tipo</dt>
                <dd>{ticket.user.modelProfile ? creatorLabel(ticket.user.modelProfile.gender) : 'Fan'}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Alta</dt>
                <dd>{formatDate(ticket.user.createdAt)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Saldo</dt>
                <dd>{formatTokens(ticket.user.wallet?.balance ?? 0)} tokens</dd>
              </div>
            </dl>
            <Link href={`/admin/users/${u.id}`} className="block text-xs font-medium text-primary hover:underline">
              Abrir su ficha completa
            </Link>
          </div>
        </Panel>
      </div>
    </>
  );
}
