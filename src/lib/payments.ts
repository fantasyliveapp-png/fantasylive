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

/** Base de la API REST de PayPal segun el modo configurado. */
export function paypalApiBase(): string {
  return config.payments.paypal.mode === 'live'
    ? 'https://api-m.paypal.com'
    : 'https://api-m.sandbox.paypal.com';
}

interface PaypalToken {
  accessToken: string;
  expiresAt: number;
}

let paypalToken: PaypalToken | null = null;

/**
 * Token OAuth2 de PayPal (client_credentials), cacheado en memoria.
 *
 * Se renueva 60 s antes de caducar para no usar uno que expire a mitad de
 * peticion.
 */
export async function getPaypalAccessToken(): Promise<string> {
  const { clientId, clientSecret } = config.payments.paypal;
  if (!clientId || !clientSecret) throw new Error('PAYPAL_NOT_CONFIGURED');

  if (paypalToken && Date.now() < paypalToken.expiresAt) {
    return paypalToken.accessToken;
  }

  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const response = await fetch(`${paypalApiBase()}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(`PAYPAL_AUTH_FAILED_${response.status}`);
  }

  const data = (await response.json()) as {
    access_token: string;
    expires_in: number;
  };

  paypalToken = {
    accessToken: data.access_token,
    expiresAt: Date.now() + (data.expires_in - 60) * 1000,
  };

  return paypalToken.accessToken;
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
 * - paypal : crea una Order v2 y devuelve el enlace de aprobacion.
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

  if (provider === 'paypal') {
    const accessToken = await getPaypalAccessToken();

    // El importe de PayPal va en unidades decimales, no en centavos.
    const value = (pkg.priceCents / 100).toFixed(2);

    const response = await fetch(`${paypalApiBase()}/v2/checkout/orders`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        // Evita crear dos ordenes si el usuario hace doble clic o si hay un
        // reintento de red: PayPal devuelve la misma orden.
        'PayPal-Request-Id': `${params.userId}-${pkg.id}-${Date.now()}`,
      },
      body: JSON.stringify({
        intent: 'CAPTURE',
        purchase_units: [
          {
            // Se recupera en el webhook y en la captura para saber a quien
            // acreditar sin fiarse de lo que mande el navegador.
            custom_id: `${params.userId}:${pkg.id}:${totalTokens}`,
            description: `${pkg.name} - ${totalTokens} tokens`,
            amount: { currency_code: pkg.currency, value },
          },
        ],
        payment_source: {
          paypal: {
            experience_context: {
              brand_name: config.app.name,
              user_action: 'PAY_NOW',
              return_url: `${config.app.url}/api/payments/paypal/capture`,
              cancel_url: `${config.app.url}/wallet?purchase=cancelled`,
            },
          },
        },
      }),
      cache: 'no-store',
    });

    if (!response.ok) {
      console.error('[paypal] Error creando la orden:', await response.text());
      throw new Error('PAYPAL_ORDER_FAILED');
    }

    const order = (await response.json()) as {
      id: string;
      links: { rel: string; href: string }[];
    };

    const approveUrl = order.links.find((link) => link.rel === 'payer-action')
      ?.href;
    if (!approveUrl) throw new Error('PAYPAL_NO_APPROVAL_URL');

    await prisma.transaction.create({
      data: {
        userId: params.userId,
        type: 'TOKEN_PURCHASE',
        status: 'PENDING',
        tokens: totalTokens,
        amountCents: pkg.priceCents,
        currency: pkg.currency,
        provider: 'PAYPAL',
        providerRef: order.id,
        description: `Compra pendiente: ${pkg.name}`,
        tokenPackageId: pkg.id,
      },
    });

    return { url: approveUrl, credited: false };
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
 * Captura una orden de PayPal ya aprobada y acredita los tokens.
 *
 * Se llama desde dos sitios que pueden solaparse -la vuelta del usuario y el
 * webhook-, asi que tiene que ser idempotente: ambos usan el ID de la orden
 * como providerRef y fulfillPurchase deduplica por el indice unico.
 *
 * Los tokens y el importe NO se leen de la respuesta de PayPal sino de la
 * transaccion PENDING que se creo al abrir la orden. Es la version fiable: lo
 * que vuelve por el navegador no decide cuanto se acredita.
 */
export async function capturePaypalOrder(orderId: string): Promise<{
  ok: boolean;
  reason?: string;
}> {
  const pending = await prisma.transaction.findUnique({
    where: { providerRef: orderId },
    select: {
      userId: true,
      tokens: true,
      amountCents: true,
      currency: true,
      tokenPackageId: true,
      status: true,
    },
  });

  if (!pending) return { ok: false, reason: 'ORDER_UNKNOWN' };
  if (pending.status === 'COMPLETED') return { ok: true };

  const accessToken = await getPaypalAccessToken();

  const response = await fetch(
    `${paypalApiBase()}/v2/checkout/orders/${orderId}/capture`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        // Reintentar la captura de una orden ya capturada devuelve la misma
        // captura en vez de cobrar dos veces.
        'PayPal-Request-Id': `capture-${orderId}`,
      },
      cache: 'no-store',
    },
  );

  const payload = (await response.json().catch(() => null)) as {
    status?: string;
    details?: { issue?: string }[];
  } | null;

  // ORDER_ALREADY_CAPTURED significa que el otro camino (webhook o vuelta del
  // usuario) llego primero: no es un error, hay que acreditar igual.
  const alreadyCaptured = payload?.details?.some(
    (detail) => detail.issue === 'ORDER_ALREADY_CAPTURED',
  );

  if (!response.ok && !alreadyCaptured) {
    console.error('[paypal] Captura fallida:', JSON.stringify(payload));
    return { ok: false, reason: 'CAPTURE_FAILED' };
  }

  if (!alreadyCaptured && payload?.status !== 'COMPLETED') {
    return { ok: false, reason: `CAPTURE_STATUS_${payload?.status ?? 'UNKNOWN'}` };
  }

  await fulfillPurchase({
    userId: pending.userId,
    packageId: pending.tokenPackageId ?? undefined,
    tokens: pending.tokens,
    amountCents: pending.amountCents ?? 0,
    currency: pending.currency ?? 'USD',
    provider: 'PAYPAL',
    providerRef: orderId,
  });

  return { ok: true };
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
  provider: 'STRIPE' | 'PAYPAL' | 'CCBILL' | 'CRYPTO';
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
