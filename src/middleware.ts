import NextAuth from 'next-auth';
import { NextResponse } from 'next/server';

import { authConfig } from '@/lib/auth/auth.config';

// Instancia ligera sin adaptador Prisma: el middleware corre en Edge Runtime
const { auth } = NextAuth(authConfig);

const PROTECTED_PREFIXES = [
  '/dashboard',
  '/wallet',
  '/bookings',
  '/call',
  '/random',
  '/vip',
];

const MODEL_PREFIXES = ['/dashboard/model'];
const ADMIN_PREFIXES = ['/admin'];

export default auth((req) => {
  const { pathname } = req.nextUrl;
  const user = req.auth?.user;

  const needsAuth = PROTECTED_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );

  if (needsAuth && !user) {
    const url = new URL('/login', req.nextUrl.origin);
    url.searchParams.set('callbackUrl', pathname);
    return NextResponse.redirect(url);
  }

  if (user) {
    // Cuentas baneadas fuera de todo salvo la pagina informativa
    if ((user as any).status === 'BANNED' && pathname !== '/banned') {
      return NextResponse.redirect(new URL('/banned', req.nextUrl.origin));
    }

    const isAdminArea = ADMIN_PREFIXES.some((p) => pathname.startsWith(p));
    if (isAdminArea && (user as any).role !== 'ADMIN') {
      return NextResponse.redirect(new URL('/403', req.nextUrl.origin));
    }

    const isModelArea = MODEL_PREFIXES.some((p) => pathname.startsWith(p));
    if (
      isModelArea &&
      (user as any).role !== 'MODEL' &&
      (user as any).role !== 'ADMIN'
    ) {
      return NextResponse.redirect(new URL('/403', req.nextUrl.origin));
    }

    // Ya autenticado: fuera de login/register
    if (pathname === '/login' || pathname === '/register') {
      return NextResponse.redirect(new URL('/', req.nextUrl.origin));
    }
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    /*
     * Todo salvo:
     * - api (rutas propias con su propia auth)
     * - _next/static, _next/image, favicon, assets publicos
     */
    '/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
