import 'server-only';

import { NextResponse, type NextRequest } from 'next/server';

import { config } from '@/lib/config';
import { prisma } from '@/lib/prisma';
import { REF_COOKIE, REF_COOKIE_MAX_AGE } from '@/lib/referrals';

/**
 * Direccion publica de la web. NO req.url: detras de nginx es la interna
 * (http://localhost:3000) y los enlaces mandaban a la gente a localhost.
 */
const publicUrl = (path: string) => new URL(path, config.app.url);

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
    return NextResponse.redirect(publicUrl('/'));
  }
  const res = NextResponse.redirect(publicUrl(target(creator.slug)));
  res.cookies.set(REF_COOKIE, creator.userId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: REF_COOKIE_MAX_AGE,
    path: '/',
  });
  return res;
}

/**
 * Enlace de un reclutador: /reclutar/<code>. Guarda 30 dias "r:<id>" y
 * lleva al registro como creadora. Reclutador pausado o codigo roto: portada.
 */
export async function recruiterRedirect(req: NextRequest, code: string) {
  const recruiter = await prisma.recruiter.findUnique({
    where: { code: code.toLowerCase() },
    select: { id: true, active: true },
  });
  if (!recruiter?.active) return NextResponse.redirect(publicUrl('/'));
  const res = NextResponse.redirect(publicUrl('/register?role=model'));
  res.cookies.set(REF_COOKIE, `r:${recruiter.id}`, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: REF_COOKIE_MAX_AGE,
    path: '/',
  });
  return res;
}
