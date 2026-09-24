'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { Check, Flame, Gem, Loader2, Play, Send, X } from 'lucide-react';
import { toast } from 'sonner';
import type { VaultSection } from '@prisma/client';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { VAULT_SECTIONS } from '@/lib/vault';
import type { ChatVault } from '@/lib/vault-data';
import { getChatVaultAction, sendVaultItemsAction } from '@/server/actions/vault';

const LEVEL_NAMES = ['nada todavia', 'Nivel 1', 'Nivel 2', 'Nivel 3', 'Especial'];
const MAX_PICK = 10;

/**
 * Boton "Boveda" del chat: la creadora elige fotos o videos de su Boveda y
 * los envia sin volver a subirlos.
 */
export function VaultPicker({
  conversationId,
  onSent,
}: {
  conversationId: string;
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
  onClose,
  onSent,
}: {
  conversationId: string;
  onClose: () => void;
  onSent: () => void;
}) {
  const [vault, setVault] = useState<ChatVault | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [section, setSection] = useState<VaultSection>('TEASER');
  const [folder, setFolder] = useState<string>('all');
  const [picked, setPicked] = useState<Map<string, number>>(new Map());
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
  const counts = useMemo(() => {
    const c = new Map<VaultSection, number>();
    for (const i of vault?.items ?? []) c.set(i.section, (c.get(i.section) ?? 0) + 1);
    return c;
  }, [vault]);
  const shown = (vault?.items ?? []).filter(
    (i) =>
      i.section === section &&
      (folder === 'all' || (folder === 'none' ? !i.folderId : i.folderId === folder)),
  );

  function toggle(id: string, price: number) {
    setPicked((prev) => {
      const next = new Map(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size >= MAX_PICK) toast.error(`Maximo ${MAX_PICK} a la vez.`);
      else next.set(id, price);
      return next;
    });
  }

  function send() {
    startTransition(async () => {
      const result = await sendVaultItemsAction({
        conversationId,
        items: [...picked].map(([id, priceTokens]) => ({ id, priceTokens })),
        body,
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
          {vault && (
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
            <Link href="/dashboard/model/boveda" className="font-medium text-primary hover:underline">
              Ir a mi Boveda
            </Link>
          </div>
        ) : (
          <>
            {/* Secciones */}
            <div className="flex gap-1.5 overflow-x-auto px-4 pt-3 [scrollbar-width:none]">
              {VAULT_SECTIONS.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setSection(s.id)}
                  className={cn(
                    'flex shrink-0 items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-medium',
                    section === s.id
                      ? 'border-primary bg-primary/15 text-foreground'
                      : 'border-border/60 text-muted-foreground',
                  )}
                >
                  {s.id === 'TEASER' && <Flame className="h-3.5 w-3.5 text-primary" />}
                  {s.short}
                  <span className="ml-0.5 rounded-full bg-muted px-1.5 text-[10px] font-semibold text-muted-foreground">
                    {counts.get(s.id) ?? 0}
                  </span>
                </button>
              ))}
            </div>
            {/* Carpetas */}
            {vault.folders.length > 0 && (
              <div className="flex gap-1.5 overflow-x-auto px-4 pt-2 [scrollbar-width:none]">
                {[
                  { id: 'all', name: 'Todas' },
                  ...vault.folders,
                  { id: 'none', name: 'Sin carpeta' },
                ].map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setFolder(f.id)}
                    className={cn(
                      'shrink-0 rounded-md px-2 py-1 text-[11px]',
                      folder === f.id ? 'bg-muted text-foreground' : 'text-muted-foreground',
                    )}
                  >
                    {f.name}
                  </button>
                ))}
              </div>
            )}
            <p className="px-4 pt-2 text-[11px] text-muted-foreground">
              {VAULT_SECTIONS.find((s) => s.id === section)?.hint}
            </p>

            {/* Galeria */}
            <div className="grid flex-1 grid-cols-3 gap-1.5 overflow-y-auto p-4 sm:grid-cols-4">
              {shown.length === 0 && (
                <p className="col-span-full py-8 text-center text-xs text-muted-foreground">
                  Nada en esta seccion.
                </p>
              )}
              {shown.map((i) => {
                const isPicked = picked.has(i.id);
                const has = bought.has(i.id);
                return (
                  <button
                    key={i.id}
                    type="button"
                    onClick={() => toggle(i.id, i.suggestedPrice)}
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

            {/* Lo elegido, con su precio */}
            {picked.size > 0 && (
              <div className="space-y-2 border-t border-border/60 p-3">
                <div className="flex gap-2 overflow-x-auto [scrollbar-width:none]">
                  {[...picked].map(([id, price]) => {
                    const item = itemsById.get(id);
                    if (!item) return null;
                    const free = item.section === 'TEASER';
                    return (
                      <div
                        key={id}
                        className="flex shrink-0 items-center gap-1.5 rounded-xl border border-border/60 p-1.5"
                      >
                        <span className="h-9 w-9 overflow-hidden rounded-lg bg-muted">
                          {item.url && !item.mimeType.startsWith('video/') && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={item.url} alt="" className="h-full w-full object-cover" />
                          )}
                        </span>
                        {free ? (
                          <span className="px-1 text-xs text-muted-foreground">Gratis</span>
                        ) : (
                          <label className="flex items-center gap-1 text-xs">
                            <input
                              type="number"
                              min={0}
                              value={price}
                              onChange={(e) =>
                                setPicked((prev) =>
                                  new Map(prev).set(id, Math.max(0, Number(e.target.value) || 0)),
                                )
                              }
                              className="h-7 w-16 rounded-md border border-input bg-background px-1.5"
                              aria-label="Precio en tokens"
                            />
                            tk
                          </label>
                        )}
                        <button
                          type="button"
                          onClick={() => toggle(id, price)}
                          className="rounded p-0.5 text-muted-foreground hover:text-foreground"
                          aria-label="Quitar"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    );
                  })}
                </div>
                <div className="flex items-end gap-2">
                  <textarea
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    rows={1}
                    maxLength={1000}
                    placeholder="Anade un mensaje (opcional)"
                    className="max-h-24 min-h-10 flex-1 resize-none rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none"
                  />
                  <Button variant="brand" onClick={send} disabled={isPending}>
                    {isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Send className="h-4 w-4" />
                    )}
                    Enviar {picked.size}
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
