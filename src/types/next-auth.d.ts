import type { Role, UserStatus } from '@prisma/client';
import type { DefaultSession } from 'next-auth';

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      role: Role;
      status: UserStatus;
      isVip: boolean;
      ageVerified: boolean;
      modelProfileId: string | null;
    } & DefaultSession['user'];
  }

  interface User {
    role?: Role;
    status?: UserStatus;
    isVip?: boolean;
    ageVerified?: boolean;
    modelProfileId?: string | null;
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id: string;
    role: Role;
    status: UserStatus;
    isVip: boolean;
    ageVerified: boolean;
    modelProfileId: string | null;
  }
}

export {};
