import type { Metadata } from 'next';
import Link from 'next/link';
import {
  BadgeCheck,
  CalendarDays,
  ChevronRight,
  Coins,
  Crown,
  Images,
  MessageCircle,
  MessageSquareHeart,
  Pencil,
  ShieldBan,
  type LucideIcon,
} from 'lucide-react';

import { ProfileEditorButton } from '@/components/model/profile-editor';
import { BlockedAccounts } from '@/components/social/blocked-accounts';
import { MessagePrivacySetting } from '@/components/social/message-privacy-setting';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { requireModel } from '@/lib/auth/guards';
import { KYC_STATUS_LABELS } from '@/lib/constants';
import { prisma } from '@/lib/prisma';
import { formatRateNumber } from '@/lib/rates';
import { cn, formatTokens, initials } from '@/lib/utils';

export const metadata: Metadata = { title: 'Ajustes' };
export const dynamic = 'force-dynamic';

/**
 * AJUSTES
 *
 * Lo que se configura una vez y casi no se toca, en una sola lista (como los
 * ajustes del movil). Cada fila resume como esta ahora y lleva a su pantalla.
 * Tambien muestra que herramientas estan activas: lo que esta apagado no
 * aparece en la Bandeja ni en el perfil.
 */
export default async function SettingsPage() {
  const { user, profile } = await requireModel();
  const [legacyPacks, account] = await Promise.all([
    prisma.contentPackage.count({ where: { modelId: profile.id } }),
    prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { messagePrivacy: true } }),
  ]);

  const kycOk = profile.kycStatus === 'APPROVED';

  const tools: { icon: LucideIcon; label: string; on: boolean; detail: string }[] = [
    {
      icon: Crown,
      label: 'Suscripcion mensual',
      on: profile.subscriptionEnabled && profile.subscriptionPriceTokens > 0,
      detail: `${formatTokens(profile.subscriptionPriceTokens)} tokens/mes`,
    },
    {
      icon: MessageCircle,
      label: 'Mensajes de fans',
      on: profile.messagingEnabled,
      detail:
        profile.messagePriceTokens > 0
          ? `${formatTokens(profile.messagePriceTokens)} tokens por abrir chat`
          : 'Gratis',
    },
    {
      icon: CalendarDays,
      label: 'Citas por videollamada',
      on: profile.acceptsBookings,
      detail: `${formatRateNumber(profile.privateRateCentitokens)} tokens/min`,
    },
    {
      icon: Crown,
      label: 'Sala VIP',
      on: profile.isVipEnabled,
      detail: `${formatRateNumber(profile.vipRateCentitokens)} tokens/min`,
    },
  ];

  return (
    <div className="space-y-6">
      <h1 className="font-heading text-3xl uppercase tracking-wide">Ajustes</h1>

      {/* Perfil */}
      <Group title="Tu perfil">
        <div className="flex items-center gap-3 px-4 py-3.5">
          <Avatar className="h-12 w-12">
            {profile.avatarUrl && <AvatarImage src={profile.avatarUrl} alt="" />}
            <AvatarFallback>{initials(profile.stageName)}</AvatarFallback>
          </Avatar>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-semibold">{profile.stageName}</span>
            <span className="block truncate text-xs text-muted-foreground">
              Foto, portada, nombre, bio y etiquetas
            </span>
          </span>
          <ProfileEditorButton
            profile={{
              slug: profile.slug,
              stageName: profile.stageName,
              headline: profile.headline ?? '',
              bio: profile.bio ?? '',
              languages: profile.languages,
              tags: profile.tags,
              avatarUrl: profile.avatarUrl ?? '',
              coverUrl: profile.coverUrl ?? '',
            }}
            variant="secondary"
          >
            <Pencil className="h-3.5 w-3.5" />
            Editar
          </ProfileEditorButton>
        </div>
      </Group>

      {/* Cobrar */}
      <Group title="Como cobras">
        <Row
          href="/dashboard/model/rates"
          icon={Coins}
          title="Precios y herramientas"
          hint="Suscripcion, mensajes, citas y sala VIP"
        />
        <div className="grid gap-2 border-t border-border/60 p-3 sm:grid-cols-2">
          {tools.map((tool) => (
            <div
              key={tool.label}
              className={cn(
                'flex items-center gap-2.5 rounded-xl border px-3 py-2.5',
                tool.on ? 'border-state-connected/40 bg-state-connected/5' : 'border-border/60',
              )}
            >
              <tool.icon
                className={cn('h-4 w-4 shrink-0', tool.on ? 'text-state-connected' : 'text-muted-foreground')}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{tool.label}</span>
                <span className="block truncate text-[11px] text-muted-foreground">
                  {tool.on ? tool.detail : 'Desactivado'}
                </span>
              </span>
              <span
                className={cn(
                  'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase',
                  tool.on ? 'bg-state-connected/15 text-state-connected' : 'bg-muted text-muted-foreground',
                )}
              >
                {tool.on ? 'On' : 'Off'}
              </span>
            </div>
          ))}
        </div>
        <p className="border-t border-border/60 px-4 py-2.5 text-[11px] text-muted-foreground">
          Lo que tengas apagado no aparece en tu Bandeja ni en tu perfil. Actívalo en
          &laquo;Precios y herramientas&raquo; cuando lo quieras usar.
        </p>
      </Group>

      {/* Mensajes */}
      <Group title="Quien puede escribirme">
        <div className="p-3">
          <MessagePrivacySetting initial={account.messagePrivacy} />
        </div>
        <p className="border-t border-border/60 px-4 py-2.5 text-[11px] text-muted-foreground">
          Los fans que pagan por abrir chat contigo siempre pueden escribirte
          (lo controlas en &laquo;Mensajes de fans&raquo;). Esto es para chats gratis.
        </p>
      </Group>

      <Group title="Cuentas bloqueadas">
        <BlockedAccounts userId={user.id} />
      </Group>

      {/* Fans */}
      <Group title="Con tus fans">
        <Row
          href="/dashboard/model/greeting"
          icon={MessageSquareHeart}
          title="Mensaje de bienvenida"
          hint="Lo que reciben automaticamente al visitar tu perfil"
        />
      </Group>

      {/* Seguridad */}
      <Group title="Cuenta y seguridad">
        <Row
          href="/dashboard/model/kyc"
          icon={BadgeCheck}
          title="Verificacion de identidad"
          hint={kycOk ? 'Tu cuenta esta verificada' : 'Necesaria para conectarte, emitir y cobrar'}
          badge={
            <span
              className={cn(
                'rounded-full px-2 py-0.5 text-[10px] font-bold',
                kycOk ? 'bg-state-connected/15 text-state-connected' : 'bg-amber-500/15 text-amber-500',
              )}
            >
              {KYC_STATUS_LABELS[profile.kycStatus]}
            </span>
          }
        />
        <Row
          href="/dashboard/model/privacy"
          icon={ShieldBan}
          title="Privacidad y bloqueos"
          hint="Paises bloqueados y usuarios"
        />
      </Group>

      {legacyPacks > 0 && (
        <Group title="Contenido antiguo">
          <Row
            href="/dashboard/model/content"
            icon={Images}
            title="Packs anteriores"
            hint={`${legacyPacks} ${legacyPacks === 1 ? 'pack' : 'packs'} de antes. Lo nuevo se publica en el feed.`}
          />
        </Group>
      )}
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        {title}
      </h2>
      <div className="overflow-hidden rounded-2xl border border-border/60 bg-card">{children}</div>
    </section>
  );
}

function Row({
  href,
  icon: Icon,
  title,
  hint,
  badge,
}: {
  href: string;
  icon: LucideIcon;
  title: string;
  hint: string;
  badge?: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-3 border-b border-border/60 px-4 py-3.5 transition-colors last:border-b-0 hover:bg-muted/40"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted">
        <Icon className="h-4 w-4 text-muted-foreground" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{title}</span>
        <span className="block truncate text-xs text-muted-foreground">{hint}</span>
      </span>
      {badge}
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
    </Link>
  );
}
