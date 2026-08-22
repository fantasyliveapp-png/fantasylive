import Link from 'next/link';
import { SearchX } from 'lucide-react';

import { Button } from '@/components/ui/button';

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="max-w-md text-center">
        <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-full bg-muted">
          <SearchX className="h-7 w-7 text-muted-foreground" />
        </div>
        <h1 className="text-2xl font-bold">Pagina no encontrada</h1>
        <p className="mt-3 text-muted-foreground">
          El enlace que has seguido no existe o el contenido ha sido retirado.
        </p>
        <div className="mt-8 flex justify-center gap-3">
          <Link href="/">
            <Button variant="brand">Ir al inicio</Button>
          </Link>
          <Link href="/models">
            <Button variant="outline">Ver modelos</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
