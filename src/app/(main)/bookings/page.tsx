import type { Metadata } from 'next';
import Link from 'next/link';
import { CalendarDays, Clock, Coins } from 'lucide-react';

import { BookingActions } from '@/components/bookings/booking-actions';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { requireUser } from '@/lib/auth/guards';
import { BOOKING_STATUS_LABELS } from '@/lib/constants';
import { prisma } from '@/lib/prisma';
import { formatDateTime, formatTokens, initials } from '@/lib/utils';

export const metadata: Metadata = { title: 'Mis reservas' };
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

export default async function BookingsPage() {
  const user = await requireUser('/bookings');

  const bookings = await prisma.booking.findMany({
    where: { userId: user.id },
    orderBy: { startsAt: 'desc' },
    include: {
      model: {
        select: { stageName: true, slug: true, avatarUrl: true },
      },
      callSession: { select: { id: true, status: true } },
    },
  });

  const upcoming = bookings.filter(
    (b) =>
      ['PENDING_CONFIRMATION', 'CONFIRMED', 'IN_PROGRESS'].includes(b.status) &&
      b.startsAt > new Date(Date.now() - 60 * 60 * 1000),
  );
  const past = bookings.filter((b) => !upcoming.includes(b));

  return (
    <div className="container py-10">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Mis reservas</h1>
          <p className="mt-2 text-muted-foreground">
            Videollamadas privadas 1 a 1 agendadas con modelos.
          </p>
        </div>
        <Link href="/models">
          <Button variant="outline">
            <CalendarDays className="h-4 w-4" />
            Reservar nueva
          </Button>
        </Link>
      </div>

      {bookings.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <CalendarDays className="mx-auto h-8 w-8 text-muted-foreground" />
            <p className="mt-3 font-medium">Aun no tienes reservas</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Explora el catalogo y agenda tu primera videollamada privada.
            </p>
            <Link href="/models">
              <Button variant="brand" className="mt-5">
                Ver modelos
              </Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-10">
          {upcoming.length > 0 && (
            <section>
              <h2 className="mb-4 text-lg font-semibold">Proximas</h2>
              <div className="space-y-3">
                {upcoming.map((booking) => (
                  <BookingRow key={booking.id} booking={booking} isOwner />
                ))}
              </div>
            </section>
          )}

          {past.length > 0 && (
            <section>
              <h2 className="mb-4 text-lg font-semibold">Historial</h2>
              <div className="space-y-3">
                {past.map((booking) => (
                  <BookingRow key={booking.id} booking={booking} isOwner />
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}

function BookingRow({ booking, isOwner }: { booking: any; isOwner: boolean }) {
  const canJoin =
    booking.status === 'CONFIRMED' &&
    Date.now() > booking.startsAt.getTime() - 10 * 60 * 1000 &&
    Date.now() <
      booking.startsAt.getTime() + (booking.durationMinutes + 15) * 60 * 1000;

  return (
    <Card>
      <CardContent className="flex flex-wrap items-center gap-4 py-4">
        <Avatar className="h-12 w-12">
          {booking.model.avatarUrl && (
            <AvatarImage src={booking.model.avatarUrl} alt="" />
          )}
          <AvatarFallback>{initials(booking.model.stageName)}</AvatarFallback>
        </Avatar>

        <div className="min-w-[180px] flex-1">
          <Link
            href={`/models/${booking.model.slug}`}
            className="font-medium hover:underline"
          >
            {booking.model.stageName}
          </Link>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <CalendarDays className="h-3.5 w-3.5" />
              {formatDateTime(booking.startsAt)}
            </span>
            <span className="flex items-center gap-1">
              <Clock className="h-3.5 w-3.5" />
              {booking.durationMinutes} min
            </span>
            <span className="flex items-center gap-1">
              <Coins className="h-3.5 w-3.5" />
              {formatTokens(booking.totalTokens)}
            </span>
          </p>
          {booking.userNote && (
            <p className="mt-1 truncate text-xs italic text-muted-foreground">
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
          role={isOwner ? 'USER' : 'MODEL'}
        />
      </CardContent>
    </Card>
  );
}
