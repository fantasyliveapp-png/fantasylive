import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { BadgeCheck, Coins, Crown, Radio, Sparkles } from 'lucide-react';

import { OnboardingForm } from '@/components/model/onboarding-form';
import { requireUser } from '@/lib/auth/guards';
import { prisma } from '@/lib/prisma';
import { pageMeta } from '@/lib/seo';

export const metadata: Metadata = pageMeta('Hazte creador', 'Gana dinero con directos, videollamadas, suscripciones y contenido exclusivo. Regístrate y empieza al verificar tu identidad.');
export const dynamic = 'force-dynamic';

const PERKS = [
  { icon: Coins, title: 'Cobra por tu contenido', hint: 'Publicaciones de pago, suscripcion y mensajes' },
  { icon: Radio, title: 'Directos y videollamadas', hint: 'Regalos en vivo y llamadas por minuto' },
  { icon: Crown, title: 'Tu comunidad', hint: 'Suscriptores con contenido exclusivo' },
] as const;

/**
 * HAZTE CREADORA
 *
 * Una sola cuenta para todos: cualquier persona registrada activa aqui el modo
 * creadora (perfil publico + herramientas para cobrar). Sigue pudiendo usar la
 * app como fan. Para cobrar y publicar contenido de pago hace falta verificar
 * la identidad despues, desde su panel.
 */
export default async function BecomeCreatorPage() {
  const user = await requireUser('/hazte-creador');

  const existing = await prisma.modelProfile.findUnique({
    where: { userId: user.id },
    select: { id: true },
  });
  if (existing) redirect('/dashboard/model');

  const account = await prisma.user.findUnique({
    where: { id: user.id },
    select: { name: true, username: true, gender: true },
  });

  return (
    <div className="container max-w-xl py-8">
      <div className="relative overflow-hidden rounded-3xl border border-border/60 bg-card p-6">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-20 -top-24 h-64 w-64 rounded-full bg-primary/25 blur-3xl"
        />
        <p className="relative flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">
          <Sparkles className="h-3.5 w-3.5" />
          Modo creador
        </p>
        <h1 className="relative mt-2 font-heading text-3xl uppercase tracking-wide">
          Empieza a ganar con tu contenido
        </h1>
        <p className="relative mt-2 text-sm text-muted-foreground">
          No tienes que registrarte otra vez: es tu misma cuenta. Solo un paso y ya.
        </p>

        <ul className="relative mt-5 space-y-3">
          {PERKS.map((perk) => (
            <li key={perk.title} className="flex items-center gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
                <perk.icon className="h-4 w-4" />
              </span>
              <span>
                <span className="block text-sm font-medium">{perk.title}</span>
                <span className="block text-xs text-muted-foreground">{perk.hint}</span>
              </span>
            </li>
          ))}
        </ul>

        <div className="relative mt-6 rounded-2xl border border-border/60 bg-background/60 p-4">
          <OnboardingForm
            defaultName={account?.name || account?.username || ''}
            defaultGender={account?.gender ?? null}
          />
        </div>

        <p className="relative mt-4 flex items-start gap-2 text-xs text-muted-foreground">
          <BadgeCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          Foto, bio y precios los pones despues en tu panel. Para cobrar verificaras tu identidad
          desde alli.
        </p>
      </div>
    </div>
  );
}
