'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Package, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { ContentTile, EmptyState } from '@/components/content/content-hub';
import { LivePackCreator } from '@/components/content/live-pack-creator';
import { Button } from '@/components/ui/button';
import type { LivePackCard } from '@/lib/creator-content';
import { creatorUsd } from '@/components/money/creator-price';
import type { EconomyParams } from '@/lib/earnings';
import { cn } from '@/lib/utils';
import { deleteLivePackAction, setLivePackInMenuAction } from '@/server/actions/creator-content';

/**
 * Packs de directo: fotos y videos agrupados con un precio, que solo se
 * venden desde el menu "Especiales" mientras emite. Cada fan lo compra una vez.
 */
export function LivePacksManager({ packs, economy }: { packs: LivePackCard[]; economy: EconomyParams }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const creator = <LivePackCreator open={creating} onOpenChange={setCreating} economy={economy} />;
  const usd = (tokens: number) => creatorUsd(tokens, economy);

  function run(fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) {
    startTransition(async () => {
      const r = await fn();
      if (r.ok) {
        if (r.message) toast.success(r.message);
        setConfirmDelete(null);
        router.refresh();
      } else toast.error(r.error ?? 'No se pudo completar.');
    });
  }

  if (packs.length === 0) {
    return (
      <>
        <EmptyState
          text="Crea packs con fotos y vídeos que solo se venden en tus directos, desde tu menú de Especiales."
          cta={
            <Button variant="brand" onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" /> Nuevo pack de directo
            </Button>
          }
        />
        {creator}
      </>
    );
  }

  const inMenu = packs.filter((p) => p.inMenu).length;
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {inMenu} de {packs.length} en tu menú de Especiales
        </p>
        <Button variant="brand" size="sm" onClick={() => setCreating(true)}>
          <Plus className="h-4 w-4" /> Nuevo pack
        </Button>
      </div>
      {creator}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {packs.map((p) => (
          <ContentTile
            key={p.id}
            card={p}
            footer={
              <div className="space-y-2 pt-1">
                <p className="text-[11px] text-muted-foreground">
                  <span className="font-semibold text-token">{p.priceTokens} tk</span> · ganas{' '}
                  <span className="font-semibold text-state-connected">{usd(p.priceTokens)}</span> por venta
                </p>
                <p className="flex items-center justify-between text-[11px] text-muted-foreground">
                  <span>
                    {p.sales} {p.sales === 1 ? 'venta' : 'ventas'}
                  </span>
                  <span className="font-medium text-foreground">{p.tokensEarned} tk ganados</span>
                </p>
                {confirmDelete === p.id ? (
                  <div className="flex gap-1.5">
                    <Button size="sm" variant="ghost" className="h-8 flex-1" onClick={() => setConfirmDelete(null)}>
                      No
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      className="h-8 flex-1"
                      disabled={isPending}
                      onClick={() => run(() => deleteLivePackAction(p.id))}
                    >
                      Borrar
                    </Button>
                  </div>
                ) : (
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      disabled={isPending}
                      onClick={() => run(() => setLivePackInMenuAction(p.id, !p.inMenu))}
                      className={cn(
                        'flex h-8 flex-1 items-center justify-center gap-1 rounded-lg border text-xs font-semibold transition-colors',
                        p.inMenu
                          ? 'border-champagne-gold/50 bg-champagne-gold/15 text-champagne-gold'
                          : 'border-border/60 text-muted-foreground hover:text-foreground',
                      )}
                    >
                      {p.inMenu ? <Check className="h-3.5 w-3.5" /> : <Package className="h-3.5 w-3.5" />}
                      {p.inMenu ? 'En Especiales' : 'Poner en Especiales'}
                    </button>
                    {p.sales === 0 && (
                      <button
                        type="button"
                        onClick={() => setConfirmDelete(p.id)}
                        className="flex h-8 w-8 items-center justify-center rounded-lg border border-border/60 text-muted-foreground hover:text-destructive"
                        aria-label="Borrar pack"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                )}
              </div>
            }
          />
        ))}
      </div>
    </div>
  );
}
