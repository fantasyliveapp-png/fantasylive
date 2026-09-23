import 'server-only';

import { NextResponse, type NextRequest } from 'next/server';

import { prisma } from '@/lib/prisma';
import { REF_COOKIE, REF_COOKIE_MAX_AGE } from '@/lib/referrals';

/**
 * Enlaces de referidos (/r/<slug>...): recuerda 30 dias que creadora invito
 * (cookie) y lleva a donde toque. Solo creadoras verificadas pueden invitar.
 */
export async function refRedirect(
  req: NextRequest,
  slug: string,
  target: (slug: string) => string,
) {
  const creator = await prisma.modelProfile.findUnique({
    where: { slug },
    select: { slug: true, userId: true, kycStatus: true },
  });
  // Enlace roto o creadora sin verificar: a la portada, sin marcar nada.
  if (!creator || creator.kycStatus !== 'APPROVED') {
    return NextResponse.redirect(new URL('/', req.url));
  }
  const res = NextResponse.redirect(new URL(target(creator.slug), req.url));
  res.cookies.set(REF_COOKIE, creator.userId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: REF_COOKIE_MAX_AGE,
    path: '/',
  });
  return res;
}
