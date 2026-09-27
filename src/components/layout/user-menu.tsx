'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { signOut } from 'next-auth/react';
import {
  Calendar,
  Coins,
  Crown,
  Handshake,
  Heart,
  LayoutDashboard,
  LogOut,
  Menu,
  Settings,
  Shield,
  Sparkles,
  SlidersHorizontal,
  UserRound,
  LifeBuoy,
  Smartphone,
} from 'lucide-react';
import type { Role } from '@prisma/client';

import { LanguageSubMenu } from '@/components/layout/language-switcher';
import { isStandalone, openInstallApp } from '@/components/pwa/install-app';
import { SIDEBAR_LABEL, SIDEBAR_ROW } from '@/components/layout/sidebar-row';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ROLE_LABELS } from '@/lib/constants';
import { initials } from '@/lib/utils';

interface UserMenuProps {
  name: string;
  email: string;
  image: string | null;
  role: Role;
  isVip: boolean;
  /** Slug del perfil publico si es modelo: activa "Ver/Editar mi perfil". */
  profileSlug?: string | null;
  /** @usuario de la cuenta: su perfil de persona (/u/<usuario>). */
  username?: string | null;
  /**
   * Como se abre: con la foto (barra de arriba, escritorio) o con un boton
   * de menu (en el propio perfil, en el movil, donde la foto ya esta abajo).
   */
  trigger?: 'avatar' | 'menu' | 'sidebar';
  /** Cuenta de reclutador: acceso a su panel. */
  isRecruiter?: boolean;
}

export function UserMenu({
  name,
  email,
  image,
  role,
  isVip,
  profileSlug,
  username,
  trigger = 'avatar',
  isRecruiter = false,
}: UserMenuProps) {
  // Ya instalada como app: no se ofrece instalarla.
  const [installed, setInstalled] = useState(true);
  useEffect(() => setInstalled(isStandalone()), []);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={
          trigger === 'sidebar'
            ? SIDEBAR_ROW
            : trigger === 'menu'
              ? 'flex h-9 w-9 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring'
              : 'rounded-full outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'
        }
        aria-label="Menu de tu cuenta"
      >
        {trigger === 'sidebar' ? (
          <>
            <Menu className="h-6 w-6" />
            <span className={SIDEBAR_LABEL}>Mas</span>
          </>
        ) : trigger === 'menu' ? (
          <Menu className="h-5 w-5" />
        ) : (
          <Avatar className="h-9 w-9 border border-border">
            {image ? <AvatarImage src={image} alt={name} /> : null}
            <AvatarFallback>{initials(name)}</AvatarFallback>
          </Avatar>
        )}
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align={trigger === 'sidebar' ? 'start' : 'end'}
        side={trigger === 'sidebar' ? 'top' : 'bottom'}
        className="w-60"
      >
        <DropdownMenuLabel className="flex flex-col gap-1">
          <span className="truncate">{name}</span>
          <span className="truncate text-xs font-normal text-muted-foreground">
            {email}
          </span>
          <div className="flex gap-1 pt-1">
            <Badge variant="muted" className="text-[10px]">
              {ROLE_LABELS[role]}
            </Badge>
            {isVip && (
              <Badge variant="vip" className="text-[10px]">
                <Crown className="h-3 w-3" /> VIP
              </Badge>
            )}
          </div>
        </DropdownMenuLabel>

        <DropdownMenuSeparator />

        {/* Una sola cuenta: todos tienen su perfil y todos pueden usar la app
            como fans. La creadora suma su panel; el resto ve "Hazte creadora". */}
        {(profileSlug || username) && (
          <DropdownMenuItem asChild>
            <Link href={profileSlug ? `/models/${profileSlug}` : `/u/${username}`}>
              <UserRound /> Mi perfil
            </Link>
          </DropdownMenuItem>
        )}
        {profileSlug ? (
          <DropdownMenuItem asChild>
            <Link href="/dashboard/model">
              <LayoutDashboard /> Mi panel
            </Link>
          </DropdownMenuItem>
        ) : (
          role !== 'ADMIN' && (
            <DropdownMenuItem asChild>
              <Link href="/hazte-creador" className="font-medium text-primary">
                <Sparkles /> Hazte creador
              </Link>
            </DropdownMenuItem>
          )
        )}

        <DropdownMenuSeparator />

        {isRecruiter && (
          <DropdownMenuItem asChild>
            <Link href="/reclutador" className="font-medium text-primary">
              <Handshake /> Panel de reclutador
            </Link>
          </DropdownMenuItem>
        )}
        <DropdownMenuItem asChild>
          <Link href="/wallet">
            <Coins /> Monedero
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/dashboard/subscriptions">
            <Heart /> Mis suscripciones
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/bienvenida">
            <SlidersHorizontal /> Tus gustos
          </Link>
        </DropdownMenuItem>
        {!profileSlug && (
          <DropdownMenuItem asChild>
            <Link href="/bookings">
              <Calendar /> Mis reservas
            </Link>
          </DropdownMenuItem>
        )}

        {role === 'ADMIN' && (
          <DropdownMenuItem asChild>
            <Link href="/admin">
              <Shield /> Panel de admin
            </Link>
          </DropdownMenuItem>
        )}

        <DropdownMenuItem asChild>
          <Link href={profileSlug ? '/dashboard/model/ajustes' : '/dashboard/settings'}>
            <Settings /> Ajustes
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/soporte">
            <LifeBuoy /> Soporte
          </Link>
        </DropdownMenuItem>
        {!installed && (
          <DropdownMenuItem onSelect={() => openInstallApp()}>
            <Smartphone /> Instalar app
          </DropdownMenuItem>
        )}
        {/* En el movil el globo no cabe arriba: el idioma va aqui. */}
        <LanguageSubMenu className={trigger === 'avatar' ? 'sm:hidden' : undefined} />

        <DropdownMenuSeparator />

        <DropdownMenuItem
          className="text-destructive focus:text-destructive"
          onClick={() => signOut({ callbackUrl: '/' })}
        >
          <LogOut /> Cerrar sesion
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
