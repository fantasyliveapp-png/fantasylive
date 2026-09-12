import { NextRequest, NextResponse } from 'next/server';

import { config } from '@/lib/config';
import { capturePaypalOrder } from '@/lib/payments';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/payments/paypal/capture
 *
 * Es la return_url de la orden: PayPal manda aqui al usuario despues de
 * aprobar el pago, con el ID de la orden en el parametro `token`.
 *
 * Captura el cobro y redirige al monedero. No es la unica via de acreditacion
 * -el webhook cubre al usuario que cierra el navegador sin volver-, y las dos
 * son idempotentes porque comparten el ID de orden como providerRef.
 */
export async function GET(request: NextRequest) {
  const walletUrl = new URL('/wallet', config.app.url);
  const orderId = request.nextUrl.searchParams.get('token');

  if (!orderId) {
    walletUrl.searchParams.set('purchase', 'error');
    return NextResponse.redirect(walletUrl);
  }

  try {
    const result = await capturePaypalOrder(orderId);
    walletUrl.searchParams.set('purchase', result.ok ? 'success' : 'error');
  } catch (error) {
    console.error('[paypal] Error capturando la orden:', error);
    walletUrl.searchParams.set('purchase', 'error');
  }

  return NextResponse.redirect(walletUrl);
}
