'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, MessageCircle, Send } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { messageUserAction } from '@/server/actions/chat';
import { useJoinPrompt } from '@/components/providers/join-prompt';

/**
 * "Enviar mensaje" desde un perfil. Si ya hay chat con esa persona, lleva a
 * el; si no, pide el primer mensaje y lo abre (o lo envia como solicitud).
 */
export function SendMessageButton({
  targetUserId,
  targetName,
  existingHref,
  isAuthenticated,
  className,
}: {
  targetUserId: string;
  targetName: string;
  /** Hilo ya existente con esta persona, si lo hay. */
  existingHref?: string | null;
  isAuthenticated: boolean;
  className?: string;
}) {
  const router = useRouter();
  const joinPrompt = useJoinPrompt();
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState('');
  const [isPending, startTransition] = useTransition();

  function onClick() {
    if (!isAuthenticated) {
      joinPrompt('para enviar mensajes');
      return;
    }
    if (existingHref) {
      router.push(existingHref);
      return;
    }
    setOpen(true);
  }

  function send() {
    startTransition(async () => {
      const result = await messageUserAction({ targetUserId, body });
      if (!result.ok) {
        toast.error(result.error ?? 'No se pudo enviar.');
        return;
      }
      if (result.message) toast.success(result.message);
      setOpen(false);
      setBody('');
      if (result.href) router.push(result.href);
    });
  }

  return (
    <>
      <Button variant="secondary" className={className ?? 'h-10 flex-1 px-5 sm:flex-none'} onClick={onClick}>
        <MessageCircle className="h-4 w-4" />
        Mensaje
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Escribe a {targetName}</DialogTitle>
            <DialogDescription>
              Si no te sigue, le llegara como solicitud y decidira si la acepta.
            </DialogDescription>
          </DialogHeader>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            maxLength={1000}
            rows={4}
            autoFocus
            placeholder="Hola..."
            className="w-full resize-none rounded-xl border border-border/60 bg-muted/40 p-3 text-sm outline-none focus:border-primary"
          />
          <Button variant="brand" onClick={send} disabled={isPending || !body.trim()}>
            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Enviar
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}
