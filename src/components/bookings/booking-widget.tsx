'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { CalendarDays, Coins, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { BOOKING_DURATIONS } from '@/lib/constants';
import { createBookingAction } from '@/server/actions/bookings';
import { formatTokens } from '@/lib/utils';

interface Slot {
  weekday: number;
  startMinute: number;
  endMinute: number;
}

interface BookingWidgetProps {
  slug: string;
  stageName: string;
  ratePerMinute: number;
  minMinutes: number;
  isAuthenticated: boolean;
  availability: Slot[];
}

const DAY_LABELS = ['Dom', 'Lun', 'Mar', 'Mie', 'Jue', 'Vie', 'Sab'];

/** Genera los proximos 14 dias a partir de manana. */
function nextDays(count: number) {
  const days: Date[] = [];
  for (let i = 1; i <= count; i++) {
    const d = new Date();
    d.setDate(d.getDate() + i);
    d.setHours(0, 0, 0, 0);
    days.push(d);
  }
  return days;
}

export function BookingWidget({
  slug,
  stageName,
  ratePerMinute,
  minMinutes,
  isAuthenticated,
  availability,
}: BookingWidgetProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const days = useMemo(() => nextDays(14), []);
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);
  const [selectedTime, setSelectedTime] = useState<number | null>(null);
  const [duration, setDuration] = useState<number>(
    BOOKING_DURATIONS.find((d) => d >= minMinutes) ?? minMinutes,
  );
  const [note, setNote] = useState('');

  /** Horas disponibles ese dia segun la agenda publicada por la modelo. */
  const timeSlots = useMemo(() => {
    if (!selectedDay) return [];

    const daySlots = availability.filter(
      (s) => s.weekday === selectedDay.getDay(),
    );

    // Sin agenda publicada: se ofrece una franja por defecto de 10:00 a 23:00
    const ranges =
      daySlots.length > 0
        ? daySlots
        : [{ weekday: selectedDay.getDay(), startMinute: 600, endMinute: 1380 }];

    const slots: number[] = [];
    for (const range of ranges) {
      for (
        let m = range.startMinute;
        m + duration <= range.endMinute;
        m += 30
      ) {
        slots.push(m);
      }
    }
    return slots;
  }, [availability, selectedDay, duration]);

  const totalTokens = ratePerMinute * duration;

  const availableWeekdays = new Set(availability.map((a) => a.weekday));

  function submit() {
    if (!isAuthenticated) {
      router.push(`/login?callbackUrl=/models/${slug}`);
      return;
    }
    if (!selectedDay || selectedTime === null) {
      toast.error('Elige dia y hora.');
      return;
    }

    const startsAt = new Date(selectedDay);
    startsAt.setMinutes(selectedTime);

    startTransition(async () => {
      const result = await createBookingAction({
        modelSlug: slug,
        startsAt: startsAt.toISOString(),
        durationMinutes: duration,
        note: note.trim() || undefined,
      });

      if (result.ok) {
        toast.success(result.message ?? 'Reserva creada');
        router.push('/bookings');
      } else {
        toast.error(result.error ?? 'No se pudo crear la reserva');
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <CalendarDays className="h-4 w-4 text-primary" />
          Reservar privado
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-5">
        {/* Duracion */}
        <div className="space-y-2">
          <Label className="text-xs uppercase tracking-wide text-muted-foreground">
            Duracion
          </Label>
          <div className="flex flex-wrap gap-1.5">
            {BOOKING_DURATIONS.filter((d) => d >= minMinutes).map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => {
                  setDuration(d);
                  setSelectedTime(null);
                }}
                className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
                  duration === d
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border hover:bg-muted'
                }`}
              >
                {d} min
              </button>
            ))}
          </div>
        </div>

        {/* Dia */}
        <div className="space-y-2">
          <Label className="text-xs uppercase tracking-wide text-muted-foreground">
            Dia
          </Label>
          <div className="grid grid-cols-7 gap-1">
            {days.slice(0, 14).map((day) => {
              const isSelected =
                selectedDay?.toDateString() === day.toDateString();
              const hasAvailability =
                availability.length === 0 || availableWeekdays.has(day.getDay());

              return (
                <button
                  key={day.toISOString()}
                  type="button"
                  disabled={!hasAvailability}
                  onClick={() => {
                    setSelectedDay(day);
                    setSelectedTime(null);
                  }}
                  className={`flex flex-col items-center rounded-lg border py-1.5 text-[11px] transition-colors disabled:opacity-30 ${
                    isSelected
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border hover:bg-muted'
                  }`}
                >
                  <span className="text-muted-foreground">
                    {DAY_LABELS[day.getDay()]}
                  </span>
                  <span className="font-semibold">{day.getDate()}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Hora */}
        {selectedDay && (
          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">
              Hora
            </Label>
            {timeSlots.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Sin huecos ese dia para {duration} minutos.
              </p>
            ) : (
              <div className="grid max-h-40 grid-cols-4 gap-1.5 overflow-y-auto pr-1">
                {timeSlots.map((minutes) => {
                  const h = Math.floor(minutes / 60);
                  const m = minutes % 60;
                  const label = `${h.toString().padStart(2, '0')}:${m
                    .toString()
                    .padStart(2, '0')}`;
                  return (
                    <button
                      key={minutes}
                      type="button"
                      onClick={() => setSelectedTime(minutes)}
                      className={`rounded-lg border py-1.5 text-xs font-medium transition-colors ${
                        selectedTime === minutes
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-border hover:bg-muted'
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Nota */}
        <div className="space-y-2">
          <Label htmlFor="note" className="text-xs uppercase tracking-wide text-muted-foreground">
            Nota para {stageName} (opcional)
          </Label>
          <Textarea
            id="note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={300}
            placeholder="Cuentale que te gustaria..."
            className="min-h-[70px] text-sm"
          />
        </div>

        {/* Total */}
        <div className="rounded-lg bg-muted/50 p-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">
              {duration} min x {ratePerMinute} tokens
            </span>
            <Badge variant="token" className="gap-1">
              <Coins className="h-3 w-3" />
              {formatTokens(totalTokens)}
            </Badge>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Los tokens se retienen ahora y se liberan a la modelo al finalizar la
            sesion. Cancelacion gratuita hasta 2 h antes.
          </p>
        </div>

        <Button
          variant="brand"
          className="w-full"
          size="lg"
          onClick={submit}
          disabled={isPending || !selectedDay || selectedTime === null}
        >
          {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          {isAuthenticated ? 'Confirmar reserva' : 'Inicia sesion para reservar'}
        </Button>
      </CardContent>
    </Card>
  );
}
