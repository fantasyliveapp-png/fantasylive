import type { Metadata } from 'next';

import { RatesForm } from '@/components/model/rates-form';
import { ProfileForm } from '@/components/model/profile-form';
import { requireModel } from '@/lib/auth/guards';

export const metadata: Metadata = { title: 'Tarifas y perfil' };
export const dynamic = 'force-dynamic';

export default async function RatesPage() {
  const { profile } = await requireModel();

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Tarifas y perfil</h1>
        <p className="mt-2 text-muted-foreground">
          Define cuanto cobras por minuto y como te ven los usuarios.
        </p>
      </div>

      <RatesForm
        vipRatePerMinute={profile.vipRatePerMinute}
        privateRatePerMinute={profile.privateRatePerMinute}
        minPrivateMinutes={profile.minPrivateMinutes}
        isVipEnabled={profile.isVipEnabled}
        acceptsBookings={profile.acceptsBookings}
        subscriptionEnabled={profile.subscriptionEnabled}
        subscriptionPriceTokens={profile.subscriptionPriceTokens}
        subscriptionDiscountPercent={profile.subscriptionDiscountPercent}
        messagingEnabled={profile.messagingEnabled}
        messagePriceTokens={profile.messagePriceTokens}
        kycApproved={profile.kycStatus === 'APPROVED'}
      />

      <ProfileForm
        stageName={profile.stageName}
        headline={profile.headline ?? ''}
        bio={profile.bio ?? ''}
        languages={profile.languages}
        tags={profile.tags}
        avatarUrl={profile.avatarUrl ?? ''}
        coverUrl={profile.coverUrl ?? ''}
        slug={profile.slug}
      />
    </div>
  );
}
