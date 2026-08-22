import Link from 'next/link';
import { Coins, LayoutDashboard, Shield, Video } from 'lucide-react';

import { Logo } from '@/components/brand/logo';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { NotificationBell } from '@/components/layout/notification-bell';
import { UserMenu } from '@/components/layout/user-menu';
import { getCurrentUser } from '@/lib/auth/guards';
import { getWalletSummary } from '@/lib/tokens';
import { formatTokens } from '@/lib/utils';

const NAV_LINKS = [
  { href: '/models', label: 'Creadores' },
  { href: '/random', label: 'Aleatorio' },
  { href: '/vip', label: 'VIP' },
  { href: '/bookings', label: 'Reservas' },
];

export async function Navbar() {
  const user = await getCurrentUser();
  const wallet = user ? await getWalletSummary(user.id) : null;

  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur-xl">
      <div className="container flex h-16 items-center justify-between gap-4">
        <div className="flex items-center gap-8">
          <Logo />

          <nav className="hidden items-center gap-1 md:flex">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>

        <div className="flex items-center gap-2">
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
                    Panel
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
                    Mi cuenta
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
                  Entrar
                </Button>
              </Link>
              <Link href="/register">
                <Button variant="brand" size="sm">
                  Crear cuenta
                </Button>
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
