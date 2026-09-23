'use client';

import { useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ChevronLeft,
  ChevronRight,
  Coins,
  Eye,
  EyeOff,
  Film,
  Images,
  Loader2,
  MoreVertical,
  Package,
  Plus,
  Trash2,
  Upload,
  UploadCloud,
} from 'lucide-react';
import { toast } from 'sonner';
import type { ContentType } from '@prisma/client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  attachContentAssetAction,
  deleteContentPackageAction,
  removeContentAssetAction,
  requestContentUploadUrlAction,
  updateContentPackageAction,
} from '@/server/actions/model';
import { cn, formatTokens } from '@/lib/utils';

interface PackageRow {
  id: string;
  title: string;
  description: string | null;
  type: ContentType;
  priceTokens: number;
  isPublished: boolean;
  subscriberOnly: boolean;
  previewUrl: string | null;
  /** URL firmada del primer archivo subido (si es una foto). */
  thumbnailUrl: string | null;
  assetCount: number;
  unlockCount: number;
  tokensEarned: number;
}

const TYPE_ICON: Record<ContentType, typeof Images> = {
  PHOTO: Images,
  VIDEO: Film,
  BUNDLE: Package,
};

export function ContentManager({
  packages,
  storageReady,
  subscriptionEnabled,
}: {
  packages: PackageRow[];
  storageReady: boolean;
  subscriptionEnabled: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [viewing, setViewing] = useState<PackageRow | null>(null);
  const [viewAssets, setViewAssets] = useState<
    Array<{ id: string; url: string; mimeType: string }>
  >([]);
  const [viewIndex, setViewIndex] = useState(0);
  const [loadingAssets, setLoadingAssets] = useState(false);
  const [removingAssetId, setRemovingAssetId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const targetPackageRef = useRef<string | null>(null);

  function togglePublish(pkg: PackageRow) {
    startTransition(async () => {
      const result = await updateContentPackageAction({
        packageId: pkg.id,
        isPublished: !pkg.isPublished,
      });
      if (result.ok) {
        toast.success(pkg.isPublished ? 'Paquete oculto' : 'Paquete publicado');
        router.refresh();
      } else {
        toast.error(result.error ?? 'No se pudo actualizar');
      }
    });
  }

  function remove(pkg: PackageRow) {
    if (pkg.unlockCount > 0) {
      toast.error(
        'No puedes borrar un paquete que ya ha sido comprado. Ocultalo en su lugar.',
      );
      return;
    }
    startTransition(async () => {
      const result = await deleteContentPackageAction(pkg.id);
      if (result.ok) {
        toast.success('Paquete eliminado');
        router.refresh();
      } else {
        toast.error(result.error ?? 'No se pudo eliminar');
      }
    });
  }

  function pickFiles(packageId: string) {
    if (!storageReady) {
      toast.error(
        'El almacenamiento no esta configurado. Define S3_* en tu .env (o levanta MinIO con docker compose).',
      );
      return;
    }
    targetPackageRef.current = packageId;
    fileInputRef.current?.click();
  }

  /** Sube directamente a S3/R2 con URL firmada y registra cada asset en BD. */
  async function uploadFiles(packageId: string, files: File[]) {
    if (!storageReady) {
      toast.error(
        'El almacenamiento no esta configurado. Define S3_* en tu .env (o levanta MinIO con docker compose).',
      );
      return;
    }
    if (files.length === 0) return;

    setUploadingId(packageId);

    for (const file of files) {
      try {
        const urlResult = await requestContentUploadUrlAction({
          packageId,
          filename: file.name,
          contentType: file.type || 'application/octet-stream',
        });

        if (!urlResult.ok || !urlResult.data) {
          toast.error(urlResult.error ?? 'No se pudo preparar la subida');
          break;
        }

        const upload = await fetch(urlResult.data.uploadUrl, {
          method: 'PUT',
          body: file,
          headers: { 'Content-Type': file.type || 'application/octet-stream' },
        });

        if (!upload.ok) {
          toast.error(`Fallo al subir ${file.name}`);
          continue;
        }

        await attachContentAssetAction({
          packageId,
          storageKey: urlResult.data.key,
          mimeType: file.type || 'application/octet-stream',
          sizeBytes: file.size,
        });

        toast.success(`${file.name} subido`);
      } catch {
        toast.error(`Error subiendo ${file.name}`);
      }
    }

    setUploadingId(null);
    router.refresh();
  }

  function handleFileInput(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    const packageId = targetPackageRef.current;
    if (packageId && files.length > 0) uploadFiles(packageId, files);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function handleDrop(packageId: string, event: React.DragEvent) {
    event.preventDefault();
    setDragOverId(null);
    const files = Array.from(event.dataTransfer.files ?? []).filter((f) =>
      /^(image|video)\//.test(f.type),
    );
    if (files.length === 0) {
      toast.error('Solta fotos o videos.');
      return;
    }
    uploadFiles(packageId, files);
  }

  async function openViewer(pkg: PackageRow) {
    setViewing(pkg);
    setViewAssets([]);
    setViewIndex(0);
    setLoadingAssets(true);
    try {
      const res = await fetch(`/api/content/${pkg.id}/assets`);
      const data = await res.json();
      setViewAssets(data.assets?.filter((a: any) => a.url) ?? []);
    } catch {
      toast.error('No se pudo cargar el contenido');
    } finally {
      setLoadingAssets(false);
    }
  }

  function removeAsset(assetId: string) {
    setRemovingAssetId(assetId);
    startTransition(async () => {
      const result = await removeContentAssetAction(assetId);
      if (result.ok) {
        toast.success(result.message ?? 'Archivo eliminado');
        setViewAssets((prev) => prev.filter((a) => a.id !== assetId));
        router.refresh();
      } else {
        toast.error(result.error ?? 'No se pudo eliminar');
      }
      setRemovingAssetId(null);
    });
  }

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/*,video/*"
        className="hidden"
        onChange={handleFileInput}
      />

      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {packages.length} paquete{packages.length === 1 ? '' : 's'}
        </p>
        {/* Ya no se crean packs: todo se publica en el feed desde el estudio. */}
        <Link href="/dashboard/model/posts?nuevo=1">
          <Button variant="brand">
            <Plus className="h-4 w-4" />
            Crear publicacion
          </Button>
        </Link>
      </div>

      {!storageReady && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-500">
          El almacenamiento de archivos no esta configurado. Puedes crear
          paquetes, pero para subir fotos y videos define las variables S3_* en
          tu <code>.env</code> (MinIO local ya viene en docker-compose).
        </div>
      )}

      {packages.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <Images className="mx-auto h-8 w-8 text-muted-foreground" />
            <p className="mt-3 font-medium">No tienes packs antiguos</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Ahora todo se publica en el feed: una sesion completa es una
              publicacion con varias fotos o videos.
            </p>
            <Link href="/dashboard/model/posts?nuevo=1" className="mt-4 inline-block">
              <Button variant="brand" size="sm">
                <Plus className="h-4 w-4" />
                Crear publicacion
              </Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-3 gap-1 sm:grid-cols-4 sm:gap-1.5 lg:grid-cols-5">
          {packages.map((pkg) => {
            const Icon = TYPE_ICON[pkg.type];
            return (
              <div key={pkg.id}>
                <div
                  className={cn(
                    'group relative aspect-square overflow-hidden rounded-md bg-muted transition-colors',
                    dragOverId === pkg.id && 'ring-2 ring-inset ring-primary',
                  )}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOverId(pkg.id);
                  }}
                  onDragLeave={() => setDragOverId(null)}
                  onDrop={(e) => handleDrop(pkg.id, e)}
                >
                  <button
                    type="button"
                    disabled={uploadingId === pkg.id}
                    onClick={() =>
                      pkg.assetCount > 0 ? openViewer(pkg) : pickFiles(pkg.id)
                    }
                    className="absolute inset-0 h-full w-full"
                  >
                    {uploadingId === pkg.id ? (
                      <span className="flex h-full w-full items-center justify-center text-muted-foreground">
                        <Loader2 className="h-6 w-6 animate-spin" />
                      </span>
                    ) : pkg.thumbnailUrl || pkg.previewUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={pkg.thumbnailUrl ?? pkg.previewUrl ?? ''}
                        alt={pkg.title}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <span className="flex h-full w-full flex-col items-center justify-center gap-1.5 text-muted-foreground transition-colors hover:text-foreground">
                        <UploadCloud className="h-6 w-6" />
                        <span className="px-2 text-center text-[11px] leading-tight">
                          Arrastra o hace clic
                        </span>
                      </span>
                    )}
                  </button>

                  {pkg.assetCount > 0 && (
                    <div className="pointer-events-none absolute inset-0 flex items-center justify-center gap-4 bg-black/0 opacity-0 transition-all group-hover:bg-black/50 group-hover:opacity-100">
                      <span className="flex items-center gap-1 text-sm font-semibold text-white">
                        <Icon className="h-4 w-4" />
                        {pkg.assetCount}
                      </span>
                      <span className="flex items-center gap-1 text-sm font-semibold text-white">
                        <Coins className="h-4 w-4" />
                        {formatTokens(pkg.tokensEarned)}
                      </span>
                    </div>
                  )}

                  {dragOverId === pkg.id && (
                    <div className="absolute inset-0 flex items-center justify-center bg-primary/20 backdrop-blur-sm">
                      <p className="rounded-md bg-background/90 px-2 py-1 text-center text-xs font-medium">
                        Solta para subir
                      </p>
                    </div>
                  )}

                  <Badge
                    variant={pkg.isPublished ? 'success' : 'muted'}
                    className="pointer-events-none absolute left-1 top-1 px-1.5 py-0 text-[10px]"
                  >
                    {pkg.isPublished ? 'Publicado' : 'Oculto'}
                  </Badge>
                  <Badge
                    variant={
                      pkg.subscriberOnly
                        ? 'vip'
                        : pkg.priceTokens === 0
                          ? 'secondary'
                          : 'token'
                    }
                    className="pointer-events-none absolute right-1 top-1 gap-1 px-1.5 py-0 text-[10px]"
                  >
                    {pkg.subscriberOnly ? (
                      'Suscriptores'
                    ) : pkg.priceTokens === 0 ? (
                      'Gratis'
                    ) : (
                      <>
                        <Coins className="h-2.5 w-2.5" />
                        {pkg.priceTokens}
                      </>
                    )}
                  </Badge>

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        onClick={(e) => e.stopPropagation()}
                        className="absolute bottom-1 right-1 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-black/50 text-white transition-colors hover:bg-black/70"
                        aria-label="Mas opciones"
                      >
                        <MoreVertical className="h-3.5 w-3.5" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => pickFiles(pkg.id)}>
                        <Upload className="h-4 w-4" />
                        Subir archivos
                      </DropdownMenuItem>
                      {pkg.assetCount > 0 && (
                        <DropdownMenuItem onClick={() => openViewer(pkg)}>
                          <Images className="h-4 w-4" />
                          Ver archivos
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem
                        disabled={isPending}
                        onClick={() => togglePublish(pkg)}
                      >
                        {pkg.isPublished ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                        {pkg.isPublished ? 'Ocultar' : 'Publicar'}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        disabled={isPending}
                        className="text-destructive focus:text-destructive"
                        onClick={() => remove(pkg)}
                      >
                        <Trash2 className="h-4 w-4" />
                        Eliminar paquete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                <div className="mt-1 px-0.5">
                  <p className="truncate text-xs font-medium">{pkg.title}</p>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {pkg.assetCount} archivo{pkg.assetCount === 1 ? '' : 's'} ·{' '}
                    {pkg.unlockCount} compra{pkg.unlockCount === 1 ? '' : 's'}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Visor de archivos del paquete, estilo carrusel */}
      <Dialog open={Boolean(viewing)} onOpenChange={(o) => !o && setViewing(null)}>
        <DialogContent className="max-w-lg gap-0 overflow-hidden border-none bg-black p-0 text-white sm:rounded-2xl">
          <DialogHeader className="sr-only">
            <DialogTitle>{viewing?.title}</DialogTitle>
            <DialogDescription>Visor de archivos del paquete.</DialogDescription>
          </DialogHeader>

          {loadingAssets ? (
            <div className="flex h-[50vh] items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-white/60" />
            </div>
          ) : viewAssets.length === 0 ? (
            <p className="flex h-[40vh] items-center justify-center px-8 text-center text-sm text-white/60">
              No hay archivos en este paquete.
            </p>
          ) : (
            (() => {
              const index = Math.min(viewIndex, viewAssets.length - 1);
              const asset = viewAssets[index];
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
                    {index < viewAssets.length - 1 && (
                      <button
                        type="button"
                        onClick={() => setViewIndex(index + 1)}
                        className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-white transition-colors hover:bg-black/70"
                        aria-label="Siguiente"
                      >
                        <ChevronRight className="h-5 w-5" />
                      </button>
                    )}

                    <Button
                      size="icon"
                      variant="destructive"
                      className="absolute right-3 top-3 h-8 w-8"
                      disabled={removingAssetId === asset.id}
                      onClick={() => removeAsset(asset.id)}
                      aria-label="Borrar archivo"
                    >
                      {removingAssetId === asset.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="h-3.5 w-3.5" />
                      )}
                    </Button>
                  </div>

                  <div className="flex items-center justify-between gap-3 bg-black px-4 py-3">
                    {viewAssets.length > 1 ? (
                      <div className="flex gap-1.5">
                        {viewAssets.map((a, i) => (
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
                      {index + 1}/{viewAssets.length}
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
