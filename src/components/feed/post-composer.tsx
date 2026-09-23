'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BarChart3, ImagePlus, Type, Video } from 'lucide-react';

import { MAX_FILES, PostStudio, type StudioModel } from '@/components/feed/post-studio';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import type { EconomyParams } from '@/lib/earnings';
import {
  clearPendingStudioFiles,
  peekPendingStudioFiles,
} from '@/lib/pending-studio-files';
import { cn, initials } from '@/lib/utils';

export type ComposerModel = StudioModel;

/**
 * Punto de entrada para publicar: una tarjeta compacta en la pagina de
 * publicaciones que abre el estudio a pantalla completa. Elegir fotos abre
 * directamente el selector del sistema, como en Instagram; tambien se pueden
 * soltar archivos encima.
 */
export function PostComposer({
  subscriptionEnabled,
  model,
  autoOpen,
  economy,
}: {
  subscriptionEnabled: boolean;
  model: ComposerModel;
  /**
   * Abre el estudio al cargar (menu "+" de la barra inferior): listo para
   * elegir fotos, con los archivos ya elegidos, en modo texto o con encuesta.
   */
  autoOpen?: 'media' | 'files' | 'text' | 'poll';
  /** Parametros de la economia para mostrar lo que se gana en dolares. */
  economy: EconomyParams;
}) {
  const router = useRouter();
  const imageInput = useRef<HTMLInputElement | null>(null);
  const videoInput = useRef<HTMLInputElement | null>(null);
  const [studio, setStudio] = useState<{
    key: number;
    files: File[];
    mediaFirst?: boolean;
    withPoll?: boolean;
  } | null>(() => {
    switch (autoOpen) {
      case 'media':
        return { key: 0, files: [], mediaFirst: true };
      case 'files':
        return { key: 0, files: peekPendingStudioFiles() ?? [], mediaFirst: true };
      case 'text':
        return { key: 0, files: [] };
      case 'poll':
        return { key: 0, files: [], withPoll: true };
      default:
        return null;
    }
  });

  // Los archivos del menu "+" ya estan en el estudio: se sueltan.
  useEffect(() => {
    if (autoOpen === 'files') clearPendingStudioFiles();
  }, [autoOpen]);
  const [dragOver, setDragOver] = useState(false);

  function open(files: File[]) {
    setStudio({ key: Date.now(), files: files.slice(0, MAX_FILES) });
  }

  const firstName = model.stageName.split(' ')[0];

  return (
    <>
      <section
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (e.dataTransfer.files.length > 0) open(Array.from(e.dataTransfer.files));
        }}
        className={cn(
          'relative overflow-hidden rounded-3xl border bg-card p-5 transition-colors',
          dragOver ? 'border-primary' : 'border-border/60',
        )}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute -right-24 -top-28 h-72 w-72 rounded-full bg-primary/20 blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-32 -left-20 h-64 w-64 rounded-full bg-champagne-gold/10 blur-3xl"
        />

        <div className="relative flex items-center gap-3">
          <span className="rounded-full bg-gradient-to-tr from-primary via-fantazy-red to-champagne-gold p-[2px]">
            <Avatar className="h-11 w-11 border-2 border-card">
              <AvatarImage src={model.avatarUrl ?? undefined} />
              <AvatarFallback>{initials(model.stageName)}</AvatarFallback>
            </Avatar>
          </span>
          <button
            type="button"
            onClick={() => open([])}
            className="flex-1 rounded-full border border-border/60 bg-muted/40 px-4 py-3 text-left text-sm text-muted-foreground transition-colors hover:bg-muted"
          >
            {dragOver ? 'Suelta para empezar...' : `¿Que compartes hoy, ${firstName}?`}
          </button>
        </div>

        <div className="relative mt-4 grid grid-cols-4 gap-2">
          <EntryAction
            icon={ImagePlus}
            label="Fotos"
            hint="Hasta 20"
            onClick={() => imageInput.current?.click()}
          />
          <EntryAction
            icon={Video}
            label="Video"
            hint="Hasta 50 MB"
            onClick={() => videoInput.current?.click()}
          />
          <EntryAction icon={Type} label="Texto" hint="Sin archivos" onClick={() => open([])} />
          <EntryAction
            icon={BarChart3}
            label="Encuesta"
            hint="Pregunta"
            onClick={() => setStudio({ key: Date.now(), files: [], withPoll: true })}
          />
        </div>

        <input
          ref={imageInput}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files?.length) open(Array.from(e.target.files));
            e.target.value = '';
          }}
        />
        <input
          ref={videoInput}
          type="file"
          accept="video/*"
          hidden
          onChange={(e) => {
            if (e.target.files?.length) open(Array.from(e.target.files));
            e.target.value = '';
          }}
        />
      </section>

      {studio && (
        <PostStudio
          key={studio.key}
          initialFiles={studio.files}
          startWithMedia={studio.mediaFirst}
          startWithPoll={studio.withPoll}
          economy={economy}
          subscriptionEnabled={subscriptionEnabled}
          model={model}
          onClose={() => {
            setStudio(null);
            // Quita ?nuevo=1 para que recargar no vuelva a abrir el estudio.
            if (autoOpen) router.replace('/dashboard/model/posts', { scroll: false });
          }}
        />
      )}
    </>
  );
}

function EntryAction({
  icon: Icon,
  label,
  hint,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  hint: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex flex-col items-center gap-1.5 rounded-2xl border border-border/60 bg-background/40 px-2 py-3 transition-all hover:-translate-y-0.5 hover:border-primary/50 hover:bg-primary/5"
    >
      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
        <Icon className="h-4 w-4" />
      </span>
      <span className="text-xs font-medium">{label}</span>
      <span className="text-[10px] text-muted-foreground">{hint}</span>
    </button>
  );
}
