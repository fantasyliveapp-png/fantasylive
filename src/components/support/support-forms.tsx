'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Send } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SUPPORT_CATEGORIES } from '@/lib/support';
import { createSupportTicketAction, replySupportTicketAction } from '@/server/actions/support';

/** Formulario para abrir una consulta nueva. */
export function NewTicketForm() {
  const router = useRouter();
  const [category, setCategory] = useState<string>('cuenta');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [pending, start] = useTransition();

  function submit() {
    start(async () => {
      const r = await createSupportTicketAction({ category, subject, body });
      if (!r.ok) {
        toast.error(r.error ?? 'No se pudo enviar.');
        return;
      }
      toast.success(r.message ?? 'Enviado');
      router.push(`/soporte/${r.ticketId}`);
    });
  }

  return (
    <div className="space-y-4 rounded-2xl border border-border/60 bg-card p-5">
      <div className="space-y-2">
        <p className="text-sm font-medium">Sobre que es?</p>
        <div className="flex flex-wrap gap-2">
          {SUPPORT_CATEGORIES.map((c) => (
            <button
              key={c.value}
              type="button"
              onClick={() => setCategory(c.value)}
              className={
                category === c.value
                  ? 'rounded-full bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground'
                  : 'rounded-full bg-muted px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground'
              }
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>
      <label className="block space-y-1.5 text-sm font-medium">
        Asunto
        <Input
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="Ej: no me llegan los tokens que compre"
          maxLength={120}
        />
      </label>
      <label className="block space-y-1.5 text-sm font-medium">
        Cuentanos que pasa
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={5}
          maxLength={4000}
          className="w-full resize-none rounded-md border border-input bg-background p-3 text-sm font-normal"
          placeholder="Con todos los detalles que puedas: que hiciste, que esperabas y que paso."
        />
      </label>
      <Button variant="brand" onClick={submit} disabled={pending || !subject.trim() || !body.trim()}>
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        Enviar consulta
      </Button>
    </div>
  );
}

/** Caja para contestar dentro de una consulta. */
export function TicketReplyBox({ ticketId }: { ticketId: string }) {
  const router = useRouter();
  const [body, setBody] = useState('');
  const [pending, start] = useTransition();

  function submit() {
    start(async () => {
      const r = await replySupportTicketAction({ ticketId, body });
      if (!r.ok) {
        toast.error(r.error ?? 'No se pudo enviar.');
        return;
      }
      setBody('');
      router.refresh();
    });
  }

  return (
    <div className="flex items-end gap-2">
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={2}
        maxLength={4000}
        placeholder="Escribe tu mensaje..."
        className="min-w-0 flex-1 resize-none rounded-xl border border-input bg-background p-3 text-sm"
      />
      <Button variant="brand" onClick={submit} disabled={pending || !body.trim()} className="h-11">
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
      </Button>
    </div>
  );
}
