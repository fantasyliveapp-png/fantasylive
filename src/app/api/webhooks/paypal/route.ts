import { NextRequest, NextResponse } from 'next/server';

import { config } from '@/lib/config';
import {
  capturePaypalOrder,
  getPaypalAccessToken,
  paypalApiBase,
} from '@/lib/payments';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface PaypalWebhookEvent {
  id?: string;
  event_type?: string;
  resource?: {
    id?: string;
    supplementary_data?: { related_ids?: { order_id?: string } };
  };
}

/**
 * Verifica la firma del evento contra la API de PayPal.
 *
 * PayPal no usa un HMAC con secreto compartido como Stripe: hay que mandarle
 * las cabeceras de la transmision y el evento entero, y es su servidor quien
 * dice si la firma es valida. Sin esto, cualquiera podria acreditarse tokens
 * enviando un POST a esta ruta.
 */
async function isSignatureValid(
  request: NextRequest,
  event: unknown,
): Promise<boolean> {
  const { webhookId } = config.payments.paypal;
  if (!webhookId) return false;

  const authAlgo = request.headers.get('paypal-auth-algo');
  const certUrl = request.headers.get('paypal-cert-url');
  const transmissionId = request.headers.get('paypal-transmission-id');
  const transmissionSig = request.headers.get('paypal-transmission-sig');
  const transmissionTime = request.headers.get('paypal-transmission-time');

  if (
    !authAlgo ||
    !certUrl ||
    !transmissionId ||
    !transmissionSig ||
    !transmissionTime
  ) {
    return false;
  }

  // El certificado tiene que ser de PayPal. La verificacion la hace su API,
  // pero no hay motivo para reenviarle una URL arbitraria.
  let certHost: string;
  try {
    certHost = new URL(certUrl).hostname;
  } catch {
    return false;
  }
  if (certHost !== 'paypal.com' && !certHost.endsWith('.paypal.com')) {
    return false;
  }

  try {
    const accessToken = await getPaypalAccessToken();
    const response = await fetch(
      `${paypalApiBase()}/v1/notifications/verify-webhook-signature`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          auth_algo: authAlgo,
          cert_url: certUrl,
          transmission_id: transmissionId,
          transmission_sig: transmissionSig,
          transmission_time: transmissionTime,
          webhook_id: webhookId,
          webhook_event: event,
        }),
        cache: 'no-store',
      },
    );

    if (!response.ok) return false;

    const result = (await response.json()) as { verification_status?: string };
    return result.verification_status === 'SUCCESS';
  } catch (error) {
    console.error('[paypal] Error verificando la firma:', error);
    return false;
  }
}

/**
 * POST /api/webhooks/paypal
 *
 * Acredita los tokens cuando PayPal confirma el cobro. Cubre el caso en que el
 * usuario paga pero cierra el navegador antes de volver a la return_url.
 *
 * Hay que dar de alta esta URL en el dashboard de PayPal (Apps & Credentials ->
 * la app -> Webhooks) y copiar el Webhook ID a PAYPAL_WEBHOOK_ID.
 */
export async function POST(request: NextRequest) {
  if (!config.payments.paypal.configured) {
    return NextResponse.json({ error: 'PayPal no configurado' }, { status: 503 });
  }

  const event = (await request.json().catch(() => null)) as
    | PaypalWebhookEvent
    | null;
  if (!event) {
    return NextResponse.json({ error: 'Cuerpo invalido' }, { status: 400 });
  }

  if (!(await isSignatureValid(request, event))) {
    return NextResponse.json({ error: 'Firma invalida' }, { status: 400 });
  }

  try {
    switch (event.event_type) {
      // La orden fue aprobada por el usuario: el resource.id ES el ID de orden.
      case 'CHECKOUT.ORDER.APPROVED': {
        if (event.resource?.id) await capturePaypalOrder(event.resource.id);
        break;
      }

      // El cobro se completo. Aqui resource.id es el ID de la captura, no el de
      // la orden: hay que sacar el de la orden para compartir providerRef con
      // el otro camino y que la acreditacion siga siendo idempotente.
      case 'PAYMENT.CAPTURE.COMPLETED': {
        const orderId =
          event.resource?.supplementary_data?.related_ids?.order_id;
        if (orderId) await capturePaypalOrder(orderId);
        break;
      }

      case 'PAYMENT.CAPTURE.DENIED':
      case 'PAYMENT.CAPTURE.REFUNDED':
      case 'CUSTOMER.DISPUTE.CREATED': {
        // Contracargos y reembolsos: revision manual desde el panel admin.
        console.warn(`[paypal] Evento de disputa recibido: ${event.event_type}`);
        break;
      }

      default:
        break;
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error('[paypal] Error procesando el webhook:', error);
    return NextResponse.json(
      { error: 'Error interno procesando el evento' },
      { status: 500 },
    );
  }
}
