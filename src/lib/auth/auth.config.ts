import type { NextAuthConfig } from 'next-auth';

/**
 * Configuracion compartida y segura para Edge (middleware).
 * NO importa Prisma ni bcrypt: el middleware corre en Edge Runtime.
 */
export const authConfig = {
  pages: {
    signIn: '/login',
    error: '/login',
    newUser: '/register',
  },
  session: {
    strategy: 'jwt',
    maxAge: 30 * 24 * 60 * 60, // 30 dias
  },
  trustHost: true,
  providers: [], // se completan en auth.ts (runtime Node)
  callbacks: {
    async jwt({ token, user, trigger, session }) {
      if (user) {
        token.id = user.id as string;
        token.role = (user as any).role;
        token.status = (user as any).status;
        token.isVip = (user as any).isVip;
        token.modelProfileId = (user as any).modelProfileId ?? null;
        token.ageVerified = (user as any).ageVerified ?? false;
      }
      // Permite refrescar el token tras cambios de rol/VIP sin re-login
      if (trigger === 'update' && session?.user) {
        token.role = session.user.role ?? token.role;
        token.isVip = session.user.isVip ?? token.isVip;
        token.modelProfileId =
          session.user.modelProfileId ?? token.modelProfileId;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.role = token.role as any;
        session.user.status = token.status as any;
        session.user.isVip = Boolean(token.isVip);
        session.user.modelProfileId = (token.modelProfileId as string) ?? null;
        session.user.ageVerified = Boolean(token.ageVerified);
      }
      return session;
    },
    authorized({ auth }) {
      return Boolean(auth?.user);
    },
  },
} satisfies NextAuthConfig;
