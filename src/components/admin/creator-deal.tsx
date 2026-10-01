'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Handshake, Loader2, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn, formatUtcDate } from '@/lib/utils';
import { clearCreatorDealAction, setCreatorDealAction } from '@/server/actions/deals';

/**
 * Trato negociado con una creadora: % que retiene la plataforma, % que cobra
 * como embajadora y hasta cuando. Ensena en vivo como queda el reparto.
 */
export function CreatorDealEditor({
  modelId,
  standard,
  deal,
  recruiterPercent,
  ambassadorOfHerPercent,
}: {
  modelId: string;
  /** Los % estandar de la plataforma. */
  standard: { platformPercent: number; ambassadorPercent: number };
  deal: {
    platformPercent: number | null;
    ambassadorPercent: number | null;
    /** "YYYY-MM-DD" */
    until: string | null;
    notes: string | null;
    active: boolean;
    expired: boolean;
  };
  /** Si la trajo un reclutador, su % (sale de la parte de la plataforma). */
  recruiterPercent: number | null;
  /** Si la invito otra creadora, el % que cobra esa embajadora. */
  ambassadorOfHerPercent: number | null;
}) {
  const router = useRouter();
  const [platform, setPlatform] = useState(deal.platformPercent?.toString() ?? '');
  const [ambassador, setAmbassador] = useState(deal.ambassadorPercent?.toString() ?? '');
  const [until, setUntil] = useState(deal.until ?? '');
  const [notes, setNotes] = useState(deal.notes ?? '');
  const [isPending, startTransition] = useTransition();

  const platformPct = platform.trim() === '' ? standard.platformPercent : Number(platform);
  const creatorPct = 100 - platformPct;
  const recruiterPct = Math.min(recruiterPercent ?? 0, platformPct);
  const ambassadorPct = Math.min(ambassadorOfHerPercent ?? 0, platformPct - recruiterPct);
  const netPlatform = platformPct - recruiterPct - ambassadorPct;
  const hasDeal = deal.platformPercent != null || deal.ambassadorPercent != null;

  function save() {
    startTransition(async () => {
      const r = await setCreatorDealAction({
        modelId,
        platformPercent: platform.trim() === '' ? null : Number(platform),
        ambassadorPercent: ambassador.trim() === '' ? null : Number(ambassador),
        until: until || null,
        notes: notes.trim() || undefined,
      });
      if (!r.ok) toast.error(r.error ?? 'No se pudo guardar.');
      else {
        toast.success(r.message ?? 'Guardado');
        router.refresh();
      }
    });
  }

  function clear() {
    if (!window.confirm('¿Quitar el trato? Vuelve a las condiciones estandar desde ya.')) return;
    startTransition(async () => {
      const r = await clearCreatorDealAction(modelId);
      if (!r.ok) toast.error(r.error ?? 'No se pudo quitar.');
      else {
        toast.success(r.message ?? 'Hecho');
        setPlatform('');
        setAmbassador('');
        setUntil('');
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-4 px-5 py-4 text-sm">
      {hasDeal && (
        <p
          className={cn(
            'flex items-center gap-2 rounded-lg px-3 py-2 text-xs',
            deal.active ? 'bg-state-connected/10 text-state-connected' : 'bg-muted text-muted-foreground',
          )}
        >
          <Handshake className="h-4 w-4" />
          {deal.active
            ? `Trato vigente${deal.until ? ` hasta el ${formatUtcDate(deal.until)}` : ' sin fecha de fin'}.`
            : deal.expired
              ? `El trato termino el ${formatUtcDate(deal.until!)}: ya se le aplica el estandar.`
              : 'Sin trato vigente.'}
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <label className="space-y-1 text-xs text-muted-foreground">
          % que se queda la plataforma
          <Input
            type="number"
            min={5}
            max={60}
            value={platform}
            onChange={(e) => setPlatform(e.target.value)}
            placeholder={`Estandar: ${standard.platformPercent}%`}
          />
        </label>
        <label className="space-y-1 text-xs text-muted-foreground">
          % por cada creador que invite
          <Input
            type="number"
            min={1}
            max={20}
            value={ambassador}
            onChange={(e) => setAmbassador(e.target.value)}
            placeholder={`Estandar: ${standard.ambassadorPercent}%`}
          />
        </label>
        <label className="space-y-1 text-xs text-muted-foreground">
          Hasta (vacio = sin fin)
          <Input type="date" value={until} onChange={(e) => setUntil(e.target.value)} />
        </label>
      </div>

      <label className="block space-y-1 text-xs text-muted-foreground">
        Lo acordado (nota interna, ella no la ve)
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          placeholder="Ej.: 30% los 3 primeros meses a cambio de 4 directos por semana"
          className="w-full resize-none rounded-md border border-input bg-background p-2 text-sm text-foreground"
        />
      </label>

      {Number.isFinite(platformPct) && platformPct >= 0 && platformPct <= 100 && (
        <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
          <p className="mb-2 text-xs text-muted-foreground">De cada 100 $ que venda:</p>
          <div className="flex h-2.5 overflow-hidden rounded-full bg-muted">
            <span className="bg-state-connected" style={{ width: `${creatorPct}%` }} />
            <span className="bg-amber-500" style={{ width: `${recruiterPct + ambassadorPct}%` }} />
            <span className="bg-primary" style={{ width: `${netPlatform}%` }} />
          </div>
          <ul className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
            <li>
              <span className="text-state-connected">●</span> Ella: <b>{creatorPct} $</b>
            </li>
            {recruiterPercent != null && (
              <li>
                <span className="text-amber-500">●</span> Reclutador: <b>{recruiterPct} $</b>
              </li>
            )}
            {ambassadorOfHerPercent != null && (
              <li>
                <span className="text-amber-500">●</span> Quien la invito: <b>{ambassadorPct} $</b>
              </li>
            )}
            <li>
              <span className="text-primary">●</span> Plataforma: <b>{netPlatform} $</b>
            </li>
          </ul>
          {netPlatform < 10 && (
            <p className="mt-2 text-xs text-amber-500">
              Ojo: la plataforma se queda solo con el {netPlatform}% de sus ventas.
            </p>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="brand" onClick={save} disabled={isPending || (!platform.trim() && !ambassador.trim())}>
          {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Handshake className="h-4 w-4" />}
          {hasDeal ? 'Guardar trato' : 'Crear trato'}
        </Button>
        {hasDeal && (
          <Button size="sm" variant="outline" onClick={clear} disabled={isPending}>
            <RotateCcw className="h-4 w-4" /> Volver al estandar
          </Button>
        )}
      </div>
    </div>
  );
}
