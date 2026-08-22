'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Gift, Loader2 } from 'lucide-react';
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
import { createContentRequestAction } from '@/server/actions/content-requests';

export function RequestContentDialog({
  modelId,
  slug,
  isAuthenticated,
}: {
  modelId: string;
  slug: string;
  isAuthenticated: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState('');
  const [isPending, startTransition] = useTransition();

  function openDialog() {
    if (!isAuthenticated) {
      router.push(`/login?callbackUrl=/models/${slug}`);
      return;
    }
    setOpen(true);
  }

  function submit() {
    if (description.trim().length < 10) {
      toast.error('Contanos un poco mas que queres (min. 10 caracteres).');
      return;
    }
    startTransition(async () => {
      const result = await createContentRequestAction({ modelId, description });
      if (result.ok) {
        toast.success(result.message ?? 'Pedido enviado');
        setOpen(false);
        setDescription('');
        router.refresh();
      } else {
        toast.error(result.error ?? 'No se pudo enviar el pedido');
      }
    });
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={openDialog} className="gap-1.5">
        <Gift className="h-4 w-4" />
        Pedir contenido a medida
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Pedir contenido a medida</DialogTitle>
            <DialogDescription>
              Describi que te gustaria recibir. La modelo va a revisar tu
              pedido y ponerle un precio en tokens; solo pagas si aceptas la
              cotizacion.
            </DialogDescription>
          </DialogHeader>

          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={600}
            rows={4}
            placeholder="Ej: una sesion de fotos con..."
          />

          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button variant="brand" onClick={submit} disabled={isPending}>
              {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Enviar pedido
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
