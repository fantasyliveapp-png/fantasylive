import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Lock, Pencil, Sparkles } from 'lucide-react';

import { OwnAccountMenu } from '@/components/layout/own-account-menu';
import { SafetyMenu } from '@/components/social/safety-menu';
import { SendMessageButton } from '@/components/social/send-message-button';
import { FollowPersonButton, UserProfileEditor } from '@/components/social/user-profile-actions';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { getCurrentUser } from '@/lib/auth/guards';
import { peerPair } from '@/lib/chat';
import { prisma } from '@/lib/prisma';
import { formatDate, formatTokens, initials } from '@/lib/utils';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ username: string }>;
}): Promise<Metadata> {
  const { username } = await params;
  return { title: `@${username}` };
}

/**
 * PERFIL DE PERSONA (/u/<usuario>)
 *
 * Todas las cuentas tienen perfil. Las creadoras redirigen a su perfil de
 * creadora; el resto ve este: foto, nombre, seguidores y a quien sigue.
 * Privado por defecto: sin abrirlo solo se ve el nombre y la foto.
 */
export default async function PersonProfilePage({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const { username } = await params;
  const viewer = await getCurrentUser();

  const person = await prisma.user.findUnique({
    where: { username: username.toLowerCase() },
    select: {
      id: true,
      name: true,
      username: true,
      image: true,
      bio: true,
      status: true,
      isProfilePublic: true,
      createdAt: true,
      modelProfile: { select: { slug: true, kycStatus: true } },
    },
  });
  if (!person || person.status === 'BANNED') notFound();
  // Solo las creadoras VERIFICADAS tienen perfil de creadora publico; hasta
  // entonces se ven como una persona mas.
  if (person.modelProfile?.kycStatus === 'APPROVED') {
    redirect(`/models/${person.modelProfile.slug}`);
  }

  const isSelf = viewer?.id === person.id;
  const canSeeDetails = isSelf || person.isProfilePublic;

  const [followers, followingPeople, followingCreators, isFollowing, creatorsSample] =
    await Promise.all([
      prisma.userFollow.count({ where: { followingId: person.id } }),
      prisma.userFollow.count({ where: { followerId: person.id } }),
      prisma.follow.count({ where: { userId: person.id } }),
      viewer && !isSelf
        ? prisma.userFollow
            .findUnique({
              where: {
                followerId_followingId: { followerId: viewer.id, followingId: person.id },
              },
              select: { id: true },
            })
            .then(Boolean)
        : Promise.resolve(false),
      canSeeDetails
        ? prisma.follow.findMany({
            where: { userId: person.id, model: { kycStatus: 'APPROVED' } },
            orderBy: { createdAt: 'desc' },
            take: 12,
            select: {
              model: { select: { slug: true, stageName: true, avatarUrl: true, isOnline: true } },
            },
          })
        : Promise.resolve([]),
    ]);

  const displayName = person.name ?? person.username ?? 'Usuario';

  const iBlocked =
    viewer && !isSelf
      ? Boolean(
          await prisma.blockedPair.findFirst({
            where: { blockerId: viewer.id, blockedId: person.id, isSkip: false },
            select: { id: true },
          }),
        )
      : false;

  // Si ya hay chat con esta persona, "Mensaje" lleva directo a el.
  let existingChatHref: string | null = null;
  if (viewer && !isSelf) {
    if (viewer.modelProfileId) {
      const c = await prisma.conversation.findUnique({
        where: { userId_modelId: { userId: person.id, modelId: viewer.modelProfileId } },
        select: { id: true },
      });
      if (c) existingChatHref = `/mensajes/${c.id}`;
    } else {
      const c = await prisma.peerChat.findUnique({
        where: { userAId_userBId: peerPair(viewer.id, person.id) },
        select: { id: true },
      });
      if (c) existingChatHref = `/mensajes/${c.id}`;
    }
  }

  return (
    <div className="container max-w-2xl space-y-6 py-8">
      {isSelf && (
        // Menu de tu cuenta: en el movil no esta arriba (tu foto va abajo).
        <div className="-mb-6 flex justify-end md:hidden">
          <OwnAccountMenu />
        </div>
      )}
      <section className="flex flex-col items-center text-center">
        <Avatar className="h-24 w-24 border-4 border-background shadow-xl">
          {person.image && <AvatarImage src={person.image} alt={displayName} />}
          <AvatarFallback className="text-2xl">{initials(displayName)}</AvatarFallback>
        </Avatar>
        <h1 className="mt-3 text-2xl font-bold tracking-tight">{displayName}</h1>
        <p className="text-sm text-muted-foreground">@{person.username}</p>

        {canSeeDetails && (
          <div className="mt-4 flex divide-x divide-border/60">
            <Stat value={followers} label="Seguidores" />
            <Stat value={followingPeople + followingCreators} label="Siguiendo" />
          </div>
        )}

        {canSeeDetails && person.bio && (
          <p className="mt-3 max-w-md whitespace-pre-line text-sm text-muted-foreground">
            {person.bio}
          </p>
        )}

        <div className="mt-5 flex w-full max-w-sm gap-2">
          {isSelf ? (
            <UserProfileEditor
              profile={{
                name: person.name ?? '',
                username: person.username ?? '',
                bio: person.bio ?? '',
                image: person.image ?? '',
                isProfilePublic: person.isProfilePublic,
              }}
            >
              <Pencil className="h-4 w-4" />
              Editar perfil
            </UserProfileEditor>
          ) : (
            <>
              {!iBlocked && (
                <>
                  <FollowPersonButton
                    userId={person.id}
                    initialFollowing={isFollowing}
                    isAuthenticated={Boolean(viewer)}
                  />
                  <SendMessageButton
                    targetUserId={person.id}
                    targetName={displayName}
                    existingHref={existingChatHref}
                    isAuthenticated={Boolean(viewer)}
                  />
                </>
              )}
              {iBlocked && (
                <p className="flex-1 rounded-xl border border-border/60 px-3 py-2 text-xs text-muted-foreground">
                  Has bloqueado a {displayName}.
                </p>
              )}
              <SafetyMenu
                targetUserId={person.id}
                targetName={displayName}
                initialBlocked={iBlocked}
                isAuthenticated={Boolean(viewer)}
                className="h-10 w-10 border border-border/60"
              />
            </>
          )}
        </div>
      </section>

      {!canSeeDetails ? (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-border/60 bg-card px-6 py-10 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full border-2 border-foreground/70">
            <Lock className="h-5 w-5" />
          </span>
          <p className="font-medium">Esta cuenta es privada</p>
          <p className="max-w-xs text-sm text-muted-foreground">
            {displayName} no muestra su actividad ni a quien sigue.
          </p>
        </div>
      ) : (
        <>
          {isSelf && !person.isProfilePublic && (
            <p className="flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
              <Lock className="h-3.5 w-3.5" />
              Tu perfil es privado: los demas solo ven tu nombre y tu foto.
            </p>
          )}

          {creatorsSample.length > 0 && (
            <section>
              <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Sigue a
              </h2>
              <div className="-mx-6 flex gap-4 overflow-x-auto px-6 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {creatorsSample.map(({ model }) => (
                  <Link
                    key={model.slug}
                    href={`/models/${model.slug}`}
                    className="flex w-[68px] shrink-0 flex-col items-center gap-1.5"
                  >
                    <span
                      className={
                        model.isOnline
                          ? 'rounded-full bg-state-connected p-[2px]'
                          : 'rounded-full bg-border p-[2px]'
                      }
                    >
                      <Avatar className="h-14 w-14 border-2 border-background">
                        {model.avatarUrl && <AvatarImage src={model.avatarUrl} alt="" />}
                        <AvatarFallback>{initials(model.stageName)}</AvatarFallback>
                      </Avatar>
                    </span>
                    <span className="w-full truncate text-center text-[11px]">{model.stageName}</span>
                  </Link>
                ))}
              </div>
            </section>
          )}

          <p className="text-center text-xs text-muted-foreground">
            En FantasyLive desde {formatDate(person.createdAt)}
          </p>
        </>
      )}

      {isSelf && (
        <Link
          href="/hazte-creador"
          className="relative flex items-center gap-4 overflow-hidden rounded-2xl border border-primary/40 bg-primary/5 p-4 transition-colors hover:bg-primary/10"
        >
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-tr from-primary via-fantazy-red to-champagne-gold text-white">
            <Sparkles className="h-5 w-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold">Hazte creador</span>
            <span className="block text-xs text-muted-foreground">
              Publica, haz directos y cobra con tu contenido. Con la misma cuenta.
            </span>
          </span>
          <Button variant="brand" size="sm" className="shrink-0" tabIndex={-1}>
            Empezar
          </Button>
        </Link>
      )}
    </div>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="px-6 text-center">
      <p className="text-lg font-bold leading-none">{formatTokens(value)}</p>
      <p className="mt-1 text-[11px] text-muted-foreground">{label}</p>
    </div>
  );
}
