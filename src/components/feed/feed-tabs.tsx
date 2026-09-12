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
 */
export function FeedTabs() {
  const pathname = usePathname();
  const { t } = useI18n();

  const tabs = [
    { href: '/feed', label: t('feed.discover'), icon: Compass },
    { href: '/feed/siguiendo', label: t('feed.following'), icon: Users },
    { href: '/live', label: t('live.title'), icon: Radio },
  ];

  return (
    <nav className="sticky top-16 z-30 -mx-4 mb-5 border-b border-border/60 bg-background/90 px-4 backdrop-blur">
      <div className="flex gap-1">
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
