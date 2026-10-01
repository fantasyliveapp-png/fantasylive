import type { Metadata } from 'next';
import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';

import { ContentRule, ContentTabs, type ContentTab } from '@/components/content/content-hub';
import { LivePacksManager } from '@/components/content/live-packs-manager';
import { VaultManager } from '@/components/vault/vault-manager';
import { requireModel } from '@/lib/auth/guards';
import { config } from '@/lib/config';
import { effectiveTerms } from '@/lib/deals';
import { getLivePacks } from '@/lib/creator-content';
import { prisma } from '@/lib/prisma';
import { getVaultForCreator } from '@/lib/vault-data';

export const metadata: Metadata = { title: 'Contenido' };
export const dynamic = 'force-dynamic';

/**
 * CONTENIDO: lo privado que vende la creadora.
 *  - Para chat: la Boveda.
 *  - Para directos: los packs de su menu Especiales.
 * Lo publico no esta aqui: se ve y se gestiona en el feed y en su perfil.
 */
export default async function ContentPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { profile } = await requireModel();
  const { tab: raw } = await searchParams;
  // ?tab=publico (enlaces antiguos) cae en el primero.
  const tab: ContentTab = raw === 'directos' ? 'directos' : 'chat';

  // Para mostrar cada precio tambien en $ (lo que le llega al creador).
  const economy = {
    platformCommissionPercent: effectiveTerms(profile).platformPercent,
    payoutCentsPerToken: config.economy.modelPayoutCentsPerToken,
    payoutFeePercent: config.economy.payoutFeePercent,
  };

  const [chatCount, liveCount] = await Promise.all([
    prisma.vaultItem.count({ where: { modelId: profile.id } }),
    prisma.post.count({ where: { modelId: profile.id, liveExclusiveAt: { not: null }, removedAt: null } }),
  ]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-heading text-3xl uppercase tracking-wide">Contenido</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Lo privado que vendes: por chat o en tus directos. Tus publicaciones están en{' '}
          <Link href={`/models/${profile.slug}`} className="font-medium text-foreground hover:text-primary">
            tu perfil
          </Link>
          .
        </p>
      </div>

      <ContentTabs tab={tab} counts={{ chat: chatCount, directos: liveCount }} />

      {tab === 'chat' && (
        <>
          <ContentRule>
            Solo se vende por chat, en paquetes o sueltas. No se publica en ningún sitio y no puede
            repetirse en tus directos.
          </ContentRule>
          <VaultManager vault={await getVaultForCreator(profile.id, profile)} economy={economy} />
        </>
      )}

      {tab === 'directos' && (
        <>
          <ContentRule>
            Solo se vende en tus directos, desde tu menú de Especiales. No sale en el feed, ni en tu perfil,
            ni por chat. Cada fan lo compra una vez.
          </ContentRule>
          <p className="flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3.5 py-2.5 text-xs text-muted-foreground">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
            <span>
              <strong className="text-amber-500">Tiene que ser especial y único para tus directos.</strong> No repitas aquí
              fotos o vídeos del chat, del feed o de otros packs: el contenido repetido puede ser retirado y tu cuenta
              penalizada. Al crear un pack comprobamos que no esté repetido.
            </span>
          </p>
          <LivePacksManager packs={await getLivePacks(profile.id)} economy={economy} />
        </>
      )}
    </div>
  );
}
