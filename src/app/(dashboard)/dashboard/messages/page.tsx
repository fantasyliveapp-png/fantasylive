import type { Metadata } from 'next';
import Link from 'next/link';
import { MessageCircle } from 'lucide-react';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Card, CardContent } from '@/components/ui/card';
import { requireUser } from '@/lib/auth/guards';
import { prisma } from '@/lib/prisma';
import { initials, relativeTime } from '@/lib/utils';

export const metadata: Metadata = { title: 'Mensajes' };
export const dynamic = 'force-dynamic';

export default async function UserMessagesPage() {
  const user = await requireUser('/dashboard/messages');

  const conversations = await prisma.conversation.findMany({
    where: { userId: user.id },
    orderBy: { lastMessageAt: 'desc' },
    include: {
      model: { select: { stageName: true, slug: true, avatarUrl: true } },
      messages: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        include: { attachment: { select: { id: true } } },
      },
    },
  });

  return (
    <div className="container py-10">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Mensajes</h1>
        <p className="mt-2 text-muted-foreground">
          Tus conversaciones desbloqueadas con modelos.
        </p>
      </div>

      {conversations.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <MessageCircle className="mx-auto h-8 w-8 text-muted-foreground" />
            <p className="mt-3 font-medium">Todavia no tenes conversaciones</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Entra al perfil de una modelo con mensajeria activada para
              escribirle.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {conversations.map((c) => (
            <Link key={c.id} href={`/dashboard/messages/${c.model.slug}`}>
              <Card className="transition-colors hover:border-primary/50">
                <CardContent className="flex items-center gap-3 py-4">
                  <Avatar className="h-10 w-10">
                    {c.model.avatarUrl && <AvatarImage src={c.model.avatarUrl} alt="" />}
                    <AvatarFallback>{initials(c.model.stageName)}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{c.model.stageName}</p>
                    <p className="truncate text-sm text-muted-foreground">
                      {c.messages[0]
                        ? c.messages[0].body ??
                          (c.messages[0].attachment ? 'Archivo adjunto' : '')
                        : 'Sin mensajes'}
                    </p>
                  </div>
                  <p className="shrink-0 text-xs text-muted-foreground">
                    {relativeTime(c.lastMessageAt)}
                  </p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
