import Link from 'next/link';
import type { KycStatus } from '@prisma/client';
import {
  BadgeCheck,
  Camera,
  Clock,
  CreditCard,
  FileText,
  Lock,
  MessageSquareHeart,
  Pencil,
  Radio,
  ShieldCheck,
  SquarePen,
  Wallet,
  XCircle,
  type LucideIcon,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const LOCKED: { icon: LucideIcon; label: string }[] = [
  { icon: SquarePen, label: 'Publicar fotos, videos y encuestas' },
  { icon: Radio, label: 'Hacer directos y videollamadas' },
  { icon: CreditCard, label: 'Cobrar: suscripcion, mensajes, reservas y pedidos' },
  { icon: MessageSquareHeart, label: 'Mensaje de bienvenida' },
  { icon: Wallet, label: 'Retirar dinero' },
];

const STEPS: { icon: LucideIcon; title: string; hint: string }[] = [
  { icon: FileText, title: 'Tu documento', hint: 'DNI, pasaporte o carnet de conducir' },
  { icon: Camera, title: 'Un selfie con el documento', hint: 'Para comprobar que eres tu' },
  { icon: Clock, title: 'Lo revisamos', hint: 'En 24-48 h te avisamos' },
];

/**
 * Lo que ve una creadora en su panel mientras no esta verificada: por que
 * hace falta, que tiene bloqueado y el siguiente paso segun su estado
 * (sin enviar, en revision o rechazada).
 */
export function KycGate({
  status,
  rejectionReason,
  profileSlug,
}: {
  status: KycStatus;
  rejectionReason: string | null;
  profileSlug: string;
}) {
  const pending = status === 'PENDING';
  const rejected = status === 'REJECTED';

  return (
    <div className="mx-auto max-w-xl space-y-5">
      <section
        className={cn(
          'relative overflow-hidden rounded-3xl border p-6 text-center',
          pending
            ? 'border-amber-500/40 bg-amber-500/5'
            : rejected
              ? 'border-destructive/40 bg-destructive/5'
              : 'border-primary/40 bg-primary/5',
        )}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-primary/20 blur-3xl"
        />
        <span
          className={cn(
            'relative mx-auto flex h-16 w-16 items-center justify-center rounded-2xl',
            pending
              ? 'bg-amber-500/15 text-amber-500'
              : rejected
                ? 'bg-destructive/15 text-destructive'
                : 'bg-primary/15 text-primary',
          )}
        >
          {pending ? (
            <Clock className="h-8 w-8" />
          ) : rejected ? (
            <XCircle className="h-8 w-8" />
          ) : (
            <ShieldCheck className="h-8 w-8" />
          )}
        </span>

        <h1 className="relative mt-4 font-heading text-3xl uppercase tracking-wide">
          {pending
            ? 'Estamos revisando tu identidad'
            : rejected
              ? 'Tu verificacion fue rechazada'
              : 'Verifica tu identidad para empezar'}
        </h1>
        <p className="relative mt-2 text-sm text-muted-foreground">
          {pending
            ? 'Te avisaremos en 24-48 h. En cuanto la aprobemos se desbloquea todo tu panel. Mientras tanto puedes preparar tu perfil.'
            : rejected
              ? 'Revisa el motivo y vuelve a enviarla. Hasta que este aprobada no puedes usar las herramientas de creador.'
              : 'Por ley tenemos que comprobar que eres mayor de edad y que eres tu antes de que publiques o cobres. Son 2 minutos.'}
        </p>

        {rejected && rejectionReason && (
          <p className="relative mx-auto mt-3 max-w-sm rounded-xl border border-destructive/30 bg-background/60 px-3 py-2 text-left text-sm">
            <strong className="block text-xs text-destructive">Motivo</strong>
            {rejectionReason}
          </p>
        )}

        <div className="relative mt-5 flex flex-col gap-2 sm:flex-row sm:justify-center">
          {pending ? (
            <>
              <Link href={`/models/${profileSlug}?editar=1`}>
                <Button variant="brand" size="lg" className="w-full">
                  <Pencil className="h-4 w-4" />
                  Preparar mi perfil
                </Button>
              </Link>
              <Link href="/dashboard/model/kyc">
                <Button variant="outline" size="lg" className="w-full">
                  Ver estado
                </Button>
              </Link>
            </>
          ) : (
            <Link href="/dashboard/model/kyc">
              <Button variant="brand" size="lg" className="w-full">
                <BadgeCheck className="h-4 w-4" />
                {rejected ? 'Volver a intentarlo' : 'Verificar ahora'}
              </Button>
            </Link>
          )}
        </div>
      </section>

      {!pending && (
        <section className="rounded-2xl border border-border/60 bg-card p-4">
          <h2 className="text-sm font-semibold">Como funciona</h2>
          <ol className="mt-3 space-y-3">
            {STEPS.map((step, i) => (
              <li key={step.title} className="flex items-center gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
                  <step.icon className="h-4 w-4" />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium">
                    {i + 1}. {step.title}
                  </span>
                  <span className="block text-xs text-muted-foreground">{step.hint}</span>
                </span>
              </li>
            ))}
          </ol>
          <p className="mt-3 flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Lock className="h-3 w-3" /> Tus documentos son privados: solo los ve el equipo de
            verificacion. Tus fans solo veran tu nombre artistico.
          </p>
        </section>
      )}

      <section className="rounded-2xl border border-border/60 bg-card p-4">
        <h2 className="text-sm font-semibold">Se desbloquea al verificarte</h2>
        <ul className="mt-3 space-y-2">
          {LOCKED.map((item) => (
            <li key={item.label} className="flex items-center gap-3 text-sm text-muted-foreground">
              <item.icon className="h-4 w-4 shrink-0" />
              <span className="flex-1">{item.label}</span>
              <Lock className="h-3.5 w-3.5 shrink-0" />
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
