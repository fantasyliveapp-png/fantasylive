'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Clock, Loader2, MoreHorizontal, Pencil, Send, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { FeedPost } from '@/lib/posts';
import { deletePostAction, updatePostAction } from '@/server/actions/posts';

/** Date -> valor de <input type="datetime-local"> en la hora local. */
export function toLocalInputValue(date: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

/**
 * Menu "···" de la duena de una publicacion: editar el texto (y el precio si
 * es de pago, y la hora si esta programada), publicar ya una programada, o
 * eliminarla.
 */
export function PostOwnerMenu({ post }: { post: FeedPost }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(post.body ?? '');
  const [price, setPrice] = useState(String(post.priceTokens));
  const [when, setWhen] = useState(
    post.scheduledFor ? toLocalInputValue(new Date(post.scheduledFor)) : '',
  );
  const [isPending, startTransition] = useTransition();

  function run(action: () => ReturnType<typeof updatePostAction>, onDone?: () => void) {
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        toast.error(result.error ?? 'No se pudo completar.');
        return;
      }
      toast.success(result.message ?? 'Listo');
      onDone?.();
      router.refresh();
    });
  }

  function save() {
    const priceTokens = Number(price);
    if (post.visibility === 'LOCKED' && (!Number.isInteger(priceTokens) || priceTokens < 1)) {
      toast.error('El precio tiene que ser de al menos 1 token.');
      return;
    }
    const scheduleChanged =
      post.scheduledFor && when !== toLocalInputValue(new Date(post.scheduledFor));
    run(
      () =>
        updatePostAction({
          postId: post.id,
          body,
          ...(post.visibility === 'LOCKED' ? { priceTokens } : {}),
          ...(scheduleChanged ? { publishAt: new Date(when).toISOString() } : {}),
        }),
      () => setEditing(false),
    );
  }

  function publishNow() {
    run(() => updatePostAction({ postId: post.id, body: post.body ?? '', publishAt: null }));
  }

  function remove() {
    if (!window.confirm('¿Eliminar esta publicacion? No se puede deshacer.')) return;
    run(() => deletePostAction(post.id));
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label="Opciones de la publicacion" disabled={isPending}>
            {isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <MoreHorizontal className="h-5 w-5" />
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem onClick={() => setEditing(true)}>
            <Pencil /> Editar
          </DropdownMenuItem>
          {post.scheduledFor && (
            <DropdownMenuItem onClick={publishNow}>
              <Send /> Publicar ahora
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={remove} className="text-destructive focus:text-destructive">
            <Trash2 /> Eliminar
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Editar publicacion</DialogTitle>
            <DialogDescription>
              Las fotos y quien la ve no se cambian: quien ya pago o se suscribio lo hizo
              por lo que habia.
            </DialogDescription>
          </DialogHeader>

          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            maxLength={2000}
            rows={4}
            placeholder="Escribe algo…"
            className="w-full resize-none rounded-xl border border-border/60 bg-muted/40 p-3 text-sm outline-none focus:border-primary"
          />

          {post.visibility === 'LOCKED' && (
            <label className="flex items-center justify-between gap-3 rounded-xl border border-border/60 px-3 py-2.5 text-sm">
              <span>Precio para desbloquear</span>
              <span className="flex items-center gap-1.5">
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={100000}
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  className="w-20 rounded-lg border border-border/60 bg-muted/40 px-2 py-1 text-right outline-none focus:border-primary"
                />
                <span className="text-muted-foreground">tokens</span>
              </span>
            </label>
          )}

          {post.scheduledFor && (
            <label className="flex items-center justify-between gap-3 rounded-xl border border-border/60 px-3 py-2.5 text-sm">
              <span className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-primary" />
                Sale el
              </span>
              <input
                type="datetime-local"
                value={when}
                min={toLocalInputValue(new Date(Date.now() + 5 * 60_000))}
                onChange={(e) => setWhen(e.target.value)}
                className="rounded-lg border border-border/60 bg-muted/40 px-2 py-1 outline-none focus:border-primary"
              />
            </label>
          )}

          <Button variant="brand" onClick={save} disabled={isPending}>
            {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Guardar cambios
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}
