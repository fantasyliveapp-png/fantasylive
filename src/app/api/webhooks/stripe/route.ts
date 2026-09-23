import { NextRequest, NextResponse } from 'next/server';
import type Stripe from 'stripe';

import { config } from '@/lib/config';
import { getStripe, fulfillPurchase } from '@/lib/payments';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/webhooks/stripe
 *
 * Acredita los tokens cuando Stripe confirma el pago.
 * En Vercel hay que anadir esta URL en el dashboard de Stripe y copiar el
 * signing secret a STRIPE_WEBHOOK_SECRET.
 */
export async function POST(request: NextRequest) {
  const stripe = getStripe();
  const webhookSecret = config.payments.stripe.webhookSecret;

  if (!stripe || !webhookSecret) {
    return NextResponse.json(
      { error: 'Stripe no configurado' },
      { status: 503 },
    );
  }

  const signature = request.headers.get('stripe-signature');
  if (!signature) {
    return NextResponse.json({ error: 'Falta la firma' }, { status: 400 });
  }

  // El cuerpo debe leerse en crudo para validar la firma
  const rawBody = await request.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (error) {
    return NextResponse.json(
      {
        error: `Firma invalida: ${error instanceof Error ? error.message : 'error'}`,
      },
      { status: 400 },
    );
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const { userId, packageId, tokens } = session.metadata ?? {};

        if (!userId || !tokens) {
          return NextResponse.json({ received: true, skipped: 'sin metadata' });
        }

        await fulfillPurchase({
          userId,
          packageId,
          tokens: Number(tokens),
          amountCents: session.amount_total ?? 0,
          currency: (session.currency ?? 'usd').toUpperCase(),
          provider: 'STRIPE',
          providerRef: session.id,
        });
        break;
      }

      case 'charge.refunded':
      case 'charge.dispute.created': {
        // Chargebacks: revisar manualmente desde el panel admin
        console.warn(`[stripe] Evento de disputa recibido: ${event.type}`);
        break;
      }

      default:
        break;
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error('[stripe] Error procesando webhook:', error);
    return NextResponse.json(
      { error: 'Error interno procesando el evento' },
      { status: 500 },
    );
  }
}
