import type { Metadata } from 'next';
import { BadgeCheck, Clock, ShieldAlert, XCircle } from 'lucide-react';

import { KycForm } from '@/components/model/kyc-form';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { requireModel } from '@/lib/auth/guards';
import { KYC_STATUS_LABELS } from '@/lib/constants';
import { isStorageConfigured } from '@/lib/storage';
import { prisma } from '@/lib/prisma';
import { formatDateTime } from '@/lib/utils';

export const metadata: Metadata = { title: 'Verificacion KYC' };
export const dynamic = 'force-dynamic';

export default async function KycPage() {
  const { profile } = await requireModel();

  const history = await prisma.kycVerification.findMany({
    where: { modelId: profile.id },
    orderBy: { submittedAt: 'desc' },
  });

  const latest = history[0];
  const canSubmit =
    profile.kycStatus === 'NOT_SUBMITTED' ||
    profile.kycStatus === 'REJECTED' ||
    profile.kycStatus === 'EXPIRED';

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">
          Verificacion de identidad
        </h1>
        <p className="mt-2 text-muted-foreground">
          Obligatoria por ley (18 U.S.C. 2257) para emitir y cobrar. Tus
          documentos son privados y solo los ve el equipo de compliance.
        </p>
      </div>

      {/* Estado actual */}
      <Card
        className={
          profile.kycStatus === 'APPROVED'
            ? 'border-emerald-600/40 bg-emerald-600/5'
            : profile.kycStatus === 'PENDING'
              ? 'border-amber-500/40 bg-amber-500/5'
              : profile.kycStatus === 'REJECTED'
                ? 'border-destructive/40 bg-destructive/5'
                : ''
        }
      >
        <CardContent className="flex flex-wrap items-center gap-4 py-5">
          {profile.kycStatus === 'APPROVED' ? (
            <BadgeCheck className="h-8 w-8 text-emerald-500" />
          ) : profile.kycStatus === 'PENDING' ? (
            <Clock className="h-8 w-8 text-amber-500" />
          ) : profile.kycStatus === 'REJECTED' ? (
            <XCircle className="h-8 w-8 text-destructive" />
          ) : (
            <ShieldAlert className="h-8 w-8 text-muted-foreground" />
          )}

          <div className="flex-1">
            <p className="font-semibold">
              Estado: {KYC_STATUS_LABELS[profile.kycStatus]}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {profile.kycStatus === 'APPROVED'
                ? 'Tu cuenta esta verificada. Puedes emitir, recibir reservas y retirar dinero.'
                : profile.kycStatus === 'PENDING'
                  ? 'Estamos revisando tu documentacion. El proceso tarda entre 24 y 48 horas.'
                  : profile.kycStatus === 'REJECTED'
                    ? (latest?.rejectionReason ??
                      'Tu verificacion fue rechazada. Revisa los documentos y vuelve a enviarla.')
                    : 'Envia tu documentacion para poder empezar a emitir.'}
            </p>
          </div>

          {latest && (
            <div className="text-right text-xs text-muted-foreground">
              <p>Enviado: {formatDateTime(latest.submittedAt)}</p>
              {latest.reviewedAt && (
                <p>Revisado: {formatDateTime(latest.reviewedAt)}</p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {canSubmit && (
        <KycForm
          storageReady={isStorageConfigured()}
          defaultName={profile.stageName}
          defaultCountry={profile.country ?? ''}
        />
      )}

      {history.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Historial de verificaciones</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-3">
              {history.map((entry) => (
                <li
                  key={entry.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border px-4 py-3"
                >
                  <div>
                    <p className="text-sm font-medium">{entry.fullLegalName}</p>
                    <p className="text-xs text-muted-foreground">
                      {entry.documentType} · {entry.country} ·{' '}
                      {formatDateTime(entry.submittedAt)}
                    </p>
                    {entry.rejectionReason && (
                      <p className="mt-1 text-xs text-destructive">
                        {entry.rejectionReason}
                      </p>
                    )}
                  </div>
                  <Badge
                    variant={
                      entry.status === 'APPROVED'
                        ? 'success'
                        : entry.status === 'PENDING'
                          ? 'warning'
                          : 'destructive'
                    }
                  >
                    {KYC_STATUS_LABELS[entry.status]}
                  </Badge>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
