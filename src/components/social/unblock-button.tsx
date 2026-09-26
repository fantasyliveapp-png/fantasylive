'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { toggleBlockUserAction } from '@/server/actions/chat';

export function UnblockButton({ userId }: { userId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  return (
    <Button
      variant="secondary"
      size="sm"
      disabled={isPending}
      onClick={() =>
        startTransition(async () => {
          const result = await toggleBlockUserAction(userId);
          if (!result.ok) {
            toast.error(result.error ?? 'No se pudo desbloquear.');
            return;
          }
          toast.success('Desbloqueado');
          router.refresh();
        })
      }
    >
      {isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
      Desbloquear
    </Button>
  );
}
