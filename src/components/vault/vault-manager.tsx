'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowRightLeft,
  Check,
  Coins,
  Flame,
  Gem,
  Layers,
  Loader2,
  Package,
  Pencil,
  Play,
  StickyNote,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { CreatorPriceInput, creatorUsd } from '@/components/money/creator-price';
import type { EconomyParams } from '@/lib/earnings';
import { hashFile } from '@/lib/file-hash';
import { cn } from '@/lib/utils';
import type { CreatorVault } from '@/lib/vault-data';
import { checkContentAction } from '@/server/actions/content-guard';
import {
  addVaultItemsAction,
  createVaultPackAction,
  deleteVaultItemsAction,
  deleteVaultPackAction,
  requestVaultUploadUrlAction,
  updateVaultItemsAction,
  updateVaultPackAction,
  type VaultActionResult,
} from '@/server/actions/vault';

const PRICE_CHOICES = [30, 60, 100, 200];
const PACK_PRICE_CHOICES = [100, 200, 300, 500];

type Group = 'packs' | 'single' | 'free';
type Item = CreatorVault['items'][number];

/**
 * PARA CHAT: lo que vendes por mensaje, de dos formas.
 *  - Paquetes: varias fotos y videos juntos por un precio.
 *  - Sueltas: cada foto o video con su precio.
 * Y "Gratis" para enganchar. Cada precio dice tambien lo que ganas en $.
 */
export function VaultManager({ vault, economy }: { vault: CreatorVault; economy: EconomyParams }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [group, setGroup] = useState<Group>(vault.packs.length ? 'packs' : 'single');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [edit, setEdit] = useState<'price' | 'note' | 'delete' | 'pack' | null>(null);

  const usd = (tokens: number) => creatorUsd(tokens, economy);
  const singles = vault.items.filter((i) => i.section !== 'TEASER' && !i.packId);
  const free = vault.items.filter((i) => i.section === 'TEASER');
  const byId = new Map(vault.items.map((i) => [i.id, i]));
  const shown = group === 'single' ? singles : free;

  function run<T>(fn: () => Promise<VaultActionResult<T>>, onOk?: () => void) {
    startTransition(async () => {
      const r = await fn();
      if (r.ok) {
        if (r.message) toast.success(r.message);
        onOk?.();
        router.refresh();
      } else toast.error(r.error ?? 'No se pudo completar.');
    });
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
  const switchTo = (g: Group) => {
    setGroup(g);
    clear();
  };

  return (
    <div className="space-y-4">
      {/* Tres grupos */}
      <div className="grid grid-cols-3 gap-1.5">
        <GroupButton active={group === 'packs'} onClick={() => switchTo('packs')} icon={<Package className="h-4 w-4 text-token" />} label="Paquetes" count={vault.packs.length} />
        <GroupButton active={group === 'single'} onClick={() => switchTo('single')} icon={<Gem className="h-4 w-4 text-token" />} label="Sueltas" count={singles.length} />
        <GroupButton active={group === 'free'} onClick={() => switchTo('free')} icon={<Flame className="h-4 w-4 text-primary" />} label="Gratis" count={free.length} />
      </div>
      <p className="text-xs text-muted-foreground">
        {group === 'packs'
          ? 'Varias fotos y vídeos juntos por un solo precio. En el chat los envías de un toque.'
          : group === 'single'
            ? 'Cada foto o vídeo con su precio. En el chat puedes mandar una o varias: el fan paga la suma.'
            : 'Fotos que mandas gratis para enganchar: que el fan quiera más.'}
      </p>

      <Uploader group={group} economy={economy} onDone={() => router.refresh()} />

      {/* PAQUETES */}
      {group === 'packs' &&
        (vault.packs.length === 0 ? (
          <Empty text="Aún no tienes paquetes. Sube varias fotos de una como paquete, o junta algunas de «Sueltas»." />
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {vault.packs.map((p) => (
              <PackCard
                key={p.id}
                pack={p}
                items={p.itemIds.map((id) => byId.get(id)).filter((i): i is Item => Boolean(i))}
                usd={usd}
                economy={economy}
                pending={isPending}
                onRename={(name) => run(() => updateVaultPackAction({ id: p.id, name }))}
                onPrice={(priceTokens) => run(() => updateVaultPackAction({ id: p.id, priceTokens }))}
                onUnpack={() => run(() => deleteVaultPackAction(p.id))}
              />
            ))}
          </div>
        ))}

      {/* SUELTAS / GRATIS */}
      {group !== 'packs' &&
        (shown.length === 0 ? (
          <Empty text={group === 'single' ? 'Aún no tienes nada suelto de pago.' : 'Aún no tienes fotos para enganchar.'} />
        ) : (
          <>
            <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4 lg:grid-cols-5">
              {shown.map((i) => (
                <Tile key={i.id} item={i} selected={selected.has(i.id)} onClick={() => toggle(i.id)} usd={group === 'single' ? usd : null} />
              ))}
            </div>
            {selected.size === 0 && (
              <p className="text-center text-xs text-muted-foreground">
                {group === 'single'
                  ? 'Toca varias para juntarlas en un paquete, cambiar su precio o borrarlas.'
                  : 'Toca una o varias para pasarlas a de pago o borrarlas.'}
              </p>
            )}
          </>
        ))}

      {/* Acciones sobre lo seleccionado */}
      {selected.size > 0 && group !== 'packs' && (
        <div className="sticky bottom-20 z-10 space-y-2 rounded-2xl border border-border/60 bg-background/95 p-3 shadow-2xl backdrop-blur md:bottom-4">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium">
              {selected.size} {selected.size === 1 ? 'seleccionada' : 'seleccionadas'}
            </span>
            <button type="button" onClick={clear} className="rounded-full p-1 hover:bg-muted" aria-label="Quitar seleccion">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {group === 'single' && selected.size >= 2 && (
              <Button size="sm" variant="brand" onClick={() => setEdit('pack')}>
                <Package className="h-4 w-4" /> Juntar en un paquete
              </Button>
            )}
            {group === 'single' && (
              <Button size="sm" variant="secondary" onClick={() => setEdit('price')}>
                <Coins className="h-4 w-4" /> Cambiar precio
              </Button>
            )}
            <Button
              size="sm"
              variant="secondary"
              disabled={isPending}
              onClick={() =>
                run(
                  () =>
                    group === 'single'
                      ? updateVaultItemsAction({ ids, section: 'TEASER', priceTokens: null })
                      : updateVaultItemsAction({ ids, section: 'LEVEL_1', priceTokens: 60 }),
                  clear,
                )
              }
            >
              <ArrowRightLeft className="h-4 w-4" />
              {group === 'single' ? 'Pasar a gratis' : 'Pasar a de pago (60 tk)'}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setEdit('note')}>
              <StickyNote className="h-4 w-4" /> Nota
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEdit('delete')}>
              <Trash2 className="h-4 w-4" /> Borrar
            </Button>
          </div>
          {edit === 'pack' && (
            <PackForm
              economy={economy}
              suggested={ids.reduce((sum, id) => sum + (byId.get(id)?.suggestedPrice ?? 0), 0)}
              onCancel={() => setEdit(null)}
              onSubmit={(name, priceTokens) =>
                run(() => createVaultPackAction({ name, priceTokens, itemIds: ids }), () => {
                  clear();
                  setGroup('packs');
                })
              }
            />
          )}
          {edit === 'price' && (
            <PriceField
              choices={PRICE_CHOICES}
              initial={60}
              economy={economy}
              onCancel={() => setEdit(null)}
              onSubmit={(price) => run(() => updateVaultItemsAction({ ids, priceTokens: price }), clear)}
            />
          )}
          {edit === 'note' && (
            <TextField
              placeholder="Nota corta (p. ej. lencería roja)"
              action="Guardar"
              onCancel={() => setEdit(null)}
              onSubmit={(v) => run(() => updateVaultItemsAction({ ids, note: v }), clear)}
            />
          )}
          {edit === 'delete' && (
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-destructive/40 bg-destructive/10 p-2.5 text-xs">
              <span className="min-w-0 flex-1">¿Borrar? Lo que ya enviaste por chat se seguirá viendo.</span>
              <Button size="sm" variant="ghost" onClick={() => setEdit(null)}>
                No
              </Button>
              <Button size="sm" variant="destructive" onClick={() => run(() => deleteVaultItemsAction(ids), clear)}>
                Sí, borrar
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Subir: sueltas (cada una con su precio) o todo junto como paquete
// ---------------------------------------------------------------------------

function Uploader({ group, economy, onDone }: { group: Group; economy: EconomyParams; onDone: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [price, setPrice] = useState(60);
  const [packName, setPackName] = useState('');
  const [packPrice, setPackPrice] = useState(200);
  const [busy, setBusy] = useState<string | null>(null);
  const asPack = group === 'packs';
  const isFree = group === 'free';

  async function upload(list: File[]) {
    if (list.length === 0) return;
    if (asPack && list.length < 2) {
      toast.error('Un paquete lleva al menos 2 archivos.');
      return;
    }
    if (asPack && !packName.trim()) {
      toast.error('Ponle un nombre al paquete.');
      return;
    }

    // 1. Sin repetir: lo que ya es de un pack de directo no entra al chat.
    setBusy('Comprobando...');
    const hashes = await Promise.all(list.map((f) => hashFile(f)));
    const check = await checkContentAction({ hashes: hashes.filter((h): h is string => Boolean(h)), target: 'chat' });
    const placeOf = new Map((check.data ?? []).map((d) => [d.hash, d]));
    const keep: { file: File; hash: string | null }[] = [];
    let blocked = 0;
    let repeated = 0;
    list.forEach((file, n) => {
      const hit = hashes[n] ? placeOf.get(hashes[n]!) : undefined;
      if (hit?.blocked) blocked++;
      else if (hit?.place === 'chat') repeated++;
      else keep.push({ file, hash: hashes[n] ?? null });
    });
    if (blocked) toast.error(`${blocked} ${blocked === 1 ? 'archivo es' : 'archivos son'} de un pack de directo: lo de los directos no se vende por chat.`);
    if (repeated) toast(`${repeated} ya ${repeated === 1 ? 'estaba' : 'estaban'} en tu Bóveda: no se ${repeated === 1 ? 'sube' : 'suben'} otra vez.`);
    if (keep.length === 0 || (asPack && keep.length < 2)) {
      setBusy(null);
      return;
    }

    // 2. Subir
    const ok: { key: string; mimeType: string; sizeBytes: number; contentHash: string | null }[] = [];
    for (let n = 0; n < keep.length; n++) {
      const { file, hash } = keep[n]!;
      setBusy(`Subiendo ${n + 1}/${keep.length}`);
      const url = await requestVaultUploadUrlAction({ filename: file.name, contentType: file.type });
      if (!url.ok || !url.data) {
        toast.error(url.error ?? 'No se pudo subir');
        break;
      }
      const put = await fetch(url.data.uploadUrl, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } }).catch(() => null);
      if (put?.ok) ok.push({ key: url.data.key, mimeType: file.type, sizeBytes: file.size, contentHash: hash });
      else toast.error(`No se pudo subir ${file.name}`);
    }

    // 3. Guardar
    if (ok.length) {
      setBusy('Guardando...');
      const r = await addVaultItemsAction({
        section: isFree ? 'TEASER' : 'LEVEL_1',
        files: ok,
        priceTokens: isFree || asPack ? null : price,
        pack: asPack ? { name: packName, priceTokens: packPrice } : null,
      });
      if (r.ok) {
        toast.success(r.message ?? 'Guardado.');
        setPackName('');
        onDone();
      } else toast.error(r.error ?? 'No se pudo guardar.');
    }
    setBusy(null);
  }

  return (
    <div className="space-y-2.5 rounded-2xl border border-dashed border-border/70 p-3">
      <input
        ref={input}
        type="file"
        accept="image/*,video/*"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = [...(e.target.files ?? [])].filter((f) => /^(image|video)\//.test(f.type));
          e.target.value = '';
          void upload(files);
        }}
      />
      {asPack ? (
        <>
          <input
            value={packName}
            onChange={(e) => setPackName(e.target.value)}
            maxLength={60}
            placeholder="Nombre del paquete (p. ej. Sesión en la playa)"
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
          />
          <PricePicker label="Precio del paquete" choices={PACK_PRICE_CHOICES} value={packPrice} onChange={setPackPrice} economy={economy} />
        </>
      ) : (
        !isFree && <PricePicker label="Precio de cada una" choices={PRICE_CHOICES} value={price} onChange={setPrice} economy={economy} />
      )}
      <Button variant="brand" className="w-full" onClick={() => input.current?.click()} disabled={Boolean(busy)}>
        {busy ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" /> {busy}
          </>
        ) : (
          <>
            {asPack ? <Package className="h-4 w-4" /> : <Upload className="h-4 w-4" />}
            {asPack
              ? `Elegir fotos y vídeos del paquete · ${packPrice} tk`
              : isFree
                ? 'Subir fotos gratis'
                : `Subir fotos y vídeos a ${price} tk cada una`}
          </>
        )}
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Piezas
// ---------------------------------------------------------------------------

function PackCard({
  pack,
  items,
  usd,
  economy,
  pending,
  onRename,
  onPrice,
  onUnpack,
}: {
  pack: CreatorVault['packs'][number];
  items: Item[];
  usd: (t: number) => string;
  economy: EconomyParams;
  pending: boolean;
  onRename: (name: string) => void;
  onPrice: (price: number) => void;
  onUnpack: () => void;
}) {
  const [edit, setEdit] = useState<'name' | 'price' | 'unpack' | null>(null);
  const cover = items.slice(0, 4);
  return (
    <div className="overflow-hidden rounded-2xl border border-border/60 bg-card">
      <div className="grid aspect-[2/1] grid-cols-4 gap-0.5 bg-muted">
        {cover.map((i) => (
          <div key={i.id} className="relative overflow-hidden">
            {i.url &&
              (i.mimeType.startsWith('video/') ? (
                <video src={i.url} muted preload="metadata" className="h-full w-full object-cover" />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={i.url} alt="" className="h-full w-full object-cover" loading="lazy" />
              ))}
          </div>
        ))}
      </div>
      <div className="space-y-2 p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate font-semibold">{pack.name}</p>
            <p className="flex items-center gap-1 text-xs text-muted-foreground">
              <Layers className="h-3 w-3" />
              {[pack.photos && `${pack.photos} ${pack.photos === 1 ? 'foto' : 'fotos'}`, pack.videos && `${pack.videos} ${pack.videos === 1 ? 'vídeo' : 'vídeos'}`]
                .filter(Boolean)
                .join(' · ')}
              {' · '}vendido {pack.stats.sales} {pack.stats.sales === 1 ? 'vez' : 'veces'}
            </p>
          </div>
          <div className="shrink-0 text-right">
            <p className="font-bold text-token">{pack.priceTokens} tk</p>
            <p className="text-[11px] text-muted-foreground">ganas <span className="font-semibold text-state-connected">{usd(pack.priceTokens)}</span></p>
          </div>
        </div>
        {edit === 'name' ? (
          <TextField initial={pack.name} action="Guardar" onCancel={() => setEdit(null)} onSubmit={(v) => { onRename(v); setEdit(null); }} />
        ) : edit === 'price' ? (
          <PriceField choices={PACK_PRICE_CHOICES} initial={pack.priceTokens} economy={economy} onCancel={() => setEdit(null)} onSubmit={(v) => { onPrice(v); setEdit(null); }} />
        ) : edit === 'unpack' ? (
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border/60 bg-muted/40 p-2 text-xs">
            <span className="min-w-0 flex-1">¿Deshacer? Sus archivos pasan a «Sueltas».</span>
            <Button size="sm" variant="ghost" onClick={() => setEdit(null)}>
              No
            </Button>
            <Button size="sm" variant="secondary" disabled={pending} onClick={() => { onUnpack(); setEdit(null); }}>
              Sí, deshacer
            </Button>
          </div>
        ) : (
          <div className="flex gap-1.5">
            <Button size="sm" variant="secondary" className="flex-1" onClick={() => setEdit('price')}>
              <Coins className="h-3.5 w-3.5" /> Precio
            </Button>
            <Button size="sm" variant="secondary" className="flex-1" onClick={() => setEdit('name')}>
              <Pencil className="h-3.5 w-3.5" /> Nombre
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEdit('unpack')} aria-label="Deshacer paquete">
              <ArrowRightLeft className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function Tile({
  item: i,
  selected,
  onClick,
  usd,
}: {
  item: Item;
  selected: boolean;
  onClick: () => void;
  usd: ((t: number) => string) | null;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'relative aspect-[3/4] overflow-hidden rounded-xl bg-muted text-left',
        selected && 'ring-2 ring-primary ring-offset-2 ring-offset-background',
      )}
    >
      {i.url &&
        (i.mimeType.startsWith('video/') ? (
          <>
            <video src={i.url} muted preload="metadata" className="h-full w-full object-cover" />
            <Play className="absolute bottom-10 right-1.5 h-4 w-4 fill-white text-white drop-shadow" />
          </>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={i.url} alt="" className="h-full w-full object-cover" loading="lazy" />
        ))}
      {usd && (
        <span className="absolute left-1.5 top-1.5 rounded-full bg-token px-1.5 py-0.5 text-[10px] font-bold text-black shadow">
          {i.suggestedPrice} tk
        </span>
      )}
      <span className="absolute inset-x-0 bottom-0 space-y-0.5 bg-gradient-to-t from-black/85 to-transparent p-1.5 pt-6 text-[10px] text-white">
        {i.note && <span className="block truncate font-medium">{i.note}</span>}
        <span className="block">
          {usd
            ? `Ganas ${usd(i.suggestedPrice)} · vendida ${i.stats.sales}`
            : `Enviada ${i.stats.sends} ${i.stats.sends === 1 ? 'vez' : 'veces'}`}
        </span>
      </span>
      {selected && (
        <span className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-primary">
          <Check className="h-4 w-4 text-white" />
        </span>
      )}
    </button>
  );
}

function GroupButton({
  active,
  onClick,
  icon,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  count: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center justify-center gap-1.5 rounded-xl border px-2 py-2.5 text-sm font-semibold transition-colors',
        active ? 'border-primary bg-primary/10 text-foreground' : 'border-border/60 text-muted-foreground',
      )}
    >
      {icon}
      {label}
      <span className="text-xs font-normal text-muted-foreground">{count}</span>
    </button>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-border/60 px-6 py-10 text-center text-sm text-muted-foreground">
      {text}
    </div>
  );
}

function PricePicker({
  label,
  choices,
  value,
  onChange,
  economy,
}: {
  label: string;
  choices: number[];
  value: number;
  onChange: (v: number) => void;
  economy: EconomyParams;
}) {
  return (
    <div className="space-y-1">
      <span className="text-sm text-muted-foreground">{label}</span>
      <CreatorPriceInput value={value} onChange={onChange} economy={economy} choices={choices} />
    </div>
  );
}

function PackForm({
  economy,
  suggested,
  onSubmit,
  onCancel,
}: {
  economy: EconomyParams;
  suggested: number;
  onSubmit: (name: string, price: number) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  // Un paquete suele salir algo mas barato que comprarlas sueltas.
  const [price, setPrice] = useState(Math.max(1, Math.round((suggested * 0.8) / 10) * 10 || suggested));
  return (
    <form
      className="space-y-2 rounded-xl border border-border/60 p-2.5"
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim()) onSubmit(name, price);
      }}
    >
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={60}
        placeholder="Nombre del paquete"
        className="h-9 w-full rounded-md border border-input bg-background px-2.5 text-sm"
      />
      <PricePicker label="Precio del paquete" choices={PACK_PRICE_CHOICES} value={price} onChange={setPrice} economy={economy} />
      <p className="text-[11px] text-muted-foreground">Sueltas costarían {suggested} tk.</p>
      <div className="flex gap-2">
        <Button type="submit" size="sm" variant="brand" disabled={!name.trim()}>
          Crear paquete
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}

function PriceField({
  choices,
  initial,
  economy,
  onSubmit,
  onCancel,
}: {
  choices: number[];
  initial: number;
  economy: EconomyParams;
  onSubmit: (price: number) => void;
  onCancel: () => void;
}) {
  const [price, setPrice] = useState(initial);
  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(price);
      }}
    >
      <PricePicker label="Precio" choices={choices} value={price} onChange={setPrice} economy={economy} />
      <div className="flex gap-2">
        <Button type="submit" size="sm" variant="brand">
          Aplicar
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}

function TextField({
  initial = '',
  placeholder,
  action,
  onSubmit,
  onCancel,
}: {
  initial?: string;
  placeholder?: string;
  action: string;
  onSubmit: (v: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(value);
      }}
    >
      <input
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        maxLength={80}
        className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-2.5 text-sm"
      />
      <Button type="submit" size="sm" variant="brand">
        {action}
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
        Cancelar
      </Button>
    </form>
  );
}
