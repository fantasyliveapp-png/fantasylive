import type { Metadata } from 'next';

import { PostCard } from '@/components/feed/post-card';
import { PostComposer } from '@/components/feed/post-composer';
import { requireModel } from '@/lib/auth/guards';
import { getModelPosts } from '@/lib/posts';

export const metadata: Metadata = { title: 'Publicaciones' };
export const dynamic = 'force-dynamic';

export default async function ModelPostsPage() {
  const { user, profile } = await requireModel();

  const posts = await getModelPosts({
    modelId: profile.id,
    viewerId: user.id,
    take: 30,
  });

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Publicaciones</h1>
        <p className="mt-2 text-muted-foreground">
          Lo que publiques aparece en el feed de descubrimiento y en el de tus
          seguidores. Las publicaciones de pago se ven borrosas hasta que se
          desbloquean.
        </p>
      </div>

      <PostComposer subscriptionEnabled={profile.subscriptionEnabled} />

      <div className="space-y-5">
        {posts.length === 0 ? (
          <p className="rounded-xl border border-border/60 bg-card/40 p-8 text-center text-sm text-muted-foreground">
            Todavia no has publicado nada.
          </p>
        ) : (
          posts.map((post) => (
            <PostCard key={post.id} post={post} isAuthenticated />
          ))
        )}
      </div>
    </div>
  );
}
