import 'server-only';

import crypto from 'node:crypto';
import Stripe from 'stripe';

import { config } from '@/lib/config';
import { prisma } from '@/lib/prisma';
import { applyLedgerEntry } from '@/lib/tokens';

let stripeClient: Stripe | null = null;

export function getStripe(): Stripe | null {
  if (!config.payments.stripe.secretKey) return null;
  if (!stripeClient) {
    stripeClient = new Stripe(config.payments.stripe.secretKey, {
      apiVersion: '2024-12-18.acacia' as Stripe.LatestApiVersion,
    });
  }
  return stripeClient;
}

export interface CheckoutResult {
  /** URL a la que redirigir al usuario, o null si se acredito al instante */
  url: string | null;
  /** true cuando el proveedor "mock" acredito los tokens sin cobrar */
  credited: boolean;
  tokens?: number;
  newBalance?: number;
}

/**
 * Inicia la compra de un paquete de tokens.
 *
 * - stripe : crea una Checkout Session y devuelve su URL.
 * - ccbill : construye la URL del FlexForm firmada.
 * - mock   : acredita los tokens al instante (desarrollo local).
 */
export async function startTokenPurchase(params: {
  userId: string;
  packageId: string;
  userEmail: string;
}): Promise<CheckoutResult> {
  const pkg = await prisma.tokenPackage.findUnique({
    where: { id: params.packageId },
  });
  if (!pkg || !pkg.isActive) throw new Error('PACKAGE_NOT_AVAILABLE');

  const totalTokens = pkg.tokens + pkg.bonusTokens;
  const provider = config.payments.provider;

  if (provider === 'mock') {
    const { balanceAfter } = await prisma.$transaction((tx) =>
      applyLedgerEntry(tx, {
        userId: params.userId,
        type: 'TOKEN_PURCHASE',
        tokens: totalTokens,
        amountCents: pkg.priceCents,
        currency: pkg.currency,
        provider: 'MOCK',
        providerRef: `mock_${crypto.randomUUID()}`,
        description: `Compra ${pkg.name} (modo prueba)`,
        tokenPackageId: pkg.id,
      }),
    );
    return { url: null, credited: true, tokens: totalTokens, newBalance: balanceAfter };
  }

  if (provider === 'stripe') {
    const stripe = getStripe();
    if (!stripe) throw new Error('STRIPE_NOT_CONFIGURED');

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer_email: params.userEmail,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: pkg.currency.toLowerCase(),
            unit_amount: pkg.priceCents,
            product_data: {
              name: `${pkg.name} - ${totalTokens} tokens`,
              description: pkg.description ?? undefined,
            },
          },
        },
      ],
      metadata: {
        userId: params.userId,
        packageId: pkg.id,
        tokens: String(totalTokens),
      },
      success_url: `${config.app.url}/wallet?purchase=success`,
      cancel_url: `${config.app.url}/wallet?purchase=cancelled`,
    });

    await prisma.transaction.create({
      data: {
        userId: params.userId,
        type: 'TOKEN_PURCHASE',
        status: 'PENDING',
        tokens: totalTokens,
        amountCents: pkg.priceCents,
        currency: pkg.currency,
        provider: 'STRIPE',
        providerRef: session.id,
        description: `Compra pendiente: ${pkg.name}`,
        tokenPackageId: pkg.id,
      },
    });

    return { url: session.url, credited: false };
  }

  if (provider === 'ccbill') {
    const { accnum, subacc, flexFormId, salt } = config.payments.ccbill;
    if (!accnum || !flexFormId) throw new Error('CCBILL_NOT_CONFIGURED');

    const price = (pkg.priceCents / 100).toFixed(2);
    const currencyCode = '840'; // USD
    const digest = crypto
      .createHash('md5')
      .update(`${price}1${currencyCode}${salt}`)
      .digest('hex');

    const url = new URL(
      `https://api.ccbill.com/wap/frontflex.cgi?flexId=${flexFormId}`,
    );
    url.searchParams.set('clientAccnum', accnum);
    url.searchParams.set('clientSubacc', subacc);
    url.searchParams.set('initialPrice', price);
    url.searchParams.set('initialPeriod', '1');
    url.searchParams.set('currencyCode', currencyCode);
    url.searchParams.set('formDigest', digest);
    url.searchParams.set('customUserId', params.userId);
    url.searchParams.set('customPackageId', pkg.id);

    return { url: url.toString(), credited: false };
  }

  throw new Error('PAYMENT_PROVIDER_NOT_SUPPORTED');
}

/**
 * Acredita tokens tras confirmacion del proveedor (webhook).
 * Idempotente gracias al indice unico de providerRef.
 */
export async function fulfillPurchase(params: {
  userId: string;
  packageId?: string;
  tokens: number;
  amountCents: number;
  currency: string;
  provider: 'STRIPE' | 'CCBILL' | 'CRYPTO';
  providerRef: string;
}) {
  const existing = await prisma.transaction.findUnique({
    where: { providerRef: params.providerRef },
  });

  if (existing?.status === 'COMPLETED') {
    return { alreadyProcessed: true, balance: existing.balanceAfter ?? 0 };
  }

  return prisma.$transaction(async (tx) => {
    if (existing) {
      // Limpia el registro PENDING para no chocar con el indice unico
      await tx.transaction.delete({ where: { id: existing.id } });
    }

    const { balanceAfter } = await applyLedgerEntry(tx, {
      userId: params.userId,
      type: 'TOKEN_PURCHASE',
      tokens: params.tokens,
      amountCents: params.amountCents,
      currency: params.currency,
      provider: params.provider,
      providerRef: params.providerRef,
      description: `Compra de ${params.tokens} tokens`,
      tokenPackageId: params.packageId,
    });

    return { alreadyProcessed: false, balance: balanceAfter };
  });
}
