'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Coins, Gift, Loader2, Send, X } from 'lucide-react';
import { toast } from 'sonner';
import type { ContentRequestStatus } from '@prisma/client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  declineContentRequestAction,
  deliverContentRequestAction,
  quoteContentRequestAction,
} from '@/server/actions/content-requests';
import { CONTENT_REQUEST_STATUS_LABELS } from '@/lib/constants';
import { formatTokens, relativeTime } from '@/lib/utils';

interface RequestRow {
  id: string;
  status: ContentRequestStatus;
  description: string;
  quotedTokens: number | null;
  modelNote: string | null;
  createdAt: string;
  userName: string;
}

interface PackageOption {
  id: string;
  title: string;
  assetCount: number;
}

const STATUS_VARIANT: Record<ContentRequestStatus, any> = {
  PENDING: 'warning',
  QUOTED: 'token',
  PAID: 'success',
  DELIVERED: 'muted',
  DECLINED: 'destructive',
  CANCELLED: 'muted',
};

export function RequestsManager({
  requests,
  unpublishedPackages,
}: {
  requests: RequestRow[];
  unpublishedPackages: PackageOption[];
}) {
  if (requests.length === 0) {
    return (
      <Card>
        <CardContent className="py-16 text-center">
          <Gift className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-3 font-medium">Todavia no recibiste pedidos</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Cuando alguien pida contenido a medida desde tu perfil, aparece
            aca.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {requests.map((request) => (
        <RequestCard
          key={request.id}
          request={request}
          unpublishedPackages={unpublishedPackages}
        />
      ))}
    </div>
  );
}

function RequestCard({
  request,
  unpublishedPackages,
}: {
  request: RequestRow;
  unpublishedPackages: PackageOption[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [quotedTokens, setQuotedTokens] = useState(request.quotedTokens ?? 100);
  const [note, setNote] = useState('');
  const [packageId, setPackageId] = useState('');

  function quote() {
    startTransition(async () => {
      const result = await quoteContentRequestAction({
        requestId: request.id,
        quotedTokens,
        note: note.trim() || undefined,
      });
      if (result.ok) {
        toast.success(result.message ?? 'Cotizacion enviada');
        router.refresh();
      } else {
        toast.error(result.error ?? 'No se pudo cotizar');
      }
    });
  }

  function decline() {
    startTransition(async () => {
      const result = await declineContentRequestAction({ requestId: request.id });
      if (result.ok) {
        toast.success(result.message ?? 'Pedido rechazado');
        router.refresh();
      } else {
        toast.error(result.error ?? 'No se pudo rechazar');
      }
    });
  }

  function deliver() {
    if (!packageId) {
      toast.error('Elegi el paquete oculto que subiste para este pedido.');
      return;
    }
    startTransition(async () => {
      const result = await deliverContentRequestAction({
        requestId: request.id,
        packageId,
      });
      if (result.ok) {
        toast.success(result.message ?? 'Pedido entregado');
        router.refresh();
      } else {
        toast.error(result.error ?? 'No se pudo entregar');
      }
    });
  }

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="font-medium">{request.userName}</p>
            <p className="text-xs text-muted-foreground">
              {relativeTime(request.createdAt)}
            </p>
          </div>
          <Badge variant={STATUS_VARIANT[request.status]}>
            {CONTENT_REQUEST_STATUS_LABELS[request.status]}
          </Badge>
        </div>

        <p className="rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">
          {request.description}
        </p>

        {request.quotedTokens && (
          <p className="flex items-center gap-1.5 text-sm font-semibold text-token">
            <Coins className="h-4 w-4" />
            Cotizado: {formatTokens(request.quotedTokens)} tokens
          </p>
        )}

        {request.status === 'PENDING' && (
          <div className="flex flex-wrap items-end gap-3 border-t border-border pt-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                Precio (tokens)
              </label>
              <div className="relative">
                <Coins className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-token" />
                <Input
                  type="number"
                  min={1}
                  value={quotedTokens}
                  onChange={(e) => setQuotedTokens(Number(e.target.value))}
                  className="w-32 pl-9"
                />
              </div>
            </div>
            <div className="flex-1 space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                Nota (opcional)
              </label>
              <Input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Que incluye, tiempos de entrega..."
              />
            </div>
            <Button variant="brand" onClick={quote} disabled={isPending}>
              {isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
              Cotizar
            </Button>
            <Button
              variant="ghost"
              className="text-destructive hover:text-destructive"
              onClick={decline}
              disabled={isPending}
            >
              <X className="h-4 w-4" />
              Rechazar
            </Button>
          </div>
        )}

        {request.status === 'QUOTED' && (
          <div className="flex items-center justify-between border-t border-border pt-4">
            <p className="text-xs text-muted-foreground">
              Esperando que el usuario pague la cotizacion.
            </p>
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={decline}
              disabled={isPending}
            >
              <X className="h-4 w-4" />
              Rechazar
            </Button>
          </div>
        )}

        {request.status === 'PAID' && (
          <div className="space-y-3 border-t border-border pt-4">
            <p className="text-xs text-muted-foreground">
              Ya cobraste. Sube el archivo como paquete oculto en{' '}
              <span className="font-medium text-foreground">Contenido</span> y
              elegilo aca para entregarlo.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <Select value={packageId} onValueChange={setPackageId}>
                <SelectTrigger className="w-64">
                  <SelectValue placeholder="Elegi el paquete oculto..." />
                </SelectTrigger>
                <SelectContent>
                  {unpublishedPackages.length === 0 ? (
                    <div className="px-3 py-2 text-xs text-muted-foreground">
                      No tenes paquetes ocultos todavia.
                    </div>
                  ) : (
                    unpublishedPackages.map((pkg) => (
                      <SelectItem key={pkg.id} value={pkg.id}>
                        {pkg.title} ({pkg.assetCount} archivos)
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
              <Button variant="brand" onClick={deliver} disabled={isPending}>
                {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                Entregar
              </Button>
            </div>
          </div>
        )}

        {request.modelNote && request.status !== 'PENDING' && (
          <p className="text-xs text-muted-foreground">
            Tu nota: {request.modelNote}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
