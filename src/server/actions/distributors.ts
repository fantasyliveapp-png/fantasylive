'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { getAuthedUserOrThrow } from '@/lib/auth/guards';
import { config } from '@/lib/config';
import { normalizeCountryCode } from '@/lib/countries';
import { operatingBlock, ORDER_LIMITS, quoteOrder, SANCTIONED_COUNTRIES } from '@/lib/distributors';
import { peerPair } from '@/lib/chat';
import { createNotification } from '@/lib/notifications';
import { buildDistributorLotProofKey, checkUpload, createUploadUrl, isDistributorLotProofKeyOf } from '@/lib/storage';
import { prisma } from '@/lib/prisma';
import { formatMoney, formatTokens } from '@/lib/utils';

/** DISTRIBUIDORES OFICIALES: alta y gestion (admin) y lotes (distribuidor). Las ventas a fans: distributor-sales.ts. */

export interface DistributorActionResult {
  ok: boolean;
  error?: string;
  message?: string;
}

async function requireAdminUser() {
  const user = await getAuthedUserOrThrow();
  if (user.role !== 'ADMIN') throw new Error('FORBIDDEN');
  return user;
}

async function requireDistributor() {
  const user = await getAuthedUserOrThrow();
  const d = await prisma.distributor.findUnique({ where: { userId: user.id } });
  if (!d) throw new Error('FORBIDDEN');
  return { user, d };
}

function revalidateAll() {
  revalidatePath('/admin/distribuidores');
  revalidatePath('/distribuidor');
  revalidatePath('/distribuidores');
}

// ---------------------------------------------------------------------------
// ADMIN
// ---------------------------------------------------------------------------

const termsSchema = z.object({
  legalName: z.string().trim().min(2, 'Pon el nombre legal.').max(120),
  country: z.string().trim().min(2, 'Elige el país.'),
  taxId: z.string().trim().max(60).optional(),
  publicContact: z.string().trim().min(3, 'Pon cómo lo contactan los fans.').max(120),
  dailyLimitTokens: z.number().int().min(100).max(1_000_000),
});

export async function createDistributorAction(input: {
  user: string;
  legalName: string;
  country: string;
  taxId?: string;
  publicContact: string;
  dailyLimitTokens: number;
}): Promise<DistributorActionResult> {
  try {
    const admin = await requireAdminUser();
    const parsed = termsSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Datos no válidos.' };
    const d = parsed.data;
    const country = normalizeCountryCode(d.country);
    if (!country) return { ok: false, error: 'País no válido.' };
    if (SANCTIONED_COUNTRIES.has(country)) return { ok: false, error: 'País con embargo de EE. UU.: no se puede.' };

    const q = input.user.trim().replace(/^@/, '');
    const user = await prisma.user.findFirst({
      where: { OR: [{ email: q.toLowerCase() }, { username: q }] },
      select: { id: true, role: true, modelProfile: { select: { id: true } }, distributor: { select: { id: true } } },
    });
    if (!user) return { ok: false, error: 'No existe una cuenta con ese email o usuario.' };
    if (user.modelProfile) return { ok: false, error: 'Un creador no puede ser distribuidor.' };
    if (user.role === 'ADMIN') return { ok: false, error: 'Un administrador no puede ser distribuidor.' };
    if (user.distributor) return { ok: false, error: 'Esa cuenta ya es distribuidor.' };

    const created = await prisma.distributor.create({
      data: {
        userId: user.id,
        legalName: d.legalName,
        country,
        taxId: d.taxId || null,
        publicContact: d.publicContact,
        dailyLimitTokens: d.dailyLimitTokens,
        // Los demas paises y los metodos se suman solos cuando añade sus metodos de cobro.
        countries: [country],
        paymentMethods: [],
      },
      select: { id: true },
    });
    await prisma.auditLog.create({
      data: { actorId: admin.id, action: 'DISTRIBUTOR_CREATED', entityType: 'Distributor', entityId: created.id },
    });
    await createNotification(prisma, {
      userId: user.id,
      type: 'ANNOUNCEMENT',
      title: 'Ya eres distribuidor oficial de FantasyLive',
      body: 'Entra a tu panel para añadir tus métodos de pago y tus paquetes.',
      link: '/distribuidor',
    });
    revalidateAll();
    return { ok: true, message: 'Distribuidor creado. Completa su verificación para que pueda operar.' };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

/** Cambia condiciones, estado o pasos de cumplimiento. */
export async function updateDistributorAction(
  id: string,
  input: {
    dailyLimitTokens?: number;
    publicContact?: string;
    status?: 'ACTIVE' | 'SUSPENDED';
    idVerified?: boolean;
    sanctionsChecked?: boolean;
    contractSigned?: boolean;
    notes?: string;
  },
): Promise<DistributorActionResult> {
  try {
    const admin = await requireAdminUser();
    const now = new Date();
    const stamp = (v: boolean | undefined) => (v === undefined ? undefined : v ? now : null);
    await prisma.distributor.update({
      where: { id },
      data: {
        dailyLimitTokens: input.dailyLimitTokens,
        publicContact: input.publicContact?.trim() || undefined,
        status: input.status,
        idVerifiedAt: stamp(input.idVerified),
        sanctionsCheckedAt: stamp(input.sanctionsChecked),
        contractSignedAt: stamp(input.contractSigned),
        notes: input.notes,
      },
    });
    await prisma.auditLog.create({
      data: {
        actorId: admin.id,
        action: 'DISTRIBUTOR_UPDATED',
        entityType: 'Distributor',
        entityId: id,
        metadata: JSON.parse(JSON.stringify(input)),
      },
    });
    revalidateAll();
    return { ok: true, message: 'Guardado.' };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

/** El dinero del lote llego al banco: sus tokens pasan a su stock. */
export async function confirmOrderAction(orderId: string, paymentRef: string): Promise<DistributorActionResult> {
  try {
    const admin = await requireAdminUser();
    if (paymentRef.trim().length < 3) return { ok: false, error: 'Pon la referencia de la transferencia.' };
    const pending = await prisma.distributorOrder.findUnique({ where: { id: orderId }, select: { proofKey: true } });
    if (!pending?.proofKey) return { ok: false, error: 'El distribuidor aún no ha enviado el recibo del pago.' };
    const order = await prisma.$transaction(async (tx) => {
      const o = await tx.distributorOrder.updateMany({
        where: { id: orderId, status: 'PENDING' },
        data: { status: 'PAID', paidAt: new Date(), confirmedById: admin.id, paymentRef: paymentRef.trim() },
      });
      if (o.count === 0) throw new Error('Ese pedido ya no está pendiente.');
      const row = await tx.distributorOrder.findUniqueOrThrow({
        where: { id: orderId },
        select: { tokens: true, amountCents: true, distributorId: true, distributor: { select: { userId: true } } },
      });
      await tx.distributor.update({
        where: { id: row.distributorId },
        data: { stockTokens: { increment: row.tokens } },
      });
      return row;
    });
    await createNotification(prisma, {
      userId: order.distributor.userId,
      type: 'ANNOUNCEMENT',
      title: `Pago recibido: ${formatTokens(order.tokens)} tokens ya están en tu stock`,
      link: '/distribuidor',
    });
    await prisma.auditLog.create({
      data: { actorId: admin.id, action: 'DISTRIBUTOR_ORDER_PAID', entityType: 'DistributorOrder', entityId: orderId },
    });
    revalidateAll();
    return { ok: true, message: `Pago confirmado: +${formatTokens(order.tokens)} tokens de stock.` };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

export async function cancelOrderAction(orderId: string, reason = ''): Promise<DistributorActionResult> {
  try {
    const user = await getAuthedUserOrThrow();
    const order = await prisma.distributorOrder.findUnique({
      where: { id: orderId },
      select: { status: true, tokens: true, proofKey: true, distributor: { select: { userId: true } } },
    });
    if (!order) return { ok: false, error: 'Pedido no encontrado.' };
    const isAdmin = user.role === 'ADMIN';
    if (!isAdmin && order.distributor.userId !== user.id) throw new Error('FORBIDDEN');
    if (order.status !== 'PENDING') return { ok: false, error: 'Solo se puede cancelar un pedido pendiente.' };
    if (!isAdmin && order.proofKey) {
      return { ok: false, error: 'Ya enviaste el recibo: el equipo lo está revisando. Si hay un error, escribe a soporte.' };
    }
    const why = reason.trim().slice(0, 300);
    if (isAdmin && order.proofKey && why.length < 5) {
      return { ok: false, error: 'Explica por qué lo rechazas (lo verá el distribuidor).' };
    }
    await prisma.distributorOrder.update({ where: { id: orderId }, data: { status: 'CANCELLED', rejectReason: why || null } });
    if (isAdmin) {
      await createNotification(prisma, {
        userId: order.distributor.userId,
        type: 'ANNOUNCEMENT',
        title: `Lote de ${formatTokens(order.tokens)} tokens rechazado`,
        body: why || 'El equipo canceló el pedido.',
        link: '/distribuidor?tab=comprar',
      });
      await prisma.auditLog.create({
        data: { actorId: user.id, action: 'DISTRIBUTOR_ORDER_REJECTED', entityType: 'DistributorOrder', entityId: orderId, metadata: { reason: why } },
      });
    }
    revalidateAll();
    return { ok: true, message: 'Pedido cancelado.' };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

/** Distribuidor: URL para subir el recibo del pago de su lote. */
export async function requestLotProofUploadUrlAction(
  orderId: string,
  filename: string,
  contentType: string,
  sizeBytes: number,
): Promise<DistributorActionResult & { uploadUrl?: string; key?: string }> {
  try {
    const { d } = await requireDistributor();
    const order = await prisma.distributorOrder.findUnique({ where: { id: orderId }, select: { distributorId: true, status: true } });
    if (!order || order.distributorId !== d.id) throw new Error('FORBIDDEN');
    if (order.status !== 'PENDING') return { ok: false, error: 'Este lote ya no está pendiente.' };
    if (!/^(image\/(jpeg|png|webp|heic|heif)|application\/pdf)$/.test(contentType)) {
      return { ok: false, error: 'Sube una imagen o un PDF del recibo.' };
    }
    const invalid = checkUpload(contentType, sizeBytes, ['image', 'pdf']);
    if (invalid) return { ok: false, error: invalid };
    const key = buildDistributorLotProofKey({ orderId, filename });
    const uploadUrl = await createUploadUrl({ key, contentType, sizeBytes });
    if (!uploadUrl) return { ok: false, error: 'No se pueden subir archivos ahora.' };
    return { ok: true, uploadUrl, key };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

/** Distribuidor: envia el recibo y la referencia de su pago. El equipo lo revisa y confirma. */
export async function submitLotProofAction(orderId: string, ref: string, proofKey: string): Promise<DistributorActionResult> {
  try {
    const { d } = await requireDistributor();
    const reference = ref.trim();
    if (reference.length < 3 || reference.length > 120) {
      return { ok: false, error: 'Pon la referencia de la transferencia o el hash de la transacción.' };
    }
    if (!proofKey || !isDistributorLotProofKeyOf(orderId, proofKey)) return { ok: false, error: 'Sube el recibo del pago.' };
    const { count } = await prisma.distributorOrder.updateMany({
      where: { id: orderId, distributorId: d.id, status: 'PENDING' },
      data: { proofKey, paymentRef: reference, proofUploadedAt: new Date() },
    });
    if (count === 0) return { ok: false, error: 'Este lote ya no está pendiente.' };
    const admins = await prisma.user.findMany({ where: { role: 'ADMIN' }, select: { id: true } });
    for (const a of admins) {
      await createNotification(prisma, {
        userId: a.id,
        type: 'ANNOUNCEMENT',
        title: `${d.legalName} envió el recibo de un lote`,
        body: 'Revísalo y confirma el pago para sumarle los tokens.',
        link: '/admin/distribuidores?tab=lotes',
      });
    }
    revalidateAll();
    return { ok: true, message: 'Recibo enviado. Te avisamos cuando confirmemos el pago.' };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

// ---------------------------------------------------------------------------
// DISTRIBUIDOR
// ---------------------------------------------------------------------------

/** Pide un lote al por mayor: se paga por transferencia y el admin lo confirma. */
export async function requestOrderAction(
  tokens: number,
  paymentMethod: 'WIRE' | 'USDT' = 'WIRE',
): Promise<DistributorActionResult> {
  try {
    const { d } = await requireDistributor();
    const block = operatingBlock(d);
    if (block) return { ok: false, error: block };
    if (!Number.isInteger(tokens) || tokens < ORDER_LIMITS.minTokens || tokens > ORDER_LIMITS.maxTokens) {
      return { ok: false, error: `Pide entre ${formatTokens(ORDER_LIMITS.minTokens)} y ${formatTokens(ORDER_LIMITS.maxTokens)} tokens.` };
    }
    const pending = await prisma.distributorOrder.count({ where: { distributorId: d.id, status: 'PENDING' } });
    if (pending >= 3) return { ok: false, error: 'Tienes 3 pedidos pendientes de pago. Espera a que se confirmen.' };

    if (paymentMethod === 'USDT' && !config.distributors.usdtAddress) {
      return { ok: false, error: 'El pago con USDT no está disponible ahora.' };
    }

    const q = quoteOrder(tokens);
    await prisma.distributorOrder.create({
      data: {
        distributorId: d.id,
        tokens,
        centsPerToken: Math.round((q.costCents * 1000) / tokens),
        discountPercent: q.discountPercent,
        amountCents: q.costCents,
        paymentMethod,
      },
    });
    revalidateAll();
    return {
      ok: true,
      message: `Pedido creado: ${formatTokens(tokens)} tokens por ${formatMoney(q.costCents)} (−${q.discountPercent}%). ${
        paymentMethod === 'USDT' ? 'Envía el USDT y sube el recibo en «Tus lotes».' : 'Haz la transferencia y sube el recibo en «Tus lotes».'
      }`,
    };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

/** Fan: abrir chat con un distribuidor oficial para pedirle tokens. */
export async function contactDistributorAction(distributorId: string): Promise<DistributorActionResult & { href?: string }> {
  try {
    const me = await getAuthedUserOrThrow();
    if (!config.distributors.enabled) return { ok: false, error: 'El programa de distribuidores no está activo.' };
    const d = await prisma.distributor.findUnique({ where: { id: distributorId } });
    if (!d || operatingBlock(d)) return { ok: false, error: 'Ese distribuidor no está disponible ahora.' };
    if (d.userId === me.id) return { ok: false, error: 'Eres tú.' };

    const pair = peerPair(me.id, d.userId);
    const existing = await prisma.peerChat.findUnique({ where: { userAId_userBId: pair }, select: { id: true } });
    if (existing) return { ok: true, href: `/mensajes/${existing.id}` };

    const meUser = await prisma.user.findUnique({ where: { id: me.id }, select: { username: true, name: true } });
    const chat = await prisma.$transaction(async (tx) => {
      // Con un distribuidor oficial el chat entra directo (no como solicitud).
      const c = await tx.peerChat.create({
        data: { ...pair, createdById: me.id, acceptedAt: new Date() },
        select: { id: true },
      });
      await tx.peerMessage.create({
        data: {
          chatId: c.id,
          senderId: me.id,
          body: `Hola, tengo una pregunta sobre comprar tokens. Mi usuario es @${meUser?.username ?? ''}.`,
        },
      });
      await createNotification(tx, {
        userId: d.userId,
        type: 'NEW_MESSAGE',
        title: `${meUser?.name ?? 'Un fan'} quiere comprarte tokens`,
        link: `/mensajes/${c.id}`,
      });
      return c;
    });
    revalidatePath('/mensajes');
    return { ok: true, href: `/mensajes/${chat.id}` };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

function toMessage(error: unknown): string {
  if (error instanceof Error) {
    if (error.message === 'UNAUTHORIZED') return 'Debes iniciar sesión.';
    if (error.message === 'FORBIDDEN') return 'No tienes permiso.';
    return error.message;
  }
  return 'No se pudo completar.';
}
