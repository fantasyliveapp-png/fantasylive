import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { StudioLauncher } from '@/components/feed/studio-launcher';
import { requireModel } from '@/lib/auth/guards';
import { config } from '@/lib/config';

export const metadata: Metadata = { title: 'Nueva publicacion' };
export const dynamic = 'force-dynamic';

/**
 * El estudio de publicacion (el +, "Nueva publicacion" en Hoy, el perfil y
 * el panel). No es una pagina de "mis publicaciones": esas se ven en el
 * perfil, asi que sin ?nuevo se va alli.
 */
export default async function NewPostPage({
  searchParams,
}: {
  searchParams: Promise<{ nuevo?: string; t?: string }>;
}) {
  const { profile } = await requireModel();
  const { nuevo, t } = await searchParams;
  const profileHref = `/models/${profile.slug}`;

  if (!nuevo) redirect(profileHref);

  return (
    <StudioLauncher
      // Clave por apertura: volver a pulsar "+" estando aqui reinicia el estudio.
      key={t ?? nuevo}
      profileHref={profileHref}
      economy={{
        platformCommissionPercent: config.economy.platformCommissionPercent,
        payoutCentsPerToken: config.economy.modelPayoutCentsPerToken,
        payoutFeePercent: config.economy.payoutFeePercent,
      }}
      subscriptionEnabled={profile.subscriptionEnabled}
      model={{
        id: profile.id,
        slug: profile.slug,
        stageName: profile.stageName,
        avatarUrl: profile.avatarUrl,
        isAi: profile.isAi,
        subscriptionPriceTokens: profile.subscriptionPriceTokens,
      }}
    />
  );
}
