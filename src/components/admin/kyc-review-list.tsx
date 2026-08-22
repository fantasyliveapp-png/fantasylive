'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Calendar,
  Check,
  ExternalLink,
  Eye,
  FileText,
  Loader2,
  Mail,
  X,
} from 'lucide-react';
import { toast } from 'sonner';

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
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  getKycDocumentUrlsAction,
  reviewKycAction,
} from '@/server/actions/admin';
import { calculateAge, formatDate, formatDateTime } from '@/lib/utils';

interface KycItem {
  id: string;
  status: string;
  fullLegalName: string;
  birthDate: string;
  country: string;
  documentType: string;
  documentNumber: string | null;
  submittedAt: string;
  hasBack: boolean;
  hasNote: boolean;
  model: {
    stageName: string;
    slug: string;
    email: string;
    country: string | null;
    registeredAt: string;
  };
}

const DOC_LABELS: Record<string, string> = {
  PASSPORT: 'Pasaporte',
  NATIONAL_ID: 'DNI',
  DRIVERS_LICENSE: 'Carnet de conducir',
};

export function KycReviewList({ items }: { items: KycItem[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [viewing, setViewing] = useState<KycItem | null>(null);
  const [docs, setDocs] = useState<Record<string, string | null>>({});
  const [loadingDocs, setLoadingDocs] = useState(false);

  const [rejecting, setRejecting] = useState<KycItem | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  async function openDocuments(item: KycItem) {
    setViewing(item);
    setDocs({});
    setLoadingDocs(true);

    const result = await getKycDocumentUrlsAction(item.id);
    setLoadingDocs(false);

    if (result.ok && result.data) {
      setDocs(result.data);
    } else {
      toast.error(
        result.error ??
          'No se pudieron cargar los documentos (revisa la configuracion S3).',
      );
    }
  }

  function approve(item: KycItem) {
    startTransition(async () => {
      const result = await reviewKycAction({
        kycId: item.id,
        decision: 'APPROVED',
        notes: 'Documentacion verificada. Registro 2257 archivado.',
      });

      if (result.ok) {
        toast.success(result.message ?? 'KYC aprobado');
        setViewing(null);
        router.refresh();
      } else {
        toast.error(result.error ?? 'No se pudo aprobar');
      }
    });
  }

  function reject() {
    if (!rejecting) return;
    if (rejectReason.trim().length < 10) {
      toast.error('Explica el motivo del rechazo (minimo 10 caracteres).');
      return;
    }

    startTransition(async () => {
      const result = await reviewKycAction({
        kycId: rejecting.id,
        decision: 'REJECTED',
        rejectionReason: rejectReason.trim(),
        notes: rejectReason.trim(),
      });

      if (result.ok) {
        toast.success(result.message ?? 'KYC rechazado');
        setRejecting(null);
        setRejectReason('');
        setViewing(null);
        router.refresh();
      } else {
        toast.error(result.error ?? 'No se pudo rechazar');
      }
    });
  }

  return (
    <>
      <div className="space-y-4">
        {items.map((item) => {
          const age = calculateAge(new Date(item.birthDate));
          const isMinor = age < 18;

          return (
            <Card key={item.id} className={isMinor ? 'border-destructive' : ''}>
              <CardContent className="flex flex-wrap items-start gap-4 py-5">
                <div className="min-w-[220px] flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold">{item.fullLegalName}</p>
                    <Badge variant="muted">{item.model.stageName}</Badge>
                    {isMinor && (
                      <Badge variant="destructive">MENOR DE EDAD</Badge>
                    )}
                  </div>

                  <div className="mt-2 grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
                    <span className="flex items-center gap-1.5">
                      <Mail className="h-3.5 w-3.5" />
                      {item.model.email}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <Calendar className="h-3.5 w-3.5" />
                      {formatDate(new Date(item.birthDate))} ({age} anos)
                    </span>
                    <span className="flex items-center gap-1.5">
                      <FileText className="h-3.5 w-3.5" />
                      {DOC_LABELS[item.documentType] ?? item.documentType}
                      {item.documentNumber ? ` · ${item.documentNumber}` : ''}
                    </span>
                    <span>
                      Pais: {item.country} · Enviado{' '}
                      {formatDateTime(new Date(item.submittedAt))}
                    </span>
                  </div>

                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <Badge variant="muted">Anverso</Badge>
                    {item.hasBack && <Badge variant="muted">Reverso</Badge>}
                    <Badge variant="muted">Selfie</Badge>
                    {item.hasNote && <Badge variant="muted">Nota manuscrita</Badge>}
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Link href={`/models/${item.model.slug}`} target="_blank">
                    <Button variant="ghost" size="sm">
                      <ExternalLink className="h-4 w-4" />
                      Perfil
                    </Button>
                  </Link>

                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => openDocuments(item)}
                  >
                    <Eye className="h-4 w-4" />
                    Ver documentos
                  </Button>

                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={isPending}
                    onClick={() => setRejecting(item)}
                  >
                    <X className="h-4 w-4" />
                    Rechazar
                  </Button>

                  <Button
                    variant="brand"
                    size="sm"
                    disabled={isPending || isMinor}
                    onClick={() => approve(item)}
                  >
                    {isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Check className="h-4 w-4" />
                    )}
                    Aprobar
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Visor de documentos */}
      <Dialog open={Boolean(viewing)} onOpenChange={(o) => !o && setViewing(null)}>
        <DialogContent className="max-h-[85vh] max-w-4xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Documentos de {viewing?.fullLegalName}</DialogTitle>
            <DialogDescription>
              Las URLs son temporales y caducan automaticamente. Verifica que la
              cara del selfie coincide con el documento.
            </DialogDescription>
          </DialogHeader>

          {loadingDocs ? (
            <div className="flex justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {(
                [
                  ['front', 'Documento (anverso)'],
                  ['back', 'Documento (reverso)'],
                  ['selfie', 'Selfie con documento'],
                  ['note', 'Nota manuscrita'],
                ] as const
              ).map(([key, label]) =>
                docs[key] ? (
                  <div key={key}>
                    <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      {label}
                    </p>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={docs[key]!}
                      alt={label}
                      className="w-full rounded-lg border border-border"
                    />
                  </div>
                ) : null,
              )}

              {Object.values(docs).every((v) => !v) && (
                <p className="col-span-2 py-10 text-center text-sm text-muted-foreground">
                  No se pudieron generar las URLs firmadas. Verifica que el
                  almacenamiento S3/R2 este configurado.
                </p>
              )}
            </div>
          )}

          <DialogFooter>
            <Button
              variant="destructive"
              onClick={() => {
                setRejecting(viewing);
              }}
            >
              <X className="h-4 w-4" />
              Rechazar
            </Button>
            <Button
              variant="brand"
              disabled={isPending}
              onClick={() => viewing && approve(viewing)}
            >
              {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              <Check className="h-4 w-4" />
              Aprobar verificacion
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialogo de rechazo */}
      <Dialog
        open={Boolean(rejecting)}
        onOpenChange={(o) => {
          if (!o) {
            setRejecting(null);
            setRejectReason('');
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Rechazar verificacion</DialogTitle>
            <DialogDescription>
              El motivo se mostrara a la modelo para que pueda corregirlo y
              volver a enviarlo.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="reason">Motivo del rechazo</Label>
            <Textarea
              id="reason"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Ej: la foto del documento esta borrosa y no se lee la fecha de nacimiento."
              className="min-h-[100px]"
            />
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setRejecting(null)}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={reject} disabled={isPending}>
              {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Confirmar rechazo
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
