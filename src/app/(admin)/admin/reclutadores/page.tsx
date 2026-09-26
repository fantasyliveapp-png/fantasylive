import type { Metadata } from 'next';

import { AdminPageHeader } from '@/components/admin/admin-shell';

import { CreateRecruiterForm, RecruiterRow } from '@/components/admin/recruiter-admin';
import { requireAdmin } from '@/lib/auth/guards';
import { config } from '@/lib/config';
import { prisma } from '@/lib/prisma';
import { getRecruiterOverview } from '@/lib/recruiters';
import { tokensToPayoutCents } from '@/lib/tokens';

export const metadata: Metadata = { title: 'Reclutadores' };
export const dynamic = 'force-dynamic';

/**
 * RECLUTADORES: personas que solo traen creadoras a cambio de un % de sus
 * ventas (de la comision). Se dan de alta aqui con lo negociado; los pagos
 * se hacen fuera y se anotan aqui.
 */
export default async function RecruitersAdminPage() {
  await requireAdmin();
  const list = await prisma.recruiter.findMany({
    orderBy: [{ active: 'desc' }, { createdAt: 'desc' }],
    select: { id: true },
  });
  const overviews = (await Promise.all(list.map((r) => getRecruiterOverview(r.id)))).filter(
    (r): r is NonNullable<typeof r> => r !== null,
  );
  const baseUrl = config.app.url.replace(/\/$/, '');
  // Pagos semanales a partir del minimo de retiro ($25).
  const minPayoutCents = tokensToPayoutCents(config.economy.minPayoutTokens);

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Reclutadores"
        description={<>Personas que traen creadoras a cambio de un % de lo que venden. Se paga de nuestra comision y solo cuando la creadora ya ha vendido.</>}
      />
      <CreateRecruiterForm />
      {overviews.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border/60 p-8 text-center text-sm text-muted-foreground">
          Aun no hay reclutadores.
        </p>
      ) : (
        <ul className="space-y-2">
          {overviews.map((r) => (
            <RecruiterRow key={r.id} r={r} baseUrl={baseUrl} minPayoutCents={minPayoutCents} />
          ))}
        </ul>
      )}
    </div>
  );
}
