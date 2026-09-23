'use client';

import { useCallback, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import type { Role } from '@prisma/client';
import {
  Coins,
  Compass,
  Crown,
  MessageCircle,
  Plus,
  Radio,
  Search,
  Shuffle,
  Sparkles,
  Users,
  type LucideIcon,
} from 'lucide-react';

import { Logo } from '@/components/brand/logo';
import { CreateSheet } from '@/components/layout/create-sheet';
import { NotificationBell } from '@/components/layout/notification-bell';
import { SIDEBAR_ROW } from '@/components/layout/sidebar-row';
import { UserMenu } from '@/components/layout/user-menu';
import { useI18n } from '@/components/providers/i18n-provider';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { cn, formatTokens, initials } from '@/lib/utils';

export interface SideNavAccount {
  name: string;
  email: string;
  image: string | null;
  role: Role;
  isVip: boolean;
  profileSlug: string | null;
  username: string | null;
  /** Identidad verificada (solo creadoras): sin ella el + lleva a verificarse. */
  verified: boolean;
  balance: number;
}

/**
 * BARRA LATERAL DE ESCRITORIO (como Instagram o TikTok en web).
 *
 * Lleva a pantalla grande lo que en el movil funciona tan bien en la barra
 * de abajo: Descubrir, Directos, el + de crear (con el mismo menu), Mensajes
 * y tu Perfil, mas buscar, notificaciones y el menu de tu cuenta ("Mas").
 * En el movil no se ve: alli esta la barra inferior.
 */
export function SideNav({ account }: { account: SideNavAccount | null }) {
  const pathname = usePathname();
  const router = useRouter();
  const { t } = useI18n();
  const [createOpen, setCreateOpen] = useState(false);
  const closeCreate = useCallback(() => setCreateOpen(false), []);

  // En una llamada o viendo un directo la barra estorbaria.
  if (pathname.startsWith('/call/') || /^\/live\/[^/]+/.test(pathname)) return null;

  const isCreator = Boolean(account?.profileSlug);
  const profileHref = account?.profileSlug
    ? `/models/${account.profileSlug}`
    : account?.username
      ? `/u/${account.username}`
      : '/dashboard';

  const main: { href: string; label: string; icon: LucideIcon; exact?: boolean }[] = [
    { href: '/feed', label: t('feed.discover'), icon: Compass, exact: true },
    { href: '/feed/siguiendo', label: t('feed.following'), icon: Users },
    { href: '/live', label: t('live.title'), icon: Radio, exact: true },
    { href: '/buscar', label: 'Buscar', icon: Search },
  ];
  const explore: { href: string; label: string; icon: LucideIcon }[] = [
    { href: '/models', label: t('nav.creators'), icon: Sparkles },
    { href: '/random', label: t('nav.random'), icon: Shuffle },
    { href: '/vip', label: t('nav.vip'), icon: Crown },
  ];

  const active = (href: string, exact?: boolean) =>
    pathname === href || (!exact && pathname.startsWith(`${href}/`));

  const row = (on: boolean) =>
    cn(SIDEBAR_ROW, on && 'bg-muted font-semibold text-foreground');

  return (
    <>
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-60 flex-col border-r border-border/60 bg-background px-3 pb-4 pt-6 lg:flex">
        <div className="mb-6 px-3">
          <Logo />
        </div>

        <nav className="flex flex-1 flex-col gap-1 overflow-y-auto">
          {main.map((item) => {
            const on = active(item.href, item.exact);
            return (
              <Link key={item.href} href={item.href} className={row(on)}>
                <item.icon className={cn('h-6 w-6', on && 'text-primary')} />
                {item.label}
              </Link>
            );
          })}

          {account && (
            <>
              <Link href="/mensajes" className={row(active('/mensajes'))}>
                <MessageCircle className={cn('h-6 w-6', active('/mensajes') && 'text-primary')} />
                {t('nav.messages')}
              </Link>
              <NotificationBell label="Notificaciones" />
            </>
          )}

          {isCreator && (
            <button
              type="button"
              onClick={() =>
                // Sin verificar no puede crear: el + lleva a verificarse.
                account && !account.verified ? router.push('/dashboard/model') : setCreateOpen(true)
              }
              className={row(false)}
            >
              <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-gradient-to-tr from-primary via-fantazy-red to-champagne-gold text-white">
                <Plus className="h-4 w-4" strokeWidth={3} />
              </span>
              {t('nav.create')}
            </button>
          )}

          {account && (
            <Link
              href={profileHref}
              className={row(
                active(profileHref) || (isCreator && pathname.startsWith('/dashboard/model')),
              )}
            >
              <Avatar className="h-6 w-6">
                {account.image && <AvatarImage src={account.image} alt="" />}
                <AvatarFallback className="text-[10px]">{initials(account.name)}</AvatarFallback>
              </Avatar>
              {t('nav.profile')}
            </Link>
          )}

          <p className="mt-5 px-3 pb-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Explorar
          </p>
          {explore.map((item) => {
            const on = active(item.href);
            return (
              <Link key={item.href} href={item.href} className={row(on)}>
                <item.icon className={cn('h-5 w-5', on && 'text-primary')} />
                <span className="text-sm">{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="mt-3 space-y-2 border-t border-border/60 pt-3">
          {account ? (
            <>
              <Link
                href="/wallet"
                className="flex items-center justify-between rounded-xl border border-token/30 bg-token/10 px-3 py-2 text-sm font-semibold text-token transition-colors hover:bg-token/15"
              >
                <span className="flex items-center gap-2">
                  <Coins className="h-4 w-4" />
                  {formatTokens(account.balance)}
                </span>
                <span className="text-xs font-medium">Recargar</span>
              </Link>
              <UserMenu
                trigger="sidebar"
                name={account.name}
                email={account.email}
                image={account.image}
                role={account.role}
                isVip={account.isVip}
                profileSlug={account.profileSlug}
                username={account.username}
              />
            </>
          ) : (
            <div className="space-y-2">
              <Link href="/register" className="block">
                <Button variant="brand" className="w-full">
                  {t('nav.register')}
                </Button>
              </Link>
              <Link href="/login" className="block">
                <Button variant="outline" className="w-full">
                  {t('nav.login')}
                </Button>
              </Link>
            </div>
          )}
        </div>
      </aside>

      {isCreator && <CreateSheet open={createOpen} onClose={closeCreate} />}
    </>
  );
}
