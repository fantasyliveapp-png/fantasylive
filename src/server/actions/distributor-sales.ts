'use server';

import { revalidatePath } from 'next/cache';

import { getAuthedUserOrThrow } from '@/lib/auth/guards';
import { emailVerificationBlock } from '@/lib/auth-tokens';
import { config } from '@/lib/config';
import { normalizeCountryCode } from '@/lib/countries';
import {
  COUNTRY_CURRENCY,
  currenciesFor,
  formatLocal,
  officialFor,
  PACKAGE_LIMITS,
  PAYMENT_METHOD_KEYS,
  paymentMethodLabel,
  SALE_PAY_MINUTES,
} from '@/lib/distributor-shared';
import { buildDistributorProofKey, checkUpload, createUploadUrl, isDistributorProofKeyOf } from '@/lib/storage';
import { expireSales, openTokensForFan, operatingBlock, receivedToday, SANCTIONED_COUNTRIES, syncCoverage } from '@/lib/distributors';
import { usdRate } from '@/lib/fx';
import { createNotification } from '@/lib/notifications';
import { prisma } from '@/lib/prisma';
import { applyLedgerEntry } from '@/lib/tokens';
import { formatTokens } from '@/lib/utils';

/**
 * COMPRA PROTEGIDA ENTRE FAN Y DISTRIBUIDOR (como un P2P):
 *   1. El fan elige un paquete y crea el pedido: los tokens del distribuidor
 *      quedan reservados.
 *   2. El fan paga directamente al distribuidor (Nequi, OXXO...) y marca
 *      "Ya pagué" con la referencia y la captura del comprobante (obligatoria).
 *   Fantasy Live nunca recibe ni devuelve el dinero del fan: solo reserva tokens.
 *   3. El distribuidor confirma que le llego y los tokens se liberan al fan.
 * Si el fan no paga en 30 min, caduca y los tokens vuelven al stock. Si hay
 * problema, cualquiera abre una disputa y la resuelve el equipo.
 */

export interface SaleResult {
  ok: boolean;
  error?: string;
  message?: string;
  saleId?: string;
}

function fail(error: unknown): SaleResult {
  if (error instanceof Error) {
    if (error.message === 'UNAUTHORIZED') return { ok: false, error: 'Debes iniciar sesión.' };
    if (error.message === 'FORBIDDEN') return { ok: false, error: 'No tienes permiso.' };
    return { ok: false, error: error.message };
  }
  return { ok: false, error: 'No se pudo completar.' };
}

function revalidateSale(id: string) {
  revalidatePath(`/compra-tokens/${id}`);
  revalidatePath('/distribuidor');
  revalidatePath('/admin/distribuidores');
}

/** El fan puede recibir tokens de distribuidores (mismas reglas que siempre). */
async function fanBlock(fanId: string): Promise<string | null> {
  const fan = await prisma.user.findUnique({
    where: { id: fanId },
    select: {
      role: true,
      status: true,
      ageVerified: true,
      country: true,
      modelProfile: { select: { id: true } },
      distributor: { select: { id: true } },
    },
  });
  if (!fan || fan.status !== 'ACTIVE') return 'Tu cuenta no está activa.';
  if (fan.modelProfile || fan.role !== 'USER') return 'Las cuentas de creador no pueden comprar a distribuidores.';
  if (fan.distributor) return 'Un distribuidor no puede comprar a otro.';
  if (!fan.ageVerified) return 'Confirma primero que eres mayor de edad.';
  if (fan.country && SANCTIONED_COUNTRIES.has(fan.country)) return 'No disponible en tu país.';
  return null;
}

// ---------------------------------------------------------------------------
// FAN
// ---------------------------------------------------------------------------

export async function createSaleAction(packageId: string, acceptedTerms: boolean): Promise<SaleResult> {
  try {
    const me = await getAuthedUserOrThrow();
    if (!config.distributors.enabled) return { ok: false, error: 'El programa de distribuidores no está activo.' };
    if (!acceptedTerms) return { ok: false, error: 'Confirma que entiendes cómo funciona la compra.' };
    await expireSales();
    const block = (await fanBlock(me.id)) ?? (await emailVerificationBlock(me.id));
    if (block) return { ok: false, error: block };

    const pkg = await prisma.distributorPackage.findUnique({
      where: { id: packageId },
      include: { account: { include: { distributor: true } } },
    });
    if (!pkg || !pkg.active || !pkg.account.active) return { ok: false, error: 'Ese paquete ya no está disponible.' };
    const account = pkg.account;
    const tokens = pkg.tokens;
    const d = account.distributor;
    if (d.userId === me.id) return { ok: false, error: 'Eres tú.' };
    const dBlock = operatingBlock(d);
    if (dBlock || !d.isAvailable) return { ok: false, error: 'Este distribuidor no está disponible ahora.' };

    const open = await prisma.distributorSale.count({
      where: { fanId: me.id, status: { in: ['AWAITING_PAYMENT', 'PAID'] } },
    });
    if (open >= 2) return { ok: false, error: 'Tienes 2 compras en curso. Termínalas antes de abrir otra.' };

    const cap = config.distributors.fanDailyTokens;
    const already = (await receivedToday(me.id)) + (await openTokensForFan(me.id));
    if (already + tokens > cap) {
      return { ok: false, error: `Hoy puedes comprar ${formatTokens(Math.max(0, cap - already))} tokens más (máximo ${formatTokens(cap)} al día).` };
    }

    // Tope diario del distribuidor (lo fija el equipo): entregado hoy + pedidos abiertos.
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    const dToday = await prisma.distributorSale.aggregate({
      where: {
        distributorId: d.id,
        OR: [
          { status: { in: ['AWAITING_PAYMENT', 'PAID', 'DISPUTED'] } },
          { status: 'COMPLETED', completedAt: { gte: dayStart } },
        ],
      },
      _sum: { tokens: true },
    });
    if ((dToday._sum.tokens ?? 0) + tokens > d.dailyLimitTokens) {
      return { ok: false, error: 'Este distribuidor llegó a su máximo de hoy. Prueba con otro o mañana.' };
    }

    // Precio: el del paquete. Se guarda tambien lo que valen esos tokens al cambio
    // oficial del dia (solo como referencia para revisar disputas; no se muestra).
    const rate = await usdRate(account.currency);

    const sale = await prisma.$transaction(async (tx) => {
      const reserved = await tx.distributor.updateMany({
        where: { id: d.id, stockTokens: { gte: tokens } },
        data: { stockTokens: { decrement: tokens } },
      });
      if (reserved.count === 0) throw new Error('El distribuidor no tiene tokens suficientes ahora.');
      return tx.distributorSale.create({
        data: {
          distributorId: d.id,
          fanId: me.id,
          accountId: account.id,
          packageId: pkg.id,
          tokens,
          currency: account.currency,
          amount: pkg.price,
          referenceAmount: rate ? officialFor(tokens, config.economy.tokenValueCents, rate) : 0,
          expiresAt: new Date(Date.now() + SALE_PAY_MINUTES * 60_000),
        },
        select: { id: true, amount: true },
      });
    });
    await createNotification(prisma, {
      userId: d.userId,
      type: 'ANNOUNCEMENT',
      title: `Nuevo pedido: ${formatTokens(tokens)} tokens por ${formatLocal(sale.amount, account.currency)} (${paymentMethodLabel(account.method)})`,
      body: 'Los tokens están reservados. Espera a que el fan pague.',
      link: `/compra-tokens/${sale.id}`,
    });
    revalidateSale(sale.id);
    return { ok: true, saleId: sale.id };
  } catch (error) {
    return fail(error);
  }
}

/** URL para subir la captura del comprobante (solo el fan, antes de marcar pagado). */
export async function requestProofUploadUrlAction(
  saleId: string,
  filename: string,
  contentType: string,
): Promise<SaleResult & { uploadUrl?: string; key?: string }> {
  try {
    const me = await getAuthedUserOrThrow();
    const sale = await prisma.distributorSale.findUnique({ where: { id: saleId }, select: { fanId: true, status: true } });
    if (!sale || sale.fanId !== me.id) throw new Error('FORBIDDEN');
    if (sale.status !== 'AWAITING_PAYMENT') return { ok: false, error: 'Este pedido ya no está esperando pago.' };
    if (!/^image\/(jpeg|png|webp|heic|heif)$/.test(contentType)) return { ok: false, error: 'Sube una imagen (captura o foto del comprobante).' };
    const invalid = checkUpload(contentType, ['image']);
    if (invalid) return { ok: false, error: invalid };
    const key = buildDistributorProofKey({ saleId, filename });
    const uploadUrl = await createUploadUrl({ key, contentType });
    if (!uploadUrl) return { ok: false, error: 'No se pueden subir archivos ahora.' };
    return { ok: true, uploadUrl, key };
  } catch (error) {
    return fail(error);
  }
}

/** Fan o distribuidor: subir una prueba para la disputa (pedido pagado o en disputa). */
export async function requestDisputeEvidenceUploadUrlAction(
  saleId: string,
  filename: string,
  contentType: string,
): Promise<SaleResult & { uploadUrl?: string; key?: string }> {
  try {
    const me = await getAuthedUserOrThrow();
    const sale = await prisma.distributorSale.findUnique({
      where: { id: saleId },
      select: { fanId: true, status: true, distributor: { select: { userId: true } } },
    });
    if (!sale || (sale.fanId !== me.id && sale.distributor.userId !== me.id)) throw new Error('FORBIDDEN');
    if (sale.status !== 'PAID') return { ok: false, error: 'Solo al abrir una disputa en un pedido pagado.' };
    if (!/^image\/(jpeg|png|webp|heic|heif)$/.test(contentType)) return { ok: false, error: 'Sube una imagen (captura o foto).' };
    const invalid = checkUpload(contentType, ['image']);
    if (invalid) return { ok: false, error: invalid };
    const key = buildDistributorProofKey({ saleId, filename });
    const uploadUrl = await createUploadUrl({ key, contentType });
    if (!uploadUrl) return { ok: false, error: 'No se pueden subir archivos ahora.' };
    return { ok: true, uploadUrl, key };
  } catch (error) {
    return fail(error);
  }
}

export async function markSalePaidAction(saleId: string, paymentRef: string, proofKey: string): Promise<SaleResult> {
  try {
    const me = await getAuthedUserOrThrow();
    await expireSales();
    const ref = paymentRef.trim();
    if (ref.length < 3 || ref.length > 120) return { ok: false, error: 'Pon la referencia o el número de operación del pago.' };
    if (!proofKey || !isDistributorProofKeyOf(saleId, proofKey)) {
      return { ok: false, error: 'Sube la captura del comprobante de pago.' };
    }
    const { count } = await prisma.distributorSale.updateMany({
      where: { id: saleId, fanId: me.id, status: 'AWAITING_PAYMENT' },
      data: { status: 'PAID', paidAt: new Date(), paymentRef: ref, paymentProofKey: proofKey },
    });
    if (count === 0) return { ok: false, error: 'Este pedido ya no está esperando pago.' };
    const sale = await prisma.distributorSale.findUniqueOrThrow({
      where: { id: saleId },
      select: { tokens: true, amount: true, currency: true, distributor: { select: { userId: true } } },
    });
    await createNotification(prisma, {
      userId: sale.distributor.userId,
      type: 'ANNOUNCEMENT',
      title: `El fan dice que pagó ${formatLocal(sale.amount, sale.currency)}`,
      body: `Comprueba que te llegó y libera los ${formatTokens(sale.tokens)} tokens.`,
      link: `/compra-tokens/${saleId}`,
    });
    revalidateSale(saleId);
    return { ok: true, message: 'Avisamos al distribuidor. En cuanto confirme el pago, recibes tus tokens.' };
  } catch (error) {
    return fail(error);
  }
}

export async function cancelSaleAction(saleId: string): Promise<SaleResult> {
  try {
    const me = await getAuthedUserOrThrow();
    const sale = await prisma.distributorSale.findUnique({ where: { id: saleId }, include: { distributor: true } });
    if (!sale) return { ok: false, error: 'Pedido no encontrado.' };
    const isFan = sale.fanId === me.id;
    const isDist = sale.distributor.userId === me.id;
    if (!isFan && !isDist) throw new Error('FORBIDDEN');
    // El fan cancela antes de pagar; el distribuidor tambien puede cancelar si aun no le han pagado.
    if (sale.status !== 'AWAITING_PAYMENT') return { ok: false, error: 'Solo se puede cancelar antes de marcarlo como pagado.' };
    await returnToStock(saleId, isFan ? 'Cancelado por el fan' : 'Cancelado por el distribuidor');
    await createNotification(prisma, {
      userId: isFan ? sale.distributor.userId : sale.fanId,
      type: 'ANNOUNCEMENT',
      title: `Pedido de ${formatTokens(sale.tokens)} tokens cancelado`,
      link: `/compra-tokens/${saleId}`,
    });
    revalidateSale(saleId);
    return { ok: true, message: 'Pedido cancelado.' };
  } catch (error) {
    return fail(error);
  }
}

/** Disputa: el fan (pago y no le liberan) o el distribuidor (no le llego el pago). */
export async function disputeSaleAction(saleId: string, reason: string, evidenceKey?: string | null): Promise<SaleResult> {
  try {
    const me = await getAuthedUserOrThrow();
    const sale = await prisma.distributorSale.findUnique({ where: { id: saleId }, include: { distributor: true } });
    if (!sale) return { ok: false, error: 'Pedido no encontrado.' };
    const isFan = sale.fanId === me.id;
    const isDist = sale.distributor.userId === me.id;
    if (!isFan && !isDist) throw new Error('FORBIDDEN');
    if (sale.status !== 'PAID') return { ok: false, error: 'Solo se puede abrir una disputa cuando el pedido está marcado como pagado.' };
    if (isFan && sale.paidAt && Date.now() - sale.paidAt.getTime() < 30 * 60_000) {
      return { ok: false, error: 'Dale al distribuidor al menos 30 minutos para comprobar el pago.' };
    }
    const why = reason.trim();
    if (why.length < 5) return { ok: false, error: 'Cuéntanos qué pasó.' };
    if (evidenceKey && !isDistributorProofKeyOf(saleId, evidenceKey)) return { ok: false, error: 'Prueba no válida.' };
    await prisma.distributorSale.update({
      where: { id: saleId },
      data: {
        status: 'DISPUTED',
        disputedAt: new Date(),
        disputeBy: isFan ? 'FAN' : 'DISTRIBUTOR',
        disputeReason: why.slice(0, 500),
        disputeEvidenceKey: evidenceKey || null,
      },
    });
    await createNotification(prisma, {
      userId: isFan ? sale.distributor.userId : sale.fanId,
      type: 'ANNOUNCEMENT',
      title: 'Se abrió una disputa en un pedido de tokens',
      body: 'El equipo lo revisará. Los tokens siguen reservados mientras tanto.',
      link: `/compra-tokens/${saleId}`,
    });
    revalidateSale(saleId);
    return { ok: true, message: 'Disputa abierta. El equipo la revisará; los tokens siguen reservados.' };
  } catch (error) {
    return fail(error);
  }
}

export async function rateSaleAction(saleId: string, good: boolean): Promise<SaleResult> {
  try {
    const me = await getAuthedUserOrThrow();
    const { count } = await prisma.distributorSale.updateMany({
      where: { id: saleId, fanId: me.id, status: 'COMPLETED', rating: null },
      data: { rating: good ? 1 : -1 },
    });
    if (count === 0) return { ok: false, error: 'Ya lo valoraste.' };
    revalidateSale(saleId);
    return { ok: true, message: 'Gracias por tu valoración.' };
  } catch (error) {
    return fail(error);
  }
}

// ---------------------------------------------------------------------------
// DISTRIBUIDOR
// ---------------------------------------------------------------------------

/** Le llego el pago: los tokens reservados pasan al monedero del fan. */
export async function releaseSaleAction(saleId: string): Promise<SaleResult> {
  try {
    const me = await getAuthedUserOrThrow();
    const sale = await prisma.distributorSale.findUnique({ where: { id: saleId }, include: { distributor: true } });
    if (!sale || sale.distributor.userId !== me.id) throw new Error('FORBIDDEN');
    if (sale.status !== 'PAID' && sale.status !== 'AWAITING_PAYMENT') {
      return { ok: false, error: 'Este pedido ya no se puede liberar.' };
    }
    await completeSale(saleId, null);
    return { ok: true, message: `Liberados ${formatTokens(sale.tokens)} tokens. ¡Venta completada!` };
  } catch (error) {
    return fail(error);
  }
}

/** Cuenta de cobro: nueva o editar. */
export async function saveAccountAction(input: {
  id?: string;
  country: string;
  currency: string;
  method: string;
  details: string;
}): Promise<SaleResult> {
  try {
    const me = await getAuthedUserOrThrow();
    const d = await prisma.distributor.findUnique({ where: { userId: me.id } });
    if (!d) throw new Error('FORBIDDEN');
    const country = normalizeCountryCode(input.country);
    if (!country || !COUNTRY_CURRENCY[country]) return { ok: false, error: 'Elige un país.' };
    if (SANCTIONED_COUNTRIES.has(country)) return { ok: false, error: 'No se puede vender en ese país.' };
    if (!currenciesFor(country).includes(input.currency)) return { ok: false, error: 'Moneda no válida para ese país.' };
    if (!PAYMENT_METHOD_KEYS.has(input.method)) return { ok: false, error: 'Elige un método de pago.' };
    const details = input.details.trim();
    if (details.length < 4 || details.length > 300) return { ok: false, error: 'Pon los datos para pagarte (número, titular...).' };
    const data = { country, currency: input.currency, method: input.method, details, active: true };
    if (input.id) {
      const { count } = await prisma.distributorAccount.updateMany({ where: { id: input.id, distributorId: d.id }, data });
      if (count === 0) return { ok: false, error: 'Cuenta no encontrada.' };
    } else {
      const n = await prisma.distributorAccount.count({ where: { distributorId: d.id, active: true } });
      if (n >= 15) return { ok: false, error: 'Máximo 15 métodos de pago.' };
      await prisma.distributorAccount.create({ data: { distributorId: d.id, ...data } });
    }
    // Los paises donde vende salen de sus metodos (los fans filtran por ellos).
    await syncCoverage(d.id);
    revalidatePath('/distribuidor');
    revalidatePath('/distribuidores');
    return { ok: true, message: 'Guardado.' };
  } catch (error) {
    return fail(error);
  }
}

export async function removeAccountAction(id: string): Promise<SaleResult> {
  try {
    const me = await getAuthedUserOrThrow();
    const d = await prisma.distributor.findUnique({ where: { userId: me.id }, select: { id: true } });
    if (!d) throw new Error('FORBIDDEN');
    await prisma.distributorAccount.updateMany({ where: { id, distributorId: d.id }, data: { active: false } });
    await syncCoverage(d.id);
    revalidatePath('/distribuidor');
    revalidatePath('/distribuidores');
    return { ok: true, message: 'Método quitado.' };
  } catch (error) {
    return fail(error);
  }
}

/** Paquete de un metodo: "50 tokens = 95 MXN". El precio lo pone el distribuidor. */
export async function savePackageAction(input: {
  id?: string;
  accountId: string;
  tokens: number;
  /** En unidades de la moneda (con decimales). */
  price: number;
}): Promise<SaleResult> {
  try {
    const me = await getAuthedUserOrThrow();
    const d = await prisma.distributor.findUnique({ where: { userId: me.id }, select: { id: true } });
    if (!d) throw new Error('FORBIDDEN');
    const account = await prisma.distributorAccount.findFirst({
      where: { id: input.accountId, distributorId: d.id, active: true },
      select: { id: true },
    });
    if (!account) return { ok: false, error: 'Método no encontrado.' };
    const tokens = Math.round(input.tokens);
    if (!Number.isInteger(tokens) || tokens < PACKAGE_LIMITS.minTokens || tokens > PACKAGE_LIMITS.maxTokens) {
      return { ok: false, error: `Entre ${PACKAGE_LIMITS.minTokens} y ${formatTokens(PACKAGE_LIMITS.maxTokens)} tokens por paquete.` };
    }
    const price = Math.round(input.price * 100);
    if (!Number.isFinite(price) || price <= 0) return { ok: false, error: 'Pon el precio del paquete.' };
    if (input.id) {
      const { count } = await prisma.distributorPackage.updateMany({
        where: { id: input.id, accountId: account.id },
        data: { tokens, price, active: true },
      });
      if (count === 0) return { ok: false, error: 'Paquete no encontrado.' };
    } else {
      const n = await prisma.distributorPackage.count({ where: { accountId: account.id, active: true } });
      if (n >= PACKAGE_LIMITS.perAccount) return { ok: false, error: `Máximo ${PACKAGE_LIMITS.perAccount} paquetes por método.` };
      await prisma.distributorPackage.create({ data: { accountId: account.id, tokens, price } });
    }
    revalidatePath('/distribuidor');
    revalidatePath('/distribuidores');
    return { ok: true, message: 'Paquete guardado.' };
  } catch (error) {
    return fail(error);
  }
}

export async function removePackageAction(id: string): Promise<SaleResult> {
  try {
    const me = await getAuthedUserOrThrow();
    const d = await prisma.distributor.findUnique({ where: { userId: me.id }, select: { id: true } });
    if (!d) throw new Error('FORBIDDEN');
    await prisma.distributorPackage.updateMany({
      where: { id, account: { distributorId: d.id } },
      data: { active: false },
    });
    revalidatePath('/distribuidor');
    revalidatePath('/distribuidores');
    return { ok: true, message: 'Paquete quitado.' };
  } catch (error) {
    return fail(error);
  }
}

/** Distribuidor: si ahora atiende pedidos o no. */
export async function setAvailabilityAction(available: boolean): Promise<SaleResult> {
  try {
    const me = await getAuthedUserOrThrow();
    const { count } = await prisma.distributor.updateMany({ where: { userId: me.id }, data: { isAvailable: available } });
    if (count === 0) throw new Error('FORBIDDEN');
    revalidatePath('/distribuidor');
    revalidatePath('/distribuidores');
    return { ok: true, message: available ? 'Disponible: los fans pueden comprarte.' : 'No disponible: no recibirás pedidos.' };
  } catch (error) {
    return fail(error);
  }
}

// ---------------------------------------------------------------------------
// ADMIN: disputas
// ---------------------------------------------------------------------------

export async function resolveDisputeAction(saleId: string, outcome: 'release' | 'cancel', note = ''): Promise<SaleResult> {
  try {
    const me = await getAuthedUserOrThrow();
    if (me.role !== 'ADMIN') throw new Error('FORBIDDEN');
    const sale = await prisma.distributorSale.findUnique({ where: { id: saleId }, include: { distributor: { select: { userId: true } } } });
    if (!sale || sale.status !== 'DISPUTED') return { ok: false, error: 'Esa disputa ya no está abierta.' };
    const why = note.trim().slice(0, 500);
    if (why.length < 5) return { ok: false, error: 'Explica en una frase por qué decides así (lo verán los dos).' };
    if (outcome === 'release') await completeSale(saleId, me.id);
    else await returnToStock(saleId, 'Cancelado por el equipo tras la disputa', me.id);
    await prisma.distributorSale.update({ where: { id: saleId }, data: { resolvedAt: new Date(), resolutionNote: why } });
    const title = outcome === 'release' ? 'Disputa resuelta: tokens entregados al fan' : 'Disputa resuelta: pedido cancelado';
    for (const userId of [sale.fanId, sale.distributor.userId]) {
      await createNotification(prisma, { userId, type: 'ANNOUNCEMENT', title, body: why, link: `/compra-tokens/${saleId}` });
    }
    await prisma.auditLog.create({
      data: {
        actorId: me.id,
        action: `DISTRIBUTOR_SALE_${outcome.toUpperCase()}`,
        entityType: 'DistributorSale',
        entityId: saleId,
        metadata: { note: why },
      },
    });
    revalidateSale(saleId);
    return { ok: true, message: outcome === 'release' ? 'Tokens liberados al fan.' : 'Pedido cancelado; tokens devueltos al distribuidor.' };
  } catch (error) {
    return fail(error);
  }
}

// ---------------------------------------------------------------------------
// Internos
// ---------------------------------------------------------------------------

/** Entrega: tokens reservados -> monedero del fan (cuentan como comprados). */
async function completeSale(saleId: string, resolvedById: string | null) {
  const sale = await prisma.$transaction(async (tx) => {
    const done = await tx.distributorSale.updateMany({
      where: { id: saleId, status: { in: ['AWAITING_PAYMENT', 'PAID', 'DISPUTED'] } },
      data: { status: 'COMPLETED', completedAt: new Date(), resolvedById },
    });
    if (done.count === 0) throw new Error('Este pedido ya no se puede liberar.');
    const s = await tx.distributorSale.findUniqueOrThrow({ where: { id: saleId }, include: { distributor: true } });
    await tx.distributorTransfer.create({
      data: { distributorId: s.distributorId, toUserId: s.fanId, tokens: s.tokens, saleId: s.id },
    });
    await applyLedgerEntry(tx, {
      userId: s.fanId,
      type: 'DISTRIBUTOR_CREDIT',
      tokens: s.tokens,
      description: `Compra a distribuidor oficial (${s.distributor.legalName})`,
      metadata: { distributorId: s.distributorId, saleId: s.id, amount: s.amount, currency: s.currency },
    });
    return s;
  });
  await createNotification(prisma, {
    userId: sale.fanId,
    type: 'ANNOUNCEMENT',
    title: `¡Listo! Tienes ${formatTokens(sale.tokens)} tokens nuevos`,
    body: `${sale.distributor.legalName} confirmó tu pago.`,
    link: `/compra-tokens/${saleId}`,
  });
  revalidateSale(saleId);
}

/** Cancela y devuelve los tokens reservados al stock del distribuidor. */
async function returnToStock(saleId: string, reason: string, resolvedById: string | null = null) {
  await prisma.$transaction(async (tx) => {
    const done = await tx.distributorSale.updateMany({
      where: { id: saleId, status: { in: ['AWAITING_PAYMENT', 'DISPUTED'] } },
      data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: reason, resolvedById },
    });
    if (done.count === 0) throw new Error('Este pedido ya no se puede cancelar.');
    const s = await tx.distributorSale.findUniqueOrThrow({ where: { id: saleId }, select: { distributorId: true, tokens: true } });
    await tx.distributor.update({ where: { id: s.distributorId }, data: { stockTokens: { increment: s.tokens } } });
  });
}
