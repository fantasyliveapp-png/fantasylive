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
  Video,
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
}

export function UserMenu({ name, email, image, role, isVip }: UserMenuProps) {
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

        <DropdownMenuItem asChild>
          <Link href="/wallet">
            <Coins /> Monedero
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/bookings">
            <Calendar /> Mis reservas
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/dashboard/subscriptions">
            <Heart /> Mis suscripciones
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/dashboard">
            <LayoutDashboard /> Mi cuenta
          </Link>
        </DropdownMenuItem>

        {role === 'MODEL' && (
          <DropdownMenuItem asChild>
            <Link href="/dashboard/model">
              <Video /> Panel de modelo
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
          <Link href="/dashboard/settings">
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
