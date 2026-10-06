import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { ImageResponse } from 'next/og';
import { NextResponse, type NextRequest } from 'next/server';
import sharp from 'sharp';

import { config } from '@/lib/config';
import { prisma } from '@/lib/prisma';
import { getObjectBuffer, isProfileImageKey } from '@/lib/storage';

export const runtime = 'nodejs';

/**
 * GET /api/og/creator/<slug>[?live=1]
 *
 * Imagen de vista previa (1200x630) del perfil o del directo de una creadora
 * al compartir el enlace: su foto de perfil, su nombre y la marca.
 *
 * Solo usa la foto de PERFIL (la publica, la que ya ve cualquiera en la web),
 * nunca contenido de pago. Sin foto, o si no se puede leer, sale la imagen
 * general de la marca.
 */

const W = 1200;
const H = 630;

/** Fotos externas solo de los mismos sitios que admite next.config (datos de prueba). */
const EXTERNAL_HOSTS = new Set(['i.pravatar.cc', 'picsum.photos', 'images.unsplash.com']);

let fonts: Promise<{ akira: Buffer; bebas: Buffer; body: Buffer }> | null = null;
function loadFonts() {
  fonts ??= Promise.all([
    readFile(path.join(process.cwd(), 'public/fonts/Akira-Expanded-Demo.otf')),
    readFile(path.join(process.cwd(), 'public/fonts/BebasNeue-Regular.ttf')),
    // Letra normal para la frase del perfil (la que trae next/og).
    readFile(path.join(process.cwd(), 'node_modules/next/dist/compiled/@vercel/og/noto-sans-v27-latin-regular.ttf')),
  ]).then(([akira, bebas, body]) => ({ akira, bebas, body }));
  return fonts;
}

/** La foto de perfil como JPEG cuadrado en data URL, o null. */
async function avatarDataUrl(avatarUrl: string | null): Promise<string | null> {
  if (!avatarUrl) return null;
  let raw: Buffer | null = null;
  try {
    if (avatarUrl.startsWith('/api/public-media/')) {
      const key = decodeURIComponent(avatarUrl.slice('/api/public-media/'.length).split('?')[0]!);
      if (isProfileImageKey(key)) raw = await getObjectBuffer(key);
    } else if (/^https:\/\//i.test(avatarUrl) && EXTERNAL_HOSTS.has(new URL(avatarUrl).hostname)) {
      raw = await getObjectBuffer(avatarUrl);
    }
    if (!raw) return null;
    const jpg = await sharp(raw).rotate().resize(H, H, { fit: 'cover' }).jpeg({ quality: 85 }).toBuffer();
    return `data:image/jpeg;base64,${jpg.toString('base64')}`;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const live = req.nextUrl.searchParams.get('live') === '1';
  const fallback = NextResponse.redirect(new URL('/brand/og-image.png', config.app.url), 302);

  const model = await prisma.modelProfile.findUnique({
    where: { slug },
    select: { stageName: true, headline: true, avatarUrl: true, kycStatus: true },
  });
  if (!model || model.kycStatus !== 'APPROVED') return fallback;

  const [photo, { akira, bebas, body }] = await Promise.all([avatarDataUrl(model.avatarUrl), loadFonts()]);
  if (!photo) return fallback;

  const name = model.stageName.length > 22 ? `${model.stageName.slice(0, 21)}…` : model.stageName;
  const headline = model.headline?.trim();

  const image = new ImageResponse(
    (
      <div
        style={{
          width: W,
          height: H,
          display: 'flex',
          background: 'linear-gradient(135deg, #0a0a0b 40%, #2a0d10 100%)',
          color: '#F5F1EC',
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={photo} width={H} height={H} style={{ objectFit: 'cover' }} alt="" />
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            padding: '48px 48px 44px',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            {live ? (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  background: '#C1272D',
                  borderRadius: 999,
                  padding: '6px 18px 4px',
                  fontFamily: 'Bebas',
                  fontSize: 34,
                  letterSpacing: 2,
                }}
              >
                <div style={{ width: 12, height: 12, borderRadius: 6, background: '#F5F1EC' }} />
                EN DIRECTO
              </div>
            ) : (
              <div style={{ display: 'flex' }} />
            )}
            <div
              style={{
                display: 'flex',
                border: '2px solid rgba(245,241,236,0.55)',
                borderRadius: 999,
                padding: '4px 16px 2px',
                fontFamily: 'Bebas',
                fontSize: 28,
                color: 'rgba(245,241,236,0.8)',
              }}
            >
              18+
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ fontFamily: 'Bebas', fontSize: name.length > 14 ? 76 : 96, lineHeight: 1 }}>{name}</div>
            {headline ? (
              <div style={{ fontSize: 28, lineHeight: 1.3, color: 'rgba(245,241,236,0.75)', display: 'flex' }}>
                {headline.length > 90 ? `${headline.slice(0, 89)}…` : headline}
              </div>
            ) : null}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontFamily: 'Akira', fontSize: 34 }}>FANTASY LIVE</div>
            <div style={{ fontFamily: 'Bebas', fontSize: 26, letterSpacing: 1, color: '#D9B98C', whiteSpace: 'nowrap' }}>
              {live ? 'ENTRA AHORA Y CHATEA EN VIVO' : 'DIRECTOS · VIDEOLLAMADAS · EXCLUSIVO'}
            </div>
          </div>
        </div>
      </div>
    ),
    {
      width: W,
      height: H,
      // La primera es la de por defecto (la frase del perfil).
      fonts: [
        { name: 'Body', data: body, weight: 400, style: 'normal' },
        { name: 'Akira', data: akira, weight: 800, style: 'normal' },
        { name: 'Bebas', data: bebas, weight: 400, style: 'normal' },
      ],
    },
  );
  // Las apps que generan la vista previa la piden una vez; si la creadora
  // cambia de foto, en una hora sale la nueva.
  image.headers.set('Cache-Control', 'public, max-age=3600');
  return image;
}
