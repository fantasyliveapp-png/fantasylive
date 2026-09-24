'use client';

import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { HelpCircle, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * TUTORIAL GUIADO
 *
 * La primera vez que alguien entra a una pantalla, se oscurece todo menos
 * una cosa, con una tarjetita que dice que es. "Siguiente" pasa a la
 * siguiente. Los elementos se marcan con data-tour="<nombre>"; si uno no
 * esta visible (p. ej. solo existe en escritorio), ese paso se salta.
 *
 * Se recuerda en el navegador que ya se vio. <TourButton> lo vuelve a abrir.
 */

export interface TourStep {
  /** Valor de data-tour del elemento a senalar. Sin target: tarjeta centrada. */
  target?: string;
  title: string;
  body: string;
}

const OPEN_EVENT = 'fl:tour-open';
const PAD = 8;

function storageKey(id: string) {
  return `fl_tour_${id}`;
}

/** El primer elemento visible con ese data-tour (movil y escritorio tienen distintos). */
function findTarget(name: string): HTMLElement | null {
  const all = document.querySelectorAll<HTMLElement>(`[data-tour="${name}"]`);
  for (const el of all) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden') return el;
  }
  return null;
}

export function GuidedTour({ id, steps }: { id: string; steps: TourStep[] }) {
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [viewport, setViewport] = useState({ w: 0, h: 0 });

  // Solo los pasos que se pueden ensenar en esta pantalla (movil/escritorio).
  const [visibleSteps, setVisibleSteps] = useState<TourStep[]>(steps);

  const start = useCallback(() => {
    setVisibleSteps(steps.filter((s) => !s.target || findTarget(s.target)));
    setIndex(0);
    setOpen(true);
  }, [steps]);

  const finish = useCallback(() => {
    setOpen(false);
    try {
      localStorage.setItem(storageKey(id), '1');
    } catch {
      // Sin almacenamiento: se volvera a ensenar, no pasa nada.
    }
  }, [id]);

  // Primera visita: arranca solo, un momento despues de pintar la pagina.
  useEffect(() => {
    let seen = false;
    try {
      seen = localStorage.getItem(storageKey(id)) === '1';
    } catch {
      seen = false;
    }
    if (seen) return;
    const t = setTimeout(start, 700);
    return () => clearTimeout(t);
  }, [id, start]);

  // "Ver tutorial" desde cualquier boton de la pagina.
  useEffect(() => {
    const onOpen = (e: Event) => {
      if ((e as CustomEvent<string>).detail === id) start();
    };
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_EVENT, onOpen);
  }, [id, start]);

  const step = open ? visibleSteps[index] : undefined;

  // Lleva el elemento a la vista y mide donde queda (y al moverse la pagina).
  useLayoutEffect(() => {
    if (!step) return;
    const el = step.target ? findTarget(step.target) : null;
    if (step.target && !el) return;
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });

    const measure = () => {
      setViewport({ w: window.innerWidth, h: window.innerHeight });
      setRect(el ? el.getBoundingClientRect() : null);
    };
    measure();
    // El desplazamiento suave tarda: se vuelve a medir mientras dura.
    const timers = [120, 300, 600].map((ms) => setTimeout(measure, ms));
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      timers.forEach(clearTimeout);
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [step]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') finish();
      if (e.key === 'ArrowRight') setIndex((i) => Math.min(i + 1, visibleSteps.length - 1));
      if (e.key === 'ArrowLeft') setIndex((i) => Math.max(i - 1, 0));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, finish, visibleSteps.length]);

  if (!open || !step) return null;

  const last = index === visibleSteps.length - 1;
  const spot = step.target && rect;

  // Tarjeta debajo del elemento si cabe; si no, encima. Siempre dentro de la pantalla.
  const cardW = Math.min(340, viewport.w - 32);
  let cardStyle: React.CSSProperties;
  if (spot) {
    const below = rect.bottom + PAD + 12;
    const fitsBelow = below + 190 < viewport.h;
    const left = Math.max(16, Math.min(rect.left + rect.width / 2 - cardW / 2, viewport.w - cardW - 16));
    cardStyle = fitsBelow
      ? { top: below, left, width: cardW }
      : { bottom: viewport.h - rect.top + PAD + 12, left, width: cardW };
  } else {
    cardStyle = { top: '50%', left: '50%', width: cardW, transform: 'translate(-50%, -50%)' };
  }

  return (
    <div className="fixed inset-0 z-[80]" role="dialog" aria-modal="true" aria-label={step.title}>
      {/* Capa que bloquea los clics mientras dura el tutorial */}
      <div className="absolute inset-0" />

      {spot ? (
        <div
          className="pointer-events-none absolute rounded-2xl ring-2 ring-primary transition-all duration-300"
          style={{
            top: rect.top - PAD,
            left: rect.left - PAD,
            width: rect.width + PAD * 2,
            height: rect.height + PAD * 2,
            boxShadow: '0 0 0 9999px rgba(0,0,0,0.72)',
          }}
        />
      ) : (
        <div className="absolute inset-0" style={{ backgroundColor: 'rgba(0,0,0,0.72)' }} />
      )}

      <div
        className="absolute rounded-2xl border border-border/60 bg-background p-4 shadow-2xl animate-in fade-in zoom-in-95 duration-200"
        style={cardStyle}
      >
        <button
          type="button"
          onClick={finish}
          className="absolute right-2.5 top-2.5 rounded-full p-1 text-muted-foreground hover:bg-muted"
          aria-label="Cerrar tutorial"
        >
          <X className="h-4 w-4" />
        </button>
        <p className="pr-6 text-base font-semibold">{step.title}</p>
        <p className="mt-1 text-sm text-muted-foreground">{step.body}</p>

        <div className="mt-4 flex items-center justify-between gap-3">
          <div className="flex gap-1" aria-label={`Paso ${index + 1} de ${visibleSteps.length}`}>
            {visibleSteps.map((s, i) => (
              <span
                key={`${s.title}-${i}`}
                className={cn(
                  'h-1.5 rounded-full transition-all',
                  i === index ? 'w-4 bg-primary' : 'w-1.5 bg-muted-foreground/30',
                )}
              />
            ))}
          </div>
          <div className="flex gap-2">
            {index > 0 ? (
              <Button size="sm" variant="ghost" onClick={() => setIndex(index - 1)}>
                Atras
              </Button>
            ) : (
              <Button size="sm" variant="ghost" onClick={finish}>
                Saltar
              </Button>
            )}
            <Button size="sm" variant="brand" onClick={() => (last ? finish() : setIndex(index + 1))}>
              {last ? 'Entendido' : 'Siguiente'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Boton para volver a ver un tutorial. */
export function TourButton({ id, className }: { id: string; className?: string }) {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: id }))}
      className={cn(
        'inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground',
        className,
      )}
    >
      <HelpCircle className="h-3.5 w-3.5" />
      Ver tutorial
    </button>
  );
}
