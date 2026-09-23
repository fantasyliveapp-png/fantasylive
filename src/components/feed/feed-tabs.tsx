'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Compass, Radio, Users } from 'lucide-react';

import { useI18n } from '@/components/providers/i18n-provider';
import { cn } from '@/lib/utils';

/**
 * Pestanas del feed: descubrir / siguiendo / directos.
 *
 * Son rutas de verdad y no estado de cliente para que cada pestana se pueda
 * compartir, marcar y renderizar en servidor con sus propias consultas.
 *
 * Se pinta DENTRO de la barra superior (que es fija para toda la pagina): si
 * fuera parte del contenido, su "sticky" acabaria con la lista de
 * publicaciones y la barra se iria al llegar a las ultimas.
 */
const FEED_ROUTES = ['/feed', '/feed/siguiendo', '/live'];

export function FeedTabs() {
  const pathname = usePathname();
  const { t } = useI18n();

  // Solo en las tres pestanas (no en /live/<creadora>, que es el reproductor).
  if (!FEED_ROUTES.includes(pathname)) return null;

  const tabs = [
    { href: '/feed', label: t('feed.discover'), icon: Compass },
    { href: '/feed/siguiendo', label: t('feed.following'), icon: Users },
    { href: '/live', label: t('live.title'), icon: Radio },
  ];

  return (
    <nav className="border-t border-border/60">
      <div className="container flex max-w-2xl gap-1">
        {tabs.map((tab) => {
          const active =
            tab.href === '/feed'
              ? pathname === '/feed'
              : pathname.startsWith(tab.href);

          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={cn(
                'flex flex-1 items-center justify-center gap-2 border-b-2 px-3 py-3 text-sm font-medium transition-colors',
                active
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              <tab.icon className="h-4 w-4" />
              {tab.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
