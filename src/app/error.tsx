'use client';

import { useEffect } from 'react';
import { AlertTriangle } from 'lucide-react';

import { Button } from '@/components/ui/button';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // En produccion aqui iria el reporte a Sentry / Vercel Observability
    console.error('[app] Error no controlado:', error);
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="max-w-md text-center">
        <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-full bg-destructive/15">
          <AlertTriangle className="h-7 w-7 text-destructive" />
        </div>
        <h1 className="text-2xl font-bold">Algo ha salido mal</h1>
        <p className="mt-3 text-muted-foreground">
          Se ha producido un error inesperado. Vuelve a intentarlo; si persiste,
          contacta con soporte.
        </p>
        {error.digest && (
          <p className="mt-2 font-mono text-xs text-muted-foreground">
            Ref: {error.digest}
          </p>
        )}
        <div className="mt-8 flex justify-center gap-3">
          <Button variant="brand" onClick={reset}>
            Reintentar
          </Button>
          <Button variant="outline" onClick={() => (window.location.href = '/')}>
            Ir al inicio
          </Button>
        </div>
      </div>
    </div>
  );
}
