import { Card, CardContent } from '@/components/ui/card';

/**
 * Esqueleto del monedero.
 *
 * La pagina es `force-dynamic` y depende de la sesion, asi que no hay nada
 * cacheado que mostrar: sin esto el usuario ve la pantalla anterior congelada
 * hasta que responde el servidor. El esqueleto reproduce la misma reticula que
 * la pagina real para que al llegar los datos no salte el contenido.
 */
export default function WalletLoading() {
  return (
    <div className="container py-10">
      <div className="mb-8 space-y-2">
        <Shimmer className="h-9 w-48" />
        <Shimmer className="h-4 w-80 max-w-full" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i}>
            <CardContent className="space-y-3 pt-6">
              <Shimmer className="h-3 w-24" />
              <Shimmer className="h-9 w-28" />
            </CardContent>
          </Card>
        ))}
      </div>

      <section className="mt-12">
        <Shimmer className="h-6 w-40" />
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="space-y-3 pt-6">
                <Shimmer className="h-4 w-20" />
                <Shimmer className="h-8 w-24" />
                <Shimmer className="h-7 w-28" />
                <Shimmer className="h-9 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      </section>
    </div>
  );
}

function Shimmer({ className }: { className?: string }) {
  return (
    <div className={`relative overflow-hidden rounded-md bg-muted/40 ${className ?? ''}`}>
      <div className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-foreground/5 to-transparent" />
    </div>
  );
}
