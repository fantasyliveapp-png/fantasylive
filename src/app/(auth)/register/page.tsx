import type { Metadata } from 'next';

import { RegisterForm } from '@/components/auth/register-form';
import { getInviterName } from '@/lib/referral-inviter';
import { safeNext } from '@/lib/safe-next';
import { pageMeta } from '@/lib/seo';

export const metadata: Metadata = pageMeta('Crear cuenta', 'Crea tu cuenta gratis y conecta con tus creadores favoritos en directo, por videollamada y por mensaje. Solo mayores de 18.');

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ role?: string; next?: string }>;
}) {
  const { role, next } = await searchParams;
  return (
    <RegisterForm
      defaultRole={role === 'model' ? 'MODEL' : 'USER'}
      next={safeNext(next)}
      inviterName={await getInviterName()}
    />
  );
}
