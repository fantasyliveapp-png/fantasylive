import type { Metadata } from 'next';

import { AnalyticsPanel } from '@/components/model/analytics-panel';
import { requireModel } from '@/lib/auth/guards';
import { getCreatorAnalytics } from '@/lib/analytics';
import { config } from '@/lib/config';

export const metadata: Metadata = { title: 'Analiticas' };
export const dynamic = 'force-dynamic';

const ALLOWED_RANGES = [7, 30, 90];

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const { range } = await searchParams;
  const { user, profile } = await requireModel();

  // El rango viene de la URL: se recorta a los valores conocidos para que
  // nadie pida 100.000 dias y tumbe la consulta.
  const requested = Number(range);
  const rangeDays = ALLOWED_RANGES.includes(requested) ? requested : 30;

  const analytics = await getCreatorAnalytics({
    modelId: profile.id,
    modelUserId: user.id,
    rangeDays,
  });

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Analiticas</h1>
        <p className="mt-2 text-muted-foreground">
          Quien te visita, quien te compra y de donde viene tu dinero. Usalo
          para decidir precios, horarios y que contenido publicar.
        </p>
      </div>

      <AnalyticsPanel
        analytics={analytics}
        payoutCentsPerToken={config.economy.modelPayoutCentsPerToken}
      />
    </div>
  );
}
