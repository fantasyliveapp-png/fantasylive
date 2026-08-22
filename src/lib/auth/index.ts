import NextAuth from 'next-auth';
import { PrismaAdapter } from '@auth/prisma-adapter';
import Credentials from 'next-auth/providers/credentials';
import Google from 'next-auth/providers/google';
import bcrypt from 'bcryptjs';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { authConfig } from './auth.config';

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

const providers = [
  Credentials({
    name: 'credentials',
    credentials: {
      email: { label: 'Email', type: 'email' },
      password: { label: 'Contrasena', type: 'password' },
    },
    async authorize(raw) {
      const parsed = credentialsSchema.safeParse(raw);
      if (!parsed.success) return null;

      const { email, password } = parsed.data;

      const user = await prisma.user.findUnique({
        where: { email: email.toLowerCase() },
        include: { modelProfile: { select: { id: true } } },
      });

      if (!user?.passwordHash) return null;
      if (user.status === 'BANNED') {
        throw new Error('Esta cuenta ha sido baneada.');
      }
      if (
        user.status === 'SUSPENDED' &&
        (!user.suspendedUntil || user.suspendedUntil > new Date())
      ) {
        throw new Error('Esta cuenta esta suspendida temporalmente.');
      }

      const valid = await bcrypt.compare(password, user.passwordHash);
      if (!valid) return null;

      await prisma.user.update({
        where: { id: user.id },
        data: { lastSeenAt: new Date() },
      });

      return {
        id: user.id,
        email: user.email,
        name: user.name,
        image: user.image,
        role: user.role,
        status: user.status,
        isVip: user.isVip,
        ageVerified: user.ageVerified,
        modelProfileId: user.modelProfile?.id ?? null,
      } as any;
    },
  }),
];

if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  providers.push(
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      allowDangerousEmailAccountLinking: true,
    }) as any,
  );
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter: PrismaAdapter(prisma) as any,
  providers,
  events: {
    /** Crea monedero + bono de bienvenida para altas via OAuth */
    async createUser({ user }) {
      if (!user.id) return;
      const bonus = Number(process.env.SIGNUP_BONUS_TOKENS ?? 25);
      await prisma.wallet.upsert({
        where: { userId: user.id },
        create: {
          userId: user.id,
          balance: bonus,
          lifetimePurchased: 0,
        },
        update: {},
      });
      if (bonus > 0) {
        await prisma.transaction.create({
          data: {
            userId: user.id,
            type: 'SIGNUP_BONUS',
            tokens: bonus,
            balanceAfter: bonus,
            description: 'Bono de bienvenida',
          },
        });
      }
    },
  },
});
