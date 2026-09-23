import type { Metadata } from 'next';

import { AutoGreetingForm } from '@/components/model/auto-greeting-form';
import { requireModel } from '@/lib/auth/guards';
import { config } from '@/lib/config';
import { prisma } from '@/lib/prisma';
import { resolveAssetUrl } from '@/lib/storage';
import { tokensToPayoutCents } from '@/lib/tokens';
import { utcDay } from '@/lib/visits';

export const metadata: Metadata = { title: 'Mensaje de bienvenida' };
export const dynamic = 'force-dynamic';

export default async function GreetingPage() {
  const { user, profile } = await requireModel();

  // Lo ganado de verdad con la foto de bienvenida (esta y las anteriores):
  // sus adjuntos viven bajo models/<id>/greeting/.
  const [earned, totalSent] = await Promise.all([
    prisma.transaction.aggregate({
      where: {
        userId: user.id,
        type: 'MESSAGE_ATTACHMENT_EARNING',
        messageAttachment: { storageKey: { startsWith: `models/${profile.id}/greeting/` } },
      },
      _sum: { tokens: true },
      _count: true,
    }),
    prisma.autoGreetingLog.count({ where: { modelId: profile.id } }),
  ]);

  const previewUrl = profile.autoGreetingPreviewKey
    ? await resolveAssetUrl(profile.autoGreetingPreviewKey, { isPublic: true })
    : null;

  // El contador solo cuenta si es de hoy: al cambiar el dia UTC se reinicia
  // en el propio envio, asi que aqui se interpreta igual.
  const sentToday =
    profile.autoGreetingCounterDay === utcDay()
      ? profile.autoGreetingSentToday
      : 0;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">
          Mensaje de bienvenida
        </h1>
        <p className="mt-2 text-muted-foreground">
          Un saludo automatico para quien entra por primera vez a tu perfil o a
          tu directo, con una foto que pueden desbloquear.
        </p>
      </div>

      <AutoGreetingForm
        enabled={profile.autoGreetingEnabled}
        text={profile.autoGreetingText ?? ''}
        priceTokens={profile.autoGreetingPriceTokens}
        dailyLimit={profile.autoGreetingDailyLimit}
        hasPhoto={Boolean(profile.autoGreetingAssetKey)}
        photoPreviewUrl={previewUrl}
        sentToday={sentToday}
        economy={{
          platformCommissionPercent: config.economy.platformCommissionPercent,
          payoutCentsPerToken: config.economy.modelPayoutCentsPerToken,
          payoutFeePercent: config.economy.payoutFeePercent,
        }}
        stats={{
          sent: totalSent,
          unlocks: earned._count,
          earnedCents: tokensToPayoutCents(earned._sum.tokens ?? 0),
        }}
      />
    </div>
  );
}
