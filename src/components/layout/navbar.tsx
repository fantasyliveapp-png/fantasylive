import Link from 'next/link';
import {
  Coins,
  Compass,
  LayoutDashboard,
  Radio,
  Shield,
  Users,
  Video,
} from 'lucide-react';

import { Logo } from '@/components/brand/logo';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { LanguageSwitcher } from '@/components/layout/language-switcher';
import { NotificationBell } from '@/components/layout/notification-bell';
import { UserMenu } from '@/components/layout/user-menu';
import { getCurrentUser } from '@/lib/auth/guards';
import { getT } from '@/lib/i18n/server';
import { getWalletSummary } from '@/lib/tokens';
import { formatTokens } from '@/lib/utils';

export async function Navbar() {
  const [user, t] = await Promise.all([getCurrentUser(), getT()]);
  const wallet = user ? await getWalletSummary(user.id) : null;

  // El feed y los directos van primero: son el modo de descubrimiento
  // principal, y el catalogo pasa a ser una vista mas.
  const navLinks = [
    { href: '/feed', label: t('feed.discover'), icon: Compass },
    { href: '/feed/siguiendo', label: t('feed.following'), icon: Users },
    { href: '/live', label: t('live.title'), icon: Radio },
    { href: '/models', label: t('nav.creators'), icon: null },
    { href: '/random', label: t('nav.random'), icon: null },
    { href: '/vip', label: t('nav.vip'), icon: null },
  ];

  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur-xl">
      <div className="container flex h-16 items-center justify-between gap-4">
        <div className="flex items-center gap-8">
          <Logo />

          <nav className="hidden items-center gap-1 md:flex">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                {link.icon && <link.icon className="h-4 w-4" />}
                {link.label}
              </Link>
            ))}
          </nav>
        </div>

        <div className="flex items-center gap-2">
          <LanguageSwitcher />

          {user ? (
            <>
              <Link href="/wallet" className="hidden sm:block">
                <Badge
                  variant="token"
                  className="h-9 gap-1.5 px-3 text-sm hover:opacity-90"
                >
                  <Coins className="h-4 w-4" />
                  {formatTokens(wallet?.balance ?? 0)}
                </Badge>
              </Link>

              {user.role === 'MODEL' && (
                <Link href="/dashboard/model">
                  <Button variant="ghost" size="sm" className="hidden md:flex">
                    <Video className="h-4 w-4" />
                    {t('nav.dashboard')}
                  </Button>
                </Link>
              )}

              {user.role === 'ADMIN' && (
                <Link href="/admin">
                  <Button variant="ghost" size="sm" className="hidden md:flex">
                    <Shield className="h-4 w-4" />
                    Admin
                  </Button>
                </Link>
              )}

              {user.role === 'USER' && (
                <Link href="/dashboard">
                  <Button variant="ghost" size="sm" className="hidden md:flex">
                    <LayoutDashboard className="h-4 w-4" />
                    {t('nav.dashboard')}
                  </Button>
                </Link>
              )}

              <NotificationBell />

              <UserMenu
                name={user.name ?? user.email}
                email={user.email}
                image={user.image ?? null}
                role={user.role}
                isVip={user.isVip}
              />
            </>
          ) : (
            <>
              <Link href="/login">
                <Button variant="ghost" size="sm">
                  {t('nav.login')}
                </Button>
              </Link>
              <Link href="/register">
                <Button variant="brand" size="sm">
                  {t('nav.register')}
                </Button>
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
