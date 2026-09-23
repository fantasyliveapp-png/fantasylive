'use client';

import { useCallback, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Compass,
  LogIn,
  MessageCircle,
  Plus,
  Radio,
  Users,
  Wallet,
} from 'lucide-react';

import { CreateSheet } from '@/components/layout/create-sheet';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useI18n } from '@/components/providers/i18n-provider';
import type { ProfileShortcut } from '@/lib/profile-shortcut';
import { cn, initials } from '@/lib/utils';

/**
 * Barra inferior de navegacion, solo en movil.
 *
 * Es lo que hace que la web se use como una app: las cinco cosas que se hacen
 * a diario quedan a un pulgar de distancia, sin desplegar ningun menu. Como
 * en Instagram/TikTok, la ultima pestana es tu perfil (con tu foto) y las
 * modelos tienen un boton central para crear. En
 * escritorio se oculta porque alli la barra superior ya tiene sitio de sobra.
 */
export function BottomNav({
  isAuthenticated,
  isModel,
  userName,
  userImage,
  profile,
  username,
}: {
  isAuthenticated: boolean;
  isModel: boolean;
  userName?: string | null;
  userImage?: string | null;
  /** Perfil publico de la modelo en sesion (para la pestana Perfil). */
  profile?: ProfileShortcut | null;
  /** @usuario de la cuenta: la pestana Perfil de un fan lleva a /u/<usuario>. */
  username?: string | null;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { t } = useI18n();
  const [createOpen, setCreateOpen] = useState(false);
  const closeCreate = useCallback(() => setCreateOpen(false), []);

  // Dentro de una llamada, un directo o un chat abierto la barra taparia los
  // controles (o el campo para escribir).
  if (
    pathname.startsWith('/call/') ||
    pathname.startsWith('/live/') ||
    pathname === '/bienvenida' ||
    /^\/dashboard\/(model\/)?messages\/[^/]+/.test(pathname)
  ) {
    return null;
  }

  // Perfil: la modelo va a su perfil publico (lo que ven sus fans, con los
  // botones de editar); el resto de usuarios, a su cuenta.
  const profileHref = profile
    ? `/models/${profile.slug}`
    : username
      ? `/u/${username}`
      : '/dashboard';
  const avatarSrc = profile?.avatarUrl ?? userImage ?? undefined;
  const avatarName = profile?.stageName ?? userName ?? '';

  type Item = {
    href: string;
    label: string;
    icon?: React.ComponentType<{ className?: string }>;
    exact?: boolean;
    kind?: 'create' | 'profile';
    match?: string[];
  };

  const items: Item[] = !isAuthenticated
    ? [
        {
          href: '/feed',
          label: t('feed.discover'),
          icon: Compass,
          exact: true,
        },
        { href: '/feed/siguiendo', label: t('feed.following'), icon: Users },
        { href: '/live', label: t('live.title'), icon: Radio },
        { href: '/login', label: t('nav.login'), icon: LogIn },
        { href: '/wallet', label: t('nav.wallet'), icon: Wallet },
      ]
    : isModel
      ? [
          {
            href: '/feed',
            label: t('feed.discover'),
            icon: Compass,
            exact: true,
          },
          { href: '/live', label: t('live.title'), icon: Radio },
          {
            href: '/dashboard/model/posts?nuevo=1',
            label: t('nav.create'),
            kind: 'create',
          },
          {
            href: '/mensajes',
            label: t('nav.messages'),
            icon: MessageCircle,
          },
          {
            href: profileHref,
            label: t('nav.profile'),
            kind: 'profile',
            match: ['/dashboard/model'],
          },
        ]
      : [
          {
            href: '/feed',
            label: t('feed.discover'),
            icon: Compass,
            exact: true,
          },
          { href: '/feed/siguiendo', label: t('feed.following'), icon: Users },
          { href: '/live', label: t('live.title'), icon: Radio },
          {
            href: '/mensajes',
            label: t('nav.messages'),
            icon: MessageCircle,
          },
          {
            href: profileHref,
            label: t('nav.profile'),
            kind: 'profile',
          },
        ];

  function isActive(item: Item) {
    const base = item.href.split('?')[0]!;
    if (item.kind === 'create') return false;
    if (pathname === base) return true;
    if (item.exact) return false;
    if (pathname.startsWith(`${base}/`)) return true;
    // "Perfil" tambien queda marcado dentro del panel de la modelo, salvo en
    // las secciones que ya tienen su propia pestana.
    return (
      item.match?.some(
        (m) =>
          pathname.startsWith(m) &&
          !pathname.startsWith('/dashboard/model/messages'),
      ) ?? false
    );
  }

  return (
    <>
      <nav
        className="fixed inset-x-0 bottom-0 z-40 border-t border-border/60 bg-background/95 backdrop-blur-xl md:hidden"
        // El padding inferior respeta la barra de gestos de iOS.
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <ul className="flex items-center">
          {items.map((item) => {
            const active = isActive(item);

            if (item.kind === 'create') {
              return (
                <li key={item.href} className="flex flex-1 justify-center">
                  <button
                    type="button"
                    onClick={() =>
                      // Sin verificar no puede crear: el + lleva a verificarse.
                      profile && !profile.verified
                        ? router.push('/dashboard/model')
                        : setCreateOpen(true)
                    }
                    aria-label={item.label}
                    aria-haspopup="dialog"
                    aria-expanded={createOpen}
                    className="flex h-9 w-12 items-center justify-center rounded-xl bg-gradient-to-tr from-primary via-fantazy-red to-champagne-gold text-white shadow-[0_4px_20px_-4px_hsl(var(--primary))] transition-transform active:scale-95"
                  >
                    <Plus
                      className={cn(
                        'h-5 w-5 transition-transform',
                        createOpen && 'rotate-45',
                      )}
                      strokeWidth={2.75}
                    />
                  </button>
                </li>
              );
            }

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
                  {item.kind === 'profile' ? (
                    <Avatar
                      className={cn(
                        'h-5 w-5 ring-offset-1 ring-offset-background',
                        active ? 'ring-2 ring-primary' : 'ring-1 ring-border',
                      )}
                    >
                      {avatarSrc && <AvatarImage src={avatarSrc} alt="" />}
                      <AvatarFallback className="text-[8px]">
                        {initials(avatarName)}
                      </AvatarFallback>
                    </Avatar>
                  ) : item.icon ? (
                    <item.icon className="h-5 w-5" />
                  ) : null}
                  <span className="truncate px-1">{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      {isModel && <CreateSheet open={createOpen} onClose={closeCreate} />}
    </>
  );
}
