import Link from 'next/link';
import {
  Coins,
  Compass,
  LayoutDashboard,
  Radio,
  Search,
  Shield,
  Users,
  Video,
} from 'lucide-react';

import { Logo } from '@/components/brand/logo';
import { FeedTabs } from '@/components/feed/feed-tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { LanguageSwitcher } from '@/components/layout/language-switcher';
import { NotificationBell } from '@/components/layout/notification-bell';
import { UserMenu } from '@/components/layout/user-menu';
import { getCurrentUser } from '@/lib/auth/guards';
import { getT } from '@/lib/i18n/server';
import { getOwnUsername, getProfileShortcut } from '@/lib/profile-shortcut';
import { getWalletSummary } from '@/lib/tokens';
import { formatTokens } from '@/lib/utils';

export async function Navbar() {
  const [user, t] = await Promise.all([getCurrentUser(), getT()]);
  const [wallet, profile, username] = await Promise.all([
    user ? getWalletSummary(user.id) : null,
    getProfileShortcut(user?.modelProfileId),
    getOwnUsername(user?.id),
  ]);

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
    // Desde tablet (md) la navegacion es la barra lateral (SideNav).
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur-xl md:hidden">
      <div className="container flex h-16 items-center justify-between gap-2 px-4 sm:gap-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-8">
          {/* El nombre siempre visible; en movil se ajusta al ancho de la
              pantalla para que quepan los botones de la derecha. */}
          <Logo wordmarkClassName="text-[clamp(0.8rem,4vw,1.125rem)]" />

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

        <div className="flex shrink-0 items-center gap-0.5 sm:gap-2">
          <Link href="/buscar" aria-label="Buscar">
            <Button variant="ghost" size="icon" className="h-9 w-9">
              <Search className="h-5 w-5" />
            </Button>
          </Link>
          {/* En movil el idioma va en el menu de la cuenta, o en entrar /
              crear cuenta si no hay sesion: aqui no cabe junto al nombre. */}
          <LanguageSwitcher className="hidden sm:inline-flex" />

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

              {/* En el movil tu foto ya esta en la barra de abajo (Perfil):
                  el menu de la cuenta va en tu perfil (boton de menu). */}
              <div className="hidden md:block">
                <UserMenu
                  name={profile?.stageName ?? user.name ?? user.email}
                  email={user.email}
                  image={profile?.avatarUrl ?? user.image ?? null}
                  role={user.role}
                  isVip={user.isVip}
                  profileSlug={profile?.slug}
                  username={username}
                />
              </div>
            </>
          ) : (
            <>
              {/* En movil "Entrar" ya esta en la barra inferior; aqui desbordaria. */}
              <Link href="/login" className="hidden sm:block">
                <Button variant="ghost" size="sm">
                  {t('nav.login')}
                </Button>
              </Link>
              <Link href="/register">
                <Button variant="brand" size="sm">
                  <span className="sm:hidden">{t('nav.join')}</span>
                  <span className="hidden sm:inline">{t('nav.register')}</span>
                </Button>
              </Link>
            </>
          )}
        </div>
      </div>
      <FeedTabs />
    </header>
  );
}
