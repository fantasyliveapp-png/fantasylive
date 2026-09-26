'use client';

import { useEffect, useRef, useState } from 'react';
import { Move } from 'lucide-react';

import { cropRect, type CropState } from '@/lib/post-formats';
import { cn } from '@/lib/utils';

export const MAX_ZOOM = 3;

/**
 * Marco de encuadre: la foto se ve dentro del marco del formato elegido y se
 * arrastra para moverla (el zoom lo controla quien lo usa). Usa la misma funcion
 * `cropRect` que el recorte final, asi que lo que se ve aqui es lo que se sube.
 */
export function CropFrame({
  src,
  naturalWidth,
  naturalHeight,
  aspectRatio,
  crop,
  onChange,
  className,
}: {
  className?: string;
  src: string;
  naturalWidth: number;
  naturalHeight: number;
  aspectRatio: number;
  crop: CropState;
  onChange: (crop: CropState) => void;
}) {
  const frame = useRef<HTMLDivElement | null>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      setSize({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const rect = cropRect(
    naturalWidth,
    naturalHeight,
    size.width || 1,
    size.height || 1,
    crop,
  );

  const clamp = (v: number) => Math.max(-1, Math.min(1, v));

  function onPointerMove(e: React.PointerEvent) {
    if (!drag.current) return;
    const dx = e.clientX - drag.current.x;
    const dy = e.clientY - drag.current.y;
    drag.current = { x: e.clientX, y: e.clientY };
    onChange({
      ...crop,
      x: rect.slackX > 0 ? clamp(crop.x + dx / rect.slackX) : 0,
      y: rect.slackY > 0 ? clamp(crop.y + dy / rect.slackY) : 0,
    });
  }

  function endDrag() {
    drag.current = null;
    setDragging(false);
  }

  return (
    <div
      ref={frame}
      className={cn(
        'relative w-full touch-none select-none overflow-hidden rounded-xl bg-muted',
        dragging ? 'cursor-grabbing' : 'cursor-grab',
        className,
      )}
      style={{ aspectRatio }}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { x: e.clientX, y: e.clientY };
        setDragging(true);
      }}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      {size.width > 0 && (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={src}
          alt=""
          draggable={false}
          className="pointer-events-none absolute max-w-none"
          style={{
            width: rect.width,
            height: rect.height,
            left: rect.left,
            top: rect.top,
          }}
        />
      )}

      {/* Reticula de tercios mientras se arrastra, como en la camara. */}
      <div
        className={cn(
          'pointer-events-none absolute inset-0 transition-opacity',
          dragging ? 'opacity-100' : 'opacity-0',
        )}
      >
        <div className="absolute inset-y-0 left-1/3 w-px bg-white/40" />
        <div className="absolute inset-y-0 left-2/3 w-px bg-white/40" />
        <div className="absolute inset-x-0 top-1/3 h-px bg-white/40" />
        <div className="absolute inset-x-0 top-2/3 h-px bg-white/40" />
      </div>

      {!dragging && (
        <span className="pointer-events-none absolute bottom-2 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full bg-black/60 px-2.5 py-1 text-[11px] text-white">
          <Move className="h-3 w-3" />
          Arrastra para encuadrar
        </span>
      )}
    </div>
  );
}
