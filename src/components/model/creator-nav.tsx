'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  BadgeCheck,
  BarChart3,
  CalendarDays,
  Coins,
  Gift,
  Home,
  Images,
  MessageCircle,
  MessageSquareHeart,
  Radio,
  ShieldBan,
  SlidersHorizontal,
  Inbox,
  Settings,
  SquarePen,
  Sun,
  Wallet,
  type LucideIcon,
} from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * Los Server Components no pueden pasar componentes a un Client Component,
 * asi que el layout manda nombres de icono y aqui se resuelven.
 */
const ICONS = {
  home: Home,
  posts: SquarePen,
  live: Radio,
  packs: Images,
  messages: MessageCircle,
  requests: Gift,
  bookings: CalendarDays,
  earnings: Coins,
  stats: BarChart3,
  payouts: Wallet,
  rates: SlidersHorizontal,
  greeting: MessageSquareHeart,
  kyc: BadgeCheck,
  privacy: ShieldBan,
  today: Sun,
  inbox: Inbox,
  money: Wallet,
  settings: Settings,
} satisfies Record<string, LucideIcon>;

export type CreatorNavIcon = keyof typeof ICONS;

export interface CreatorNavItem {
  href: string;
  label: string;
  icon: CreatorNavIcon;
  /** Numero de cosas pendientes (se muestra como burbuja). */
  badge?: number;
  /** Aviso sin numero (p. ej. verificacion sin completar). */
  alert?: boolean;
  exact?: boolean;
  /** Otras rutas que cuentan como esta seccion (sus subpaginas). */
  match?: string[];
}

export interface CreatorNavGroup {
  title?: string;
  items: CreatorNavItem[];
}

function useIsActive() {
  const pathname = usePathname();
  return (item: CreatorNavItem) => {
    const own = item.exact
      ? pathname === item.href
      : pathname === item.href || pathname.startsWith(`${item.href}/`);
    return (
      own ||
      (item.match?.some((m) => pathname === m || pathname.startsWith(`${m}/`)) ?? false)
    );
  };
}

function Bubble({ item, className }: { item: CreatorNavItem; className?: string }) {
  if (item.badge && item.badge > 0) {
    return (
      <span
        className={cn(
          'flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-bold text-primary-foreground',
          className,
        )}
      >
        {item.badge > 99 ? '99+' : item.badge}
      </span>
    );
  }
  if (item.alert) {
    return <span className={cn('h-2 w-2 rounded-full bg-amber-500', className)} />;
  }
  return null;
}

/** Menu lateral de escritorio: pocos grupos con nombres de la vida real. */
export function CreatorSidebar({ groups }: { groups: CreatorNavGroup[] }) {
  const isActive = useIsActive();

  return (
    <nav className="space-y-5">
      {groups.map((group, i) => (
        <div key={group.title ?? i}>
          {group.title && (
            <p className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/80">
              {group.title}
            </p>
          )}
          <ul className="space-y-0.5">
            {group.items.map((item) => {
              const Icon = ICONS[item.icon];
              const active = isActive(item);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className={cn(
                      'group flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-colors',
                      active
                        ? 'bg-primary/10 text-foreground'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                    )}
                  >
                    <span
                      className={cn(
                        'flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-colors',
                        active
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-muted text-muted-foreground group-hover:text-foreground',
                      )}
                    >
                      <Icon className="h-3.5 w-3.5" />
                    </span>
                    <span className="flex-1 truncate">{item.label}</span>
                    <Bubble item={item} />
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

/**
 * Navegacion del panel en movil: una fila de pestanas fija arriba (Hoy,
 * Bandeja, Dinero, Ajustes). Si hubiera mas secciones, se desliza en
 * horizontal como las de Instagram/TikTok.
 */
export function CreatorMobileTabs({ groups }: { groups: CreatorNavGroup[] }) {
  const isActive = useIsActive();
  const pathname = usePathname();
  const track = useRef<HTMLDivElement | null>(null);
  const items = groups.flatMap((g) => g.items);

  // La pestana activa siempre a la vista, aunque este al final de la fila.
  useEffect(() => {
    const active = track.current?.querySelector<HTMLElement>('[data-active="true"]');
    active?.scrollIntoView({ inline: 'center', block: 'nearest' });
  }, [pathname]);

  return (
    <div data-tour="sections" className="sticky top-16 z-30 -mx-6 mb-5 md:top-0 border-b border-border/60 bg-background/90 backdrop-blur-xl lg:hidden">
      <div
        ref={track}
        className="flex gap-1.5 overflow-x-auto px-6 py-2.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {items.map((item) => {
          const Icon = ICONS[item.icon];
          const active = isActive(item);
          return (
            <Link
              key={item.href}
              href={item.href}
              data-active={active}
              className={cn(
                'relative flex items-center justify-center gap-1.5 rounded-full border py-1.5 text-xs font-medium transition-colors',
                // Pocas secciones: se reparten el ancho y caben todas sin
                // deslizar. Muchas: cada una a su tamano y la fila se desliza.
                items.length <= 4 ? 'min-w-0 flex-1 gap-1 px-1.5' : 'shrink-0 px-3',
                active
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border/60 text-muted-foreground',
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {item.label}
              <Bubble
                item={item}
                className={cn(active && 'bg-primary-foreground text-primary')}
              />
            </Link>
          );
        })}
      </div>
    </div>
  );
}
