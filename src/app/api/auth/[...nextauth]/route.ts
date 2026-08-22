import { handlers } from '@/lib/auth';

export const { GET, POST } = handlers;

// NextAuth con adaptador Prisma requiere runtime Node (no Edge)
export const runtime = 'nodejs';
