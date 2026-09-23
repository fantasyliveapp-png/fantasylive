'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ChevronRight, ImagePlus, Radio, X } from 'lucide-react';

import { cn } from '@/lib/utils';

const STUDIO = '/dashboard/model/posts';

/**
 * Menu "Crear" del boton + de la barra inferior: UNA forma de publicar (el
 * estudio, donde se eligen fotos/videos, texto o encuesta; en el movil el
 * selector de archivos ya ofrece la camara) y el directo. Las mismas dos
 * opciones que en el panel, el perfil y "Hoy".
 */
export function CreateSheet({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  /**
   * Abre el estudio. `t` hace unica cada apertura: si ya se esta en la
   * pagina del estudio, el cambio de clave lo vuelve a montar desde cero.
   */
  function openStudio() {
    onClose();
    router.push(`${STUDIO}?nuevo=1&t=${Date.now()}`);
  }

  return (
    <>
      <div
        className={cn(
          'fixed inset-0 z-[55] transition-opacity duration-200 md:hidden',
          open ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
        aria-hidden={!open}
      >
        <button
          type="button"
          className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          onClick={onClose}
          aria-label="Cerrar"
          tabIndex={open ? 0 : -1}
        />

        <div
          role="dialog"
          aria-modal="true"
          aria-label="Crear"
          className={cn(
            'absolute inset-x-0 bottom-0 rounded-t-[1.75rem] border-t border-border/60 bg-background p-4 shadow-2xl transition-transform duration-300 ease-out',
            open ? 'translate-y-0' : 'translate-y-full',
          )}
          style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}
        >
          <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-muted-foreground/30" />
          <div className="mb-4 flex items-center justify-between px-1">
            <h2 className="font-heading text-lg uppercase tracking-[0.2em]">Crear</h2>
            <button
              type="button"
              onClick={onClose}
              className="rounded-full p-1.5 text-muted-foreground hover:bg-muted"
              aria-label="Cerrar"
              tabIndex={open ? 0 : -1}
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Solo dos opciones, las mismas en todas partes: una publicacion
              (fotos, videos, texto o encuesta, todo dentro del estudio) o un
              directo. */}
          <button
            type="button"
            onClick={() => openStudio()}
            tabIndex={open ? 0 : -1}
            className="flex w-full items-center gap-4 rounded-2xl bg-gradient-to-r from-primary via-fantazy-red to-champagne-gold p-4 text-left text-white shadow-[0_10px_30px_-10px_hsl(var(--primary))] active:scale-[0.99]"
          >
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/20">
              <ImagePlus className="h-6 w-6" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-semibold">Nueva publicacion</span>
              <span className="block text-xs text-white/80">
                Fotos, videos, texto o encuesta. Gratis o de pago.
              </span>
            </span>
            <ChevronRight className="h-5 w-5 shrink-0 opacity-80" />
          </button>

          <Link
            href="/dashboard/model/live"
            onClick={onClose}
            tabIndex={open ? 0 : -1}
            className="mt-2 flex items-center gap-4 rounded-2xl border border-rose-500/40 bg-rose-500/10 p-4 active:scale-[0.99]"
          >
            <span className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-rose-500 text-white">
              <Radio className="h-6 w-6" />
              <span className="absolute -right-0.5 -top-0.5 h-3 w-3 animate-pulse rounded-full border-2 border-background bg-white" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-semibold">Ir en directo</span>
              <span className="block text-xs text-muted-foreground">
                Desde el movil o con OBS. Tus seguidores reciben un aviso.
              </span>
            </span>
            <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
          </Link>
        </div>
      </div>
    </>
  );
}
