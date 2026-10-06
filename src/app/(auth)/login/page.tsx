import type { Metadata } from 'next';

import { LoginForm } from '@/components/auth/login-form';
import { safeNext } from '@/lib/safe-next';
import { pageMeta } from '@/lib/seo';

export const metadata: Metadata = pageMeta('Iniciar sesión', 'Entra en tu cuenta para ver a tus creadores favoritos, tus mensajes y tu monedero de tokens.');

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string }>;
}) {
  const { callbackUrl } = await searchParams;
  return <LoginForm callbackUrl={safeNext(callbackUrl) ?? '/'} />;
}
