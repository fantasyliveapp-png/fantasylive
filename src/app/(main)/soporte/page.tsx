import type { Metadata } from 'next';
import Link from 'next/link';
import { ChevronRight, LifeBuoy } from 'lucide-react';

import { NewTicketForm } from '@/components/support/support-forms';
import { requireUser } from '@/lib/auth/guards';
import { prisma } from '@/lib/prisma';
import { SUPPORT_STATUS_LABELS, supportCategoryLabel } from '@/lib/support';
import { cn, relativeTime } from '@/lib/utils';

export const metadata: Metadata = { title: 'Soporte' };
export const dynamic = 'force-dynamic';

/** SOPORTE: escribir al equipo y ver las consultas abiertas. */
export default async function SupportPage() {
  const user = await requireUser('/soporte');
  const tickets = await prisma.supportTicket.findMany({
    where: { userId: user.id },
    orderBy: { updatedAt: 'desc' },
    take: 30,
    select: { id: true, subject: true, category: true, status: true, updatedAt: true },
  });

  return (
    <div className="container max-w-2xl space-y-6 py-6">
      <div className="flex items-center gap-3">
        <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/15 text-primary">
          <LifeBuoy className="h-5 w-5" />
        </span>
        <div>
          <h1 className="font-heading text-2xl uppercase tracking-wide">Soporte</h1>
          <p className="text-sm text-muted-foreground">
            Escribenos y te respondemos aqui mismo. Te avisaremos con una notificacion.
          </p>
        </div>
      </div>

      {tickets.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold">Tus consultas</h2>
          <ul className="divide-y divide-border/60 overflow-hidden rounded-2xl border border-border/60 bg-card">
            {tickets.map((t) => (
              <li key={t.id}>
                <Link
                  href={`/soporte/${t.id}`}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-muted/40"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{t.subject}</span>
                    <span className="block text-xs text-muted-foreground">
                      {supportCategoryLabel(t.category)} · {relativeTime(t.updatedAt)}
                    </span>
                  </span>
                  <span
                    className={cn(
                      'shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium',
                      t.status === 'ANSWERED'
                        ? 'bg-state-connected/15 text-state-connected'
                        : t.status === 'OPEN'
                          ? 'bg-amber-500/15 text-amber-500'
                          : 'bg-muted text-muted-foreground',
                    )}
                  >
                    {SUPPORT_STATUS_LABELS[t.status]}
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Nueva consulta</h2>
        <NewTicketForm />
      </section>
    </div>
  );
}
