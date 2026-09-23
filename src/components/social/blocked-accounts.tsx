import { UnblockButton } from '@/components/social/unblock-button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { prisma } from '@/lib/prisma';
import { initials } from '@/lib/utils';

/** Cuentas que la persona ha bloqueado, con opcion de desbloquear. */
export async function BlockedAccounts({ userId }: { userId: string }) {
  const blocks = await prisma.blockedPair.findMany({
    where: { blockerId: userId, isSkip: false },
    orderBy: { createdAt: 'desc' },
    take: 100,
    select: {
      blocked: {
        select: {
          id: true,
          name: true,
          username: true,
          image: true,
          modelProfile: { select: { stageName: true, avatarUrl: true } },
        },
      },
    },
  });

  if (blocks.length === 0) {
    return (
      <p className="px-4 py-3 text-sm text-muted-foreground">
        No has bloqueado a nadie. Puedes hacerlo desde el menu &laquo;···&raquo; de
        cualquier perfil o chat.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-border/60">
      {blocks.map(({ blocked: b }) => {
        const name = b.modelProfile?.stageName ?? b.name ?? b.username ?? 'Usuario';
        const image = b.modelProfile?.avatarUrl ?? b.image;
        return (
          <li key={b.id} className="flex items-center gap-3 px-4 py-3">
            <Avatar className="h-9 w-9">
              {image && <AvatarImage src={image} alt="" />}
              <AvatarFallback>{initials(name)}</AvatarFallback>
            </Avatar>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{name}</span>
              {b.username && (
                <span className="block truncate text-xs text-muted-foreground">@{b.username}</span>
              )}
            </span>
            <UnblockButton userId={b.id} />
          </li>
        );
      })}
    </ul>
  );
}
