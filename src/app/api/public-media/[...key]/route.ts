import { NextResponse, type NextRequest } from 'next/server';

import { createDownloadUrl, isProfileImageKey } from '@/lib/storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/public-media/<clave>
 *
 * Sirve las fotos de perfil y portada de las modelos cuando no hay CDN
 * publico (S3_PUBLIC_BASE_URL): redirige a una URL firmada de corta vida.
 *
 * Solo acepta claves con la forma exacta de una foto de perfil. El resto del
 * bucket (contenido de pago, KYC, adjuntos) es privado y nunca debe poder
 * pedirse por aqui aunque alguien adivine la clave.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ key: string[] }> },
) {
  const { key: parts } = await params;
  const key = parts.join('/');

  if (!isProfileImageKey(key)) {
    return new NextResponse('Not found', { status: 404 });
  }

  const url = await createDownloadUrl(key);
  if (!url) return new NextResponse('Not found', { status: 404 });

  // La firma dura mas que esta cache, asi que el navegador nunca reutiliza
  // una redireccion hacia una URL ya caducada.
  const response = NextResponse.redirect(url, 302);
  response.headers.set('Cache-Control', 'private, max-age=300');
  return response;
}
