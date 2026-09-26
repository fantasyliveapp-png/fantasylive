import type { Metadata } from 'next';

import { RegisterForm } from '@/components/auth/register-form';
import { safeNext } from '@/lib/safe-next';

export const metadata: Metadata = { title: 'Crear cuenta' };

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ role?: string; next?: string }>;
}) {
  const { role, next } = await searchParams;
  return (
    <RegisterForm defaultRole={role === 'model' ? 'MODEL' : 'USER'} next={safeNext(next)} />
  );
}
