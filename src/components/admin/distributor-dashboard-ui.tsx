import Link from 'next/link';

import { SALE_STATUS_LABEL, type SALE_STATUSES } from '@/lib/distributor-dashboard-labels';
import { cn } from '@/lib/utils';

/** Piezas del panel de distribuidores (admin): tarjetas, tablas y filtros. */

export function Kpi({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'good' | 'warn' }) {
  return (
    <div className={cn('rounded-2xl border p-4', tone === 'good' ? 'border-state-connected/40 bg-state-connected/5' : tone === 'warn' ? 'border-amber-500/40 bg-amber-500/5' : 'border-border/60 bg-card')}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
      <p className={cn('mt-1 text-xl font-bold', tone === 'good' && 'text-state-connected', tone === 'warn' && 'text-amber-500')}>{value}</p>
      {sub && <p className="text-[11px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

export function TableWrap({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-border/60 bg-card">
      <table className="w-full text-sm">{children}</table>
    </div>
  );
}

export function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return <th className={cn('whitespace-nowrap px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground', right ? 'text-right' : 'text-left')}>{children}</th>;
}

export function Td({ children, right, className, colSpan, title }: { children: React.ReactNode; right?: boolean; className?: string; colSpan?: number; title?: string }) {
  return <td colSpan={colSpan} title={title} className={cn('px-3 py-2', right && 'text-right tabular-nums', className)}>{children}</td>;
}

export function Select({ name, label, value, options }: { name: string; label: string; value: string; options: [string, string][] }) {
  return (
    <label className="space-y-1 text-[11px] text-muted-foreground">
      {label}
      <select name={name} defaultValue={value} className="block h-9 rounded-lg border border-border/60 bg-background px-2 text-sm text-foreground">
        {options.map(([v, l]) => (
          <option key={v} value={v}>{l}</option>
        ))}
      </select>
    </label>
  );
}

export function SaleStatus({ status }: { status: (typeof SALE_STATUSES)[number] }) {
  const tone = {
    AWAITING_PAYMENT: 'bg-amber-500/15 text-amber-500',
    PAID: 'bg-primary/15 text-primary',
    DISPUTED: 'bg-rose-500/15 text-rose-500',
    COMPLETED: 'bg-state-connected/15 text-state-connected',
    CANCELLED: 'bg-muted text-muted-foreground',
  }[status];
  return <span className={cn('whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium', tone)}>{SALE_STATUS_LABEL[status]}</span>;
}

export function StatusPill({ d }: { d: { status: string; compliant: boolean; isAvailable: boolean } }) {
  const [text, tone] =
    d.status === 'SUSPENDED'
      ? ['En pausa', 'bg-muted text-muted-foreground']
      : !d.compliant
        ? ['Falta verificación', 'bg-amber-500/15 text-amber-500']
        : d.isAvailable
          ? ['Disponible', 'bg-state-connected/15 text-state-connected']
          : ['No disponible', 'bg-muted text-muted-foreground'];
  return <span className={cn('whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium', tone)}>{text}</span>;
}

export function Pager({ page, pages, hrefFor }: { page: number; pages: number; hrefFor: (p: number) => string }) {
  if (pages <= 1) return null;
  return (
    <div className="flex items-center justify-center gap-3 text-sm">
      {page > 1 && <Link href={hrefFor(page - 1)} className="text-primary">← Anterior</Link>}
      <span className="text-muted-foreground">Página {page} de {pages}</span>
      {page < pages && <Link href={hrefFor(page + 1)} className="text-primary">Siguiente →</Link>}
    </div>
  );
}
