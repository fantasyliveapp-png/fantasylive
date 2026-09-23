import type { ModelProfile } from '@prisma/client';
import Link from 'next/link';
import { Eye, Pencil, Plus, Radio } from 'lucide-react';

import {
  CreatorMobileTabs,
  CreatorSidebar,
  type CreatorNavGroup,
} from '@/components/model/creator-nav';
import { KycGate } from '@/components/model/kyc-gate';
import { KycGateSwitch } from '@/components/model/kyc-gate-switch';
import { OnlineToggle } from '@/components/model/online-toggle';
import { ProfileEditorButton } from '@/components/model/profile-editor';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { getCreatorPending } from '@/lib/creator-dashboard';
import { prisma } from '@/lib/prisma';
import { initials } from '@/lib/utils';

/**
 * PANEL DE CREADORA
 *
 * Escritorio: menu lateral corto, agrupado por lo que la creadora quiere
 * hacer (crear, atender a sus fans, cobrar). Movil: una fila de pestanas fija
 * arriba, en vez de la lista completa de enlaces encima de cada pagina.
 */
export async function CreatorShell({
  userId,
  profile,
  children,
}: {
  userId: string;
  profile: ModelProfile;
  children: React.ReactNode;
}) {
  const pending = await getCreatorPending(profile.id, userId);
  const kycPending = profile.kycStatus !== 'APPROVED';
  // Sin verificar no hay herramientas: solo la pantalla de verificacion (y
  // preparar el perfil). El motivo del ultimo rechazo, si lo hubo.
  const lastRejection = kycPending
    ? await prisma.kycVerification.findFirst({
        where: { modelId: profile.id, status: 'REJECTED' },
        orderBy: { submittedAt: 'desc' },
        select: { rejectionReason: true },
      })
    : null;

  // Cuatro secciones, por lo que la creadora quiere hacer. Las paginas de
  // antes siguen existiendo, pero cuelgan de estas y no llenan el menu.
  const inboxCount = pending.pendingRequests + pending.pendingBookings;
  const groups: CreatorNavGroup[] = [
    {
      items: [
        {
          href: '/dashboard/model',
          label: 'Hoy',
          icon: 'today',
          exact: true,
          match: ['/dashboard/model/alcance'],
        },
        {
          href: '/dashboard/model/bandeja',
          label: 'Bandeja',
          icon: 'inbox',
          badge: inboxCount,
          match: [
            '/dashboard/model/requests',
            '/dashboard/model/bookings',
          ],
        },
        {
          href: '/dashboard/model/dinero',
          label: 'Dinero',
          icon: 'money',
          match: [
            '/dashboard/model/earnings',
            '/dashboard/model/payouts',
            '/dashboard/model/analytics',
          ],
        },
        {
          href: '/dashboard/model/ajustes',
          label: 'Ajustes',
          icon: 'settings',
          alert: kycPending,
          match: [
            '/dashboard/model/rates',
            '/dashboard/model/greeting',
            '/dashboard/model/kyc',
            '/dashboard/model/privacy',
            '/dashboard/model/content',
          ],
        },
      ],
    },
  ];

  return (
    <div className="container py-4 lg:py-8">
      <div className="grid gap-8 lg:grid-cols-[250px_minmax(0,1fr)]">
        <aside className="hidden space-y-5 lg:sticky lg:top-24 lg:block lg:self-start">
          <div className="relative overflow-hidden rounded-2xl border border-border bg-card p-4">
            <div
              aria-hidden
              className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full bg-primary/20 blur-3xl"
            />
            <Link href={`/models/${profile.slug}`} className="relative flex items-center gap-3">
              <span className="rounded-full bg-gradient-to-tr from-primary via-fantazy-red to-champagne-gold p-[2px]">
                <Avatar className="h-11 w-11 border-2 border-card">
                  {profile.avatarUrl && <AvatarImage src={profile.avatarUrl} alt="" />}
                  <AvatarFallback>{initials(profile.stageName)}</AvatarFallback>
                </Avatar>
              </span>
              <span className="min-w-0">
                <span className="block truncate font-semibold">{profile.stageName}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  @{profile.slug}
                </span>
              </span>
            </Link>

            <div className="relative mt-3 grid grid-cols-2 gap-2">
              <Link href={`/models/${profile.slug}`}>
                <Button variant="secondary" size="sm" className="w-full">
                  <Eye className="h-3.5 w-3.5" />
                  Ver perfil
                </Button>
              </Link>
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
                className="w-full"
              >
                <Pencil className="h-3.5 w-3.5" />
                Editar
              </ProfileEditorButton>
            </div>

            {!kycPending && (
              <div className="relative mt-4 border-t border-border/60 pt-4">
                <OnlineToggle
                  isOnline={profile.isOnline}
                  isAvailableForVip={profile.isAvailableForVip}
                  isVipEnabled={profile.isVipEnabled}
                  canStream
                />
              </div>
            )}
          </div>

          {!kycPending && <CreatorSidebar groups={groups} />}

          {/* En escritorio no hay "+" abajo: crear queda aqui, a la vista. */}
          <div className={kycPending ? 'hidden' : 'space-y-2'}>
            <Link href="/dashboard/model/posts?nuevo=fotos" className="block">
              <Button variant="brand" className="w-full">
                <Plus className="h-4 w-4" />
                Crear publicacion
              </Button>
            </Link>
            <Link href="/dashboard/model/live" className="block">
              <Button variant="outline" className="w-full">
                <Radio className="h-4 w-4 text-rose-500" />
                Ir en directo
              </Button>
            </Link>
          </div>
        </aside>

        <div className="min-w-0">
          {kycPending ? (
            <KycGateSwitch
              gate={
                <KycGate
                  status={profile.kycStatus}
                  rejectionReason={lastRejection?.rejectionReason ?? null}
                  profileSlug={profile.slug}
                />
              }
            >
              {children}
            </KycGateSwitch>
          ) : (
            <>
              <CreatorMobileTabs groups={groups} />
              {children}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
