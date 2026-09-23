'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';

import { MAX_FILES, PostStudio, type StudioModel } from '@/components/feed/post-studio';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import type { EconomyParams } from '@/lib/earnings';
import { cn, initials } from '@/lib/utils';

export type ComposerModel = StudioModel;

/**
 * Punto de entrada para publicar en la pagina de publicaciones: abre el MISMO
 * estudio que el + de abajo y los botones "Nueva publicacion". Dentro se
 * eligen fotos/videos, solo texto o encuesta. Tambien se pueden soltar
 * archivos encima (escritorio).
 */
export function PostComposer({
  subscriptionEnabled,
  model,
  autoOpen,
  economy,
}: {
  subscriptionEnabled: boolean;
  model: ComposerModel;
  /** Abre el estudio al cargar (llegando desde el + o "Nueva publicacion"). */
  autoOpen?: 'media';
  /** Parametros de la economia para mostrar lo que se gana en dolares. */
  economy: EconomyParams;
}) {
  const router = useRouter();
  const [studio, setStudio] = useState<{ key: number; files: File[] } | null>(() =>
    autoOpen ? { key: 0, files: [] } : null,
  );
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

        {/* Una sola puerta de entrada, igual que el + de abajo: el estudio.
            Dentro se eligen fotos/videos, solo texto o encuesta. */}
        <button
          type="button"
          onClick={() => open([])}
          className="relative flex w-full items-center gap-3 text-left"
        >
          <span className="rounded-full bg-gradient-to-tr from-primary via-fantazy-red to-champagne-gold p-[2px]">
            <Avatar className="h-11 w-11 border-2 border-card">
              <AvatarImage src={model.avatarUrl ?? undefined} />
              <AvatarFallback>{initials(model.stageName)}</AvatarFallback>
            </Avatar>
          </span>
          <span className="flex-1 rounded-full border border-border/60 bg-muted/40 px-4 py-3 text-sm text-muted-foreground transition-colors hover:bg-muted">
            {dragOver ? 'Suelta para empezar...' : `¿Que compartes hoy, ${firstName}?`}
          </span>
          <span className="flex h-11 items-center gap-1.5 rounded-full bg-gradient-to-r from-primary via-fantazy-red to-champagne-gold px-4 text-sm font-semibold text-white">
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">Nueva publicacion</span>
          </span>
        </button>
      </section>

      {studio && (
        <PostStudio
          key={studio.key}
          initialFiles={studio.files}
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
