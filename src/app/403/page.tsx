import Link from 'next/link';
import { ShieldX } from 'lucide-react';

import { Button } from '@/components/ui/button';

export const metadata = { title: 'Acceso denegado' };

export default function ForbiddenPage() {
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="max-w-md text-center">
        <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-full bg-destructive/15">
          <ShieldX className="h-7 w-7 text-destructive" />
        </div>
        <h1 className="text-2xl font-bold">Acceso denegado</h1>
        <p className="mt-3 text-muted-foreground">
          No tienes permisos para ver esta seccion. Si crees que es un error,
          contacta con soporte.
        </p>
        <div className="mt-8 flex justify-center gap-3">
          <Link href="/">
            <Button variant="brand">Volver al inicio</Button>
          </Link>
          <Link href="/dashboard">
            <Button variant="outline">Mi cuenta</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
