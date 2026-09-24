'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOut } from 'next-auth/react';
import {
  ArrowUpRight,
  BadgeCheck,
  Flag,
  ChartColumn,
  Filter,
  Handshake,
  LifeBuoy,
  Megaphone,
  Sparkles,
  Images,
  MessageCircle,
  Radio,
  LayoutDashboard,
  LogOut,
  Menu,
  Receipt,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * MARCO DEL ADMIN
 *
 * El admin no vive dentro de la app de fans (sin barra inferior, sin saldo
 * de tokens, sin menu de usuario): tiene su propio menu lateral agrupado por
 * tareas, con contadores de lo que esta pendiente, y una salida clara a la web.
 */

export type AdminCounts = {
  kyc: number;
  reports: number;
  payouts: number;
  recruitersToPay: number;
  /** Directos en el aire ahora mismo. */
  live: number;
  /** Consultas de soporte esperando respuesta. */
  support: number;
};

type NavLink = {
  href: string;
  label: string;
  icon: LucideIcon;
  exact?: boolean;
  count?: keyof AdminCounts;
};

const NAV: { title?: string; links: NavLink[] }[] = [
  { links: [{ href: '/admin', label: 'Resumen', icon: LayoutDashboard, exact: true }] },
  {
    title: 'Por revisar',
    links: [
      { href: '/admin/kyc', label: 'Verificaciones', icon: BadgeCheck, count: 'kyc' },
      { href: '/admin/reports', label: 'Reportes', icon: Flag, count: 'reports' },
      { href: '/admin/payouts', label: 'Retiros', icon: Wallet, count: 'payouts' },
      { href: '/admin/soporte', label: 'Soporte', icon: LifeBuoy, count: 'support' },
    ],
  },
  {
    title: 'Supervisar',
    links: [
      { href: '/admin/content', label: 'Contenido', icon: Images },
      { href: '/admin/chats', label: 'Mensajes', icon: MessageCircle },
      { href: '/admin/live', label: 'Directos', icon: Radio, count: 'live' },
    ],
  },
  {
    title: 'Comunidad',
    links: [
      { href: '/admin/users', label: 'Usuarios y creadoras', icon: Users },
      { href: '/admin/embudo', label: 'Embudo de creadoras', icon: Filter },
      { href: '/admin/destacadas', label: 'Destacadas', icon: Sparkles },
      {
        href: '/admin/reclutadores',
        label: 'Reclutadores',
        icon: Handshake,
        count: 'recruitersToPay',
      },
      { href: '/admin/avisos', label: 'Avisos', icon: Megaphone },
    ],
  },
  {
    title: 'Dinero',
    links: [
      { href: '/admin/finanzas', label: 'Finanzas', icon: ChartColumn },
      { href: '/admin/transactions', label: 'Transacciones', icon: Receipt },
    ],
  },
];

const ALL_LINKS = NAV.flatMap((s) => s.links);

function isActive(pathname: string, link: NavLink) {
  return link.exact
    ? pathname === link.href
    : pathname === link.href || pathname.startsWith(`${link.href}/`);
}

export function AdminShell({
  counts,
  admin,
  children,
}: {
  counts: AdminCounts;
  admin: { name: string; email: string; image: string | null };
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const current = ALL_LINKS.find((l) => isActive(pathname, l));
  const totalPending = counts.kyc + counts.reports + counts.payouts + counts.recruitersToPay + counts.support;

  // Al navegar desde el menu del movil, se cierra solo.
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex h-16 items-center gap-2.5 px-5">
        <Image
          src="/brand/logo-fantazy-live.png"
          alt=""
          width={30}
          height={30}
          className="rounded-lg"
        />
        <span className="brand-wordmark text-base leading-none">FantasyLive</span>
        <span className="ml-auto rounded-md bg-primary/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary">
          Admin
        </span>
      </div>

      <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-4">
        {NAV.map((section, i) => (
          <div key={section.title ?? i}>
            {section.title && (
              <p className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                {section.title}
              </p>
            )}
            <ul className="space-y-0.5">
              {section.links.map((link) => {
                const active = isActive(pathname, link);
                const n = link.count ? counts[link.count] : 0;
                return (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className={cn(
                        'relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                        active
                          ? 'bg-white/[0.06] text-foreground'
                          : 'text-muted-foreground hover:bg-white/[0.04] hover:text-foreground',
                      )}
                    >
                      {active && (
                        <span className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-primary" />
                      )}
                      <link.icon className={cn('h-4 w-4 shrink-0', active && 'text-primary')} />
                      <span className="flex-1 truncate">{link.label}</span>
                      {n > 0 && (
                        <span className="min-w-5 rounded-full bg-primary px-1.5 text-center text-[11px] font-bold leading-5 text-white">
                          {n}
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="space-y-1 border-t border-white/[0.06] p-3">
        <Link
          href="/"
          className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-white/[0.04] hover:text-foreground"
        >
          <ArrowUpRight className="h-4 w-4" />
          Ir a la web
        </Link>
        <div className="flex items-center gap-3 rounded-lg px-3 py-2">
          {admin.image ? (
            <Image
              src={admin.image}
              alt=""
              width={28}
              height={28}
              className="h-7 w-7 rounded-full object-cover"
              unoptimized
            />
          ) : (
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-muted text-xs font-bold uppercase">
              {admin.name.slice(0, 1)}
            </span>
          )}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{admin.name}</span>
            <span className="block truncate text-[11px] text-muted-foreground">{admin.email}</span>
          </span>
          <button
            type="button"
            onClick={() => signOut({ callbackUrl: '/' })}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-white/[0.06] hover:text-foreground"
            aria-label="Cerrar sesion"
            title="Cerrar sesion"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#0c0c0e]">
      {/* Menu fijo en escritorio */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 border-r border-white/[0.06] bg-[#111114] lg:block">
        {sidebar}
      </aside>

      {/* Barra superior en movil/tablet */}
      <header className="sticky top-0 z-40 flex h-14 items-center gap-3 border-b border-white/[0.06] bg-[#111114]/95 px-4 backdrop-blur lg:hidden">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="relative -ml-1 rounded-md p-1.5 hover:bg-white/[0.06]"
          aria-label="Abrir menu"
        >
          <Menu className="h-5 w-5" />
          {totalPending > 0 && (
            <span className="absolute right-0.5 top-0.5 h-2 w-2 rounded-full bg-primary" />
          )}
        </button>
        <span className="rounded-md bg-primary/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary">
          Admin
        </span>
        <span className="truncate text-sm font-semibold">{current?.label ?? 'Admin'}</span>
      </header>

      {open && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true">
          <button
            type="button"
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setOpen(false)}
            aria-label="Cerrar menu"
          />
          <aside className="absolute inset-y-0 left-0 w-72 max-w-[85vw] border-r border-white/[0.06] bg-[#111114] animate-in slide-in-from-left duration-200">
            {sidebar}
          </aside>
        </div>
      )}

      <main className="lg:pl-64">
        <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-10 lg:py-10">{children}</div>
      </main>
    </div>
  );
}

/** Cabecera comun de cada seccion del admin (con pestanas opcionales). */
export function AdminPageHeader({
  title,
  description,
  actions,
  tabs,
}: {
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  tabs?: React.ReactNode;
}) {
  return (
    <div className="mb-8">
      <div
        className={cn(
          'flex flex-wrap items-end justify-between gap-4',
          tabs ? 'pb-5' : 'border-b border-white/[0.06] pb-6',
        )}
      >
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
          {description && (
            <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">{description}</p>
          )}
        </div>
        {actions && <div className="flex shrink-0 gap-2">{actions}</div>}
      </div>
      {tabs}
    </div>
  );
}

/** Pestanas de estado (Pendientes / Aprobadas / ...) que cambian `?status=`. */
export function AdminTabs({
  basePath,
  current,
  tabs,
  param = 'status',
}: {
  basePath: string;
  /** Parametro de la URL que cambia cada pestana. */
  param?: string;
  /** Valor actual de `?status` ('' = la pestana por defecto). */
  current: string;
  tabs: { value: string; label: string }[];
}) {
  return (
    <div className="flex gap-1 overflow-x-auto border-b border-white/[0.06]">
      {tabs.map((t) => {
        const active = t.value === current;
        return (
          <Link
            key={t.value || 'default'}
            href={t.value ? `${basePath}?${param}=${t.value}` : basePath}
            className={cn(
              '-mb-px shrink-0 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors',
              active
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
