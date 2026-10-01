import Link from 'next/link';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  monthLabel,
  type RecruiterOverview,
  type RecruiterPayment,
  type RecruitRow,
  type RecruitStatus,
} from '@/lib/recruiters';
import { cn, formatDate, formatMoney, initials } from '@/lib/utils';

/**
 * Piezas comunes del panel del reclutador y de su ficha en el admin: lo ganado
 * mes a mes, lo ganado por cada creadora y el historial de pagos.
 */

export const RECRUIT_STATUS: Record<RecruitStatus, { label: string; cls: string }> = {
  registered: { label: 'Registrada', cls: 'bg-muted text-muted-foreground' },
  verifying: { label: 'Verificandose', cls: 'bg-amber-500/15 text-amber-500' },
  active: { label: 'Activa', cls: 'bg-state-connected/15 text-state-connected' },
  out_of_quota: { label: 'Fuera de cupo', cls: 'bg-destructive/15 text-destructive' },
};

/** Cifra suelta de un resumen. */
export function SummaryStat({
  label,
  value,
  hint,
  highlight,
}: {
  label: string;
  value: string;
  hint?: string;
  highlight?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-border/60 bg-card p-3">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className={cn('mt-1 text-xl font-semibold tabular-nums', highlight && 'text-state-connected')}>
        {value}
      </p>
      {hint && <p className="mt-0.5 text-[10px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** Barras de lo ganado en los ultimos 6 meses. */
export function MonthlyEarnings({ monthly }: { monthly: RecruiterOverview['monthly'] }) {
  const max = Math.max(1, ...monthly.map((m) => m.cents));
  return (
    <div className="rounded-2xl border border-border/60 bg-card p-4">
      <p className="text-sm font-semibold">Ganado por mes</p>
      <div className="mt-4 grid h-40 grid-cols-6 gap-2">
        {monthly.map((m, i) => {
          const current = i === monthly.length - 1;
          return (
            <div key={m.month} className="flex h-full flex-col items-center justify-end gap-1">
              <span className="text-[10px] tabular-nums text-muted-foreground">
                {m.cents > 0 ? formatMoney(m.cents) : ''}
              </span>
              <div className="flex min-h-0 w-full flex-1 items-end">
                <div
                  className={cn('w-full rounded-t-md', current ? 'bg-primary' : 'bg-primary/35')}
                  style={{ height: `${Math.max(2, (m.cents / max) * 100)}%` }}
                  title={`${monthLabel(m.month)}: ${formatMoney(m.cents)}`}
                />
              </div>
              <span className={cn('text-[10px] uppercase', current ? 'font-semibold' : 'text-muted-foreground')}>
                {monthLabel(m.month)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Lo que ha ganado con cada creadora que trajo. */
export function RecruitEarnings({
  recruits,
  months,
  linkProfiles = false,
  emptyText,
}: {
  recruits: RecruitRow[];
  /** Meses de comision por creadora (null = para siempre). */
  months: number | null;
  /** En el admin se enlaza el perfil de cada creadora. */
  linkProfiles?: boolean;
  emptyText: string;
}) {
  if (recruits.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-border/60 p-6 text-center text-sm text-muted-foreground">
        {emptyText}
      </p>
    );
  }
  const now = Date.now();
  return (
    <div className="overflow-hidden rounded-2xl border border-border/60 bg-card">
      <div className="hidden grid-cols-[minmax(0,1fr)_110px_70px_90px_90px] gap-3 border-b border-border/60 px-4 py-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground sm:grid">
        <span>Creador</span>
        <span>Cobras hasta</span>
        <span className="text-right">Ventas</span>
        <span className="text-right">Este mes</span>
        <span className="text-right">Total</span>
      </div>
      <ul className="divide-y divide-border/60">
        {recruits.map((c) => {
          const ended = c.commissionEndsAt != null && new Date(c.commissionEndsAt).getTime() < now;
          const until = !c.creatorSince
            ? '—'
            : months == null
              ? 'Siempre'
              : formatDate(c.commissionEndsAt!);
          const name =
            linkProfiles && c.slug ? (
              <Link href={`/models/${c.slug}`} className="hover:underline">
                {c.name}
              </Link>
            ) : (
              c.name
            );
          return (
            <li
              key={c.userId}
              className="grid grid-cols-2 gap-x-3 gap-y-2 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_110px_70px_90px_90px] sm:items-center"
            >
              <div className="col-span-2 flex min-w-0 items-center gap-3 sm:col-span-1">
                <Avatar className="h-9 w-9">
                  {c.avatarUrl && <AvatarImage src={c.avatarUrl} alt="" />}
                  <AvatarFallback>{initials(c.name)}</AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{name}</p>
                  <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <span className={cn('rounded-full px-1.5 py-px font-medium', RECRUIT_STATUS[c.status].cls)}>
                      {RECRUIT_STATUS[c.status].label}
                    </span>
                    {c.lastSaleAt && <span>Ultima venta {formatDate(c.lastSaleAt)}</span>}
                  </p>
                </div>
              </div>
              <Cell label="Cobras hasta" className={cn(ended && 'text-muted-foreground line-through')}>
                {until}
              </Cell>
              <Cell label="Ventas" right>
                {c.salesCount}
              </Cell>
              <Cell label="Este mes" right>
                {formatMoney(c.earnedThisMonthCents)}
              </Cell>
              <Cell label="Total" right className="font-semibold text-state-connected">
                {formatMoney(c.earnedCents)}
              </Cell>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Cell({
  label,
  right,
  className,
  children,
}: {
  label: string;
  right?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn('text-sm tabular-nums', right && 'sm:text-right', className)}>
      <span className="block text-[10px] font-normal text-muted-foreground no-underline sm:hidden">
        {label}
      </span>
      {children}
    </div>
  );
}

/** Pagos ya hechos al reclutador. */
export function PaymentHistory({
  payments,
  showNotes = false,
}: {
  payments: RecruiterPayment[];
  /** La referencia del pago solo se enseña en el admin. */
  showNotes?: boolean;
}) {
  if (payments.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-border/60 p-6 text-center text-sm text-muted-foreground">
        Aun no hay pagos.
      </p>
    );
  }
  return (
    <ul className="divide-y divide-border/60 overflow-hidden rounded-2xl border border-border/60 bg-card">
      {payments.map((p) => (
        <li key={p.id} className="flex items-start gap-3 px-4 py-3 text-sm">
          <div className="min-w-0 flex-1">
            <p className="font-medium">{formatDate(p.date)}</p>
            {showNotes && p.description && (
              <p className="truncate text-xs text-muted-foreground" title={p.description}>
                {p.description}
              </p>
            )}
          </div>
          <div className="text-right">
            <p className="font-semibold tabular-nums">{formatMoney(p.cents)}</p>
            {p.feeCents > 0 && (
              <p className="text-[10px] text-muted-foreground">
                comision de retiro {formatMoney(p.feeCents)}
              </p>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
