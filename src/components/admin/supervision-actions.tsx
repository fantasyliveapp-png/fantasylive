'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Ban, EyeOff, Loader2, PauseCircle, PlayCircle, RotateCcw, Square, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { moderateUserAction } from '@/server/actions/admin';
import {
  adminDeleteCommentAction,
  adminEndStreamAction,
  adminRemovePostAction,
  adminRestorePostAction,
} from '@/server/actions/supervision';

type Result = { ok: boolean; error?: string; message?: string };

function useRun() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<Result>) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) toast.error(r.error ?? 'No se pudo.');
      else {
        toast.success(r.message ?? 'Hecho');
        router.refresh();
      }
    });
  return { pending, run };
}

/** Pide el motivo (lo vera la persona afectada). null = cancelado. */
function askReason(question: string) {
  const r = window.prompt(`${question}\n\nMotivo (lo vera la persona):`, 'Incumple las normas de la comunidad');
  return r === null ? null : r;
}

export function RemovePostButton({ postId, removed }: { postId: string; removed: boolean }) {
  const { pending, run } = useRun();
  if (removed) {
    return (
      <Button
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() => {
          if (window.confirm('Volver a publicar esta publicacion?')) run(() => adminRestorePostAction(postId));
        }}
      >
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
        Restaurar
      </Button>
    );
  }
  return (
    <Button
      variant="destructive"
      size="sm"
      disabled={pending}
      onClick={() => {
        const reason = askReason('Retirar esta publicacion? Dejara de verse y la creadora no podra republicarla.');
        if (reason !== null) run(() => adminRemovePostAction({ postId, reason }));
      }}
    >
      {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <EyeOff className="h-4 w-4" />}
      Retirar publicacion
    </Button>
  );
}

export function DeleteCommentButton({ commentId }: { commentId: string }) {
  const { pending, run } = useRun();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        if (window.confirm('Borrar este comentario?')) run(() => adminDeleteCommentAction(commentId));
      }}
      className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
      aria-label="Borrar comentario"
      title="Borrar comentario"
    >
      {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
    </button>
  );
}

export function EndStreamButton({ streamId }: { streamId: string }) {
  const { pending, run } = useRun();
  return (
    <Button
      variant="destructive"
      size="sm"
      disabled={pending}
      onClick={() => {
        const reason = askReason('Cortar este directo ahora?');
        if (reason !== null) run(() => adminEndStreamAction({ streamId, reason }));
      }}
    >
      {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Square className="h-4 w-4" />}
      Cortar directo
    </Button>
  );
}

/** Suspender / banear / reactivar desde la ficha de la persona. */
export function UserModerationButtons({
  userId,
  status,
  isSelf,
}: {
  userId: string;
  status: string;
  isSelf: boolean;
}) {
  const { pending, run } = useRun();
  if (isSelf) return null;
  if (status !== 'ACTIVE') {
    return (
      <Button
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() => {
          if (window.confirm('Reactivar esta cuenta?')) run(() => moderateUserAction({ userId, action: 'REINSTATE' }));
        }}
      >
        <PlayCircle className="h-4 w-4" />
        Reactivar cuenta
      </Button>
    );
  }
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() => {
          const reason = askReason('Suspender esta cuenta 72 horas?');
          if (reason !== null)
            run(() => moderateUserAction({ userId, action: 'SUSPEND', reason, suspensionHours: 72 }));
        }}
      >
        <PauseCircle className="h-4 w-4" />
        Suspender 72 h
      </Button>
      <Button
        variant="destructive"
        size="sm"
        disabled={pending}
        onClick={() => {
          const reason = askReason('BANEAR esta cuenta de forma permanente?');
          if (reason !== null) run(() => moderateUserAction({ userId, action: 'BAN', reason }));
        }}
      >
        <Ban className="h-4 w-4" />
        Banear
      </Button>
    </>
  );
}
