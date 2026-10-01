import { BadgeCheck } from 'lucide-react';

import { cn } from '@/lib/utils';

/** Insignia de distribuidor oficial (lista, perfil y chat). */
export function DistributorBadge({ compact = false, className }: { compact?: boolean; className?: string }) {
  return (
    <span
      title="Distribuidor oficial de FantasyLive"
      className={cn(
        'inline-flex items-center gap-1 rounded-full bg-state-connected/15 font-semibold text-state-connected',
        compact ? 'px-1.5 py-0.5 text-[10px]' : 'px-2.5 py-1 text-xs',
        className,
      )}
    >
      <BadgeCheck className={compact ? 'h-3 w-3' : 'h-3.5 w-3.5'} />
      Distribuidor oficial
    </span>
  );
}
