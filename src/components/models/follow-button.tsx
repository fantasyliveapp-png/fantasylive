'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, UserCheck, UserPlus } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { toggleFollowAction } from '@/server/actions/follows';
import { useJoinPrompt } from '@/components/providers/join-prompt';

export function FollowButton({
  modelId,
  slug,
  initialFollowing,
  isAuthenticated,
}: {
  modelId: string;
  slug: string;
  initialFollowing: boolean;
  isAuthenticated: boolean;
}) {
  const router = useRouter();
  const joinPrompt = useJoinPrompt();
  const [following, setFollowing] = useState(initialFollowing);
  const [isPending, startTransition] = useTransition();

  function toggle() {
    if (!isAuthenticated) {
      joinPrompt('para seguirla');
      return;
    }

    const next = !following;
    setFollowing(next);

    startTransition(async () => {
      const result = await toggleFollowAction(modelId, slug);
      if (!result.ok) {
        setFollowing(!next);
        toast.error(result.error ?? 'No se pudo actualizar.');
      }
    });
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={toggle}
      disabled={isPending}
      className="gap-1.5"
    >
      {isPending ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : following ? (
        <UserCheck className="h-4 w-4" />
      ) : (
        <UserPlus className="h-4 w-4" />
      )}
      {following ? 'Siguiendo' : 'Seguir'}
    </Button>
  );
}
