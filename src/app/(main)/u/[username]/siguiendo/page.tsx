import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ArrowLeft, Lock } from 'lucide-react';

import { FollowedCreatorsList } from '@/components/social/following-view';
import { getCurrentUser } from '@/lib/auth/guards';
import { getFollowedCreators } from '@/lib/following';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ username: string }>;
}): Promise<Metadata> {
  const { username } = await params;
  return { title: `Siguiendo · @${username}` };
}

/**
 * SIGUIENDO de un fan: los creadores que sigue (solo se sigue a creadores),
 * en directo primero, con campanita de avisos y dejar de seguir. Con perfil
 * privado solo lo ve el propio fan.
 */
export default async function FollowingPage({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  const viewer = await getCurrentUser();

  const person = await prisma.user.findUnique({
    where: { username: username.toLowerCase() },
    select: {
      id: true,
      name: true,
      username: true,
      status: true,
      isProfilePublic: true,
      modelProfile: { select: { slug: true, kycStatus: true } },
    },
  });
  if (!person || person.status === 'BANNED') notFound();
  const isSelf = viewer?.id === person.id;
  // Un creador tambien sigue a otros: su lista solo la ve el.
  if (person.modelProfile?.kycStatus === 'APPROVED' && !isSelf) redirect(`/models/${person.modelProfile.slug}`);

  const canSee = isSelf || person.isProfilePublic;
  const creators = canSee ? await getFollowedCreators(person.id, isSelf) : [];

  return (
    <div className="container max-w-2xl space-y-4 py-6">
      <div className="flex items-center gap-2 border-b border-border/60 pb-4">
        <Link
          href={person.modelProfile?.kycStatus === 'APPROVED' ? `/models/${person.modelProfile.slug}` : `/u/${person.username}`}
          className="rounded-full p-1.5 hover:bg-muted"
          aria-label="Volver al perfil"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="min-w-0">
          <h1 className="truncate text-lg font-bold">Siguiendo</h1>
          <p className="text-xs text-muted-foreground">
            @{person.username}
            {canSee && ` · ${creators.length} ${creators.length === 1 ? 'creador' : 'creadores'}`}
          </p>
        </div>
      </div>

      {canSee ? (
        <FollowedCreatorsList creators={creators} isSelf={isSelf} />
      ) : (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-border/60 bg-card px-6 py-10 text-center">
          <Lock className="h-5 w-5" />
          <p className="font-medium">Esta cuenta es privada</p>
          <p className="text-sm text-muted-foreground">No muestra a qué creadores sigue.</p>
        </div>
      )}
    </div>
  );
}
