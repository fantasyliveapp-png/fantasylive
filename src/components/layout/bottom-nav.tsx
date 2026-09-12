'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Compass,
  LayoutDashboard,
  MessageCircle,
  Radio,
  Users,
  Wallet,
} from 'lucide-react';

import { useI18n } from '@/components/providers/i18n-provider';
import { cn } from '@/lib/utils';

/**
 * Barra inferior de navegacion, solo en movil.
 *
 * Es lo que hace que la web se use como una app: las cinco cosas que se hacen
 * a diario quedan a un pulgar de distancia, sin desplegar ningun menu. En
 * escritorio se oculta porque alli la barra superior ya tiene sitio de sobra.
 */
export function BottomNav({
  isAuthenticated,
  isModel,
}: {
  isAuthenticated: boolean;
  isModel: boolean;
}) {
  const pathname = usePathname();
  const { t } = useI18n();

  // Dentro de una llamada o un directo la barra taparia los controles.
  if (pathname.startsWith('/call/') || pathname.startsWith('/live/')) {
    return null;
  }

  const items = [
    { href: '/feed', label: t('feed.discover'), icon: Compass, exact: true },
    { href: '/feed/siguiendo', label: t('feed.following'), icon: Users },
    { href: '/live', label: t('live.title'), icon: Radio },
    isAuthenticated
      ? {
          href: '/dashboard/messages',
          label: t('nav.messages'),
          icon: MessageCircle,
        }
      : { href: '/login', label: t('nav.login'), icon: LayoutDashboard },
    isModel
      ? {
          href: '/dashboard/model',
          label: t('nav.dashboard'),
          icon: LayoutDashboard,
        }
      : { href: '/wallet', label: t('nav.wallet'), icon: Wallet },
  ];

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border/60 bg-background/95 backdrop-blur-xl md:hidden"
      // El padding inferior respeta la barra de gestos de iOS.
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <ul className="flex">
        {items.map((item) => {
          const active =
            'exact' in item && item.exact
              ? pathname === item.href
              : pathname === item.href || pathname.startsWith(`${item.href}/`);

          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                className={cn(
                  'flex flex-col items-center gap-0.5 py-2.5 text-[10px] font-medium transition-colors',
                  active
                    ? 'text-primary'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <item.icon className="h-5 w-5" />
                <span className="truncate px-1">{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
