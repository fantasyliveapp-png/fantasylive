'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, ImagePlus, Loader2, Play, Radio, X } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { Switch } from '@/components/ui/switch';
import {
  createBlurredPreview,
  createVideoPreview,
  putToSignedUrl,
  readImageSize,
  readVideoDuration,
} from '@/lib/blur-preview';
import { CreatorPriceInput } from '@/components/money/creator-price';
import type { EconomyParams } from '@/lib/earnings';
import { hashFile } from '@/lib/file-hash';
import { cn } from '@/lib/utils';
import { checkContentAction } from '@/server/actions/content-guard';
import { setLivePackInMenuAction } from '@/server/actions/creator-content';
import {
  attachPostAssetAction,
  createPostAction,
  publishPostAction,
  requestPostUploadUrlAction,
} from '@/server/actions/posts';

const MAX_FILES = 20;
const PRICE_SUGGESTIONS = [50, 100, 200, 500];

interface Picked {
  id: string;
  file: File;
  url: string;
  isVideo: boolean;
}

/**
 * NUEVO PACK DE DIRECTO: no es una publicacion (no lleva recortes, filtros
 * ni texto para el feed). Solo lo que hace falta para venderlo en directo:
 * las fotos y videos, un nombre que se ve en el menu Especiales y el precio.
 */
export function LivePackCreator({
  open,
  onOpenChange,
  economy,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  economy: EconomyParams;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<Picked[]>([]);
  const [name, setName] = useState('');
  const [price, setPrice] = useState(100);
  const [inMenu, setInMenu] = useState(true);
  /** Confirma que es contenido nuevo y exclusivo para directos. */
  const [exclusive, setExclusive] = useState(false);
  const [progress, setProgress] = useState<{ label: string; value: number } | null>(null);
  const [isPending, startTransition] = useTransition();

  // Al cerrar se limpia (y se sueltan las vistas previas).
  useEffect(() => {
    if (open) return;
    setFiles((prev) => {
      prev.forEach((f) => URL.revokeObjectURL(f.url));
      return [];
    });
    setName('');
    setPrice(100);
    setInMenu(true);
    setExclusive(false);
    setProgress(null);
  }, [open]);

  function add(list: FileList) {
    const next = [...list]
      .filter((f) => /^(image|video)\//.test(f.type))
      .map((file) => ({
        id: crypto.randomUUID(),
        file,
        url: URL.createObjectURL(file),
        isVideo: file.type.startsWith('video/'),
      }));
    setFiles((prev) => {
      const all = [...prev, ...next];
      if (all.length > MAX_FILES) toast.error(`Máximo ${MAX_FILES} archivos por pack.`);
      return all.slice(0, MAX_FILES);
    });
  }

  function remove(id: string) {
    setFiles((prev) => {
      const f = prev.find((p) => p.id === id);
      if (f) URL.revokeObjectURL(f.url);
      return prev.filter((p) => p.id !== id);
    });
  }

  const photos = files.filter((f) => !f.isVideo).length;
  const videos = files.length - photos;
  const ready = files.length > 0 && name.trim().length > 0 && price >= 1 && exclusive;

  function create() {
    if (!ready) return;
    startTransition(async () => {
      const total = files.length + 2;

      // Exclusivo de verdad: nada que ya este en el chat, en publicaciones o
      // en otro pack (el fan pagaria dos veces por lo mismo).
      setProgress({ label: 'Comprobando que no esté repetido...', value: 100 / total });
      const hashes = await Promise.all(files.map((f) => hashFile(f.file)));
      const check = await checkContentAction({ hashes: hashes.filter((h): h is string => Boolean(h)), target: 'live' });
      const repeated = (check.data ?? []).filter((d) => d.blocked);
      if (repeated.length) {
        setProgress(null);
        const where = [...new Set(repeated.map((d) => d.label))].join(', ');
        toast.error(
          `${repeated.length === 1 ? 'Un archivo ya está' : `${repeated.length} archivos ya están`} en ${where}. Lo de los directos tiene que ser nuevo y exclusivo: quítalo y sube otro.`,
          { duration: 8000 },
        );
        return;
      }

      setProgress({ label: 'Creando pack...', value: 100 / total });
      const created = await createPostAction({ body: name.trim(), visibility: 'LOCKED', priceTokens: price });
      if (!created.ok || !created.data) {
        setProgress(null);
        toast.error(created.error ?? 'No se pudo crear el pack.');
        return;
      }
      const postId = created.data.postId;

      for (let i = 0; i < files.length; i++) {
        const item = files[i]!;
        setProgress({ label: `Subiendo ${i + 1} de ${files.length}...`, value: ((i + 2) * 100) / total });
        const mimeType = item.file.type || (item.isVideo ? 'video/mp4' : 'image/jpeg');

        const signed = await requestPostUploadUrlAction({ postId, filename: item.file.name, contentType: mimeType });
        if (!signed.ok || !signed.data || !(await putToSignedUrl(signed.data.uploadUrl, item.file, mimeType))) {
          setProgress(null);
          toast.error(`No se pudo subir ${item.file.name}.`);
          return;
        }

        // Miniatura difuminada: es lo unico que ve quien aun no lo ha comprado.
        const preview = item.isVideo ? await createVideoPreview(item.file, 4 / 5) : await createBlurredPreview(item.file);
        let previewKey: string | undefined;
        if (preview) {
          const sp = await requestPostUploadUrlAction({
            postId,
            filename: `${item.file.name}.jpg`,
            contentType: 'image/jpeg',
            isPreview: true,
          });
          if (sp.ok && sp.data && (await putToSignedUrl(sp.data.uploadUrl, preview.blob, 'image/jpeg'))) {
            previewKey = sp.data.key;
          }
        }

        const size = item.isVideo ? null : await readImageSize(item.file);
        const attached = await attachPostAssetAction({
          postId,
          storageKey: signed.data.key,
          previewKey,
          mimeType,
          sizeBytes: item.file.size,
          width: size?.width,
          height: size?.height,
          durationSec: item.isVideo ? ((await readVideoDuration(item.file)) ?? undefined) : undefined,
          contentHash: hashes[i],
        });
        if (!attached.ok) {
          setProgress(null);
          toast.error(attached.error ?? 'No se pudo guardar el archivo.');
          return;
        }
      }

      setProgress({ label: 'Guardando...', value: 100 });
      const saved = await publishPostAction(postId, { liveExclusive: true });
      if (!saved.ok) {
        setProgress(null);
        toast.error(saved.error ?? 'No se pudo guardar el pack.');
        return;
      }
      if (inMenu) await setLivePackInMenuAction(postId, true);
      toast.success(inMenu ? 'Pack creado y en tu menú de Especiales.' : 'Pack creado.');
      onOpenChange(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !isPending && onOpenChange(o)}>
      <DialogContent className="max-h-[92dvh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Radio className="h-4 w-4 text-primary" /> Nuevo pack de directo
          </DialogTitle>
          <DialogDescription>
            Fotos y vídeos que solo se venden en tus directos, desde tu menú de Especiales. Cada fan lo
            compra una vez.
          </DialogDescription>
        </DialogHeader>

        <input
          ref={input}
          type="file"
          accept="image/*,video/*"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files) add(e.target.files);
            e.target.value = '';
          }}
        />

        {/* Aviso: exclusivo para directos */}
        <div className="space-y-1.5 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
          <p className="flex items-center gap-1.5 font-semibold text-amber-500">
            <AlertTriangle className="h-4 w-4" /> Solo contenido nuevo y exclusivo
          </p>
          <p className="text-muted-foreground">
            Lo que vendes en directo tiene que ser <strong className="text-foreground">especial y único</strong>: no lo
            subas también al chat, al feed ni a otros packs. Si un fan paga dos veces por lo mismo puede reclamar, y el
            contenido repetido <strong className="text-foreground">puede ser retirado y tu cuenta penalizada</strong>.
            Comprobamos los archivos al crearlo.
          </p>
        </div>

        {/* Archivos */}
        <div className="grid grid-cols-4 gap-1.5">
          {files.map((f) => (
            <div key={f.id} className="relative aspect-square overflow-hidden rounded-lg bg-muted">
              {f.isVideo ? (
                <>
                  <video src={f.url} muted preload="metadata" className="h-full w-full object-cover" />
                  <Play className="absolute left-1 top-1 h-3.5 w-3.5 fill-white text-white drop-shadow" />
                </>
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={f.url} alt="" className="h-full w-full object-cover" />
              )}
              <button
                type="button"
                onClick={() => remove(f.id)}
                disabled={isPending}
                aria-label="Quitar"
                className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/70 text-white"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
          {files.length < MAX_FILES && (
            <button
              type="button"
              onClick={() => input.current?.click()}
              disabled={isPending}
              className={cn(
                'flex aspect-square flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-border text-muted-foreground hover:border-primary/50 hover:text-primary',
                files.length === 0 && 'col-span-4 aspect-auto py-8',
              )}
            >
              <ImagePlus className="h-6 w-6" />
              <span className="text-xs font-medium">{files.length === 0 ? 'Elegir fotos y vídeos' : 'Añadir'}</span>
            </button>
          )}
        </div>
        {files.length > 0 && (
          <p className="text-xs text-muted-foreground">
            {[photos && `${photos} ${photos === 1 ? 'foto' : 'fotos'}`, videos && `${videos} ${videos === 1 ? 'vídeo' : 'vídeos'}`]
              .filter(Boolean)
              .join(' · ')}{' '}
            · los fans lo ven difuminado hasta que pagan
          </p>
        )}

        {/* Nombre */}
        <label className="block space-y-1.5">
          <span className="text-sm font-medium">Nombre del pack</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={40}
            placeholder="Ej: Sesión en la playa"
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
          />
          <span className="block text-[11px] text-muted-foreground">Así sale en tu menú de Especiales.</span>
        </label>

        {/* Precio: en tokens o en lo que quiere que le llegue */}
        <div className="space-y-1.5">
          <span className="text-sm font-medium">Precio</span>
          <CreatorPriceInput value={price} onChange={setPrice} economy={economy} choices={PRICE_SUGGESTIONS} />
        </div>

        <label className="flex items-center justify-between gap-3 rounded-lg border border-border/60 px-3 py-2.5">
          <span className="text-sm">
            Ponerlo ya en mi menú de Especiales
            <span className="block text-[11px] text-muted-foreground">Lo puedes quitar o volver a poner cuando quieras.</span>
          </span>
          <Switch checked={inMenu} onCheckedChange={setInMenu} disabled={isPending} />
        </label>

        <label className="flex items-start gap-2.5 rounded-lg border border-border/60 px-3 py-2.5 text-sm">
          <input
            type="checkbox"
            checked={exclusive}
            onChange={(e) => setExclusive(e.target.checked)}
            disabled={isPending}
            className="mt-0.5 h-4 w-4 accent-[hsl(var(--primary))]"
          />
          <span>
            Confirmo que este contenido es nuevo y solo lo vendo en mis directos.
          </span>
        </label>

        {progress && (
          <div className="space-y-1">
            <Progress value={progress.value} />
            <p className="text-xs text-muted-foreground">{progress.label}</p>
          </div>
        )}

        <Button variant="brand" className="w-full" onClick={create} disabled={!ready || isPending}>
          {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Radio className="h-4 w-4" />}
          {ready
            ? `Crear pack · ${price} tk`
            : files.length && name.trim() && !exclusive
              ? 'Confirma que es exclusivo para crearlo'
              : 'Elige archivos, nombre y precio'}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
