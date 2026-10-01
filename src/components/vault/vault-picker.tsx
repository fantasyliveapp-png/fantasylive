'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { Check, Flame, Gem, Loader2, Package, Play, Send, X } from 'lucide-react';
import { toast } from 'sonner';
import type { VaultSection } from '@prisma/client';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { ChatVault } from '@/lib/vault-data';
import { getChatVaultAction, sendVaultItemsAction } from '@/server/actions/vault';

const LEVEL_NAMES = ['nada todavia', 'Nivel 1', 'Nivel 2', 'Nivel 3', 'Especial'];
const MAX_PICK = 20;

/**
 * Boton "Boveda" del chat: la creadora elige fotos o videos de su Boveda y
 * los envia sin volver a subirlos.
 */
export function VaultPicker({
  conversationId,
  requestId,
  onSent,
}: {
  conversationId: string;
  /** Entregando un pedido a medida: va gratis y lo marca como entregado. */
  requestId?: string;
  onSent: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setOpen(true)}
        aria-label="Enviar desde la Boveda"
        title="Boveda"
      >
        <Gem className="h-4 w-4" />
      </Button>
      {/* En un portal: la caja de escribir tiene desenfoque de fondo, que
          encerraria la ventana dentro de ella en vez de ocupar la pantalla. */}
      {open &&
        createPortal(
          <VaultSheet
            conversationId={conversationId}
            requestId={requestId}
            onClose={() => setOpen(false)}
            onSent={() => {
              setOpen(false);
              onSent();
            }}
          />,
          document.body,
        )}
    </>
  );
}

function VaultSheet({
  conversationId,
  requestId,
  onClose,
  onSent,
}: {
  conversationId: string;
  requestId?: string;
  onClose: () => void;
  onSent: () => void;
}) {
  const [vault, setVault] = useState<ChatVault | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Como en la Boveda: paquetes, sueltas o gratis para enganchar.
  const [group, setGroup] = useState<'packs' | 'paid' | 'free' | null>(null);
  // Paquetes elegidos (van enteros, por su precio).
  const [pickedPacks, setPickedPacks] = useState<string[]>([]);
  // Orden de eleccion = orden en el envio.
  const [picked, setPicked] = useState<string[]>([]);
  // Precio de TODO el envio. null = el sugerido (suma de los niveles).
  const [customPrice, setCustomPrice] = useState<number | null>(null);
  const [body, setBody] = useState('');
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    let alive = true;
    getChatVaultAction(conversationId).then((r) => {
      if (!alive) return;
      if (r.ok && r.data) setVault(r.data);
      else setError(r.error ?? 'No se pudo abrir la Boveda.');
    });
    return () => {
      alive = false;
    };
  }, [conversationId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const sent = useMemo(() => new Set(vault?.sentIds), [vault]);
  const bought = useMemo(() => new Set(vault?.boughtIds), [vault]);
  const itemsById = useMemo(() => new Map(vault?.items.map((i) => [i.id, i])), [vault]);
  const tab = group ?? (vault?.packs.length ? 'packs' : 'paid');
  const counts = useMemo(() => {
    const items = vault?.items ?? [];
    return {
      packs: vault?.packs.length ?? 0,
      free: items.filter((i) => i.section === 'TEASER').length,
      paid: items.filter((i) => i.section !== 'TEASER' && !i.packId).length,
    };
  }, [vault]);
  const shown = (vault?.items ?? []).filter((i) =>
    tab === 'free' ? i.section === 'TEASER' : i.section !== 'TEASER' && !i.packId,
  );
  const packsById = useMemo(() => new Map((vault?.packs ?? []).map((p) => [p.id, p])), [vault]);
  const chosenPacks = pickedPacks.map((id) => packsById.get(id)).filter((p) => p !== undefined);
  const packItemIds = chosenPacks.flatMap((p) => p.itemIds);

  const pickedItems = picked.map((id) => itemsById.get(id)).filter((i) => i !== undefined);
  const allTeasers =
    chosenPacks.length === 0 && pickedItems.length > 0 && pickedItems.every((i) => i.section === 'TEASER');
  // Sugerido: el precio de cada paquete + el de cada suelta.
  const suggested =
    chosenPacks.reduce((sum, p) => sum + p.priceTokens, 0) +
    pickedItems.reduce((sum, i) => sum + (i.section === 'TEASER' ? 0 : i.suggestedPrice), 0);
  const totalFiles = picked.length + packItemIds.length;
  const isFree = Boolean(requestId) || allTeasers;
  const price = isFree ? 0 : (customPrice ?? suggested);
  const alreadyHas = [...pickedItems.map((i) => i.id), ...packItemIds].filter((id) => bought.has(id)).length;

  function togglePack(id: string) {
    const pack = packsById.get(id);
    if (!pack) return;
    setPickedPacks((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (totalFiles + pack.itemIds.length > MAX_PICK) {
        toast.error(`Maximo ${MAX_PICK} archivos por envio.`);
        return prev;
      }
      return [...prev, id];
    });
  }

  function toggle(id: string) {
    setPicked((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length + packItemIds.length >= MAX_PICK) {
        toast.error(`Maximo ${MAX_PICK} archivos por envio.`);
        return prev;
      }
      return [...prev, id];
    });
  }

  function send() {
    startTransition(async () => {
      const result = await sendVaultItemsAction({
        conversationId,
        itemIds: [...packItemIds, ...picked],
        priceTokens: price,
        body,
        requestId,
      });
      if (result.ok) {
        toast.success(result.message ?? 'Enviado');
        onSent();
      } else {
        toast.error(result.error ?? 'No se pudo enviar');
      }
    });
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center bg-black/70 sm:items-center"
      onClick={onClose}
    >
      <div
        className="flex max-h-[92dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-3xl border border-border/60 bg-background sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Boveda"
      >
        {/* Cabecera y pista del fan */}
        <div className="border-b border-border/60 px-4 pb-3 pt-4">
          <div className="flex items-center gap-2">
            <Gem className="h-5 w-5 text-primary" />
            <h2 className="flex-1 font-semibold">Boveda</h2>
            <button
              type="button"
              onClick={onClose}
              className="rounded-full p-1.5 hover:bg-muted"
              aria-label="Cerrar"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          {requestId && (
            <p className="mt-2 rounded-xl border border-champagne-gold/40 bg-champagne-gold/10 px-3 py-2 text-xs text-champagne-gold">
              Entregando un pedido pagado: lo que elijas le llega gratis.
            </p>
          )}
          {vault && !requestId && (
            <p className="mt-2 rounded-xl bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
              {vault.fan.purchases > 0 ? (
                <>
                  Este fan ha comprado hasta{' '}
                  <strong className="text-foreground">{LEVEL_NAMES[vault.fan.topLevel]}</strong> ·{' '}
                  {vault.fan.purchases} {vault.fan.purchases === 1 ? 'compra' : 'compras'} ·{' '}
                  {vault.fan.spentTokens} tokens en este chat
                </>
              ) : (
                <>Este fan aun no ha comprado nada en este chat. Empieza con algo para enganchar.</>
              )}
            </p>
          )}
        </div>

        {!vault ? (
          <div className="flex flex-1 items-center justify-center p-10 text-sm text-muted-foreground">
            {error ?? <Loader2 className="h-5 w-5 animate-spin" />}
          </div>
        ) : vault.items.length === 0 ? (
          <div className="flex flex-1 flex-col items-center gap-3 p-10 text-center text-sm text-muted-foreground">
            <Gem className="h-8 w-8" />
            Tu Boveda esta vacia. Sube fotos y videos para enviarlos desde aqui.
            <Link href="/dashboard/model/contenido?tab=chat" className="font-medium text-primary hover:underline">
              Ir a mi Boveda
            </Link>
          </div>
        ) : (
          <>
            {/* Paquetes / Sueltas / Gratis */}
            <div className="grid grid-cols-3 gap-1.5 px-4 pt-3">
              {[
                { id: 'packs' as const, label: 'Paquetes', icon: <Package className="h-3.5 w-3.5 text-token" />, n: counts.packs },
                { id: 'paid' as const, label: 'Sueltas', icon: <Gem className="h-3.5 w-3.5 text-token" />, n: counts.paid },
                { id: 'free' as const, label: 'Gratis', icon: <Flame className="h-3.5 w-3.5 text-primary" />, n: counts.free },
              ].map((g) => (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => setGroup(g.id)}
                  className={cn(
                    'flex items-center justify-center gap-1 rounded-full border px-2 py-1.5 text-xs font-medium',
                    tab === g.id ? 'border-primary bg-primary/15 text-foreground' : 'border-border/60 text-muted-foreground',
                  )}
                >
                  {g.icon}
                  {g.label}
                  <span className="text-[10px] text-muted-foreground">{g.n}</span>
                </button>
              ))}
            </div>
            <p className="px-4 pt-2 text-[11px] text-muted-foreground">
              {tab === 'packs'
                ? 'Toca un paquete para enviarlo entero por su precio.'
                : 'Elige una o varias: el fan paga una sola vez la suma de sus precios.'}
            </p>

            {tab === 'packs' && (
              <div className="grid flex-1 gap-2 overflow-y-auto p-4 sm:grid-cols-2">
                {(vault.packs ?? []).length === 0 && (
                  <p className="col-span-full py-8 text-center text-xs text-muted-foreground">
                    Aún no tienes paquetes. Créalos en Contenido › Para chat.
                  </p>
                )}
                {vault.packs.map((p) => {
                  const isPicked = pickedPacks.includes(p.id);
                  const hasAll = p.itemIds.every((id) => bought.has(id));
                  const cover = p.itemIds.slice(0, 4).map((id) => itemsById.get(id)).filter((i) => i !== undefined);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => togglePack(p.id)}
                      className={cn(
                        'overflow-hidden rounded-2xl border bg-card text-left',
                        isPicked ? 'border-primary ring-2 ring-primary' : 'border-border/60',
                      )}
                    >
                      <div className="relative grid aspect-[2/1] grid-cols-4 gap-0.5 bg-muted">
                        {cover.map((i) =>
                          i.url && !i.mimeType.startsWith('video/') ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img key={i.id} src={i.url} alt="" className="h-full w-full object-cover" />
                          ) : (
                            <span key={i.id} className="flex items-center justify-center">
                              <Play className="h-4 w-4 text-muted-foreground" />
                            </span>
                          ),
                        )}
                        {hasAll && (
                          <span className="absolute right-1.5 top-1.5 rounded bg-state-connected px-1.5 py-0.5 text-[10px] font-bold text-black">
                            Ya lo tiene
                          </span>
                        )}
                        {isPicked && (
                          <span className="absolute inset-0 flex items-center justify-center bg-primary/25">
                            <Check className="h-8 w-8 text-white drop-shadow" />
                          </span>
                        )}
                      </div>
                      <div className="flex items-center justify-between gap-2 p-2.5">
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-semibold">{p.name}</span>
                          <span className="block text-[11px] text-muted-foreground">
                            {p.itemIds.length} {p.itemIds.length === 1 ? 'archivo' : 'archivos'}
                          </span>
                        </span>
                        <span className="shrink-0 text-sm font-bold text-token">{p.priceTokens} tk</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            {/* Galeria */}
            {tab !== 'packs' && (
            <div className="grid flex-1 grid-cols-3 gap-1.5 overflow-y-auto p-4 sm:grid-cols-4">
              {shown.length === 0 && (
                <p className="col-span-full py-8 text-center text-xs text-muted-foreground">
                  Nada en esta seccion.
                </p>
              )}
              {shown.map((i) => {
                const isPicked = picked.includes(i.id);
                const has = bought.has(i.id);
                return (
                  <button
                    key={i.id}
                    type="button"
                    onClick={() => toggle(i.id)}
                    className={cn(
                      'relative aspect-[3/4] overflow-hidden rounded-xl bg-muted',
                      isPicked && 'ring-2 ring-primary ring-offset-2 ring-offset-background',
                    )}
                  >
                    {i.url &&
                      (i.mimeType.startsWith('video/') ? (
                        <>
                          <video
                            src={i.url}
                            muted
                            preload="metadata"
                            className="h-full w-full object-cover"
                          />
                          <Play className="absolute left-1.5 top-1.5 h-4 w-4 text-white drop-shadow" />
                        </>
                      ) : (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={i.url}
                          alt=""
                          className="h-full w-full object-cover"
                          loading="lazy"
                        />
                      ))}
                    <span className="absolute bottom-1.5 left-1.5 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                      {i.suggestedPrice > 0 ? `${i.suggestedPrice} tk` : 'Gratis'}
                    </span>
                    {(has || sent.has(i.id)) && (
                      <span
                        className={cn(
                          'absolute right-1.5 top-1.5 rounded px-1.5 py-0.5 text-[10px] font-bold',
                          has ? 'bg-state-connected text-black' : 'bg-black/60 text-white',
                        )}
                      >
                        {has ? 'Ya lo tiene' : 'Enviado'}
                      </span>
                    )}
                    {i.note && (
                      <span className="absolute inset-x-0 bottom-7 truncate px-1.5 text-left text-[10px] text-white drop-shadow">
                        {i.note}
                      </span>
                    )}
                    {isPicked && (
                      <span className="absolute inset-0 flex items-center justify-center bg-primary/25">
                        <Check className="h-8 w-8 text-white drop-shadow" />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            )}

            {/* Lo elegido: UN envio con UN precio */}
            {(picked.length > 0 || chosenPacks.length > 0) && (
              <div className="space-y-2 border-t border-border/60 p-3">
                <div className="flex gap-1.5 overflow-x-auto [scrollbar-width:none]">
                  {chosenPacks.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => togglePack(p.id)}
                      className="flex h-11 shrink-0 items-center gap-1 rounded-lg bg-muted px-2.5 text-xs font-semibold"
                      aria-label="Quitar paquete"
                    >
                      <Package className="h-3.5 w-3.5 text-token" />
                      {p.name}
                      <X className="h-3 w-3" />
                    </button>
                  ))}
                  {pickedItems.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => toggle(item.id)}
                      className="relative h-11 w-11 shrink-0 overflow-hidden rounded-lg bg-muted"
                      aria-label="Quitar"
                    >
                      {item.url && !item.mimeType.startsWith('video/') && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={item.url} alt="" className="h-full w-full object-cover" />
                      )}
                      {item.mimeType.startsWith('video/') && (
                        <Play className="absolute inset-0 m-auto h-4 w-4 text-muted-foreground" />
                      )}
                      <X className="absolute right-0.5 top-0.5 h-3 w-3 rounded-full bg-black/70 text-white" />
                    </button>
                  ))}
                </div>
                {alreadyHas > 0 && !requestId && (
                  <p className="text-[11px] text-state-connected">
                    Ojo: ya tiene {alreadyHas} de {totalFiles}. Quitalos para no cobrarle dos veces.
                  </p>
                )}
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="text-muted-foreground">
                    {totalFiles} {totalFiles === 1 ? 'archivo' : 'archivos'} en un envio ·
                  </span>
                  {requestId ? (
                    <span className="font-medium text-champagne-gold">Gratis: entrega del pedido</span>
                  ) : allTeasers ? (
                    <span className="font-medium">Gratis (para enganchar)</span>
                  ) : (
                    <label className="flex items-center gap-1">
                      precio de todo
                      <input
                        type="number"
                        min={0}
                        value={price}
                        onChange={(e) => setCustomPrice(Math.max(0, Number(e.target.value) || 0))}
                        className="h-7 w-20 rounded-md border border-input bg-background px-1.5"
                        aria-label="Precio en tokens"
                      />
                      tk
                      {customPrice !== null && customPrice !== suggested && (
                        <button
                          type="button"
                          onClick={() => setCustomPrice(null)}
                          className="ml-1 text-primary hover:underline"
                        >
                          sugerido: {suggested}
                        </button>
                      )}
                    </label>
                  )}
                </div>
                <div className="flex items-end gap-2">
                  <textarea
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    rows={1}
                    maxLength={1000}
                    placeholder="Añade un mensaje (opcional)"
                    className="max-h-24 min-h-10 flex-1 resize-none rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none"
                  />
                  <Button variant="brand" onClick={send} disabled={isPending}>
                    {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    {requestId ? 'Entregar' : 'Enviar'}
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
