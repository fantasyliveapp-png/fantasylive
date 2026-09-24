import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, Bot, Lock, ShieldAlert } from 'lucide-react';

import { AdminPageHeader } from '@/components/admin/admin-shell';
import { Empty, Panel, PersonLink } from '@/components/admin/admin-ui';
import { getAdminChat, type ChatKind } from '@/lib/admin-supervision';
import { requireAdmin } from '@/lib/auth/guards';
import { prisma } from '@/lib/prisma';
import { cn, formatDateTime } from '@/lib/utils';

export const metadata: Metadata = { title: 'Conversacion' };
export const dynamic = 'force-dynamic';

export default async function AdminChatPage({
  params,
}: {
  params: Promise<{ kind: string; id: string }>;
}) {
  const admin = await requireAdmin();
  const { kind, id } = await params;
  if (kind !== 'fan' && kind !== 'peer') notFound();

  const chat = await getAdminChat(kind as ChatKind, id);
  if (!chat) notFound();

  // Leer un chat privado siempre deja rastro.
  await prisma.auditLog.create({
    data: {
      actorId: admin.id,
      action: 'CHAT_VIEWED',
      entityType: kind === 'fan' ? 'Conversation' : 'PeerChat',
      entityId: chat.id,
    },
  });

  const [left, right] = chat.people;
  const reports = await prisma.report.findMany({
    where: { context: `${kind === 'fan' ? 'conversation' : 'chat'}:${chat.id}` },
    select: { id: true },
  });

  return (
    <>
      <Link
        href="/admin/chats"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Mensajes
      </Link>
      <AdminPageHeader
        title={`${left!.name} y ${right!.name}`}
        description={`${chat.note} · desde ${formatDateTime(chat.createdAt)}${
          reports.length ? ` · ${reports.length} denuncia(s)` : ''
        }`}
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
        <Panel title="Conversacion" aside={`${chat.messages.length} mensajes`}>
          {chat.messages.length === 0 ? (
            <Empty>Aun no hay mensajes.</Empty>
          ) : (
            <ol className="max-h-[70vh] space-y-3 overflow-y-auto p-5">
              {chat.messages.map((m) => {
                const mine = m.senderId === right!.id;
                const who = mine ? right! : left!;
                return (
                  <li key={m.id} className={cn('flex flex-col', mine ? 'items-end' : 'items-start')}>
                    <span className="mb-0.5 px-1 text-[11px] text-muted-foreground">
                      {who.name} · {formatDateTime(m.createdAt)}
                      {m.isAi && (
                        <span className="ml-1 inline-flex items-center gap-0.5 text-primary">
                          <Bot className="h-3 w-3" /> IA
                        </span>
                      )}
                      {m.writtenBy && (
                        <Link
                          href={`/admin/users/${m.writtenBy.id}`}
                          className="ml-1 text-amber-500 hover:underline"
                        >
                          escrito por chatter @{m.writtenBy.username ?? 'sin usuario'}
                        </Link>
                      )}
                    </span>
                    <div
                      className={cn(
                        'max-w-[80%] space-y-2 rounded-2xl px-3.5 py-2 text-sm',
                        mine ? 'rounded-br-md bg-primary/20' : 'rounded-bl-md bg-white/[0.06]',
                      )}
                    >
                      {m.attachment && (
                        <div>
                          {!m.attachment.url ? (
                            <p className="text-xs text-muted-foreground">Archivo no disponible</p>
                          ) : m.attachment.isVideo ? (
                            <video src={m.attachment.url} controls className="max-h-72 rounded-lg" />
                          ) : m.attachment.isImage ? (
                            <a href={m.attachment.url} target="_blank" rel="noreferrer">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={m.attachment.url} alt="" className="max-h-72 rounded-lg" />
                            </a>
                          ) : (
                            <a href={m.attachment.url} target="_blank" rel="noreferrer" className="underline">
                              Ver archivo
                            </a>
                          )}
                          {m.attachment.priceTokens > 0 && (
                            <p className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
                              <Lock className="h-3 w-3" /> De pago: {m.attachment.priceTokens} tokens
                            </p>
                          )}
                        </div>
                      )}
                      {m.body && <p className="whitespace-pre-wrap break-words">{m.body}</p>}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </Panel>

        <div className="space-y-6">
          <Panel title="Participantes">
            <ul className="space-y-3 px-5 py-4">
              {chat.people.map((p) => (
                <li key={p.id}>
                  <PersonLink id={p.id} name={p.name} username={p.username} image={p.image} />
                </li>
              ))}
            </ul>
          </Panel>
          <div className="flex items-start gap-2 rounded-lg border border-white/[0.06] px-4 py-3 text-xs text-muted-foreground">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
            Has abierto este chat como admin. Queda registrado en la actividad. Para actuar, entra
            en la ficha de la persona.
          </div>
        </div>
      </div>
    </>
  );
}
