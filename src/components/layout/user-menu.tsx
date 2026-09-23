'use client';

import Link from 'next/link';
import { signOut } from 'next-auth/react';
import {
  Calendar,
  Coins,
  Crown,
  Heart,
  LayoutDashboard,
  LogOut,
  Settings,
  Shield,
  Sparkles,
  SlidersHorizontal,
  UserRound,
} from 'lucide-react';
import type { Role } from '@prisma/client';

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
}

export function UserMenu({
  name,
  email,
  image,
  role,
  isVip,
  profileSlug,
  username,
}: UserMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="rounded-full outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
        <Avatar className="h-9 w-9 border border-border">
          {image ? <AvatarImage src={image} alt={name} /> : null}
          <AvatarFallback>{initials(name)}</AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-60">
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
              <Link href="/hazte-creadora" className="font-medium text-primary">
                <Sparkles /> Hazte creadora
              </Link>
            </DropdownMenuItem>
          )
        )}

        <DropdownMenuSeparator />

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
