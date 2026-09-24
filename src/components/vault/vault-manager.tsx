'use client';

import { useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  Check,
  Coins,
  Flame,
  FolderPlus,
  Loader2,
  Pencil,
  Play,
  StickyNote,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import type { VaultSection } from '@prisma/client';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { VAULT_SECTIONS } from '@/lib/vault';
import type { CreatorVault } from '@/lib/vault-data';
import {
  addVaultItemsAction,
  deleteVaultFolderAction,
  deleteVaultItemsAction,
  requestVaultUploadUrlAction,
  saveVaultFolderAction,
  updateVaultItemsAction,
  updateVaultPricesAction,
  type VaultActionResult,
} from '@/server/actions/vault';

type Prices = { level1: number; level2: number; level3: number; special: number };

/**
 * La Boveda de la creadora: subir, ordenar por seccion (enganchar / niveles
 * de pago) y por carpetas propias, precios por nivel y que vende cada cosa.
 */
export function VaultManager({ vault, prices }: { vault: CreatorVault; prices: Prices }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [section, setSection] = useState<VaultSection>('TEASER');
  const [folder, setFolder] = useState<string>('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [uploading, setUploading] = useState<{ done: number; total: number } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  // Campo o confirmacion abierta (en vez de ventanas del navegador, que
  // algunos navegadores dentro de apps bloquean).
  const [edit, setEdit] = useState<{
    kind: 'newFolder' | 'renameFolder' | 'deleteFolder' | 'price' | 'note' | 'delete';
  } | null>(null);

  const counts = useMemo(() => {
    const c = new Map<VaultSection, number>();
    for (const i of vault.items) c.set(i.section, (c.get(i.section) ?? 0) + 1);
    return c;
  }, [vault.items]);
  const shown = vault.items.filter(
    (i) =>
      i.section === section &&
      (folder === 'all' || (folder === 'none' ? !i.folderId : i.folderId === folder)),
  );
  const currentFolder = vault.folders.find((f) => f.id === folder);
  const sectionMeta = VAULT_SECTIONS.find((s) => s.id === section)!;

  function run<T>(
    fn: () => Promise<VaultActionResult<T>>,
    onOk?: (r: VaultActionResult<T>) => void,
  ) {
    startTransition(async () => {
      const r = await fn();
      if (r.ok) {
        if (r.message) toast.success(r.message);
        onOk?.(r);
        router.refresh();
      } else {
        toast.error(r.error ?? 'No se pudo completar.');
      }
    });
  }

  async function upload(files: FileList) {
    const list = [...files].filter((f) => /^(image|video)\//.test(f.type));
    if (list.length === 0) return;
    setUploading({ done: 0, total: list.length });
    const ok: { key: string; mimeType: string; sizeBytes: number }[] = [];
    for (const file of list) {
      const url = await requestVaultUploadUrlAction({
        filename: file.name,
        contentType: file.type,
      });
      if (!url.ok || !url.data) {
        toast.error(url.error ?? 'No se pudo subir');
        break;
      }
      const put = await fetch(url.data.uploadUrl, {
        method: 'PUT',
        body: file,
        headers: { 'Content-Type': file.type },
      }).catch(() => null);
      if (put?.ok) ok.push({ key: url.data.key, mimeType: file.type, sizeBytes: file.size });
      else toast.error(`No se pudo subir ${file.name}`);
      setUploading((u) => (u ? { ...u, done: u.done + 1 } : u));
    }
    setUploading(null);
    if (ok.length) {
      run(() =>
        addVaultItemsAction({
          section,
          folderId: currentFolder?.id ?? null,
          files: ok,
        }),
      );
    }
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  const ids = [...selected];
  const clear = () => {
    setSelected(new Set());
    setEdit(null);
  };

  return (
    <div className="space-y-4">
      <PricesEditor
        initial={prices}
        onSave={(p) => run(() => updateVaultPricesAction(p))}
        disabled={isPending}
      />

      {/* Secciones */}
      <div className="flex gap-1.5 overflow-x-auto [scrollbar-width:none]">
        {VAULT_SECTIONS.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => {
              setSection(s.id);
              clear();
            }}
            className={cn(
              'flex shrink-0 items-center gap-1 rounded-full border px-3 py-1.5 text-sm font-medium',
              section === s.id
                ? 'border-primary bg-primary/15 text-foreground'
                : 'border-border/60 text-muted-foreground',
            )}
          >
            {s.id === 'TEASER' && <Flame className="h-4 w-4 text-primary" />}
            {s.short}
            <span className="ml-0.5 rounded-full bg-muted px-1.5 text-[10px] font-semibold text-muted-foreground">
              {counts.get(s.id) ?? 0}
            </span>
          </button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        <strong className="text-foreground">{sectionMeta.label}:</strong> {sectionMeta.hint}
        {section === 'TEASER' && ' Siempre se envian gratis.'}
      </p>

      {/* Carpetas */}
      <div className="flex flex-wrap items-center gap-1.5">
        {[{ id: 'all', name: 'Todas' }, ...vault.folders, { id: 'none', name: 'Sin carpeta' }].map(
          (f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFolder(f.id)}
              className={cn(
                'rounded-md px-2.5 py-1 text-xs',
                folder === f.id
                  ? 'bg-muted font-medium text-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {f.name}
            </button>
          ),
        )}
        <button
          type="button"
          onClick={() => setEdit({ kind: 'newFolder' })}
          className="inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs text-primary hover:underline"
        >
          <FolderPlus className="h-3.5 w-3.5" /> Carpeta
        </button>
        {currentFolder && (
          <>
            <button
              type="button"
              onClick={() => setEdit({ kind: 'renameFolder' })}
              className="rounded-md p-1 text-muted-foreground hover:text-foreground"
              aria-label="Renombrar carpeta"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setEdit({ kind: 'deleteFolder' })}
              className="rounded-md p-1 text-muted-foreground hover:text-destructive"
              aria-label="Borrar carpeta"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </>
        )}
      </div>
      {edit?.kind === 'newFolder' && (
        <InlineField
          placeholder="Nombre (p. ej. Lenceria, Ducha)"
          action="Crear"
          onCancel={() => setEdit(null)}
          onSubmit={(name) =>
            run(
              () => saveVaultFolderAction({ name }),
              (r) => {
                setEdit(null);
                if (r.data) setFolder(r.data.id);
              },
            )
          }
        />
      )}
      {edit?.kind === 'renameFolder' && currentFolder && (
        <InlineField
          initial={currentFolder.name}
          action="Renombrar"
          onCancel={() => setEdit(null)}
          onSubmit={(name) =>
            run(
              () => saveVaultFolderAction({ id: currentFolder.id, name }),
              () => setEdit(null),
            )
          }
        />
      )}
      {edit?.kind === 'deleteFolder' && currentFolder && (
        <Confirm
          text={`¿Borrar la carpeta «${currentFolder.name}»? Los archivos se quedan en tu Boveda.`}
          onCancel={() => setEdit(null)}
          onConfirm={() =>
            run(
              () => deleteVaultFolderAction(currentFolder.id),
              () => {
                setEdit(null);
                setFolder('all');
              },
            )
          }
        />
      )}

      {/* Subir */}
      <input
        ref={fileInput}
        type="file"
        accept="image/*,video/*"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files) void upload(e.target.files);
          e.target.value = '';
        }}
      />
      <Button
        variant="brand"
        className="w-full"
        onClick={() => fileInput.current?.click()}
        disabled={Boolean(uploading) || isPending}
      >
        {uploading ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" /> Subiendo {uploading.done}/{uploading.total}
          </>
        ) : (
          <>
            <Upload className="h-4 w-4" /> Subir a {sectionMeta.short}
            {currentFolder ? ` · ${currentFolder.name}` : ''}
          </>
        )}
      </Button>

      {/* Galeria */}
      {shown.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border/60 px-6 py-12 text-center text-sm text-muted-foreground">
          {section === 'TEASER'
            ? 'Sube aqui fotos provocativas para enganchar a tus fans.'
            : 'Aun no hay nada en esta seccion.'}
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4 lg:grid-cols-5">
          {shown.map((i) => {
            const isSel = selected.has(i.id);
            const folderName = vault.folders.find((f) => f.id === i.folderId)?.name;
            return (
              <button
                key={i.id}
                type="button"
                onClick={() => toggle(i.id)}
                className={cn(
                  'relative aspect-[3/4] overflow-hidden rounded-xl bg-muted text-left',
                  isSel && 'ring-2 ring-primary ring-offset-2 ring-offset-background',
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
                    <img src={i.url} alt="" className="h-full w-full object-cover" loading="lazy" />
                  ))}
                <span className="absolute inset-x-0 bottom-0 space-y-0.5 bg-gradient-to-t from-black/80 to-transparent p-1.5 pt-5 text-[10px] text-white">
                  {i.note && <span className="block truncate font-medium">{i.note}</span>}
                  <span className="block">
                    {section === 'TEASER'
                      ? `Enviada ${i.stats.sends} · engancho ${i.stats.hooked}`
                      : `${i.suggestedPrice} tk · vendida ${i.stats.sales}`}
                  </span>
                  {folderName && folder === 'all' && (
                    <span className="block truncate text-white/70">{folderName}</span>
                  )}
                </span>
                {isSel && (
                  <span className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-primary">
                    <Check className="h-4 w-4 text-white" />
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Acciones sobre lo seleccionado */}
      {selected.size > 0 && (
        <div className="sticky bottom-20 z-10 space-y-2 rounded-2xl border border-border/60 bg-background/95 p-3 shadow-2xl backdrop-blur md:bottom-4">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium">
              {selected.size} {selected.size === 1 ? 'seleccionado' : 'seleccionados'}
            </span>
            <button
              type="button"
              onClick={clear}
              className="rounded-full p-1 hover:bg-muted"
              aria-label="Quitar seleccion"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            <select
              aria-label="Mover a seccion"
              value=""
              onChange={(e) => {
                const to = e.target.value as VaultSection;
                if (to) run(() => updateVaultItemsAction({ ids, section: to }), clear);
              }}
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            >
              <option value="">Mover a…</option>
              {VAULT_SECTIONS.filter((s) => s.id !== section).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
            <select
              aria-label="Carpeta"
              value=""
              onChange={(e) => {
                const v = e.target.value;
                if (v)
                  run(
                    () => updateVaultItemsAction({ ids, folderId: v === 'none' ? null : v }),
                    clear,
                  );
              }}
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            >
              <option value="">Carpeta…</option>
              {vault.folders.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
              <option value="none">Sin carpeta</option>
            </select>
            {section !== 'TEASER' && (
              <Button size="sm" variant="secondary" onClick={() => setEdit({ kind: 'price' })}>
                <Coins className="h-4 w-4" /> Precio
              </Button>
            )}
            <Button size="sm" variant="secondary" onClick={() => setEdit({ kind: 'note' })}>
              <StickyNote className="h-4 w-4" /> Nota
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEdit({ kind: 'delete' })}>
              <Trash2 className="h-4 w-4" /> Borrar
            </Button>
          </div>
          {edit?.kind === 'price' && (
            <InlineField
              type="number"
              placeholder="Tokens (vacio = el del nivel)"
              action="Aplicar"
              allowEmpty
              onCancel={() => setEdit(null)}
              onSubmit={(v) => {
                const price = v.trim() === '' ? null : Number(v);
                if (price !== null && (!Number.isInteger(price) || price < 1)) {
                  toast.error('Pon un numero entero de tokens.');
                  return;
                }
                run(() => updateVaultItemsAction({ ids, priceTokens: price }), clear);
              }}
            />
          )}
          {edit?.kind === 'note' && (
            <InlineField
              placeholder="Nota corta (p. ej. lenceria roja)"
              action="Guardar"
              allowEmpty
              onCancel={() => setEdit(null)}
              onSubmit={(v) => run(() => updateVaultItemsAction({ ids, note: v }), clear)}
            />
          )}
          {edit?.kind === 'delete' && (
            <Confirm
              text="¿Borrar de tu Boveda? Lo que ya enviaste por chat se seguira viendo."
              onCancel={() => setEdit(null)}
              onConfirm={() => run(() => deleteVaultItemsAction(ids), clear)}
            />
          )}
        </div>
      )}
    </div>
  );
}

function PricesEditor({
  initial,
  onSave,
  disabled,
}: {
  initial: Prices;
  onSave: (p: Prices) => void;
  disabled: boolean;
}) {
  const [p, setP] = useState(initial);
  const changed = JSON.stringify(p) !== JSON.stringify(initial);
  const fields: { key: keyof Prices; label: string }[] = [
    { key: 'level1', label: 'Nivel 1' },
    { key: 'level2', label: 'Nivel 2' },
    { key: 'level3', label: 'Nivel 3' },
    { key: 'special', label: 'Especial' },
  ];
  return (
    <details className="rounded-2xl border border-border/60 bg-card">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm">
        <Coins className="h-4 w-4 text-token" />
        <span className="flex-1 font-medium">Precios por nivel</span>
        <span className="text-xs text-muted-foreground">
          {initial.level1} · {initial.level2} · {initial.level3} · {initial.special} tk
        </span>
      </summary>
      <div className="space-y-3 border-t border-border/60 p-4">
        <p className="text-xs text-muted-foreground">
          Es el precio que se propone al enviar. Se puede cambiar en cada envio o poner un precio
          propio a un archivo.
        </p>
        <div className="grid grid-cols-4 gap-2">
          {fields.map((f) => (
            <label key={f.key} className="space-y-1 text-xs">
              <span className="text-muted-foreground">{f.label}</span>
              <input
                type="number"
                min={1}
                value={p[f.key]}
                onChange={(e) => setP({ ...p, [f.key]: Number(e.target.value) || 0 })}
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
              />
            </label>
          ))}
        </div>
        <Button size="sm" variant="brand" disabled={!changed || disabled} onClick={() => onSave(p)}>
          Guardar precios
        </Button>
      </div>
    </details>
  );
}

function InlineField({
  initial = '',
  placeholder,
  action,
  type = 'text',
  allowEmpty = false,
  onSubmit,
  onCancel,
}: {
  initial?: string;
  placeholder?: string;
  action: string;
  type?: 'text' | 'number';
  allowEmpty?: boolean;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (allowEmpty || value.trim()) onSubmit(value);
      }}
    >
      <input
        autoFocus
        type={type}
        min={type === 'number' ? 1 : undefined}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        maxLength={80}
        className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-2.5 text-sm"
      />
      <Button type="submit" size="sm" variant="brand" disabled={!allowEmpty && !value.trim()}>
        {action}
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
        Cancelar
      </Button>
    </form>
  );
}

function Confirm({
  text,
  onConfirm,
  onCancel,
}: {
  text: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-destructive/40 bg-destructive/10 p-2.5 text-xs">
      <span className="min-w-0 flex-1">{text}</span>
      <Button size="sm" variant="ghost" onClick={onCancel}>
        No
      </Button>
      <Button size="sm" variant="destructive" onClick={onConfirm}>
        Si, borrar
      </Button>
    </div>
  );
}
