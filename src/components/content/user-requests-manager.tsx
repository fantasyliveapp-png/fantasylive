'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Coins, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';
import type { ContentRequestStatus } from '@prisma/client';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  cancelContentRequestAction,
  payContentRequestAction,
} from '@/server/actions/content-requests';
import { CONTENT_REQUEST_STATUS_LABELS } from '@/lib/constants';
import { formatTokens, initials, relativeTime } from '@/lib/utils';

interface RequestRow {
  id: string;
  status: ContentRequestStatus;
  description: string;
  quotedTokens: number | null;
  modelNote: string | null;
  createdAt: string;
  deliveredPackageId: string | null;
  modelStageName: string;
  modelSlug: string;
  modelAvatarUrl: string | null;
}

const STATUS_VARIANT: Record<ContentRequestStatus, any> = {
  PENDING: 'warning',
  QUOTED: 'token',
  PAID: 'success',
  DELIVERED: 'muted',
  DECLINED: 'destructive',
  CANCELLED: 'muted',
};

export function UserRequestsManager({ requests }: { requests: RequestRow[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [paying, setPaying] = useState<RequestRow | null>(null);
  const [viewing, setViewing] = useState<RequestRow | null>(null);
  const [assets, setAssets] = useState<
    Array<{ id: string; url: string; mimeType: string }>
  >([]);
  const [loadingAssets, setLoadingAssets] = useState(false);

  async function openViewer(request: RequestRow) {
    setViewing(request);
    setAssets([]);
    setLoadingAssets(true);
    try {
      const res = await fetch(`/api/content/${request.deliveredPackageId}/assets`);
      const data = await res.json();
      setAssets(data.assets?.filter((a: any) => a.url) ?? []);
    } catch {
      toast.error('No se pudo cargar el contenido');
    } finally {
      setLoadingAssets(false);
    }
  }

  function pay() {
    if (!paying) return;
    startTransition(async () => {
      const result = await payContentRequestAction(paying.id);
      if (result.ok) {
        toast.success(result.message ?? 'Pagado');
        setPaying(null);
        router.refresh();
      } else {
        toast.error(result.error ?? 'No se pudo pagar');
      }
    });
  }

  function cancel(requestId: string) {
    startTransition(async () => {
      const result = await cancelContentRequestAction(requestId);
      if (result.ok) {
        toast.success(result.message ?? 'Cancelado');
        router.refresh();
      } else {
        toast.error(result.error ?? 'No se pudo cancelar');
      }
    });
  }

  if (requests.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
        Todavia no pediste contenido a medida. Entra al perfil de una modelo
        para pedirle algo.
      </p>
    );
  }

  return (
    <>
      <div className="space-y-4">
        {requests.map((request) => (
          <Card key={request.id}>
            <CardContent className="space-y-3 pt-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <Link
                  href={`/models/${request.modelSlug}`}
                  className="flex items-center gap-2.5"
                >
                  <Avatar className="h-9 w-9">
                    {request.modelAvatarUrl && (
                      <AvatarImage src={request.modelAvatarUrl} alt="" />
                    )}
                    <AvatarFallback>{initials(request.modelStageName)}</AvatarFallback>
                  </Avatar>
                  <div>
                    <p className="text-sm font-medium">{request.modelStageName}</p>
                    <p className="text-xs text-muted-foreground">
                      {relativeTime(request.createdAt)}
                    </p>
                  </div>
                </Link>
                <Badge variant={STATUS_VARIANT[request.status]}>
                  {CONTENT_REQUEST_STATUS_LABELS[request.status]}
                </Badge>
              </div>

              <p className="rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">
                {request.description}
              </p>

              {request.modelNote && (
                <p className="text-xs text-muted-foreground">
                  Nota de la modelo: {request.modelNote}
                </p>
              )}

              {request.status === 'QUOTED' && request.quotedTokens && (
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
                  <p className="flex items-center gap-1.5 text-sm font-semibold text-token">
                    <Coins className="h-4 w-4" />
                    {formatTokens(request.quotedTokens)} tokens
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      onClick={() => cancel(request.id)}
                      disabled={isPending}
                    >
                      <X className="h-4 w-4" />
                      Cancelar
                    </Button>
                    <Button variant="token" size="sm" onClick={() => setPaying(request)}>
                      <Coins className="h-4 w-4" />
                      Pagar {request.quotedTokens}
                    </Button>
                  </div>
                </div>
              )}

              {request.status === 'PENDING' && (
                <div className="flex justify-end border-t border-border pt-3">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    onClick={() => cancel(request.id)}
                    disabled={isPending}
                  >
                    <X className="h-4 w-4" />
                    Cancelar pedido
                  </Button>
                </div>
              )}

              {request.status === 'DELIVERED' && request.deliveredPackageId && (
                <div className="border-t border-border pt-3">
                  <Button size="sm" onClick={() => openViewer(request)}>
                    Ver contenido
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={Boolean(paying)} onOpenChange={(o) => !o && setPaying(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Pagar pedido</DialogTitle>
            <DialogDescription>
              Se descontaran{' '}
              <strong className="text-token">{paying?.quotedTokens} tokens</strong>{' '}
              de tu monedero. {paying?.modelStageName} entregara el contenido
              despues del pago.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPaying(null)}>
              Cancelar
            </Button>
            <Button variant="token" onClick={pay} disabled={isPending}>
              {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              <Coins className="h-4 w-4" />
              Pagar {paying?.quotedTokens} tokens
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(viewing)} onOpenChange={(o) => !o && setViewing(null)}>
        <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Pedido entregado</DialogTitle>
            <DialogDescription>{viewing?.description}</DialogDescription>
          </DialogHeader>

          {loadingAssets ? (
            <div className="flex justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : assets.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              No hay archivos disponibles.
            </p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {assets.map((asset) =>
                asset.mimeType.startsWith('video') ? (
                  <video key={asset.id} src={asset.url} controls className="w-full rounded-lg" />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={asset.id} src={asset.url} alt="" className="w-full rounded-lg object-cover" />
                ),
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
