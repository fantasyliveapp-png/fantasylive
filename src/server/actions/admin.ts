'use server';

import { revalidatePath } from 'next/cache';
import type { KycStatus, PayoutStatus, ReportStatus } from '@prisma/client';

import { getAuthedUserOrThrow } from '@/lib/auth/guards';
import { prisma } from '@/lib/prisma';
import { applyLedgerEntry } from '@/lib/tokens';
import { createDownloadUrl } from '@/lib/storage';

export interface AdminActionResult<T = unknown> {
  ok: boolean;
  error?: string;
  message?: string;
  data?: T;
}

async function requireAdminUser() {
  const user = await getAuthedUserOrThrow();
  if (user.role !== 'ADMIN') throw new Error('FORBIDDEN');
  return user;
}

async function audit(
  actorId: string,
  action: string,
  entityType: string,
  entityId?: string,
  metadata?: Record<string, unknown>,
) {
  await prisma.auditLog.create({
    data: { actorId, action, entityType, entityId, metadata: metadata as any },
  });
}

// ---------------------------------------------------------------------------
// KYC
// ---------------------------------------------------------------------------

export async function reviewKycAction(input: {
  kycId: string;
  decision: 'APPROVED' | 'REJECTED';
  notes?: string;
  rejectionReason?: string;
}): Promise<AdminActionResult> {
  try {
    const admin = await requireAdminUser();

    const kyc = await prisma.kycVerification.findUnique({
      where: { id: input.kycId },
      include: { model: { select: { id: true, userId: true, stageName: true } } },
    });
    if (!kyc) return { ok: false, error: 'Verificacion no encontrada.' };
    if (kyc.status !== 'PENDING') {
      return { ok: false, error: 'Esta verificacion ya fue revisada.' };
    }

    const status: KycStatus = input.decision;

    await prisma.$transaction([
      prisma.kycVerification.update({
        where: { id: kyc.id },
        data: {
          status,
          reviewerId: admin.id,
          reviewedAt: new Date(),
          reviewNotes: input.notes ?? null,
          rejectionReason:
            input.decision === 'REJECTED' ? (input.rejectionReason ?? null) : null,
          // Los KYC caducan al ano
          expiresAt:
            input.decision === 'APPROVED'
              ? new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
              : null,
        },
      }),
      prisma.modelProfile.update({
        where: { id: kyc.model.id },
        data: {
          kycStatus: status,
          // Aprobar habilita reservas; rechazar corta la emision
          ...(input.decision === 'APPROVED'
            ? { acceptsBookings: true }
            : {
                isOnline: false,
                isAvailableForVip: false,
                isVipEnabled: false,
                acceptsBookings: false,
              }),
        },
      }),
      prisma.user.update({
        where: { id: kyc.model.userId },
        data: { ageVerified: input.decision === 'APPROVED' },
      }),
    ]);

    await audit(admin.id, `KYC_${input.decision}`, 'KycVerification', kyc.id, {
      model: kyc.model.stageName,
    });

    revalidatePath('/admin/kyc');
    revalidatePath('/models');
    return {
      ok: true,
      message:
        input.decision === 'APPROVED'
          ? `KYC aprobado para ${kyc.model.stageName}.`
          : `KYC rechazado para ${kyc.model.stageName}.`,
    };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

/** URLs firmadas temporales para revisar los documentos de un KYC. */
export async function getKycDocumentUrlsAction(
  kycId: string,
): Promise<AdminActionResult<Record<string, string | null>>> {
  try {
    await requireAdminUser();

    const kyc = await prisma.kycVerification.findUnique({
      where: { id: kycId },
      select: {
        documentFrontKey: true,
        documentBackKey: true,
        selfieKey: true,
        handwrittenNoteKey: true,
      },
    });
    if (!kyc) return { ok: false, error: 'Verificacion no encontrada.' };

    const [front, back, selfie, note] = await Promise.all([
      createDownloadUrl(kyc.documentFrontKey),
      kyc.documentBackKey ? createDownloadUrl(kyc.documentBackKey) : null,
      createDownloadUrl(kyc.selfieKey),
      kyc.handwrittenNoteKey ? createDownloadUrl(kyc.handwrittenNoteKey) : null,
    ]);

    return { ok: true, data: { front, back, selfie, note } };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

// ---------------------------------------------------------------------------
// USUARIOS
// ---------------------------------------------------------------------------

export async function moderateUserAction(input: {
  userId: string;
  action: 'SUSPEND' | 'BAN' | 'REINSTATE' | 'PROMOTE_VIP' | 'DEMOTE_VIP';
  reason?: string;
  suspensionHours?: number;
}): Promise<AdminActionResult> {
  try {
    const admin = await requireAdminUser();

    if (input.userId === admin.id) {
      return { ok: false, error: 'No puedes moderarte a ti mismo.' };
    }

    const target = await prisma.user.findUnique({
      where: { id: input.userId },
      select: { id: true, role: true, name: true },
    });
    if (!target) return { ok: false, error: 'Usuario no encontrado.' };

    switch (input.action) {
      case 'SUSPEND':
        await prisma.user.update({
          where: { id: target.id },
          data: {
            status: 'SUSPENDED',
            suspendedUntil: new Date(
              Date.now() + (input.suspensionHours ?? 72) * 60 * 60 * 1000,
            ),
            banReason: input.reason ?? null,
          },
        });
        break;

      case 'BAN':
        await prisma.$transaction([
          prisma.user.update({
            where: { id: target.id },
            data: {
              status: 'BANNED',
              banReason: input.reason ?? 'Violacion de terminos',
              isVip: false,
            },
          }),
          prisma.modelProfile.updateMany({
            where: { userId: target.id },
            data: {
              isOnline: false,
              isAvailableForVip: false,
              isVipEnabled: false,
              acceptsBookings: false,
            },
          }),
          prisma.matchQueueEntry.updateMany({
            where: { userId: target.id, status: 'WAITING' },
            data: { status: 'CANCELLED' },
          }),
        ]);
        break;

      case 'REINSTATE':
        await prisma.user.update({
          where: { id: target.id },
          data: {
            status: 'ACTIVE',
            suspendedUntil: null,
            banReason: null,
          },
        });
        break;

      case 'PROMOTE_VIP':
        await prisma.user.update({
          where: { id: target.id },
          data: {
            isVip: true,
            vipUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          },
        });
        await prisma.modelProfile.updateMany({
          where: { userId: target.id },
          data: { tier: 'VIP', isVipEnabled: true },
        });
        break;

      case 'DEMOTE_VIP':
        await prisma.user.update({
          where: { id: target.id },
          data: { isVip: false, vipUntil: null },
        });
        await prisma.modelProfile.updateMany({
          where: { userId: target.id },
          data: { tier: 'STANDARD', isVipEnabled: false },
        });
        break;
    }

    await audit(admin.id, `USER_${input.action}`, 'User', target.id, {
      reason: input.reason,
    });

    revalidatePath('/admin/users');
    return { ok: true, message: `Accion aplicada a ${target.name ?? target.id}.` };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

// ---------------------------------------------------------------------------
// PAYOUTS
// ---------------------------------------------------------------------------

export async function processPayoutAction(input: {
  payoutId: string;
  decision: 'APPROVED' | 'PAID' | 'REJECTED';
  notes?: string;
  externalRef?: string;
}): Promise<AdminActionResult> {
  try {
    const admin = await requireAdminUser();

    const payout = await prisma.payoutRequest.findUnique({
      where: { id: input.payoutId },
      include: { model: { select: { userId: true, stageName: true } } },
    });
    if (!payout) return { ok: false, error: 'Retiro no encontrado.' };
    if (payout.status === 'PAID' || payout.status === 'REJECTED') {
      return { ok: false, error: 'Este retiro ya esta cerrado.' };
    }

    const status: PayoutStatus = input.decision;

    await prisma.$transaction(async (tx) => {
      await tx.payoutRequest.update({
        where: { id: payout.id },
        data: {
          status,
          processorId: admin.id,
          notes: input.notes ?? null,
          externalRef: input.externalRef ?? null,
          rejectionReason: input.decision === 'REJECTED' ? (input.notes ?? null) : null,
          processedAt: new Date(),
          paidAt: input.decision === 'PAID' ? new Date() : null,
        },
      });

      // Rechazo => se devuelven los tokens retenidos al solicitar
      if (input.decision === 'REJECTED') {
        await applyLedgerEntry(tx, {
          userId: payout.model.userId,
          type: 'REFUND',
          tokens: payout.tokens,
          description: `Retiro rechazado: ${input.notes ?? 'sin motivo'}`,
          payoutRequestId: payout.id,
        });
      }
    });

    await audit(admin.id, `PAYOUT_${input.decision}`, 'PayoutRequest', payout.id, {
      tokens: payout.tokens,
      model: payout.model.stageName,
    });

    revalidatePath('/admin/payouts');
    revalidatePath('/dashboard/model/payouts');
    return { ok: true, message: `Retiro marcado como ${status}.` };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

// ---------------------------------------------------------------------------
// REPORTES / DISPUTAS
// ---------------------------------------------------------------------------

export async function resolveReportAction(input: {
  reportId: string;
  status: 'UNDER_REVIEW' | 'RESOLVED' | 'DISMISSED' | 'ESCALATED';
  resolution?: string;
  actionTaken?: string;
  refundTokens?: number;
}): Promise<AdminActionResult> {
  try {
    const admin = await requireAdminUser();

    const report = await prisma.report.findUnique({
      where: { id: input.reportId },
      select: { id: true, reporterId: true, status: true },
    });
    if (!report) return { ok: false, error: 'Reporte no encontrado.' };

    await prisma.$transaction(async (tx) => {
      await tx.report.update({
        where: { id: report.id },
        data: {
          status: input.status as ReportStatus,
          reviewerId: admin.id,
          reviewedAt: new Date(),
          resolution: input.resolution ?? null,
          actionTaken: input.actionTaken ?? null,
        },
      });

      if (input.refundTokens && input.refundTokens > 0) {
        await applyLedgerEntry(tx, {
          userId: report.reporterId,
          type: 'REFUND',
          tokens: input.refundTokens,
          description: `Reembolso por disputa #${report.id.slice(0, 8)}`,
          metadata: { reportId: report.id, adminId: admin.id },
        });
      }
    });

    await audit(admin.id, `REPORT_${input.status}`, 'Report', report.id, {
      refundTokens: input.refundTokens,
    });

    revalidatePath('/admin/reports');
    return { ok: true, message: 'Reporte actualizado.' };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

// ---------------------------------------------------------------------------
// METRICAS
// ---------------------------------------------------------------------------

export async function getPlatformMetricsAction(): Promise<
  AdminActionResult<{
    users: number;
    models: number;
    onlineModels: number;
    activeCalls: number;
    pendingKyc: number;
    openReports: number;
    pendingPayouts: number;
    tokensPurchased: number;
    tokensSpent: number;
    platformFeeTokens: number;
  }>
> {
  try {
    await requireAdminUser();

    const [
      users,
      models,
      onlineModels,
      activeCalls,
      pendingKyc,
      openReports,
      pendingPayouts,
      purchases,
      spends,
      fees,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.modelProfile.count(),
      prisma.modelProfile.count({ where: { isOnline: true } }),
      prisma.callSession.count({ where: { status: 'ACTIVE' } }),
      prisma.kycVerification.count({ where: { status: 'PENDING' } }),
      prisma.report.count({ where: { status: { in: ['OPEN', 'UNDER_REVIEW'] } } }),
      prisma.payoutRequest.count({
        where: { status: { in: ['REQUESTED', 'APPROVED', 'PROCESSING'] } },
      }),
      prisma.transaction.aggregate({
        where: { type: 'TOKEN_PURCHASE', status: 'COMPLETED' },
        _sum: { tokens: true },
      }),
      prisma.transaction.aggregate({
        where: {
          type: { in: ['CALL_CHARGE', 'CONTENT_UNLOCK', 'TIP'] },
          status: 'COMPLETED',
        },
        _sum: { tokens: true },
      }),
      prisma.transaction.aggregate({
        _sum: { platformFeeTokens: true },
      }),
    ]);

    return {
      ok: true,
      data: {
        users,
        models,
        onlineModels,
        activeCalls,
        pendingKyc,
        openReports,
        pendingPayouts,
        tokensPurchased: purchases._sum.tokens ?? 0,
        tokensSpent: Math.abs(spends._sum.tokens ?? 0),
        platformFeeTokens: fees._sum.platformFeeTokens ?? 0,
      },
    };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

function toMessage(error: unknown): string {
  if (error instanceof Error) {
    if (error.message === 'UNAUTHORIZED') return 'Debes iniciar sesion.';
    if (error.message === 'FORBIDDEN') return 'Se requiere rol de administrador.';
    return error.message;
  }
  return 'Error inesperado.';
}
