import { NextResponse, type NextRequest } from 'next/server';
import sharp from 'sharp';

import { getObjectBuffer, isProfileImageKey } from '@/lib/storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/public-media/<clave>
 *
 * Sirve las fotos de perfil y portada cuando no hay CDN publico
 * (S3_PUBLIC_BASE_URL).
 *
 * Solo acepta claves con la forma exacta de una foto de perfil. El resto del
 * bucket (contenido de pago, KYC, adjuntos) es privado y nunca debe poder
 * pedirse por aqui aunque alguien adivine la clave.
 *
 * Se sirve la imagen directamente (no una redireccion a una URL firmada) para
 * que el navegador la guarde: cada foto subida tiene un nombre unico
 * (avatar-<uuid>.jpg), asi que su contenido nunca cambia y se puede cachear
 * un año. Una foto nueva es otra clave.
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

  const data = await getObjectBuffer(key);
  if (!data) return new NextResponse('Not found', { status: 404 });

  // Solo se sirve si de verdad es una foto (nada de HTML con nombre .jpg).
  const format = await sharp(data)
    .metadata()
    .then((m) => m.format)
    .catch(() => null);
  const type = format === 'jpeg' ? 'image/jpeg' : format === 'png' ? 'image/png' : format === 'webp' ? 'image/webp' : null;
  if (!type) return new NextResponse('Not found', { status: 404 });

  return new NextResponse(new Uint8Array(data), {
    headers: {
      'Content-Type': type,
      'Content-Length': String(data.length),
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
