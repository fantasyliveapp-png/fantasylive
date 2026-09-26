import type { Metadata } from 'next';

import { RatesForm } from '@/components/model/rates-form';
import { requireModel } from '@/lib/auth/guards';
import { config } from '@/lib/config';

export const metadata: Metadata = { title: 'Precios y herramientas' };
export const dynamic = 'force-dynamic';

export default async function RatesPage() {
  const { profile } = await requireModel();

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Precios y herramientas</h1>
        <p className="mt-2 text-muted-foreground">
          Activa como quieres cobrar (suscripcion, mensajes, citas, sala VIP) y a
          que precio. Lo que dejes apagado no aparece en tu perfil ni en tu
          Bandeja.
        </p>
      </div>

      <RatesForm
        vipRateCentitokens={profile.vipRateCentitokens}
        privateRateCentitokens={profile.privateRateCentitokens}
        minPrivateMinutes={profile.minPrivateMinutes}
        isVipEnabled={profile.isVipEnabled}
        acceptsBookings={profile.acceptsBookings}
        subscriptionEnabled={profile.subscriptionEnabled}
        subscriptionPriceTokens={profile.subscriptionPriceTokens}
        subscriptionDiscountPercent={profile.subscriptionDiscountPercent}
        messagingEnabled={profile.messagingEnabled}
        messagePriceTokens={profile.messagePriceTokens}
        kycApproved={profile.kycStatus === 'APPROVED'}
        modelSharePercent={config.economy.modelRevenueSharePercent}
        payoutCentsPerToken={config.economy.modelPayoutCentsPerToken}
      />
    </div>
  );
}
