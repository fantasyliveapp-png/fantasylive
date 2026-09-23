'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Ban, Check, Loader2, Send, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { cn, relativeTime } from '@/lib/utils';
import {
  respondToChatRequestAction,
  sendPeerMessageAction,
  toggleBlockUserAction,
} from '@/server/actions/chat';

export interface ChatMessage {
  id: string;
  body: string;
  createdAt: string;
  isMine: boolean;
}

/**
 * Hilo de un chat entre personas. Comprueba mensajes nuevos cada pocos
 * segundos mientras la pestana esta visible (no hay tiempo real todavia).
 */
export function PeerChatThread({
  chatId,
  messages,
  canWrite,
  disabledHint,
}: {
  chatId: string;
  messages: ChatMessage[];
  canWrite: boolean;
  disabledHint?: string;
}) {
  const router = useRouter();
  const [body, setBody] = useState('');
  const [isPending, startTransition] = useTransition();
  const bottom = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [messages.length]);

  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') router.refresh();
    }, 5000);
    return () => clearInterval(timer);
  }, [router]);

  function send() {
    const text = body.trim();
    if (!text) return;
    startTransition(async () => {
      const result = await sendPeerMessageAction({ chatId, body: text });
      if (!result.ok) {
        toast.error(result.error ?? 'No se pudo enviar.');
        return;
      }
      setBody('');
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="space-y-2 pb-2">
        {messages.map((m) => (
          <div key={m.id} className={cn('flex', m.isMine ? 'justify-end' : 'justify-start')}>
            <div
              className={cn(
                'max-w-[80%] rounded-2xl px-3.5 py-2 text-sm',
                m.isMine
                  ? 'rounded-br-md bg-primary text-primary-foreground'
                  : 'rounded-bl-md bg-muted text-foreground',
              )}
            >
              <p className="whitespace-pre-wrap break-words">{m.body}</p>
              <p
                className={cn(
                  'mt-0.5 text-right text-[10px]',
                  m.isMine ? 'text-primary-foreground/70' : 'text-muted-foreground',
                )}
              >
                {relativeTime(new Date(m.createdAt))}
              </p>
            </div>
          </div>
        ))}
        <div ref={bottom} />
      </div>

      {canWrite ? (
        <div className="sticky bottom-16 flex items-end gap-2 rounded-2xl border border-border/60 bg-background/95 p-2 backdrop-blur md:bottom-4">
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            maxLength={1000}
            rows={1}
            placeholder="Escribe un mensaje..."
            className="max-h-32 min-h-10 w-full resize-none bg-transparent px-2 py-2 text-sm outline-none"
          />
          <Button variant="brand" size="icon" onClick={send} disabled={isPending || !body.trim()} aria-label="Enviar">
            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>
      ) : (
        disabledHint && (
          <p className="rounded-2xl border border-border/60 bg-muted/40 p-3 text-center text-xs text-muted-foreground">
            {disabledHint}
          </p>
        )
      )}
    </div>
  );
}

/**
 * Barra de una solicitud de mensaje recibida: aceptar, eliminar o bloquear.
 * Sirve para los dos tipos de chat.
 */
export function ChatRequestBar({
  kind,
  id,
  fromName,
  fromUserId,
}: {
  kind: 'peer' | 'conversation';
  id: string;
  fromName: string;
  fromUserId: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function respond(accept: boolean) {
    startTransition(async () => {
      const result = await respondToChatRequestAction({ kind, id, accept });
      if (!result.ok) {
        toast.error(result.error ?? 'No se pudo completar.');
        return;
      }
      if (accept) {
        toast.success('Solicitud aceptada');
        router.refresh();
      } else {
        router.push('/mensajes?tab=solicitudes');
      }
    });
  }

  function block() {
    if (!window.confirm(`¿Bloquear a ${fromName}? No podra volver a escribirte.`)) return;
    startTransition(async () => {
      const result = await toggleBlockUserAction(fromUserId);
      if (!result.ok) {
        toast.error(result.error ?? 'No se pudo bloquear.');
        return;
      }
      toast.success(result.message ?? 'Bloqueado');
      router.push('/mensajes?tab=solicitudes');
    });
  }

  return (
    <div className="rounded-2xl border border-primary/30 bg-primary/5 p-4">
      <p className="text-sm font-semibold">{fromName} quiere enviarte un mensaje</p>
      <p className="mt-0.5 text-xs text-muted-foreground">
        No os seguis. Si aceptas, podreis hablar con normalidad; no sabra que lo has
        leido hasta entonces.
      </p>
      <div className="mt-3 grid grid-cols-3 gap-2">
        <Button variant="brand" size="sm" onClick={() => respond(true)} disabled={isPending}>
          <Check className="h-4 w-4" />
          Aceptar
        </Button>
        <Button variant="secondary" size="sm" onClick={() => respond(false)} disabled={isPending}>
          <Trash2 className="h-4 w-4" />
          Eliminar
        </Button>
        <Button variant="ghost" size="sm" onClick={block} disabled={isPending} className="text-destructive">
          <Ban className="h-4 w-4" />
          Bloquear
        </Button>
      </div>
    </div>
  );
}
