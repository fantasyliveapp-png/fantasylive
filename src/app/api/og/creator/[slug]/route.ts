import path from 'node:path';

import { NextResponse, type NextRequest } from 'next/server';
import sharp from 'sharp';

import { config } from '@/lib/config';
import { prisma } from '@/lib/prisma';
import { getObjectBuffer, isProfileImageKey } from '@/lib/storage';

export const runtime = 'nodejs';

/**
 * GET /api/og/creator/<slug>
 *
 * Imagen de vista previa (1200x630) del perfil o del directo de una creadora
 * al compartir el enlace: solo su foto de perfil y el logo de la marca.
 *
 * La foto es cuadrada y la vista previa apaisada: va entera a la derecha y el
 * resto se rellena con la misma foto difuminada, donde va el logo.
 *
 * Solo usa la foto de PERFIL (la publica, la que ya ve cualquiera en la web),
 * nunca contenido de pago. Sin foto, o si no se puede leer, sale la imagen
 * general de la marca.
 */

const W = 1200;
const H = 630;
const LOGO_WIDTH = 340;

/** Fotos externas solo de los mismos sitios que admite next.config (datos de prueba). */
const EXTERNAL_HOSTS = new Set(['i.pravatar.cc', 'picsum.photos', 'images.unsplash.com']);

async function avatarBuffer(avatarUrl: string | null): Promise<Buffer | null> {
  if (!avatarUrl) return null;
  try {
    if (avatarUrl.startsWith('/api/public-media/')) {
      const key = decodeURIComponent(avatarUrl.slice('/api/public-media/'.length).split('?')[0]!);
      return isProfileImageKey(key) ? await getObjectBuffer(key) : null;
    }
    if (/^https:\/\//i.test(avatarUrl) && EXTERNAL_HOSTS.has(new URL(avatarUrl).hostname)) {
      return await getObjectBuffer(avatarUrl);
    }
  } catch {
    // Sin foto: imagen de la marca.
  }
  return null;
}

let logo: Promise<{ data: Buffer; height: number }> | null = null;
function loadLogo() {
  logo ??= sharp(path.join(process.cwd(), 'public/brand/og-lockup.png'))
    .resize({ width: LOGO_WIDTH })
    .png()
    .toBuffer({ resolveWithObject: true })
    .then(({ data, info }) => ({ data, height: info.height }));
  return logo;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const fallback = NextResponse.redirect(new URL('/brand/og-image.png', config.app.url), 302);

  const model = await prisma.modelProfile.findUnique({
    where: { slug },
    select: { avatarUrl: true, kycStatus: true },
  });
  if (!model || model.kycStatus !== 'APPROVED') return fallback;

  const raw = await avatarBuffer(model.avatarUrl);
  if (!raw) return fallback;

  try {
    const photo = sharp(raw).rotate();
    const [background, sharpPhoto, lockup] = await Promise.all([
      photo.clone().resize(W, H, { fit: 'cover' }).blur(28).modulate({ brightness: 0.5 }).toBuffer(),
      photo.clone().resize(H, H, { fit: 'cover' }).toBuffer(),
      loadLogo(),
    ]);
    const sideWidth = W - H;
    const png = await sharp(background)
      .composite([
        { input: sharpPhoto, left: sideWidth, top: 0 },
        {
          input: lockup.data,
          left: Math.round((sideWidth - LOGO_WIDTH) / 2),
          top: Math.round((H - lockup.height) / 2),
        },
      ])
      .jpeg({ quality: 85 })
      .toBuffer();

    return new NextResponse(new Uint8Array(png), {
      headers: {
        'Content-Type': 'image/jpeg',
        // Las apps que generan la vista previa la piden una vez; si la
        // creadora cambia de foto, en una hora sale la nueva.
        'Cache-Control': 'public, max-age=3600',
      },
    });
  } catch {
    return fallback;
  }
}
