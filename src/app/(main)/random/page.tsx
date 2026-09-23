import type { Metadata } from 'next';

import { MatchmakingLobby } from '@/components/calls/matchmaking-lobby';
import { requireUser } from '@/lib/auth/guards';
import { getQueueStats } from '@/lib/matchmaking';
import { getWalletSummary } from '@/lib/tokens';

export const metadata: Metadata = { title: 'Llamadas aleatorias' };
export const dynamic = 'force-dynamic';

export default async function RandomPage() {
  const user = await requireUser('/random');
  const [stats, wallet] = await Promise.all([
    getQueueStats(),
    getWalletSummary(user.id),
  ]);

  return (
    <div className="container py-12">
      <MatchmakingLobby
        mode="RANDOM"
        balance={wallet.balance}
        stats={{
          waiting: stats.waitingRandom,
          onlineModels: stats.onlineModels,
          vipModels: stats.vipModels,
        }}
      />
    </div>
  );
}
