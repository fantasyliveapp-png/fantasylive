'use client';

import { useState } from 'react';

import { cn, formatMoney } from '@/lib/utils';

/**
 * Barras de lo ganado cada dia de la ultima semana (una sola serie: no lleva
 * leyenda, el titulo la nombra). Tocar o pasar el raton por una barra muestra
 * el importe exacto; el dia de hoy va resaltado.
 */
export function EarningsWeekChart({
  days,
}: {
  days: { label: string; cents: number }[];
}) {
  const [active, setActive] = useState<number | null>(null);
  const max = Math.max(...days.map((d) => d.cents), 1);
  const shown = active ?? days.length - 1;

  return (
    <div>
      <p className="mb-3 h-5 text-sm text-muted-foreground">
        <span className="font-semibold text-foreground">{formatMoney(days[shown]!.cents)}</span>{' '}
        {shown === days.length - 1 ? 'hoy' : `el ${days[shown]!.label.toLowerCase()}`}
      </p>

      <div
        className="flex h-32 items-end gap-1.5"
        role="img"
        aria-label={`Ganancias por dia: ${days
          .map((d) => `${d.label} ${formatMoney(d.cents)}`)
          .join(', ')}`}
        onMouseLeave={() => setActive(null)}
      >
        {days.map((day, i) => {
          const height = day.cents > 0 ? Math.max(6, (day.cents / max) * 100) : 0;
          const isToday = i === days.length - 1;
          return (
            <button
              key={i}
              type="button"
              onMouseEnter={() => setActive(i)}
              onFocus={() => setActive(i)}
              onClick={() => setActive(i)}
              className="group flex h-full flex-1 flex-col justify-end"
              aria-label={`${day.label}: ${formatMoney(day.cents)}`}
            >
              {/* Hueco minimo visible aunque el dia sea 0: se ve que existe. */}
              <span
                className={cn(
                  'block w-full rounded-t-[4px] transition-colors',
                  day.cents === 0 && 'h-[3px] rounded-[2px] bg-border',
                  day.cents > 0 &&
                    (shown === i
                      ? 'bg-state-connected'
                      : isToday
                        ? 'bg-state-connected/70'
                        : 'bg-state-connected/35 group-hover:bg-state-connected/60'),
                )}
                style={day.cents > 0 ? { height: `${height}%` } : undefined}
              />
            </button>
          );
        })}
      </div>

      <div className="mt-2 flex gap-1.5 border-t border-border/60 pt-2">
        {days.map((day, i) => (
          <span
            key={i}
            className={cn(
              'flex-1 text-center text-[10px]',
              shown === i ? 'font-semibold text-foreground' : 'text-muted-foreground',
            )}
          >
            {day.label}
          </span>
        ))}
      </div>
    </div>
  );
}
