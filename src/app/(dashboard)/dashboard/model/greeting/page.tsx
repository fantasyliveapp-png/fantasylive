import type { Metadata } from 'next';

import { AutoGreetingForm } from '@/components/model/auto-greeting-form';
import { requireModel } from '@/lib/auth/guards';
import { resolveAssetUrl } from '@/lib/storage';
import { utcDay } from '@/lib/visits';

export const metadata: Metadata = { title: 'Mensaje de bienvenida' };
export const dynamic = 'force-dynamic';

export default async function GreetingPage() {
  const { profile } = await requireModel();

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
      />
    </div>
  );
}
