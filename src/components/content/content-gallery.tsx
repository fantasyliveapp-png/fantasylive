'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  ChevronLeft,
  ChevronRight,
  Coins,
  Crown,
  Film,
  Images,
  Loader2,
  Lock,
  Package,
  Unlock,
} from 'lucide-react';
import { toast } from 'sonner';
import type { ContentType } from '@prisma/client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { unlockContentAction } from '@/server/actions/wallet';

export interface ContentPackageView {
  id: string;
  title: string;
  description: string | null;
  type: ContentType;
  priceTokens: number;
  previewUrl: string | null;
  assetCount: number;
  purchaseCount: number;
  isUnlocked: boolean;
  subscriberOnly: boolean;
}

const TYPE_ICON: Record<ContentType, typeof Images> = {
  PHOTO: Images,
  VIDEO: Film,
  BUNDLE: Package,
};

export function ContentGallery({
  packages,
  isAuthenticated,
  isSubscribed,
}: {
  packages: ContentPackageView[];
  isAuthenticated: boolean;
  isSubscribed: boolean;
}) {
  const router = useRouter();
  const [target, setTarget] = useState<ContentPackageView | null>(null);
  const [viewing, setViewing] = useState<ContentPackageView | null>(null);
  const [assets, setAssets] = useState<
    Array<{ id: string; url: string; mimeType: string }>
  >([]);
  const [viewIndex, setViewIndex] = useState(0);
  const [isPending, startTransition] = useTransition();
  const [isLoadingAssets, setLoadingAssets] = useState(false);

  if (packages.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
        Esta modelo aun no ha publicado contenido.
      </p>
    );
  }

  function unlock() {
    if (!target) return;
    startTransition(async () => {
      const result = await unlockContentAction(target.id);
      if (result.ok) {
        toast.success(result.message ?? 'Contenido desbloqueado');
        setTarget(null);
        router.refresh();
      } else {
        toast.error(result.error ?? 'No se pudo desbloquear');
      }
    });
  }

  async function openPackage(pkg: ContentPackageView) {
    setViewing(pkg);
    setAssets([]);
    setViewIndex(0);
    setLoadingAssets(true);
    try {
      const res = await fetch(`/api/content/${pkg.id}/assets`);
      const data = await res.json();
      setAssets(data.assets?.filter((a: any) => a.url) ?? []);
    } catch {
      toast.error('No se pudo cargar el contenido');
    } finally {
      setLoadingAssets(false);
    }
  }

  return (
    <>
      <div className="grid grid-cols-3 gap-1 sm:gap-1.5">
        {packages.map((pkg) => {
          const Icon = TYPE_ICON[pkg.type];
          const isFree = pkg.priceTokens === 0;
          const subscriberUnlocked = pkg.subscriberOnly && isSubscribed;
          const accessible = pkg.isUnlocked || isFree || subscriberUnlocked;

          function handleClick() {
            if (accessible) {
              openPackage(pkg);
              return;
            }
            if (!isAuthenticated) {
              window.location.href = '/login';
              return;
            }
            if (pkg.subscriberOnly) {
              toast.error('Este pack es exclusivo para suscriptores.');
              return;
            }
            setTarget(pkg);
          }

          return (
            <div key={pkg.id}>
              <button
                type="button"
                onClick={handleClick}
                className="group relative block aspect-square w-full overflow-hidden rounded-md bg-muted text-left"
              >
                {pkg.previewUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={pkg.previewUrl}
                    alt={pkg.title}
                    loading="lazy"
                    className={cn(
                      'h-full w-full object-cover transition-transform duration-500 group-hover:scale-105',
                      !accessible && 'locked-blur',
                    )}
                  />
                )}

                {!accessible && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-black/40">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-black/60 backdrop-blur">
                      <Lock className="h-3.5 w-3.5 text-white" />
                    </div>
                    {pkg.subscriberOnly ? (
                      <Badge variant="vip" className="gap-1 px-1.5 py-0 text-[10px]">
                        <Crown className="h-2.5 w-2.5" />
                        Suscriptores
                      </Badge>
                    ) : (
                      <Badge variant="token" className="gap-1 px-1.5 py-0 text-[10px]">
                        <Coins className="h-2.5 w-2.5" />
                        {pkg.priceTokens}
                      </Badge>
                    )}
                  </div>
                )}

                {accessible && (
                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center gap-4 bg-black/0 opacity-0 transition-all group-hover:bg-black/50 group-hover:opacity-100">
                    <span className="flex items-center gap-1 text-sm font-semibold text-white">
                      <Icon className="h-4 w-4" />
                      {pkg.assetCount}
                    </span>
                  </div>
                )}

                {subscriberUnlocked && (
                  <Badge
                    variant="vip"
                    className="pointer-events-none absolute right-1 top-1 gap-1 px-1.5 py-0 text-[10px]"
                  >
                    <Crown className="h-2.5 w-2.5" />
                    Suscripcion
                  </Badge>
                )}
                {accessible && !isFree && !subscriberUnlocked && (
                  <Badge
                    variant="success"
                    className="pointer-events-none absolute right-1 top-1 gap-1 px-1.5 py-0 text-[10px]"
                  >
                    <Unlock className="h-2.5 w-2.5" />
                    Desbloqueado
                  </Badge>
                )}
                {isFree && !subscriberUnlocked && (
                  <Badge
                    variant="secondary"
                    className="pointer-events-none absolute right-1 top-1 px-1.5 py-0 text-[10px]"
                  >
                    Gratis
                  </Badge>
                )}
              </button>

              <div className="mt-1 px-0.5">
                <p className="truncate text-xs font-medium">{pkg.title}</p>
                <p className="truncate text-[11px] text-muted-foreground">
                  {pkg.assetCount} archivo{pkg.assetCount === 1 ? '' : 's'}
                  {pkg.purchaseCount > 0 && ` · ${pkg.purchaseCount} compras`}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Confirmacion de compra */}
      <Dialog open={Boolean(target)} onOpenChange={(o) => !o && setTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Desbloquear contenido</DialogTitle>
            <DialogDescription>
              Se descontaran{' '}
              <strong className="text-token">{target?.priceTokens} tokens</strong>{' '}
              de tu monedero. El acceso es permanente.
            </DialogDescription>
          </DialogHeader>

          {target && (
            <div className="rounded-lg border border-border p-3">
              <p className="font-medium">{target.title}</p>
              {target.description && (
                <p className="mt-1 text-sm text-muted-foreground">
                  {target.description}
                </p>
              )}
              <p className="mt-2 text-xs text-muted-foreground">
                {target.assetCount} archivos incluidos
              </p>
            </div>
          )}

          <DialogFooter>
            <Button variant="ghost" onClick={() => setTarget(null)}>
              Cancelar
            </Button>
            <Button variant="token" onClick={unlock} disabled={isPending}>
              {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              <Coins className="h-4 w-4" />
              Pagar {target?.priceTokens} tokens
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Visor, estilo carrusel */}
      <Dialog open={Boolean(viewing)} onOpenChange={(o) => !o && setViewing(null)}>
        <DialogContent className="max-w-lg gap-0 overflow-hidden border-none bg-black p-0 text-white sm:rounded-2xl">
          <DialogHeader className="sr-only">
            <DialogTitle>{viewing?.title}</DialogTitle>
            <DialogDescription>
              {viewing?.description ?? 'Visor de contenido.'}
            </DialogDescription>
          </DialogHeader>

          {isLoadingAssets ? (
            <div className="flex h-[50vh] items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-white/60" />
            </div>
          ) : assets.length === 0 ? (
            <p className="flex h-[40vh] items-center justify-center px-8 text-center text-sm text-white/60">
              No hay archivos disponibles en este paquete.
            </p>
          ) : (
            (() => {
              const index = Math.min(viewIndex, assets.length - 1);
              const asset = assets[index];
              return (
                <>
                  <div className="relative flex min-h-[50vh] items-center justify-center bg-black">
                    {asset.mimeType.startsWith('video') ? (
                      <video
                        key={asset.id}
                        src={asset.url}
                        controls
                        className="max-h-[70vh] w-full object-contain"
                      />
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        key={asset.id}
                        src={asset.url}
                        alt=""
                        className="max-h-[70vh] w-full object-contain"
                      />
                    )}

                    {index > 0 && (
                      <button
                        type="button"
                        onClick={() => setViewIndex(index - 1)}
                        className="absolute left-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-white transition-colors hover:bg-black/70"
                        aria-label="Anterior"
                      >
                        <ChevronLeft className="h-5 w-5" />
                      </button>
                    )}
                    {index < assets.length - 1 && (
                      <button
                        type="button"
                        onClick={() => setViewIndex(index + 1)}
                        className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-white transition-colors hover:bg-black/70"
                        aria-label="Siguiente"
                      >
                        <ChevronRight className="h-5 w-5" />
                      </button>
                    )}
                  </div>

                  <div className="flex items-center justify-between gap-3 bg-black px-4 py-3">
                    {assets.length > 1 ? (
                      <div className="flex gap-1.5">
                        {assets.map((a, i) => (
                          <span
                            key={a.id}
                            className={cn(
                              'h-1.5 w-1.5 rounded-full transition-colors',
                              i === index ? 'bg-white' : 'bg-white/30',
                            )}
                          />
                        ))}
                      </div>
                    ) : (
                      <span />
                    )}
                    <span className="text-xs text-white/60">
                      {index + 1}/{assets.length}
                    </span>
                  </div>
                </>
              );
            })()
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
