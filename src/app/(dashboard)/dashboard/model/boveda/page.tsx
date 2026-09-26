import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

import { VaultManager } from '@/components/vault/vault-manager';
import { requireModel } from '@/lib/auth/guards';
import { getVaultForCreator } from '@/lib/vault-data';

export const metadata: Metadata = { title: 'Boveda' };
export const dynamic = 'force-dynamic';

/**
 * BOVEDA: el contenido privado de la creadora para enviar por chat (ella o su
 * equipo). No se publica en ningun sitio.
 */
export default async function VaultPage() {
  const { profile } = await requireModel();
  const vault = await getVaultForCreator(profile.id, profile);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Link
          href="/dashboard/model/ajustes"
          className="rounded-full p-1.5 hover:bg-muted"
          aria-label="Volver"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="font-heading text-3xl uppercase tracking-wide">Boveda</h1>
      </div>
      <p className="text-sm text-muted-foreground">
        Tus fotos y videos listos para enviar por chat, sin publicarlos. Tu y tu equipo los envian
        desde el boton de la Boveda en cada conversacion.
      </p>
      <VaultManager
        vault={vault}
        prices={{
          level1: profile.vaultPriceLevel1,
          level2: profile.vaultPriceLevel2,
          level3: profile.vaultPriceLevel3,
          special: profile.vaultPriceSpecial,
        }}
      />
    </div>
  );
}
