'use client';

import { useMemo } from 'react';
import { Clock } from 'lucide-react';

import type { ActivityBucket } from '@/lib/creator-reach';
import { cn } from '@/lib/utils';

const DAYS = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];

const pad = (h: number) => `${String(h).padStart(2, '0')}:00`;

/**
 * MEJOR HORA PARA PUBLICAR.
 *
 * El servidor da la actividad por dia y hora en UTC; aqui se pasa a la hora
 * del movil de la creadora (por eso es un componente de cliente) y se busca
 * el tramo de 3 horas con mas actividad y el mejor dia.
 */
export function BestTimeCard({
  activity,
  source,
}: {
  activity: ActivityBucket[];
  source: 'fans' | 'platform';
}) {
  const data = useMemo(() => {
    const byHour = Array<number>(24).fill(0);
    const byDay = Array<number>(7).fill(0);
    // 7 de enero de 2024 fue domingo: semana de referencia para convertir.
    for (const b of activity) {
      const local = new Date(Date.UTC(2024, 0, 7 + b.dow, b.hour));
      byHour[local.getHours()]! += b.count;
      byDay[local.getDay()]! += b.count;
    }
    const total = byHour.reduce((a, v) => a + v, 0);
    let bestStart = 0;
    let bestSum = -1;
    for (let h = 0; h < 24; h += 1) {
      const sum = byHour[h]! + byHour[(h + 1) % 24]! + byHour[(h + 2) % 24]!;
      if (sum > bestSum) {
        bestSum = sum;
        bestStart = h;
      }
    }
    const bestDay = byDay.indexOf(Math.max(...byDay));
    return { byHour, total, bestStart, bestDay, max: Math.max(...byHour, 1) };
  }, [activity]);

  const inBest = (h: number) =>
    [data.bestStart, (data.bestStart + 1) % 24, (data.bestStart + 2) % 24].includes(h);

  return (
    <section className="rounded-2xl border border-border/60 bg-card p-4 sm:p-5">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <Clock className="h-4 w-4 text-primary" />
        Mejor hora para publicar
      </h2>

      {data.total < 10 ? (
        <p className="mt-2 text-sm text-muted-foreground">
          Aun no hay suficiente actividad para calcularla. Vuelve cuando tus publicaciones
          tengan mas vistas.
        </p>
      ) : (
        <>
          <p className="mt-2 text-sm">
            Publica entre las{' '}
            <strong className="text-primary">
              {pad(data.bestStart)} y las {pad((data.bestStart + 3) % 24)}
            </strong>
            {', '}sobre todo el <strong className="text-primary">{DAYS[data.bestDay]}</strong>.
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {source === 'fans'
              ? 'Es cuando mas miran tus publicaciones (ultimos 30 dias, en tu hora).'
              : 'Aun tienes pocas vistas: calculado con la actividad de toda la plataforma.'}
          </p>

          <div className="mt-4 flex h-24 items-end gap-[3px]" aria-hidden>
            {data.byHour.map((v, h) => (
              <div
                key={h}
                className={cn(
                  'flex-1 rounded-t-sm transition-all',
                  inBest(h) ? 'bg-primary' : 'bg-primary/20',
                )}
                style={{ height: `${Math.max(4, (v / data.max) * 100)}%` }}
                title={`${pad(h)}: ${v}`}
              />
            ))}
          </div>
          <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
            <span>00:00</span>
            <span>06:00</span>
            <span>12:00</span>
            <span>18:00</span>
            <span>23:00</span>
          </div>
        </>
      )}
    </section>
  );
}
