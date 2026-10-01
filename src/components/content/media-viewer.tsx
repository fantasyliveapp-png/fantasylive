'use client';

import { useEffect } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';

/** Visor a pantalla completa de fotos y videos ya desbloqueados. */
export function MediaViewer({
  files,
  index,
  onIndex,
  onClose,
}: {
  files: { id: string; mimeType: string; url: string | null }[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
}) {
  const f = files[index];
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight' && index < files.length - 1) onIndex(index + 1);
      if (e.key === 'ArrowLeft' && index > 0) onIndex(index - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [files.length, index, onClose, onIndex]);
  if (!f?.url) return null;
  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/95" onClick={onClose}>
      <div className="relative max-h-full max-w-full p-4" onClick={(e) => e.stopPropagation()}>
        {f.mimeType.startsWith('video') ? (
          <video src={f.url} controls autoPlay className="max-h-[85dvh] max-w-full rounded-lg" />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={f.url} alt="" className="max-h-[85dvh] max-w-full rounded-lg object-contain" />
        )}
      </div>
      <button type="button" onClick={onClose} className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white" aria-label="Cerrar">
        <X className="h-5 w-5" />
      </button>
      {files.length > 1 && (
        <>
          <span className="absolute left-1/2 top-5 -translate-x-1/2 text-sm text-white/70">
            {index + 1} / {files.length}
          </span>
          {index > 0 && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onIndex(index - 1);
              }}
              className="absolute left-3 top-1/2 -translate-y-1/2 rounded-full bg-white/10 p-2 text-white"
              aria-label="Anterior"
            >
              <ChevronLeft className="h-6 w-6" />
            </button>
          )}
          {index < files.length - 1 && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onIndex(index + 1);
              }}
              className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-white/10 p-2 text-white"
              aria-label="Siguiente"
            >
              <ChevronRight className="h-6 w-6" />
            </button>
          )}
        </>
      )}
    </div>
  );
}
