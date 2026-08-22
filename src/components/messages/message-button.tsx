'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Coins, Loader2, MessageCircle } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { startConversationAction } from '@/server/actions/messages';

export function MessageButton({
  modelId,
  slug,
  priceTokens,
  hasConversation,
  isAuthenticated,
}: {
  modelId: string;
  slug: string;
  priceTokens: number;
  hasConversation: boolean;
  isAuthenticated: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState('');
  const [isPending, startTransition] = useTransition();

  if (hasConversation) {
    return (
      <Button
        variant="outline"
        size="sm"
        className="gap-1.5"
        onClick={() => router.push(`/dashboard/messages/${slug}`)}
      >
        <MessageCircle className="h-4 w-4" />
        Ir a la conversacion
      </Button>
    );
  }

  function openDialog() {
    if (!isAuthenticated) {
      router.push(`/login?callbackUrl=/models/${slug}`);
      return;
    }
    setOpen(true);
  }

  function submit() {
    if (body.trim().length === 0) {
      toast.error('Escribi tu primer mensaje.');
      return;
    }
    startTransition(async () => {
      const result = await startConversationAction({ modelId, body });
      if (result.ok) {
        toast.success(result.message ?? 'Conversacion desbloqueada');
        setOpen(false);
        router.push(`/dashboard/messages/${slug}`);
      } else {
        toast.error(result.error ?? 'No se pudo enviar');
      }
    });
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={openDialog} className="gap-1.5">
        <MessageCircle className="h-4 w-4" />
        Enviar mensaje · {priceTokens}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Abrir conversacion</DialogTitle>
            <DialogDescription>
              Se descontaran{' '}
              <strong className="text-token">{priceTokens} tokens</strong> por
              abrir la conversacion. Despues podes seguir escribiendo mientras
              tengas saldo en tu monedero.
            </DialogDescription>
          </DialogHeader>

          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            maxLength={1000}
            rows={3}
            placeholder="Escribi tu primer mensaje..."
          />

          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button variant="token" onClick={submit} disabled={isPending}>
              {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              <Coins className="h-4 w-4" />
              Pagar {priceTokens} y enviar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
