'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Bell, Loader2, Megaphone, Send, Sparkles, X } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import {
  countAudienceAction,
  featureCreatorAction,
  replySupportAction,
  sendAnnouncementAction,
  setSupportStatusAction,
  type Audience,
} from '@/server/actions/admin-tools';

type Result = { ok: boolean; error?: string; message?: string };

function useRun() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<Result>, after?: () => void) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) toast.error(r.error ?? 'No se pudo.');
      else {
        toast.success(r.message ?? 'Hecho');
        after?.();
        router.refresh();
      }
    });
  return { pending, run };
}

// ---------------------------------------------------------------------------
// DESTACAR
// ---------------------------------------------------------------------------

export function FeatureButtons({ modelId, featured }: { modelId: string; featured: boolean }) {
  const { pending, run } = useRun();
  return (
    <div className="flex flex-wrap gap-1.5">
      {[7, 30].map((d) => (
        <Button
          key={d}
          size="sm"
          variant={featured ? 'outline' : 'brand'}
          disabled={pending}
          onClick={() => run(() => featureCreatorAction({ modelId, days: d }))}
        >
          <Sparkles className="h-3.5 w-3.5" />
          {featured ? `+${d} dias` : `${d} dias`}
        </Button>
      ))}
      {featured && (
        <Button
          size="sm"
          variant="ghost"
          disabled={pending}
          onClick={() => run(() => featureCreatorAction({ modelId, days: 0 }))}
        >
          <X className="h-3.5 w-3.5" />
          Quitar
        </Button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// AVISOS
// ---------------------------------------------------------------------------

const AUDIENCES: { value: Audience; label: string }[] = [
  { value: 'all', label: 'Todos' },
  { value: 'fans', label: 'Solo fans' },
  { value: 'creators', label: 'Solo creadores' },
  { value: 'founders', label: 'Fundadores' },
];

export function AnnouncementForm() {
  const { pending, run } = useRun();
  const [audience, setAudience] = useState<Audience>('all');
  const [count, setCount] = useState<number | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [link, setLink] = useState('');

  useEffect(() => {
    let alive = true;
    setCount(null);
    countAudienceAction(audience)
      .then((n) => alive && setCount(n))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [audience]);

  function send() {
    const who = AUDIENCES.find((a) => a.value === audience)!.label.toLowerCase();
    if (!window.confirm(`Enviar este aviso a ${count ?? '?'} personas (${who})? No se puede deshacer.`)) {
      return;
    }
    run(
      () => sendAnnouncementAction({ audience, title, body, link }),
      () => {
        setTitle('');
        setBody('');
        setLink('');
      },
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
      <div className="space-y-4">
        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground">Para quien</p>
          <div className="flex flex-wrap gap-2">
            {AUDIENCES.map((a) => (
              <button
                key={a.value}
                type="button"
                onClick={() => setAudience(a.value)}
                className={cn(
                  'rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
                  audience === a.value
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-white/[0.06] text-muted-foreground hover:text-foreground',
                )}
              >
                {a.label}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            {count === null ? 'Contando...' : `Le llegara a ${count} personas.`}
          </p>
        </div>
        <label className="block space-y-1.5 text-xs text-muted-foreground">
          Titulo
          <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder="Ej: Nueva funcion: directos con regalos" />
        </label>
        <label className="block space-y-1.5 text-xs text-muted-foreground">
          Mensaje (opcional)
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={4}
            maxLength={1000}
            className="w-full resize-none rounded-md border border-input bg-background p-3 text-sm text-foreground"
          />
        </label>
        <label className="block space-y-1.5 text-xs text-muted-foreground">
          Al tocarlo, lleva a (opcional)
          <Input value={link} onChange={(e) => setLink(e.target.value)} placeholder="/feed, /live, /hazte-creador..." />
        </label>
        <Button variant="brand" onClick={send} disabled={pending || title.trim().length < 3 || !count}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          Enviar aviso
        </Button>
      </div>

      {/* Vista previa */}
      <div>
        <p className="mb-2 text-xs text-muted-foreground">Asi lo veran en sus notificaciones</p>
        <div className="flex gap-3 rounded-xl border border-white/[0.08] bg-background p-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
            <Megaphone className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-medium">{title || 'Titulo del aviso'}</p>
            <p className="line-clamp-3 text-xs text-muted-foreground">{body || 'Mensaje del aviso'}</p>
            <p className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
              <Bell className="h-3 w-3" /> ahora mismo
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SOPORTE
// ---------------------------------------------------------------------------

export function AdminReplyBox({ ticketId, status }: { ticketId: string; status: string }) {
  const { pending, run } = useRun();
  const [body, setBody] = useState('');

  return (
    <div className="space-y-2 border-t border-white/[0.06] p-4">
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={3}
        maxLength={4000}
        placeholder="Escribe tu respuesta..."
        className="w-full resize-none rounded-lg border border-white/[0.08] bg-background p-3 text-sm"
      />
      <div className="flex flex-wrap gap-2">
        <Button
          variant="brand"
          size="sm"
          disabled={pending || !body.trim()}
          onClick={() => run(() => replySupportAction({ ticketId, body }), () => setBody(''))}
        >
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          Responder
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={pending || !body.trim()}
          onClick={() => run(() => replySupportAction({ ticketId, body, close: true }), () => setBody(''))}
        >
          Responder y cerrar
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={pending}
          onClick={() =>
            run(() =>
              setSupportStatusAction({ ticketId, status: status === 'CLOSED' ? 'OPEN' : 'CLOSED' }),
            )
          }
        >
          {status === 'CLOSED' ? 'Reabrir' : 'Cerrar sin responder'}
        </Button>
      </div>
    </div>
  );
}
