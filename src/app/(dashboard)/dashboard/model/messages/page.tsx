import type { Metadata } from 'next';
import Link from 'next/link';
import { MessageCircle } from 'lucide-react';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Card, CardContent } from '@/components/ui/card';
import { requireModel } from '@/lib/auth/guards';
import { prisma } from '@/lib/prisma';
import { initials, relativeTime } from '@/lib/utils';

export const metadata: Metadata = { title: 'Mensajes' };
export const dynamic = 'force-dynamic';

export default async function ModelMessagesPage() {
  const { profile } = await requireModel();

  const conversations = await prisma.conversation.findMany({
    where: { modelId: profile.id },
    orderBy: { lastMessageAt: 'desc' },
    include: {
      user: { select: { name: true, email: true, image: true } },
      messages: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        include: { attachment: { select: { id: true } } },
      },
    },
  });

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Mensajes</h1>
        <p className="mt-2 text-muted-foreground">
          Conversaciones que tus usuarios desbloquearon.
        </p>
      </div>

      {conversations.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <MessageCircle className="mx-auto h-8 w-8 text-muted-foreground" />
            <p className="mt-3 font-medium">Todavia no tenes conversaciones</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Activa la mensajeria en Tarifas y perfil para que los usuarios
              puedan escribirte.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {conversations.map((c) => (
            <Link key={c.id} href={`/dashboard/model/messages/${c.id}`}>
              <Card className="transition-colors hover:border-primary/50">
                <CardContent className="flex items-center gap-3 py-4">
                  <Avatar className="h-10 w-10">
                    {c.user.image && <AvatarImage src={c.user.image} alt="" />}
                    <AvatarFallback>{initials(c.user.name)}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">
                      {c.user.name ?? c.user.email}
                    </p>
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
