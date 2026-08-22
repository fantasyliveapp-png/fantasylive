'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  AlertOctagon,
  Ban,
  CheckCircle2,
  Coins,
  ExternalLink,
  Loader2,
  XCircle,
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  CALL_TYPE_LABELS,
  REPORT_REASON_LABELS,
  REPORT_STATUS_LABELS,
} from '@/lib/constants';
import { moderateUserAction, resolveReportAction } from '@/server/actions/admin';
import { formatDateTime, formatDuration, formatTokens } from '@/lib/utils';

interface ReportRow {
  id: string;
  reason: string;
  status: string;
  details: string | null;
  createdAt: string;
  reporter: { id: string; name: string | null; email: string };
  reported: {
    id: string;
    name: string | null;
    email: string;
    status: string;
    slug: string | null;
  };
  session: {
    id: string;
    type: string;
    billedSeconds: number;
    tokensSpent: number;
    createdAt: string;
  } | null;
}

const URGENT_REASONS = ['UNDERAGE', 'NON_CONSENSUAL'];

const STATUS_VARIANT: Record<string, any> = {
  OPEN: 'warning',
  UNDER_REVIEW: 'secondary',
  RESOLVED: 'success',
  DISMISSED: 'muted',
  ESCALATED: 'destructive',
};

export function ReportsReviewList({ reports }: { reports: ReportRow[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [resolving, setResolving] = useState<ReportRow | null>(null);
  const [resolution, setResolution] = useState('');
  const [refundTokens, setRefundTokens] = useState(0);

  function resolve(
    report: ReportRow,
    status: 'RESOLVED' | 'DISMISSED' | 'ESCALATED' | 'UNDER_REVIEW',
    extra?: { resolution?: string; refundTokens?: number; actionTaken?: string },
  ) {
    startTransition(async () => {
      const result = await resolveReportAction({
        reportId: report.id,
        status,
        ...extra,
      });

      if (result.ok) {
        toast.success(result.message ?? 'Reporte actualizado');
        setResolving(null);
        setResolution('');
        setRefundTokens(0);
        router.refresh();
      } else {
        toast.error(result.error ?? 'No se pudo actualizar');
      }
    });
  }

  function banReported(report: ReportRow) {
    startTransition(async () => {
      const result = await moderateUserAction({
        userId: report.reported.id,
        action: 'BAN',
        reason: `Baneado por reporte: ${REPORT_REASON_LABELS[report.reason as keyof typeof REPORT_REASON_LABELS]}`,
      });

      if (result.ok) {
        toast.success('Cuenta baneada');
        await resolveReportAction({
          reportId: report.id,
          status: 'RESOLVED',
          resolution: 'Cuenta baneada tras verificar el reporte.',
          actionTaken: 'BAN',
        });
        router.refresh();
      } else {
        toast.error(result.error ?? 'No se pudo banear');
      }
    });
  }

  return (
    <>
      <div className="space-y-4">
        {reports.map((report) => {
          const isUrgent = URGENT_REASONS.includes(report.reason);

          return (
            <Card
              key={report.id}
              className={isUrgent ? 'border-destructive bg-destructive/5' : ''}
            >
              <CardContent className="space-y-4 py-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    {isUrgent && (
                      <Badge variant="destructive" className="gap-1">
                        <AlertOctagon className="h-3 w-3" />
                        URGENTE
                      </Badge>
                    )}
                    <Badge variant="outline">
                      {REPORT_REASON_LABELS[
                        report.reason as keyof typeof REPORT_REASON_LABELS
                      ]}
                    </Badge>
                    <Badge variant={STATUS_VARIANT[report.status] ?? 'muted'}>
                      {REPORT_STATUS_LABELS[
                        report.status as keyof typeof REPORT_STATUS_LABELS
                      ]}
                    </Badge>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {formatDateTime(new Date(report.createdAt))}
                  </span>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="rounded-lg border border-border p-3">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Reporta
                    </p>
                    <p className="mt-1 text-sm font-medium">
                      {report.reporter.name ?? 'Usuario'}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {report.reporter.email}
                    </p>
                  </div>

                  <div className="rounded-lg border border-border p-3">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Reportado
                    </p>
                    <div className="mt-1 flex items-center gap-2">
                      <p className="text-sm font-medium">
                        {report.reported.name ?? 'Usuario'}
                      </p>
                      {report.reported.status !== 'ACTIVE' && (
                        <Badge variant="destructive" className="text-[10px]">
                          {report.reported.status}
                        </Badge>
                      )}
                      {report.reported.slug && (
                        <Link
                          href={`/models/${report.reported.slug}`}
                          target="_blank"
                          className="text-muted-foreground hover:text-foreground"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                        </Link>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {report.reported.email}
                    </p>
                  </div>
                </div>

                {report.details && (
                  <div className="rounded-lg bg-muted/50 p-3">
                    <p className="text-sm italic text-muted-foreground">
                      &ldquo;{report.details}&rdquo;
                    </p>
                  </div>
                )}

                {report.session && (
                  <div className="flex flex-wrap items-center gap-4 rounded-lg border border-border px-3 py-2 text-xs text-muted-foreground">
                    <span>
                      Llamada:{' '}
                      {
                        CALL_TYPE_LABELS[
                          report.session.type as keyof typeof CALL_TYPE_LABELS
                        ]
                      }
                    </span>
                    <span>
                      Duracion: {formatDuration(report.session.billedSeconds)}
                    </span>
                    <span className="flex items-center gap-1">
                      <Coins className="h-3 w-3" />
                      {formatTokens(report.session.tokensSpent)} tokens
                    </span>
                    <span>{formatDateTime(new Date(report.session.createdAt))}</span>
                  </div>
                )}

                <div className="flex flex-wrap gap-2">
                  {report.status === 'OPEN' && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={isPending}
                      onClick={() => resolve(report, 'UNDER_REVIEW')}
                    >
                      Marcar en revision
                    </Button>
                  )}

                  <Button
                    variant="brand"
                    size="sm"
                    disabled={isPending}
                    onClick={() => {
                      setResolving(report);
                      setRefundTokens(report.session?.tokensSpent ?? 0);
                    }}
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    Resolver
                  </Button>

                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={isPending}
                    onClick={() =>
                      resolve(report, 'DISMISSED', {
                        resolution: 'Sin evidencia suficiente.',
                      })
                    }
                  >
                    <XCircle className="h-4 w-4" />
                    Descartar
                  </Button>

                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={isPending || report.reported.status === 'BANNED'}
                    onClick={() => banReported(report)}
                  >
                    {isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Ban className="h-4 w-4" />
                    )}
                    Banear reportado
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Dialogo de resolucion */}
      <Dialog open={Boolean(resolving)} onOpenChange={(o) => !o && setResolving(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Resolver reporte</DialogTitle>
            <DialogDescription>
              Puedes reembolsar tokens al usuario que reporta. El reembolso se
              carga a la plataforma, no a la modelo.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="resolution">Resolucion</Label>
              <Textarea
                id="resolution"
                value={resolution}
                onChange={(e) => setResolution(e.target.value)}
                placeholder="Describe la decision tomada..."
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="refund">Tokens a reembolsar (0 = ninguno)</Label>
              <Input
                id="refund"
                type="number"
                min={0}
                value={refundTokens}
                onChange={(e) => setRefundTokens(Number(e.target.value))}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setResolving(null)}>
              Cancelar
            </Button>
            <Button
              variant="brand"
              disabled={isPending}
              onClick={() =>
                resolving &&
                resolve(resolving, 'RESOLVED', {
                  resolution: resolution || 'Reporte resuelto.',
                  refundTokens,
                  actionTaken: refundTokens > 0 ? 'REFUND' : 'NONE',
                })
              }
            >
              {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Confirmar resolucion
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
