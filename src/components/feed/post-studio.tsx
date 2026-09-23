'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  BarChart3,
  Check,
  ChevronLeft,
  ChevronRight,
  Coins,
  Crown,
  Globe,
  ImagePlus,
  Images,
  Loader2,
  Lock,
  Minus,
  Pencil,
  Plus,
  RotateCcw,
  Sparkles,
  Video,
  X,
  ZoomIn,
} from 'lucide-react';
import { toast } from 'sonner';

import { CropFrame, MAX_ZOOM } from '@/components/feed/crop-frame';
import {
  EMPTY_POLL,
  PollEditor,
  pollDraftError,
  type PollDraft,
} from '@/components/feed/post-poll-editor';
import { PostCard } from '@/components/feed/post-card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { useI18n } from '@/components/providers/i18n-provider';
import {
  attachPostAssetAction,
  createPostAction,
  publishPostAction,
  requestPostUploadUrlAction,
} from '@/server/actions/posts';
import {
  createBlurredPreview,
  createVideoPreview,
  putToSignedUrl,
  readImageSize,
  renderCropCanvas,
  renderCroppedImage,
} from '@/lib/blur-preview';
import type { FeedPost } from '@/lib/posts';
import { POST_FILTERS, type PostFilterId } from '@/lib/post-filters';
import {
  DEFAULT_CROP,
  DEFAULT_POST_FORMAT,
  getPostFormat,
  POST_FORMATS,
  type CropState,
  type PostFormatId,
} from '@/lib/post-formats';
import { estimateEarnings, type EconomyParams } from '@/lib/earnings';
import { cn, formatMoney, formatTokens, initials } from '@/lib/utils';

type Visibility = 'PUBLIC' | 'LOCKED' | 'SUBSCRIBERS';
type Step = 'edit' | 'filter' | 'audience' | 'share' | 'done';

/**
 * Archivos por publicacion. Da para una sesion completa (lo que antes era un
 * "pack"): todo se publica en el feed y se ve como carrusel.
 */
export const MAX_FILES = 20;
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const MAX_BODY = 2000;
const PRICE_PRESETS = [25, 50, 100, 250, 500] as const;
/** Mismo tope que valida el servidor. */
const MAX_PRICE_TOKENS = 100000;
/** Rango comodo del deslizador; por encima se escribe el numero. */
const SLIDER_MAX_TOKENS = 1000;

const STEP_TITLES: Record<Step, string> = {
  edit: 'Encuadre',
  filter: 'Filtros',
  audience: 'Quien lo ve',
  share: 'Nueva publicacion',
  done: 'Publicado',
};

interface MediaItem {
  id: string;
  file: File;
  /** Object URL del archivo original, para el editor. */
  url: string;
  kind: 'image' | 'video';
  naturalWidth: number;
  naturalHeight: number;
  crop: CropState;
  filter: PostFilterId;
}

/** Archivo ya recortado y filtrado: lo que se ve en la vista previa y se sube. */
interface ProcessedMedia {
  id: string;
  blob: Blob;
  mimeType: string;
  filename: string;
  width: number;
  height: number;
  url: string;
  /** Miniatura difuminada; solo se sube si la publicacion no es publica. */
  previewBlob?: Blob;
  previewUrl?: string;
}

export interface StudioModel {
  id: string;
  slug: string;
  stageName: string;
  avatarUrl: string | null;
  isAi: boolean;
  subscriptionPriceTokens: number;
}

/**
 * ESTUDIO DE PUBLICACION
 *
 * Flujo a pantalla completa, como el de Instagram (encuadre -> filtros ->
 * pie y publicar), con identidad propia: el fondo es un resplandor difuminado
 * de la propia foto, el progreso va en segmentos como las historias y la
 * vista previa final se ve dentro de un movil, tal cual la vera el publico.
 */
export function PostStudio({
  initialFiles,
  startWithMedia = false,
  startWithPoll = false,
  economy,
  subscriptionEnabled,
  model,
  onClose,
}: {
  initialFiles: File[];
  /** Empezar en el paso de encuadre aunque aun no haya archivos. */
  startWithMedia?: boolean;
  /** Abrir con una encuesta ya empezada (boton "Encuesta" de la entrada). */
  startWithPoll?: boolean;
  /** Parametros de la economia para mostrar lo que se gana en dolares. */
  economy: EconomyParams;
  subscriptionEnabled: boolean;
  model: StudioModel;
  onClose: () => void;
}) {
  const router = useRouter();
  const { t } = useI18n();
  const fileInput = useRef<HTMLInputElement | null>(null);

  const [step, setStep] = useState<Step>(
    initialFiles.length > 0 || startWithMedia ? 'edit' : 'share',
  );
  const [format, setFormat] = useState<PostFormatId>(DEFAULT_POST_FORMAT);
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [body, setBody] = useState('');
  const [visibility, setVisibility] = useState<Visibility>('PUBLIC');
  const [priceTokens, setPriceTokens] = useState(50);
  const [poll, setPoll] = useState<PollDraft | null>(startWithPoll ? EMPTY_POLL : null);

  const [processed, setProcessed] = useState<ProcessedMedia[]>([]);
  const [processing, setProcessing] = useState(false);
  const [previewUnlocked, setPreviewUnlocked] = useState(false);
  const [progress, setProgress] = useState<{ label: string; value: number } | null>(
    null,
  );
  const [isPending, startTransition] = useTransition();

  const activeFormat = getPostFormat(format);
  const aspectRatio = activeFormat.width / activeFormat.height;
  const selected = media.find((m) => m.id === selectedId) ?? media[0] ?? null;
  const hasVideo = media.some((m) => m.kind === 'video');
  const busy = isPending || processing;
  const flow: Step[] =
    media.length > 0 || step === 'edit'
      ? ['edit', 'filter', 'audience', 'share']
      : ['share'];

  // ---------------------------------------------------------------------------
  // Recursos del navegador: object URLs y bitmaps decodificados
  // ---------------------------------------------------------------------------

  const bitmaps = useRef(new Map<string, ImageBitmap>());
  const mediaRef = useRef(media);
  const processedRef = useRef(processed);
  mediaRef.current = media;
  processedRef.current = processed;

  useEffect(() => {
    const cache = bitmaps.current;
    return () => {
      mediaRef.current.forEach((m) => URL.revokeObjectURL(m.url));
      revokeProcessed(processedRef.current);
      cache.forEach((b) => b.close());
    };
  }, []);

  const getBitmap = useCallback(async (item: MediaItem) => {
    const cached = bitmaps.current.get(item.id);
    if (cached) return cached;
    try {
      const bitmap = await createImageBitmap(item.file);
      bitmaps.current.set(item.id, bitmap);
      return bitmap;
    } catch {
      return null;
    }
  }, []);

  // Cada paso empieza arriba: si no, en movil se hereda el scroll del
  // anterior y lo primero del paso nuevo queda cortado.
  const bodyRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    // Tras el pintado: el contenido del paso nuevo ya tiene su altura.
    const frame = requestAnimationFrame(() => {
      bodyRef.current?.scrollTo({ top: 0 });
      bodyRef.current?.querySelector('aside')?.scrollTo({ top: 0 });
    });
    return () => cancelAnimationFrame(frame);
  }, [step]);

  // Pantalla completa: sin scroll detras y Escape para salir.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  });

  // ---------------------------------------------------------------------------
  // Archivos
  // ---------------------------------------------------------------------------

  const addFiles = useCallback(
    async (files: FileList | File[] | null) => {
      if (!files) return;
      const room = MAX_FILES - mediaRef.current.length;
      if (room <= 0) {
        toast.error(`Maximo ${MAX_FILES} archivos por publicacion.`);
        return;
      }

      const added: MediaItem[] = [];
      for (const file of Array.from(files).slice(0, room)) {
        const isImage = file.type.startsWith('image/');
        const isVideo = file.type.startsWith('video/');
        if (!isImage && !isVideo) {
          toast.error(`${file.name} no es una foto ni un video.`);
          continue;
        }
        if (file.size > MAX_FILE_BYTES) {
          toast.error(`${file.name} pesa mas de 50 MB.`);
          continue;
        }

        let size = { width: 1, height: 1 };
        if (isImage) {
          const read = await readImageSize(file);
          if (!read) {
            toast.error(`No se puede leer ${file.name}. Prueba con JPG o PNG.`);
            continue;
          }
          size = read;
        }

        added.push({
          id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          file,
          url: URL.createObjectURL(file),
          kind: isImage ? 'image' : 'video',
          naturalWidth: size.width,
          naturalHeight: size.height,
          crop: DEFAULT_CROP,
          filter: 'none',
        });
      }

      if (added.length === 0) return;
      setMedia((prev) => [...prev, ...added]);
      setSelectedId(added[0]!.id);
      // Anadir fotos desde el paso final vuelve al encuadre.
      setStep((s) => (s === 'share' ? 'edit' : s));
    },
    [],
  );

  const initialLoaded = useRef(false);
  useEffect(() => {
    if (initialLoaded.current) return;
    initialLoaded.current = true;
    if (initialFiles.length > 0) void addFiles(initialFiles);
  }, [addFiles, initialFiles]);

  function removeMedia(id: string) {
    const item = media.find((m) => m.id === id);
    if (item) URL.revokeObjectURL(item.url);
    bitmaps.current.get(id)?.close();
    bitmaps.current.delete(id);
    setMedia((prev) => prev.filter((m) => m.id !== id));
    if (selectedId === id) setSelectedId(null);
  }

  function moveMedia(id: string, delta: -1 | 1) {
    setMedia((prev) => {
      const from = prev.findIndex((m) => m.id === id);
      const to = from + delta;
      if (from < 0 || to < 0 || to >= prev.length) return prev;
      const next = [...prev];
      [next[from], next[to]] = [next[to]!, next[from]!];
      return next;
    });
  }

  function patchMedia(id: string, patch: Partial<MediaItem>) {
    setMedia((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  }

  // ---------------------------------------------------------------------------
  // Filtros: miniaturas y vista grande generadas con el mismo pipeline final
  // ---------------------------------------------------------------------------

  const [filterThumbs, setFilterThumbs] = useState<Record<string, string>>({});
  const [filterMain, setFilterMain] = useState<{ filtered: string; original: string } | null>(
    null,
  );
  const [comparing, setComparing] = useState(false);

  const selectedImage = selected?.kind === 'image' ? selected : null;

  useEffect(() => {
    if (step !== 'filter' || !selectedImage) return;
    let cancelled = false;
    void (async () => {
      const bitmap = await getBitmap(selectedImage);
      if (cancelled || !bitmap) return;
      const w = 120;
      const thumbs: Record<string, string> = {};
      for (const f of POST_FILTERS) {
        const canvas = renderCropCanvas(bitmap, w, w / aspectRatio, selectedImage.crop, f.id);
        if (canvas) thumbs[f.id] = canvas.toDataURL('image/jpeg', 0.8);
      }
      if (!cancelled) setFilterThumbs(thumbs);
    })();
    return () => {
      cancelled = true;
    };
  }, [step, selectedImage?.id, selectedImage?.crop, aspectRatio, getBitmap]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (step !== 'filter' || !selectedImage) return;
    let cancelled = false;
    void (async () => {
      const bitmap = await getBitmap(selectedImage);
      if (cancelled || !bitmap) return;
      const w = 900;
      const h = w / aspectRatio;
      const filtered = renderCropCanvas(bitmap, w, h, selectedImage.crop, selectedImage.filter);
      const original = renderCropCanvas(bitmap, w, h, selectedImage.crop, 'none');
      if (!cancelled && filtered && original) {
        setFilterMain({
          filtered: filtered.toDataURL('image/jpeg', 0.85),
          original: original.toDataURL('image/jpeg', 0.85),
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [step, selectedImage?.id, selectedImage?.crop, selectedImage?.filter, aspectRatio, getBitmap]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------------------
  // Generar los archivos finales (paso filtros -> publicar)
  // ---------------------------------------------------------------------------

  async function processMedia(): Promise<boolean> {
    setProcessing(true);
    const result: ProcessedMedia[] = [];

    for (const item of media) {
      if (item.kind === 'video') {
        // El video no se recorta (habria que recodificarlo): se muestra
        // centrado en el formato, y se guardan las dimensiones del formato
        // para que la tarjeta use la misma proporcion. Su miniatura borrosa
        // sale de un fotograma, para poder publicarlo de pago.
        const poster = await createVideoPreview(item.file, aspectRatio);
        result.push({
          previewBlob: poster?.blob,
          previewUrl: poster ? URL.createObjectURL(poster.blob) : undefined,
          id: item.id,
          blob: item.file,
          mimeType: item.file.type || 'video/mp4',
          filename: item.file.name,
          width: activeFormat.width,
          height: activeFormat.height,
          url: URL.createObjectURL(item.file),
        });
        continue;
      }

      const cropped = await renderCroppedImage(
        item.file,
        activeFormat,
        item.crop,
        item.filter,
      );
      if (!cropped) {
        toast.error(`No se pudo procesar ${item.file.name}.`);
        revokeProcessed(result);
        setProcessing(false);
        return false;
      }

      // La miniatura difuminada se genera siempre: la visibilidad se elige en
      // el ultimo paso y la vista previa tiene que poder cambiar al instante.
      const blurred = await createBlurredPreview(cropped);

      result.push({
        id: item.id,
        blob: cropped,
        mimeType: 'image/jpeg',
        filename: `${item.file.name.replace(/\.[^.]+$/, '') || 'foto'}.jpg`,
        width: activeFormat.width,
        height: activeFormat.height,
        url: URL.createObjectURL(cropped),
        previewBlob: blurred?.blob,
        previewUrl: blurred ? URL.createObjectURL(blurred.blob) : undefined,
      });
    }

    revokeProcessed(processed);
    setProcessed(result);
    setProcessing(false);
    return true;
  }

  // ---------------------------------------------------------------------------
  // Navegacion
  // ---------------------------------------------------------------------------

  const isDirty = media.length > 0 || body.trim().length > 0;

  function close() {
    if (busy) return;
    if (step !== 'done' && isDirty && !window.confirm('¿Descartar esta publicacion?')) {
      return;
    }
    onClose();
  }

  async function next() {
    if (busy) return;
    if (step === 'edit') {
      if (media.length === 0) {
        setProcessed([]);
        setStep('share');
      } else {
        setStep('filter');
      }
      return;
    }
    if (step === 'filter') {
      if (await processMedia()) setStep('audience');
      return;
    }
    if (step === 'audience') {
      const error = validate(false);
      if (error) {
        toast.error(error);
        return;
      }
      setPreviewUnlocked(false);
      setStep('share');
      return;
    }
    if (step === 'share') publish();
  }

  function back() {
    if (busy) return;
    if (step === 'filter') setStep('edit');
    else if (step === 'audience') setStep('filter');
    else if (step === 'share' && media.length > 0) setStep('audience');
    else close();
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') close();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // ---------------------------------------------------------------------------
  // Publicar
  // ---------------------------------------------------------------------------

  /**
   * `final`: comprobaciones para publicar. Al salir de "Quien lo ve" se valida
   * solo lo de ese paso; el texto y la encuesta se rellenan en el siguiente.
   */
  function validate(final = true): string | null {
    if (!body.trim() && media.length === 0 && !poll) {
      return 'Escribe algo, anade una foto o crea una encuesta.';
    }
    if (final && poll) {
      const pollError = pollDraftError(poll);
      if (pollError) return pollError;
    }
    if (visibility === 'LOCKED' && priceTokens <= 0) {
      return 'Pon un precio mayor que 0 para una publicacion de pago.';
    }
    if (visibility !== 'PUBLIC' && media.length === 0) {
      return 'Una publicacion de pago necesita al menos una foto.';
    }
    if (visibility !== 'PUBLIC' && processed.some((p) => !p.previewBlob)) {
      return 'No se pudo generar la miniatura difuminada de algun archivo.';
    }
    return null;
  }

  /**
   * Publica en tres pasos: crear borrador, subir cada archivo (con su
   * miniatura difuminada si la publicacion es de pago) y publicar.
   *
   * Se hace asi porque la clave de S3 necesita el id del post, y porque una
   * subida a medias no debe aparecer en el feed de nadie.
   */
  function publish() {
    const error = validate();
    if (error) {
      toast.error(error);
      return;
    }

    startTransition(async () => {
      const total = processed.length + 2;
      setProgress({ label: 'Creando publicacion...', value: 100 / total });
      const created = await createPostAction({
        body: body.trim() || undefined,
        visibility,
        priceTokens: visibility === 'LOCKED' ? priceTokens : 0,
        poll: poll
          ? {
              question: poll.question.trim(),
              options: poll.options.map((o) => o.trim()),
              durationHours: poll.durationHours,
            }
          : undefined,
      });

      if (!created.ok || !created.data) {
        setProgress(null);
        toast.error(created.error ?? t('common.somethingWentWrong'));
        return;
      }

      const postId = created.data.postId;

      for (let i = 0; i < processed.length; i++) {
        const item = processed[i]!;
        setProgress({
          label: `Subiendo ${i + 1} de ${processed.length}...`,
          value: ((i + 2) * 100) / total,
        });

        const signed = await requestPostUploadUrlAction({
          postId,
          filename: item.filename,
          contentType: item.mimeType,
        });
        if (!signed.ok || !signed.data) {
          setProgress(null);
          toast.error(signed.error ?? 'No se pudo subir el archivo.');
          return;
        }

        const uploaded = await putToSignedUrl(signed.data.uploadUrl, item.blob, item.mimeType);
        if (!uploaded) {
          setProgress(null);
          toast.error(`No se pudo subir ${item.filename}.`);
          return;
        }

        // Miniatura difuminada: es lo unico que se sirve sin pagar.
        let previewKey: string | undefined;
        if (visibility !== 'PUBLIC' && item.previewBlob) {
          const signedPreview = await requestPostUploadUrlAction({
            postId,
            filename: `${item.filename}.jpg`,
            contentType: 'image/jpeg',
            isPreview: true,
          });
          if (signedPreview.ok && signedPreview.data) {
            const okPreview = await putToSignedUrl(
              signedPreview.data.uploadUrl,
              item.previewBlob,
              'image/jpeg',
            );
            if (okPreview) previewKey = signedPreview.data.key;
          }
        }

        const attached = await attachPostAssetAction({
          postId,
          storageKey: signed.data.key,
          previewKey,
          mimeType: item.mimeType,
          sizeBytes: item.blob.size,
          width: item.width,
          height: item.height,
        });
        if (!attached.ok) {
          setProgress(null);
          toast.error(attached.error ?? 'No se pudo registrar el archivo.');
          return;
        }
      }

      setProgress({ label: 'Publicando...', value: 100 });
      const published = await publishPostAction(postId);
      setProgress(null);

      if (published.ok) {
        setStep('done');
        router.refresh();
      } else {
        toast.error(published.error ?? t('common.somethingWentWrong'));
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Vista previa: el mismo PostCard del feed con datos locales
  // ---------------------------------------------------------------------------

  const previewPost: FeedPost = {
    id: 'preview',
    createdAt: new Date().toISOString(),
    body: body.trim() || null,
    visibility,
    priceTokens: visibility === 'LOCKED' ? priceTokens : 0,
    likeCount: 0,
    commentCount: 0,
    unlockCount: 0,
    isLiked: false,
    isUnlocked: visibility === 'PUBLIC' || previewUnlocked,
    isOwner: false,
    model: { ...model, isOnline: true, isLive: false, subscriptionEnabled },
    assets: processed.map((p) => ({
      id: p.id,
      mimeType: p.mimeType,
      url: p.url,
      previewUrl: p.previewUrl ?? null,
      width: p.width,
      height: p.height,
    })),
    poll: poll
      ? {
          id: 'preview-poll',
          question: poll.question.trim() || 'Tu pregunta',
          endsAt: poll.durationHours
            ? new Date(Date.now() + poll.durationHours * 3600_000).toISOString()
            : null,
          isClosed: false,
          totalVotes: 0,
          options: poll.options.map((text, i) => ({
            id: `preview-${i}`,
            text: text.trim() || `Opcion ${i + 1}`,
            votes: 0,
          })),
          myOptionId: null,
        }
      : null,
  };

  // Resplandor de fondo: la propia foto, muy difuminada.
  const glowSrc =
    step === 'audience' || step === 'share' || step === 'done'
      ? processed.find((p) => p.mimeType.startsWith('image/'))?.url
      : selected?.kind === 'image'
        ? selected.url
        : undefined;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const nextLabel =
    step === 'share'
      ? t('feed.publish')
      : step === 'audience'
        ? 'Ver vista previa'
        : step === 'filter'
          ? 'Continuar'
          : 'Siguiente';

  return (
    <div
      className="fixed inset-0 !m-0 z-[60] flex bg-black/70 backdrop-blur-md md:items-center md:justify-center md:p-6"
      role="dialog"
      aria-modal="true"
      aria-label="Nueva publicacion"
    >
      <input
        ref={fileInput}
        type="file"
        accept="image/*,video/*"
        multiple
        hidden
        onChange={(e) => {
          void addFiles(e.target.files);
          e.target.value = '';
        }}
      />

      <div className="relative flex h-full w-full flex-col overflow-hidden bg-background md:h-[min(880px,94vh)] md:max-w-6xl md:rounded-[2rem] md:border md:border-border/60 md:shadow-2xl">
        {/* Progreso en segmentos, como las historias */}
        {step !== 'done' && (
          <div className="flex gap-1 px-4 pt-3">
            {flow.map((s) => {
              const index = flow.indexOf(step);
              const i = flow.indexOf(s);
              return (
                <span key={s} className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
                  <span
                    className={cn(
                      'block h-full rounded-full bg-gradient-to-r from-primary to-champagne-gold transition-all duration-500',
                      i <= index ? 'w-full' : 'w-0',
                    )}
                  />
                </span>
              );
            })}
          </div>
        )}

        {/* Barra superior */}
        <header className="flex h-14 shrink-0 items-center gap-2 px-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={step === 'done' ? onClose : flow[0] === step ? close : back}
            disabled={busy}
            aria-label={flow[0] === step || step === 'done' ? 'Cerrar' : 'Atras'}
          >
            {flow[0] === step || step === 'done' ? (
              <X className="h-5 w-5" />
            ) : (
              <ArrowLeft className="h-5 w-5" />
            )}
          </Button>

          <h2 className="flex-1 text-center font-heading text-sm uppercase tracking-[0.2em]">
            {STEP_TITLES[step]}
          </h2>

          {step !== 'done' ? (
            <Button
              variant={step === 'share' ? 'brand' : 'ghost'}
              size="sm"
              onClick={() => void next()}
              disabled={busy}
              // En movil la accion va abajo, a mano del pulgar.
              className={cn(
                'hidden md:inline-flex',
                step !== 'share' && 'font-semibold text-primary hover:text-primary',
              )}
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              {nextLabel}
            </Button>
          ) : null}
          <span className={cn('w-10', step !== 'done' && 'md:hidden')} />
        </header>

        {step === 'done' ? (
          <DoneScreen
            glowSrc={glowSrc}
            onClose={onClose}
            onAnother={() => {
              media.forEach((m) => URL.revokeObjectURL(m.url));
              revokeProcessed(processed);
              setMedia([]);
              setProcessed([]);
              setBody('');
              setPoll(null);
              setVisibility('PUBLIC');
              setStep('share');
            }}
          />
        ) : (
          <div
            ref={bodyRef}
            className={cn(
              // Sin scroll anchoring: el navegador reajustaba el scroll al cambiar
              // de paso y dejaba el principio del paso nuevo fuera de la vista.
              'flex min-h-0 flex-1 flex-col overflow-y-auto [overflow-anchor:none] md:grid md:overflow-hidden',
              'md:grid-cols-[minmax(0,1fr)_380px]',
            )}
          >
            {/* ------------------------------ ESCENARIO ------------------------------ */}
            <section
              className={cn(
                'relative shrink-0 overflow-hidden bg-black/40 md:h-full',
                step === 'audience'
                  ? 'h-[40vh] md:h-full'
                  : step !== 'share'
                  ? 'h-[56vh] md:h-full'
                  : processed.length > 0
                    ? 'min-h-[420px] py-6 md:py-0'
                    : 'py-6 md:py-0',
                // En movil, al publicar, primero los ajustes (quien lo ve, precio
                // y lo que ganas) y despues la vista previa: si no, quedan
                // escondidos debajo del movil.
                step === 'share' && 'order-2 md:order-none',
              )}
            >
              {glowSrc && (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={glowSrc}
                  alt=""
                  aria-hidden
                  className="pointer-events-none absolute inset-0 h-full w-full scale-125 object-cover opacity-50 blur-3xl saturate-150"
                />
              )}
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_30%,hsl(var(--background))_100%)]"
              />

              <div className="relative flex h-full w-full items-center justify-center p-4 md:p-10">
                {step === 'edit' && (
                  <Fit aspectRatio={aspectRatio}>
                    {selected?.kind === 'image' ? (
                      <CropFrame
                        key={selected.id}
                        src={selected.url}
                        naturalWidth={selected.naturalWidth}
                        naturalHeight={selected.naturalHeight}
                        aspectRatio={aspectRatio}
                        crop={selected.crop}
                        onChange={(crop) => patchMedia(selected.id, { crop })}
                        className="rounded-2xl shadow-2xl ring-1 ring-white/10"
                      />
                    ) : selected ? (
                      <VideoFrame src={selected.url} aspectRatio={aspectRatio} />
                    ) : (
                      <EmptyStage onPick={() => fileInput.current?.click()} />
                    )}
                  </Fit>
                )}

                {step === 'filter' && (
                  <Fit aspectRatio={aspectRatio}>
                    {selected?.kind === 'image' ? (
                      <div
                        className="relative w-full touch-none select-none overflow-hidden rounded-2xl bg-muted shadow-2xl ring-1 ring-white/10"
                        style={{ aspectRatio }}
                        onPointerDown={() => setComparing(true)}
                        onPointerUp={() => setComparing(false)}
                        onPointerLeave={() => setComparing(false)}
                        onPointerCancel={() => setComparing(false)}
                      >
                        {filterMain && (
                          /* eslint-disable-next-line @next/next/no-img-element */
                          <img
                            src={comparing ? filterMain.original : filterMain.filtered}
                            alt=""
                            draggable={false}
                            className="h-full w-full object-cover"
                          />
                        )}
                        <span className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-black/60 px-2.5 py-1 text-[11px] text-white">
                          {comparing ? 'Original' : 'Manten pulsado para comparar'}
                        </span>
                      </div>
                    ) : selected ? (
                      <VideoFrame src={selected.url} aspectRatio={aspectRatio} />
                    ) : null}
                  </Fit>
                )}

                {step === 'audience' && (
                  <AudienceStage
                    item={processed[0]}
                    count={processed.length}
                    aspectRatio={aspectRatio}
                    visibility={visibility}
                    priceTokens={priceTokens}
                    economy={economy}
                  />
                )}

                {step === 'share' && (
                  <div className="flex h-full w-full flex-col items-center justify-center gap-4">
                    {visibility !== 'PUBLIC' && processed.length > 0 && (
                      <div className="flex rounded-full border border-white/10 bg-black/50 p-1 text-xs font-medium backdrop-blur">
                        {[
                          { value: false, label: 'Fan sin desbloquear' },
                          {
                            value: true,
                            label: visibility === 'LOCKED' ? 'Tras pagar' : 'Suscriptor',
                          },
                        ].map((opt) => (
                          <button
                            key={String(opt.value)}
                            type="button"
                            onClick={() => setPreviewUnlocked(opt.value)}
                            className={cn(
                              'rounded-full px-3.5 py-1.5 transition-colors',
                              previewUnlocked === opt.value
                                ? 'bg-white text-black'
                                : 'text-white/70 hover:text-white',
                            )}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    )}
                    {visibility === 'LOCKED' && (
                      <div className="flex items-center gap-2 rounded-full border border-state-connected/40 bg-black/60 px-3.5 py-1.5 text-xs text-white backdrop-blur">
                        <Coins className="h-3.5 w-3.5 text-token" />
                        {formatTokens(priceTokens)} tokens
                        <span className="text-white/40">→</span>
                        <span className="font-semibold text-state-connected">
                          ganas {formatMoney(estimateEarnings(priceTokens, economy).grossCents)} por fan
                        </span>
                      </div>
                    )}
                    <PhoneMockup>
                      <PostCard post={previewPost} isAuthenticated preview />
                    </PhoneMockup>
                  </div>
                )}
              </div>
            </section>

            {/* ------------------------------ PANEL ------------------------------ */}
            <aside
              className={cn(
                // shrink-0 en movil: la columna hace scroll entera; si el panel
                // encogiera, su contenido quedaria tapado por la vista previa.
                'flex shrink-0 flex-col border-border/60 md:min-h-0 md:shrink md:overflow-y-auto md:border-l',
                step === 'share' && 'order-1 md:order-none',
              )}
            >
              <div className="flex-1 space-y-6 p-5">
                {step === 'edit' && (
                  <>
                    <PanelSection title="Formato">
                      <div className="grid grid-cols-3 gap-2">
                        {POST_FORMATS.map((f) => (
                          <button
                            key={f.id}
                            type="button"
                            onClick={() => setFormat(f.id)}
                            className={cn(
                              'flex flex-col items-center gap-1.5 rounded-2xl border px-2 py-3 transition-all',
                              format === f.id
                                ? 'border-primary bg-primary/10 shadow-[0_0_24px_-6px_hsl(var(--primary))]'
                                : 'border-border/60 hover:border-muted-foreground/50',
                            )}
                          >
                            <FormatGlyph width={f.width} height={f.height} active={format === f.id} />
                            <span className="text-[11px] font-medium">{f.label}</span>
                          </button>
                        ))}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {activeFormat.hint} Todas las fotos salen a {activeFormat.width}×
                        {activeFormat.height}.
                      </p>
                    </PanelSection>

                    {selected?.kind === 'image' && (
                      <PanelSection title="Zoom">
                        <div className="flex items-center gap-3">
                          <ZoomIn className="h-4 w-4 shrink-0 text-muted-foreground" />
                          <input
                            type="range"
                            min={1}
                            max={MAX_ZOOM}
                            step={0.01}
                            value={selected.crop.zoom}
                            onChange={(e) =>
                              patchMedia(selected.id, {
                                crop: { ...selected.crop, zoom: Number(e.target.value) },
                              })
                            }
                            className="h-1.5 w-full cursor-pointer accent-primary"
                            aria-label="Zoom"
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => patchMedia(selected.id, { crop: DEFAULT_CROP })}
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                            Centrar
                          </Button>
                        </div>
                      </PanelSection>
                    )}

                    <PanelSection
                      title="Carrusel"
                      aside={`${media.length}/${MAX_FILES}`}
                    >
                      <Filmstrip
                        media={media}
                        selectedId={selected?.id ?? null}
                        onSelect={setSelectedId}
                        onRemove={removeMedia}
                        onMove={moveMedia}
                        onAdd={
                          media.length < MAX_FILES
                            ? () => fileInput.current?.click()
                            : undefined
                        }
                      />
                      {media.length > 1 && (
                        <p className="text-xs text-muted-foreground">
                          Se desliza en este orden. La primera es la portada.
                        </p>
                      )}
                    </PanelSection>
                  </>
                )}

                {step === 'filter' && (
                  <>
                    {selected?.kind === 'image' ? (
                      <PanelSection
                        title="Filtro"
                        aside={
                          media.filter((m) => m.kind === 'image').length > 1 ? (
                            <button
                              type="button"
                              onClick={() =>
                                setMedia((prev) =>
                                  prev.map((m) =>
                                    m.kind === 'image' ? { ...m, filter: selected.filter } : m,
                                  ),
                                )
                              }
                              className="text-xs font-medium text-primary hover:underline"
                            >
                              Aplicar a todas
                            </button>
                          ) : undefined
                        }
                      >
                        <div className="grid grid-cols-4 gap-x-2 gap-y-4">
                          {POST_FILTERS.map((f) => (
                            <button
                              key={f.id}
                              type="button"
                              onClick={() => patchMedia(selected.id, { filter: f.id })}
                              className="group flex flex-col items-center gap-1.5"
                            >
                              <span
                                className={cn(
                                  'relative block h-16 w-16 overflow-hidden rounded-full bg-muted p-[2px] transition-transform group-hover:scale-105',
                                  selected.filter === f.id
                                    ? 'bg-gradient-to-tr from-primary via-fantazy-red to-champagne-gold'
                                    : 'bg-border',
                                )}
                              >
                                {filterThumbs[f.id] ? (
                                  /* eslint-disable-next-line @next/next/no-img-element */
                                  <img
                                    src={filterThumbs[f.id]}
                                    alt=""
                                    className="h-full w-full rounded-full border-2 border-background object-cover"
                                  />
                                ) : (
                                  <span className="block h-full w-full rounded-full border-2 border-background bg-muted" />
                                )}
                              </span>
                              <span
                                className={cn(
                                  'text-[11px]',
                                  selected.filter === f.id
                                    ? 'font-semibold text-foreground'
                                    : 'text-muted-foreground',
                                )}
                              >
                                {f.label}
                              </span>
                            </button>
                          ))}
                        </div>
                      </PanelSection>
                    ) : (
                      <p className="rounded-2xl border border-border/60 bg-muted/30 p-4 text-sm text-muted-foreground">
                        Los filtros son solo para fotos. Los videos se publican tal cual,
                        centrados en el formato.
                      </p>
                    )}

                    {media.length > 1 && (
                      <PanelSection title="Elige la foto">
                        <Filmstrip
                          media={media}
                          selectedId={selected?.id ?? null}
                          onSelect={setSelectedId}
                        />
                      </PanelSection>
                    )}
                  </>
                )}

                {step === 'audience' && (
                  <>
                    <div>
                      <h3 className="font-heading text-xl uppercase tracking-wide">
                        ¿Quien puede verla?
                      </h3>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Gratis para ganar seguidores, o de pago para ganar dinero.
                      </p>
                    </div>

                    <PanelSection title="Elige una opcion">
                      <div className="space-y-2">
                        <AudienceOption
                          active={visibility === 'PUBLIC'}
                          onClick={() => setVisibility('PUBLIC')}
                          icon={Globe}
                          title="Todo el mundo"
                          hint="Gratis y completa en el feed. Ideal para ganar seguidores."
                        />
                        <AudienceOption
                          active={visibility === 'LOCKED'}
                          onClick={() => setVisibility('LOCKED')}
                          icon={Lock}
                          title="Pago por ver"
                          hint="Se ve borrosa hasta que el fan paga el precio que tu pongas."
                          // El dinero se ensena ANTES de elegir: es lo que decide.
                          badge={
                            <span className="whitespace-nowrap rounded-full bg-state-connected/15 px-2 py-0.5 text-[11px] font-semibold text-state-connected">
                              +{formatMoney(estimateEarnings(priceTokens, economy).grossCents)} / fan
                            </span>
                          }
                          disabled={media.length === 0}
                          disabledHint="Necesita una foto o video"
                        >
                          <PriceEditor
                            priceTokens={priceTokens}
                            onChange={setPriceTokens}
                            economy={economy}
                            label={t('feed.price')}
                          />
                        </AudienceOption>
                        <AudienceOption
                          active={visibility === 'SUBSCRIBERS'}
                          onClick={() => setVisibility('SUBSCRIBERS')}
                          icon={Crown}
                          title="Mis suscriptores"
                          hint="Exclusiva para quien paga tu suscripcion mensual."
                          badge={
                            subscriptionEnabled && model.subscriptionPriceTokens > 0 ? (
                              <span className="whitespace-nowrap rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                                {formatMoney(
                                  estimateEarnings(model.subscriptionPriceTokens, economy).grossCents,
                                )}{' '}
                                / mes
                              </span>
                            ) : undefined
                          }
                          disabled={!subscriptionEnabled || media.length === 0}
                          disabledHint={
                            !subscriptionEnabled
                              ? 'Activa la suscripcion mensual'
                              : 'Necesita una foto o video'
                          }
                        >
                          <p className="text-xs text-muted-foreground">
                            No se cobra aparte: premia a quien ya te paga{' '}
                            {formatTokens(model.subscriptionPriceTokens)} tokens al mes (
                            {formatMoney(
                              estimateEarnings(model.subscriptionPriceTokens, economy).grossCents,
                            )}{' '}
                            para ti por suscriptor) y ayuda a que renueven.
                          </p>
                        </AudienceOption>
                      </div>
                    </PanelSection>

                    {visibility !== 'PUBLIC' && (
                      <p className="flex gap-2 text-xs text-muted-foreground">
                        <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                        {t('feed.blurNotice')}
                      </p>
                    )}

                  </>
                )}

                {step === 'share' && (
                  <>
                    <div className="flex gap-3">
                      <Avatar className="h-10 w-10 shrink-0 ring-2 ring-primary/60 ring-offset-2 ring-offset-background">
                        <AvatarImage src={model.avatarUrl ?? undefined} />
                        <AvatarFallback>{initials(model.stageName)}</AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <textarea
                          value={body}
                          onChange={(e) => setBody(e.target.value)}
                          placeholder={
                            media.length > 0
                              ? 'Escribe un pie de foto...'
                              : '¿Que quieres contarles a tus fans?'
                          }
                          rows={5}
                          maxLength={MAX_BODY}
                          className="w-full resize-none bg-transparent text-sm leading-relaxed outline-none placeholder:text-muted-foreground"
                        />
                        <p className="text-right text-[11px] text-muted-foreground">
                          {body.length}/{MAX_BODY}
                        </p>
                      </div>
                    </div>

                    {poll ? (
                      <PollEditor poll={poll} onChange={setPoll} onRemove={() => setPoll(null)} />
                    ) : (
                      <button
                        type="button"
                        onClick={() => setPoll(EMPTY_POLL)}
                        className="flex w-full items-center gap-3 rounded-2xl border border-dashed border-border p-4 text-left text-sm transition-colors hover:border-primary/60 hover:bg-primary/5"
                      >
                        <BarChart3 className="h-5 w-5 text-primary" />
                        <span>
                          <span className="block font-medium">Anadir encuesta</span>
                          <span className="block text-xs text-muted-foreground">
                            Pregunta a tus fans y ve los resultados en directo.
                          </span>
                        </span>
                      </button>
                    )}

                    {media.length === 0 && (
                      <button
                        type="button"
                        onClick={() => fileInput.current?.click()}
                        className="flex w-full items-center gap-3 rounded-2xl border border-dashed border-border p-4 text-left text-sm transition-colors hover:border-primary/60 hover:bg-primary/5"
                      >
                        <ImagePlus className="h-5 w-5 text-primary" />
                        <span>
                          <span className="block font-medium">Anadir fotos o video</span>
                          <span className="block text-xs text-muted-foreground">
                            O publica solo texto o una encuesta.
                          </span>
                        </span>
                      </button>
                    )}

                    {media.length > 0 && (
                      <PanelSection title="Quien lo ve">
                        <AudienceSummary
                          visibility={visibility}
                          priceTokens={priceTokens}
                          economy={economy}
                          onChange={() => setStep('audience')}
                        />
                      </PanelSection>
                    )}

                    {progress && (
                      <div className="space-y-1.5">
                        <Progress value={progress.value} />
                        <p className="text-xs text-muted-foreground">{progress.label}</p>
                      </div>
                    )}
                  </>
                )}
              </div>

            </aside>
          </div>
        )}

        {/* En movil la accion principal queda fija abajo, a mano del pulgar. */}
        {step !== 'done' && (
          <div className="shrink-0 border-t border-border/60 bg-background/95 p-4 backdrop-blur md:hidden">
            {(step === 'audience' || step === 'share') && visibility === 'LOCKED' && (
              <p className="mb-2 text-center text-xs text-muted-foreground">
                Ganas{' '}
                <strong className="text-state-connected">
                  {formatMoney(estimateEarnings(priceTokens, economy).grossCents)}
                </strong>{' '}
                por cada fan que la desbloquee
              </p>
            )}
            <Button
              variant="brand"
              className="w-full"
              onClick={() => void next()}
              disabled={busy}
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              {nextLabel}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Precio de una publicacion de pago con lo que gana la modelo al lado, en
 * dolares, para que ponga el precio sabiendo lo que le llega. El desglose
 * (comision, retiro) queda plegado para no abrumar.
 */
function PriceEditor({
  priceTokens,
  onChange,
  economy,
  label,
}: {
  priceTokens: number;
  onChange: React.Dispatch<React.SetStateAction<number>>;
  economy: EconomyParams;
  label: string;
}) {
  const e = estimateEarnings(priceTokens, economy);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [custom, setCustom] = useState(
    () => !(PRICE_PRESETS as readonly number[]).includes(priceTokens),
  );
  const clampPrice = (v: number) => Math.max(1, Math.min(MAX_PRICE_TOKENS, Math.round(v)));
  const set = (v: number) => onChange(clampPrice(v));
  // Actualizacion funcional: varios toques seguidos en +/- suman todos.
  const bump = (delta: number) => onChange((prev) => clampPrice(prev + delta));

  function startCustom() {
    setCustom(true);
    // Tras el render: el campo ya esta visible y se puede escribir directo.
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <label
          className={cn(
            'rounded-xl border bg-token/5 p-3 transition-colors focus-within:border-token',
            custom ? 'border-token/70' : 'border-token/30',
          )}
        >
          <span className="block text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            El fan paga
          </span>
          <span className="mt-1 flex items-center gap-1.5">
            <Coins className="h-4 w-4 shrink-0 text-token" />
            <input
              ref={inputRef}
              type="number"
              inputMode="numeric"
              min={1}
              max={MAX_PRICE_TOKENS}
              value={priceTokens || ''}
              onFocus={() => setCustom(true)}
              onChange={(ev) =>
                // Mientras se escribe se deja el campo vacio (0); al salir se
                // corrige al minimo.
                onChange(Math.max(0, Math.min(MAX_PRICE_TOKENS, Number(ev.target.value) || 0)))
              }
              onBlur={() => set(priceTokens)}
              className="w-full min-w-0 bg-transparent font-heading text-3xl leading-none text-token outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
              aria-label={label}
            />
          </span>
          <span className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
            <Pencil className="h-3 w-3" />
            toca para escribir
          </span>
        </label>

        <div className="rounded-xl border border-state-connected/40 bg-state-connected/10 p-3">
          <span className="block text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Tu ganas
          </span>
          <span className="mt-1 block font-heading text-3xl leading-none text-state-connected">
            {formatMoney(e.grossCents)}
          </span>
          <span className="mt-1 block text-[11px] text-muted-foreground">por cada fan</span>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {PRICE_PRESETS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => onChange(p)}
            className={cn(
              'rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors',
              priceTokens === p
                ? 'border-token bg-token text-black'
                : 'border-border hover:border-token/60',
            )}
          >
            {formatTokens(p)} → {formatMoney(estimateEarnings(p, economy).grossCents)}
          </button>
        ))}
        <button
          type="button"
          onClick={startCustom}
          className={cn(
            'flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors',
            custom
              ? 'border-token bg-token text-black'
              : 'border-dashed border-token/60 text-token hover:bg-token/10',
          )}
        >
          <Pencil className="h-3 w-3" />
          Personalizar
        </button>
      </div>

      {custom && (
        <div className="space-y-2 rounded-xl border border-token/30 bg-token/5 p-3 animate-in fade-in slide-in-from-top-1">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => bump(-5)}
              disabled={priceTokens <= 1}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border text-lg leading-none transition-colors hover:border-token disabled:opacity-40"
              aria-label="Bajar precio"
            >
              <Minus className="h-4 w-4" />
            </button>
            <input
              type="range"
              min={1}
              max={Math.max(SLIDER_MAX_TOKENS, priceTokens)}
              step={1}
              value={priceTokens || 1}
              onChange={(ev) => set(Number(ev.target.value))}
              className="h-1.5 w-full cursor-pointer accent-[hsl(var(--token))]"
              aria-label="Precio en tokens"
            />
            <button
              type="button"
              onClick={() => bump(5)}
              disabled={priceTokens >= MAX_PRICE_TOKENS}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border text-lg leading-none transition-colors hover:border-token disabled:opacity-40"
              aria-label="Subir precio"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
          <p className="text-center text-[11px] text-muted-foreground">
            Cualquier precio entre 1 y {formatTokens(MAX_PRICE_TOKENS)} tokens. Con − y + vas de 5
            en 5.
          </p>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Si la desbloquean 10 fans ganas{' '}
        <strong className="text-foreground">{formatMoney(e.grossCents * 10)}</strong>; con 100,{' '}
        <strong className="text-foreground">{formatMoney(e.grossCents * 100)}</strong>.
      </p>

      <details className="group text-xs">
        <summary className="cursor-pointer list-none text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
          <span className="underline-offset-2 group-open:underline">Como se calcula</span>
        </summary>
        <dl className="mt-2 space-y-1 rounded-lg bg-background/50 p-3">
          <div className="flex justify-between text-muted-foreground">
            <dt>Precio para el fan</dt>
            <dd>{formatTokens(priceTokens)} tokens</dd>
          </div>
          <div className="flex justify-between text-muted-foreground">
            <dt>Comision plataforma ({economy.platformCommissionPercent}%)</dt>
            <dd>-{formatTokens(e.feeTokens)} tokens</dd>
          </div>
          <div className="flex justify-between font-medium">
            <dt>Para ti</dt>
            <dd>
              {formatTokens(e.modelTokens)} × {formatMoney(economy.payoutCentsPerToken)} ={' '}
              {formatMoney(e.grossCents)}
            </dd>
          </div>
          {economy.payoutFeePercent > 0 && (
            <div className="flex justify-between text-muted-foreground">
              <dt>Al retirar (-{economy.payoutFeePercent}%) te llegan</dt>
              <dd>{formatMoney(e.netCents)}</dd>
            </div>
          )}
        </dl>
      </details>
    </div>
  );
}

/**
 * Escenario del paso "Quien lo ve": la foto tal como la vera un fan con la
 * opcion elegida (clara, borrosa con precio o con corona) y, si es de pago,
 * una pegatina con lo que se gana. Cambia al instante al tocar las opciones.
 */
function AudienceStage({
  item,
  count,
  aspectRatio,
  visibility,
  priceTokens,
  economy,
}: {
  item?: ProcessedMedia;
  count: number;
  aspectRatio: number;
  visibility: Visibility;
  priceTokens: number;
  economy: EconomyParams;
}) {
  if (!item) return null;
  const locked = visibility !== 'PUBLIC';
  const isImage = item.mimeType.startsWith('image/');
  const earnings = estimateEarnings(priceTokens, economy);

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3">
      <span className="rounded-full bg-black/50 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.18em] text-white/80 backdrop-blur">
        Asi la ve un fan
      </span>

      <div className="min-h-0 w-full flex-1">
        <Fit aspectRatio={aspectRatio}>
          <div className="relative">
            <div
              key={visibility}
              className="relative w-full overflow-hidden rounded-2xl bg-muted shadow-2xl ring-1 ring-white/10 animate-in fade-in zoom-in-95 duration-300"
              style={{ aspectRatio }}
            >
              {locked ? (
                item.previewUrl ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={item.previewUrl} alt="" className="h-full w-full scale-110 object-cover" />
                ) : (
                  <span className="block h-full w-full bg-gradient-to-br from-primary/30 via-muted to-muted" />
                )
              ) : isImage ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={item.url} alt="" className="h-full w-full object-cover" />
              ) : (
                <video src={item.url} muted playsInline className="h-full w-full object-cover" />
              )}

              {locked && (
                <span className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/40 p-3 text-center">
                  <span className="flex h-11 w-11 items-center justify-center rounded-full bg-black/60">
                    {visibility === 'SUBSCRIBERS' ? (
                      <Crown className="h-5 w-5 text-white" />
                    ) : (
                      <Lock className="h-5 w-5 text-white" />
                    )}
                  </span>
                  <span className="rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground">
                    {visibility === 'SUBSCRIBERS'
                      ? 'Solo suscriptores'
                      : `Desbloquear · ${formatTokens(priceTokens)} tokens`}
                  </span>
                </span>
              )}

              {!locked && (
                <span className="absolute bottom-2 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-black/60 px-3 py-1 text-[11px] font-medium text-white">
                  Gratis · visible para todos
                </span>
              )}

              {count > 1 && (
                <span className="absolute right-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-medium text-white">
                  1/{count}
                </span>
              )}
            </div>

            {/* Pegatina con lo que se gana, girada como un sello */}
            {visibility === 'LOCKED' && (
              <span
                key={priceTokens}
                className="absolute -right-3 -top-4 rotate-6 rounded-2xl border-2 border-background bg-state-connected px-3 py-2 text-center text-black shadow-xl animate-in zoom-in-75 duration-200"
              >
                <span className="block text-[9px] font-bold uppercase tracking-wider">Ganas</span>
                <span className="block font-heading text-xl leading-none">
                  {formatMoney(earnings.grossCents)}
                </span>
                <span className="block text-[9px] font-semibold">por fan</span>
              </span>
            )}
          </div>
        </Fit>
      </div>
    </div>
  );
}

/** Resumen de "Quien lo ve" en la vista previa, con acceso para cambiarlo. */
function AudienceSummary({
  visibility,
  priceTokens,
  economy,
  onChange,
}: {
  visibility: Visibility;
  priceTokens: number;
  economy: EconomyParams;
  onChange: () => void;
}) {
  const Icon = visibility === 'PUBLIC' ? Globe : visibility === 'LOCKED' ? Lock : Crown;
  const title =
    visibility === 'PUBLIC'
      ? 'Todo el mundo'
      : visibility === 'LOCKED'
        ? `Pago por ver · ${formatTokens(priceTokens)} tokens`
        : 'Mis suscriptores';

  return (
    <button
      type="button"
      onClick={onChange}
      className="flex w-full items-center gap-3 rounded-2xl border border-border/60 p-3 text-left transition-colors hover:border-primary/50"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{title}</span>
        <span className="block text-xs text-muted-foreground">
          {visibility === 'LOCKED' ? (
            <>
              Ganas{' '}
              <strong className="text-state-connected">
                {formatMoney(estimateEarnings(priceTokens, economy).grossCents)}
              </strong>{' '}
              por cada fan
            </>
          ) : visibility === 'PUBLIC' ? (
            'Gratis en el feed'
          ) : (
            'Exclusiva para suscriptores'
          )}
        </span>
      </span>
      <span className="text-xs font-semibold text-primary">Cambiar</span>
    </button>
  );
}

function revokeProcessed(items: ProcessedMedia[]) {
  for (const p of items) {
    URL.revokeObjectURL(p.url);
    if (p.previewUrl) URL.revokeObjectURL(p.previewUrl);
  }
}

/**
 * Encaja un marco de la proporcion dada en el espacio disponible, sea el
 * limite el ancho o el alto (unidades de contenedor).
 */
function Fit({
  aspectRatio,
  children,
}: {
  aspectRatio: number;
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-full w-full items-center justify-center" style={{ containerType: 'size' }}>
      <div style={{ width: `min(100cqw, calc(100cqh * ${aspectRatio}))` }}>{children}</div>
    </div>
  );
}

function VideoFrame({ src, aspectRatio }: { src: string; aspectRatio: number }) {
  return (
    <div
      className="relative w-full overflow-hidden rounded-2xl bg-muted shadow-2xl ring-1 ring-white/10"
      style={{ aspectRatio }}
    >
      <video src={src} muted playsInline controls className="h-full w-full object-cover" />
    </div>
  );
}

function EmptyStage({ onPick }: { onPick: () => void }) {
  return (
    <button
      type="button"
      onClick={onPick}
      className="flex aspect-[4/5] w-full flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-white/20 text-sm text-white/70 hover:border-primary/60"
    >
      <ImagePlus className="h-8 w-8" />
      Anadir fotos o video
    </button>
  );
}

function PhoneMockup({ children }: { children: React.ReactNode }) {
  return (
    <div className="w-full max-w-md md:w-[360px] md:max-w-none">
      <div className="md:relative md:h-[min(680px,calc(94vh-150px))] md:overflow-hidden md:rounded-[2.75rem] md:border-[10px] md:border-neutral-900 md:bg-background md:shadow-[0_30px_80px_-20px_rgba(0,0,0,0.8)] md:ring-1 md:ring-white/10">
        <div className="hidden md:flex md:h-9 md:items-center md:justify-center">
          <span className="h-5 w-24 rounded-full bg-neutral-900" />
        </div>
        <div className="md:h-[calc(100%-2.25rem)] md:overflow-y-auto md:px-2 md:pb-4 md:[scrollbar-width:none]">
          {children}
        </div>
      </div>
    </div>
  );
}

function PanelSection({
  title,
  aside,
  children,
}: {
  title: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          {title}
        </h3>
        {typeof aside === 'string' ? (
          <span className="text-xs text-muted-foreground">{aside}</span>
        ) : (
          aside
        )}
      </div>
      {children}
    </section>
  );
}

function FormatGlyph({
  width,
  height,
  active,
}: {
  width: number;
  height: number;
  active: boolean;
}) {
  const size = 30;
  return (
    <span className="flex h-9 items-center">
      <span
        className={cn(
          'block rounded-[4px] border-2 transition-colors',
          active ? 'border-primary bg-primary/20' : 'border-muted-foreground/60',
        )}
        style={{
          width: width >= height ? size : size * (width / height),
          height: height >= width ? size : size * (height / width),
        }}
      />
    </span>
  );
}

function Filmstrip({
  media,
  selectedId,
  onSelect,
  onRemove,
  onMove,
  onAdd,
}: {
  media: MediaItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onRemove?: (id: string) => void;
  onMove?: (id: string, delta: -1 | 1) => void;
  onAdd?: () => void;
}) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-1">
      {media.map((item, index) => {
        const active = selectedId === item.id;
        return (
          <div
            key={item.id}
            className={cn(
              'relative h-[84px] w-[68px] shrink-0 overflow-hidden rounded-xl bg-muted ring-2 transition-all',
              active ? 'ring-primary' : 'ring-transparent opacity-70 hover:opacity-100',
            )}
          >
            <button
              type="button"
              onClick={() => onSelect(item.id)}
              className="h-full w-full"
              aria-label={`Foto ${index + 1}`}
            >
              {item.kind === 'image' ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={item.url} alt="" className="h-full w-full object-cover" />
              ) : (
                <span className="flex h-full w-full items-center justify-center">
                  <Video className="h-5 w-5 text-muted-foreground" />
                </span>
              )}
            </button>

            <span className="pointer-events-none absolute left-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-black/70 px-1 text-[10px] font-semibold text-white">
              {index + 1}
            </span>

            {onRemove && (
              <button
                type="button"
                onClick={() => onRemove(item.id)}
                className="absolute right-1 top-1 rounded-full bg-black/70 p-0.5"
                aria-label="Quitar"
              >
                <X className="h-3 w-3 text-white" />
              </button>
            )}

            {onMove && active && media.length > 1 && (
              <div className="absolute inset-x-0 bottom-0 flex justify-between bg-black/60">
                <button
                  type="button"
                  onClick={() => onMove(item.id, -1)}
                  disabled={index === 0}
                  className="p-0.5 text-white disabled:opacity-30"
                  aria-label="Mover a la izquierda"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => onMove(item.id, 1)}
                  disabled={index === media.length - 1}
                  className="p-0.5 text-white disabled:opacity-30"
                  aria-label="Mover a la derecha"
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
          </div>
        );
      })}

      {onAdd && (
        <button
          type="button"
          onClick={onAdd}
          className="flex h-[84px] w-[68px] shrink-0 items-center justify-center rounded-xl border-2 border-dashed border-border text-muted-foreground transition-colors hover:border-primary/60 hover:text-primary"
          aria-label="Anadir"
        >
          <ImagePlus className="h-5 w-5" />
        </button>
      )}
    </div>
  );
}

function AudienceOption({
  active,
  onClick,
  icon: Icon,
  title,
  hint,
  badge,
  disabled,
  disabledHint,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  hint: string;
  /** Etiqueta a la derecha del titulo (p. ej. lo que se gana). */
  badge?: React.ReactNode;
  disabled?: boolean;
  disabledHint?: string;
  /** Ajustes propios de la opcion; se despliegan dentro al elegirla. */
  children?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        'overflow-hidden rounded-2xl border transition-all',
        disabled && 'opacity-40',
        active
          ? 'border-primary bg-primary/10 shadow-[0_0_24px_-8px_hsl(var(--primary))]'
          : 'border-border/60 hover:border-muted-foreground/50',
      )}
    >
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className="flex w-full items-center gap-3 p-3 text-left disabled:cursor-not-allowed"
      >
        <span
          className={cn(
            'flex h-9 w-9 shrink-0 items-center justify-center rounded-full',
            active ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
          )}
        >
          <Icon className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-sm font-medium">{title}</span>
            {!disabled && badge}
          </span>
          <span className="mt-0.5 block text-xs text-muted-foreground">
            {disabled && disabledHint ? disabledHint : hint}
          </span>
        </span>
        <span
          className={cn(
            'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border',
            active ? 'border-primary bg-primary' : 'border-border',
          )}
        >
          {active && <Check className="h-3 w-3 text-primary-foreground" />}
        </span>
      </button>

      {active && children && (
        <div className="border-t border-primary/20 p-3 animate-in fade-in slide-in-from-top-1">
          {children}
        </div>
      )}
    </div>
  );
}

function DoneScreen({
  glowSrc,
  onClose,
  onAnother,
}: {
  glowSrc?: string;
  onClose: () => void;
  onAnother: () => void;
}) {
  return (
    <div className="relative flex flex-1 flex-col items-center justify-center gap-6 overflow-hidden p-8 text-center">
      {glowSrc && (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={glowSrc}
          alt=""
          aria-hidden
          className="pointer-events-none absolute inset-0 h-full w-full scale-125 object-cover opacity-30 blur-3xl"
        />
      )}
      <div className="relative flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-tr from-primary via-fantazy-red to-champagne-gold shadow-[0_0_60px_-10px_hsl(var(--primary))] animate-in zoom-in-50 duration-500">
        <Check className="h-9 w-9 text-white" strokeWidth={3} />
      </div>
      <div className="relative space-y-2">
        <h3 className="font-heading text-2xl uppercase tracking-wide">Publicado</h3>
        <p className="text-sm text-muted-foreground">
          Ya esta en el feed de tus seguidores y en Descubrir.
        </p>
      </div>
      <div className="relative flex gap-2">
        <Button variant="outline" onClick={onAnother}>
          Crear otra
        </Button>
        <Button variant="brand" onClick={onClose}>
          Listo
        </Button>
      </div>
    </div>
  );
}
