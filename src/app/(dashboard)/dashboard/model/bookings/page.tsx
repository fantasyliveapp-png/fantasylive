import type { Metadata } from 'next';
import { CalendarDays, Clock, Coins } from 'lucide-react';

import { BookingActions } from '@/components/bookings/booking-actions';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { requireModel } from '@/lib/auth/guards';
import { BOOKING_STATUS_LABELS } from '@/lib/constants';
import { prisma } from '@/lib/prisma';
import { formatDateTime, formatTokens, initials } from '@/lib/utils';

export const metadata: Metadata = { title: 'Reservas recibidas' };
export const dynamic = 'force-dynamic';

const STATUS_VARIANT: Record<string, any> = {
  PENDING_CONFIRMATION: 'warning',
  CONFIRMED: 'success',
  IN_PROGRESS: 'live',
  COMPLETED: 'muted',
  CANCELLED_BY_USER: 'destructive',
  CANCELLED_BY_MODEL: 'destructive',
  NO_SHOW: 'destructive',
  REFUNDED: 'muted',
};

export default async function ModelBookingsPage() {
  const { profile } = await requireModel();

  const bookings = await prisma.booking.findMany({
    where: { modelId: profile.id },
    orderBy: { startsAt: 'desc' },
    include: {
      user: { select: { name: true, image: true, country: true } },
      callSession: { select: { id: true } },
    },
  });

  const pending = bookings.filter((b) => b.status === 'PENDING_CONFIRMATION');
  const confirmed = bookings.filter((b) =>
    ['CONFIRMED', 'IN_PROGRESS'].includes(b.status),
  );
  const rest = bookings.filter(
    (b) => !pending.includes(b) && !confirmed.includes(b),
  );

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Reservas</h1>
        <p className="mt-2 text-muted-foreground">
          Confirma o rechaza las solicitudes de videollamada privada.
        </p>
      </div>

      {bookings.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <CalendarDays className="mx-auto h-8 w-8 text-muted-foreground" />
            <p className="mt-3 font-medium">Aun no tienes reservas</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Activa las reservas en tus tarifas y publica tus horarios para
              recibir solicitudes.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {pending.length > 0 && (
            <Section title={`Pendientes de confirmar (${pending.length})`}>
              {pending.map((b) => (
                <Row key={b.id} booking={b} />
              ))}
            </Section>
          )}
          {confirmed.length > 0 && (
            <Section title="Confirmadas">
              {confirmed.map((b) => (
                <Row key={b.id} booking={b} />
              ))}
            </Section>
          )}
          {rest.length > 0 && (
            <Section title="Historial">
              {rest.map((b) => (
                <Row key={b.id} booking={b} />
              ))}
            </Section>
          )}
        </>
      )}
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="mb-3 text-lg font-semibold">{title}</h2>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function Row({ booking }: { booking: any }) {
  const canJoin =
    booking.status === 'CONFIRMED' &&
    Date.now() > booking.startsAt.getTime() - 10 * 60 * 1000 &&
    Date.now() <
      booking.startsAt.getTime() + (booking.durationMinutes + 15) * 60 * 1000;

  return (
    <Card>
      <CardContent className="flex flex-wrap items-center gap-4 py-4">
        <Avatar className="h-11 w-11">
          <AvatarFallback>{initials(booking.user.name)}</AvatarFallback>
        </Avatar>

        <div className="min-w-[180px] flex-1">
          <p className="font-medium">
            {booking.user.name ?? 'Usuario'}
            {booking.user.country ? ` · ${booking.user.country}` : ''}
          </p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <CalendarDays className="h-3.5 w-3.5" />
              {formatDateTime(booking.startsAt)}
            </span>
            <span className="flex items-center gap-1">
              <Clock className="h-3.5 w-3.5" />
              {booking.durationMinutes} min
            </span>
            <span className="flex items-center gap-1 text-token">
              <Coins className="h-3.5 w-3.5" />
              {formatTokens(booking.totalTokens)}
            </span>
          </p>
          {booking.userNote && (
            <p className="mt-1 text-xs italic text-muted-foreground">
              &ldquo;{booking.userNote}&rdquo;
            </p>
          )}
        </div>

        <Badge variant={STATUS_VARIANT[booking.status] ?? 'muted'}>
          {BOOKING_STATUS_LABELS[booking.status as keyof typeof BOOKING_STATUS_LABELS]}
        </Badge>

        <BookingActions
          bookingId={booking.id}
          status={booking.status}
          canJoin={canJoin}
          existingSessionId={booking.callSession?.id ?? null}
          role="MODEL"
        />
      </CardContent>
    </Card>
  );
}
