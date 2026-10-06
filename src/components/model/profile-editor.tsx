'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  AtSign,
  Camera,
  ChevronRight,
  Coins,
  Loader2,
  MessageSquareHeart,
  RotateCcw,
  Shield,
  X,
  ZoomIn,
} from 'lucide-react';
import { toast } from 'sonner';

import { CropFrame, MAX_ZOOM } from '@/components/feed/crop-frame';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { putToSignedUrl, readImageSize, renderCroppedImage } from '@/lib/blur-preview';
import { LANGUAGES, MODEL_TAGS } from '@/lib/constants';
import { DEFAULT_CROP, type CropState } from '@/lib/post-formats';
import { cn, initials } from '@/lib/utils';
import {
  requestProfileImageUploadUrlAction,
  updateModelProfileAction,
} from '@/server/actions/model';

export interface EditableProfile {
  slug: string;
  stageName: string;
  headline: string;
  bio: string;
  languages: string[];
  tags: string[];
  avatarUrl: string;
  coverUrl: string;
}

const IMAGE_SPECS = {
  avatar: { width: 512, height: 512, label: 'Foto de perfil' },
  cover: { width: 1500, height: 500, label: 'Portada' },
} as const;

type ImageKind = keyof typeof IMAGE_SPECS;

/**
 * Boton que abre el editor de perfil. Se usa en el propio perfil, en el
 * panel y en el menu, para que editar este siempre a un toque.
 */
export function ProfileEditorButton({
  profile,
  defaultOpen = false,
  children,
  className,
  variant = 'outline',
  size = 'sm',
}: {
  profile: EditableProfile;
  defaultOpen?: boolean;
  children: React.ReactNode;
  className?: string;
  variant?: 'outline' | 'brand' | 'ghost' | 'secondary';
  size?: 'sm' | 'default' | 'lg';
}) {
  const [open, setOpen] = useState(defaultOpen);
  const router = useRouter();

  // "Editar perfil" del menu lleva a ?editar=1. Si ya se estaba en el perfil,
  // el componente no se vuelve a montar: hay que abrir al cambiar la prop.
  useEffect(() => {
    if (defaultOpen) setOpen(true);
  }, [defaultOpen]);

  return (
    <>
      <Button variant={variant} size={size} className={className} onClick={() => setOpen(true)}>
        {children}
      </Button>
      {open && (
        <ProfileEditor
          profile={profile}
          onClose={() => {
            setOpen(false);
            // Quita ?editar=1 para que recargar no vuelva a abrir el editor.
            if (defaultOpen) router.replace(window.location.pathname, { scroll: false });
          }}
        />
      )}
    </>
  );
}

/**
 * EDITOR DE PERFIL
 *
 * Pantalla completa, como "Editar perfil" de Instagram: la portada y la foto
 * se cambian tocandolas (con recorte), y los textos se editan en el mismo
 * orden en que aparecen en el perfil publico.
 */
export function ProfileEditor({
  profile,
  onClose,
}: {
  profile: EditableProfile;
  onClose: () => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [stageName, setStageName] = useState(profile.stageName);
  const [handle, setHandle] = useState(profile.slug);
  const pathname = usePathname();
  const [headline, setHeadline] = useState(profile.headline);
  const [bio, setBio] = useState(profile.bio);
  const [languages, setLanguages] = useState(profile.languages);
  const [tags, setTags] = useState(profile.tags);
  const [avatarUrl, setAvatarUrl] = useState(profile.avatarUrl);
  const [coverUrl, setCoverUrl] = useState(profile.coverUrl);
  // Vista local inmediata mientras la foto nueva se sube.
  const [localPreview, setLocalPreview] = useState<Partial<Record<ImageKind, string>>>({});
  const [uploading, setUploading] = useState<ImageKind | null>(null);

  const [cropping, setCropping] = useState<{
    kind: ImageKind;
    file: File;
    url: string;
    width: number;
    height: number;
  } | null>(null);

  const fileInputs = {
    avatar: useRef<HTMLInputElement | null>(null),
    cover: useRef<HTMLInputElement | null>(null),
  };

  const dirty =
    stageName !== profile.stageName ||
    handle !== profile.slug ||
    headline !== profile.headline ||
    bio !== profile.bio ||
    avatarUrl !== profile.avatarUrl ||
    coverUrl !== profile.coverUrl ||
    languages.join() !== profile.languages.join() ||
    tags.join() !== profile.tags.join();

  const busy = isPending || uploading !== null;

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  // Liberar las vistas locales al cerrar (ref: el cierre ve el valor actual).
  const previewRef = useRef(localPreview);
  previewRef.current = localPreview;
  useEffect(
    () => () => {
      Object.values(previewRef.current).forEach((u) => u && URL.revokeObjectURL(u));
    },
    [],
  );

  function close() {
    if (busy) return;
    if (dirty && !window.confirm('¿Salir sin guardar los cambios?')) return;
    onClose();
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !cropping) close();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  async function pickImage(kind: ImageKind, file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error('Elige una imagen.');
      return;
    }
    const size = await readImageSize(file);
    if (!size) {
      toast.error('No se puede leer esa imagen. Prueba con JPG o PNG.');
      return;
    }
    setCropping({ kind, file, url: URL.createObjectURL(file), ...size });
  }

  async function applyCrop(crop: CropState) {
    if (!cropping) return;
    const { kind, file, url } = cropping;
    setCropping(null);
    URL.revokeObjectURL(url);

    const blob = await renderCroppedImage(file, IMAGE_SPECS[kind], crop);
    if (!blob) {
      toast.error('No se pudo procesar la imagen.');
      return;
    }

    const preview = URL.createObjectURL(blob);
    setLocalPreview((prev) => {
      if (prev[kind]) URL.revokeObjectURL(prev[kind]!);
      return { ...prev, [kind]: preview };
    });

    // Si la subida falla se vuelve a la foto anterior: la vista local no
    // puede mostrar algo que no se va a guardar.
    const revert = (message: string) => {
      setUploading(null);
      URL.revokeObjectURL(preview);
      setLocalPreview((prev) => {
        const next = { ...prev };
        delete next[kind];
        return next;
      });
      toast.error(message);
    };

    setUploading(kind);
    const signed = await requestProfileImageUploadUrlAction({ kind, sizeBytes: blob.size });
    if (!signed.ok || !signed.data) {
      revert(signed.error ?? 'No se pudo subir la imagen.');
      return;
    }
    const ok = await putToSignedUrl(signed.data.uploadUrl, blob, 'image/jpeg').catch(() => false);
    if (!ok) {
      revert('No se pudo subir la imagen.');
      return;
    }
    setUploading(null);
    if (kind === 'avatar') setAvatarUrl(signed.data.publicUrl);
    else setCoverUrl(signed.data.publicUrl);
  }

  function toggle(list: string[], setter: (v: string[]) => void, value: string, max: number) {
    if (list.includes(value)) setter(list.filter((v) => v !== value));
    else if (list.length < max) setter([...list, value]);
    else toast.error(`Maximo ${max}.`);
  }

  function save() {
    if (stageName.trim().length < 2) {
      toast.error('El nombre artistico necesita al menos 2 caracteres.');
      return;
    }
    startTransition(async () => {
      const newHandle = handle.trim().toLowerCase();
      const result = await updateModelProfileAction({
        stageName: stageName.trim(),
        username: newHandle,
        headline: headline.trim(),
        bio: bio.trim(),
        languages,
        tags,
        avatarUrl,
        coverUrl,
      });
      if (result.ok) {
        toast.success(result.message ?? 'Perfil guardado');
        onClose();
        // Si cambio su @ estando en su perfil, la direccion tambien cambia.
        if (newHandle !== profile.slug && pathname === `/models/${profile.slug}`) {
          router.replace(`/models/${newHandle}`);
        } else {
          router.refresh();
        }
      } else {
        toast.error(result.error ?? 'No se pudo guardar el perfil');
      }
    });
  }

  const shownAvatar = localPreview.avatar ?? avatarUrl;
  const shownCover = localPreview.cover ?? coverUrl;

  return (
    <div
      className="fixed inset-0 !m-0 z-[60] flex bg-black/70 backdrop-blur-md md:items-center md:justify-center md:p-6"
      role="dialog"
      aria-modal="true"
      aria-label="Editar perfil"
    >
      {(['avatar', 'cover'] as const).map((kind) => (
        <input
          key={kind}
          ref={fileInputs[kind]}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            void pickImage(kind, e.target.files?.[0]);
            e.target.value = '';
          }}
        />
      ))}

      <div className="relative flex h-full w-full flex-col overflow-hidden bg-background md:h-auto md:max-h-[92vh] md:max-w-xl md:rounded-[2rem] md:border md:border-border/60 md:shadow-2xl">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border/60 px-2">
          <Button variant="ghost" size="icon" onClick={close} disabled={busy} aria-label="Cerrar">
            <X className="h-5 w-5" />
          </Button>
          <h2 className="flex-1 text-center font-heading text-sm uppercase tracking-[0.2em]">
            Editar perfil
          </h2>
          <Button
            variant="ghost"
            size="sm"
            onClick={save}
            disabled={busy || !dirty}
            className="font-semibold text-primary hover:text-primary"
          >
            {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Guardar
          </Button>
        </header>

        <div className="flex-1 overflow-y-auto pb-8">
          {/* Portada + avatar: se cambian tocandolos */}
          <div className="relative">
            <button
              type="button"
              onClick={() => fileInputs.cover.current?.click()}
              className="group relative block h-36 w-full overflow-hidden bg-gradient-to-br from-primary/40 via-fantazy-red/20 to-champagne-gold/30 sm:h-44"
              aria-label="Cambiar portada"
            >
              {shownCover && (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={shownCover} alt="" className="h-full w-full object-cover" />
              )}
              {/* En movil la etiqueta va en la esquina: centrada la taparia el avatar. */}
              <span className="absolute inset-0 flex items-start justify-end bg-black/20 p-3 transition-opacity sm:items-center sm:justify-center sm:bg-black/30 sm:p-0 sm:opacity-0 sm:group-hover:opacity-100">
                <span className="flex items-center gap-1.5 rounded-full bg-black/60 px-3 py-1.5 text-xs font-medium text-white">
                  {uploading === 'cover' ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Camera className="h-3.5 w-3.5" />
                  )}
                  Cambiar portada
                </span>
              </span>
            </button>

            <button
              type="button"
              onClick={() => fileInputs.avatar.current?.click()}
              className="group absolute -bottom-12 left-1/2 -translate-x-1/2 rounded-full bg-gradient-to-tr from-primary via-fantazy-red to-champagne-gold p-[3px]"
              aria-label="Cambiar foto de perfil"
            >
              <Avatar className="h-24 w-24 border-4 border-background">
                {shownAvatar && <AvatarImage src={shownAvatar} alt="" />}
                <AvatarFallback className="text-2xl">{initials(stageName)}</AvatarFallback>
              </Avatar>
              <span className="absolute bottom-1 right-1 flex h-8 w-8 items-center justify-center rounded-full border-2 border-background bg-primary text-primary-foreground">
                {uploading === 'avatar' ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Camera className="h-4 w-4" />
                )}
              </span>
            </button>
          </div>

          <div className="mt-16 space-y-1 px-5">
            <p className="text-center text-xs text-muted-foreground">
              Toca la foto o la portada para cambiarlas
            </p>
          </div>

          <div className="mt-6 divide-y divide-border/60 border-y border-border/60">
            <Field label="Nombre" hint={`${stageName.length}/40`}>
              <input
                value={stageName}
                onChange={(e) => setStageName(e.target.value)}
                maxLength={40}
                className="w-full bg-transparent text-sm outline-none"
                placeholder="Tu nombre artistico"
              />
            </Field>
            <Field label="Usuario">
              <span className="flex items-center gap-1 text-sm">
                <AtSign className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <input
                  value={handle}
                  onChange={(e) => setHandle(e.target.value.toLowerCase().replace(/\s/g, ''))}
                  maxLength={30}
                  autoCapitalize="none"
                  spellCheck={false}
                  className="w-full bg-transparent outline-none"
                  placeholder="tu.usuario"
                  aria-label="Tu @usuario"
                />
              </span>
            </Field>
            <Field label="Titular" hint={`${headline.length}/120`}>
              <input
                value={headline}
                onChange={(e) => setHeadline(e.target.value)}
                maxLength={120}
                className="w-full bg-transparent text-sm outline-none"
                placeholder="Una frase que te describa"
              />
            </Field>
            <Field label="Bio" hint={`${bio.length}/1200`} alignTop>
              <textarea
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                maxLength={1200}
                rows={4}
                className="w-full resize-none bg-transparent text-sm leading-relaxed outline-none"
                placeholder="Quien eres, que te gusta y como son tus sesiones..."
              />
            </Field>
          </div>

          <div className="space-y-6 px-5 pt-6">
            <ChipGroup
              title="Etiquetas"
              max={8}
              options={MODEL_TAGS}
              selected={tags}
              onToggle={(v) => toggle(tags, setTags, v, 8)}
              capitalize
            />
            <ChipGroup
              title="Idiomas"
              max={5}
              options={LANGUAGES}
              selected={languages}
              onToggle={(v) => toggle(languages, setLanguages, v, 5)}
            />

            <p className="text-xs text-muted-foreground">
              No incluyas redes sociales ni formas de contacto: el perfil no se
              guardara si las detecta.
            </p>

            <div className="overflow-hidden rounded-2xl border border-border/60">
              <SettingsLink href="/dashboard/model/rates" icon={Coins} label="Tarifas, suscripcion y mensajes" />
              <SettingsLink
                href="/dashboard/model/greeting"
                icon={MessageSquareHeart}
                label="Mensaje de bienvenida"
              />
              <SettingsLink href="/dashboard/model/privacy" icon={Shield} label="Privacidad y bloqueos" />
            </div>
          </div>
        </div>
      </div>

      {cropping && (
        <ImageCropDialog
          kind={cropping.kind}
          src={cropping.url}
          naturalWidth={cropping.width}
          naturalHeight={cropping.height}
          onCancel={() => {
            URL.revokeObjectURL(cropping.url);
            setCropping(null);
          }}
          onApply={(crop) => void applyCrop(crop)}
        />
      )}
    </div>
  );
}

function Field({
  label,
  hint,
  alignTop,
  children,
}: {
  label: string;
  hint?: string;
  alignTop?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className={cn('flex gap-4 px-5 py-3.5', alignTop ? 'items-start' : 'items-center')}>
      <span className="w-20 shrink-0 text-sm font-medium">{label}</span>
      <span className="min-w-0 flex-1">{children}</span>
      {hint && <span className="shrink-0 text-[11px] text-muted-foreground">{hint}</span>}
    </label>
  );
}

function ChipGroup({
  title,
  max,
  options,
  selected,
  onToggle,
  capitalize,
}: {
  title: string;
  max: number;
  options: readonly string[];
  selected: string[];
  onToggle: (value: string) => void;
  capitalize?: boolean;
}) {
  return (
    <section className="space-y-2.5">
      <div className="flex items-center justify-between">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          {title}
        </h3>
        <span className="text-xs text-muted-foreground">
          {selected.length}/{max}
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {options.map((option) => {
          const active = selected.includes(option);
          return (
            <button
              key={option}
              type="button"
              onClick={() => onToggle(option)}
              className={cn(
                'rounded-full border px-3 py-1.5 text-xs transition-colors',
                capitalize && 'capitalize',
                active
                  ? 'border-primary bg-primary/15 font-medium text-foreground'
                  : 'border-border/60 text-muted-foreground hover:border-muted-foreground/50',
              )}
            >
              {option}
            </button>
          );
        })}
      </div>
    </section>
  );
}

function SettingsLink({
  href,
  icon: Icon,
  label,
}: {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-3 border-b border-border/60 px-4 py-3 text-sm transition-colors last:border-b-0 hover:bg-muted/40"
    >
      <Icon className="h-4 w-4 text-muted-foreground" />
      <span className="flex-1">{label}</span>
      <ChevronRight className="h-4 w-4 text-muted-foreground" />
    </Link>
  );
}

/** Recorte de avatar (circulo) o portada (3:1) antes de subir. */
export function ImageCropDialog({
  kind,
  src,
  naturalWidth,
  naturalHeight,
  onCancel,
  onApply,
}: {
  kind: ImageKind;
  src: string;
  naturalWidth: number;
  naturalHeight: number;
  onCancel: () => void;
  onApply: (crop: CropState) => void;
}) {
  const [crop, setCrop] = useState<CropState>(DEFAULT_CROP);
  const spec = IMAGE_SPECS[kind];
  const aspectRatio = spec.width / spec.height;

  return (
    <div className="fixed inset-0 !m-0 z-[70] flex flex-col items-center justify-center gap-5 bg-black p-5">
      <p className="font-heading text-sm uppercase tracking-[0.2em] text-white">{spec.label}</p>

      <div className={cn('relative w-full', kind === 'avatar' ? 'max-w-xs' : 'max-w-lg')}>
        <CropFrame
          src={src}
          naturalWidth={naturalWidth}
          naturalHeight={naturalHeight}
          aspectRatio={aspectRatio}
          crop={crop}
          onChange={setCrop}
          className={kind === 'avatar' ? 'rounded-none' : 'rounded-2xl'}
        />
        {kind === 'avatar' && (
          // Mascara circular: asi se vera en el perfil. La sombra que oscurece
          // lo de fuera del circulo se recorta al marco; sin el overflow-hidden
          // cubria toda la pantalla y dejaba opacos el zoom y los botones.
          <span className="pointer-events-none absolute inset-0 overflow-hidden">
            <span className="absolute inset-0 rounded-full shadow-[0_0_0_9999px_rgba(0,0,0,0.6)] ring-2 ring-white/70" />
          </span>
        )}
      </div>

      <div className="flex w-full max-w-xs items-center gap-3">
        <ZoomIn className="h-4 w-4 shrink-0 text-white/70" />
        <input
          type="range"
          min={1}
          max={MAX_ZOOM}
          step={0.01}
          value={crop.zoom}
          onChange={(e) => setCrop({ ...crop, zoom: Number(e.target.value) })}
          className="h-1.5 w-full cursor-pointer accent-primary"
          aria-label="Zoom"
        />
        <button
          type="button"
          onClick={() => setCrop(DEFAULT_CROP)}
          className="text-white/70 hover:text-white"
          aria-label="Centrar"
        >
          <RotateCcw className="h-4 w-4" />
        </button>
      </div>

      <div className="flex gap-2">
        <Button variant="ghost" className="text-white hover:bg-white/10" onClick={onCancel}>
          Cancelar
        </Button>
        <Button variant="brand" onClick={() => onApply(crop)}>
          Usar foto
        </Button>
      </div>
    </div>
  );
}
