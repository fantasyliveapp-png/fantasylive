'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  BadgeCheck,
  CalendarDays,
  Coins,
  Flag,
  Gift,
  Images,
  LayoutDashboard,
  MessageCircle,
  Receipt,
  Settings2,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

/**
 * Los Server Components no pueden pasar componentes (funciones) a un Client
 * Component: React no sabe serializarlos. Por eso el sidebar recibe un NOMBRE
 * de icono y resuelve aqui el componente real.
 */
const ICONS = {
  badgeCheck: BadgeCheck,
  calendar: CalendarDays,
  coins: Coins,
  flag: Flag,
  gift: Gift,
  images: Images,
  layout: LayoutDashboard,
  messageCircle: MessageCircle,
  receipt: Receipt,
  settings: Settings2,
  users: Users,
  wallet: Wallet,
} satisfies Record<string, LucideIcon>;

export type SidebarIcon = keyof typeof ICONS;

export interface SidebarLink {
  href: string;
  label: string;
  icon: SidebarIcon;
  badge?: number;
  exact?: boolean;
}

export interface SidebarSection {
  title?: string;
  links: SidebarLink[];
}

export function DashboardSidebar({ sections }: { sections: SidebarSection[] }) {
  const pathname = usePathname();

  return (
    <nav className="space-y-6">
      {sections.map((section, i) => (
        <div key={section.title ?? i}>
          {section.title && (
            <p className="mb-2 px-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {section.title}
            </p>
          )}
          <ul className="space-y-1">
            {section.links.map((link) => {
              const Icon = ICONS[link.icon] ?? LayoutDashboard;
              const isActive = link.exact
                ? pathname === link.href
                : pathname === link.href || pathname.startsWith(`${link.href}/`);

              return (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className={cn(
                      'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                      isActive
                        ? 'bg-primary/10 text-primary'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span className="flex-1 truncate">{link.label}</span>
                    {link.badge !== undefined && link.badge > 0 && (
                      <Badge variant="destructive" className="h-5 px-1.5 text-[10px]">
                        {link.badge}
                      </Badge>
                    )}
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
