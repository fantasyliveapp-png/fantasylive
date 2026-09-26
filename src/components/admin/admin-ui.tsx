import Link from 'next/link';

import { cn } from '@/lib/utils';

/** Piezas visuales comunes del admin (componentes de servidor). */

export function Panel({
  title,
  aside,
  children,
  className,
}: {
  title?: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn('overflow-hidden rounded-xl border border-white/[0.06] bg-[#141417]', className)}
    >
      {title && (
        <header className="flex items-center justify-between gap-3 border-b border-white/[0.06] px-5 py-3">
          <h2 className="text-sm font-semibold">{title}</h2>
          {aside && <span className="text-xs text-muted-foreground">{aside}</span>}
        </header>
      )}
      {children}
    </section>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-5 py-10 text-center text-sm text-muted-foreground">{children}</p>;
}

const PILL = {
  neutral: 'bg-white/[0.06] text-muted-foreground',
  good: 'bg-state-connected/15 text-state-connected',
  warn: 'bg-amber-500/15 text-amber-500',
  bad: 'bg-destructive/15 text-destructive',
  brand: 'bg-primary/15 text-primary',
  gold: 'bg-champagne-gold/15 text-champagne-gold',
} as const;

export function Pill({
  tone = 'neutral',
  children,
}: {
  tone?: keyof typeof PILL;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium',
        PILL[tone],
      )}
    >
      {children}
    </span>
  );
}

/** Avatar + nombre que lleva a la ficha de la persona en el admin. */
export function PersonLink({
  id,
  name,
  username,
  image,
  size = 'md',
}: {
  id: string;
  name: string;
  username?: string | null;
  image?: string | null;
  size?: 'sm' | 'md';
}) {
  const px = size === 'sm' ? 'h-6 w-6 text-[10px]' : 'h-8 w-8 text-xs';
  return (
    <Link href={`/admin/users/${id}`} className="group flex min-w-0 items-center gap-2">
      {image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={image} alt="" className={cn('shrink-0 rounded-full object-cover', px)} />
      ) : (
        <span
          className={cn(
            'flex shrink-0 items-center justify-center rounded-full bg-muted font-bold uppercase',
            px,
          )}
        >
          {name.slice(0, 1)}
        </span>
      )}
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium group-hover:underline">{name}</span>
        {username && size === 'md' && (
          <span className="block truncate text-[11px] text-muted-foreground">@{username}</span>
        )}
      </span>
    </Link>
  );
}

/** Buscador simple por GET (mantiene el resto de filtros como campos ocultos). */
export function SearchBox({
  action,
  placeholder,
  defaultValue,
  hidden,
}: {
  action: string;
  placeholder: string;
  defaultValue?: string;
  hidden?: Record<string, string | undefined>;
}) {
  return (
    <form action={action} className="flex gap-2">
      {Object.entries(hidden ?? {}).map(([k, v]) =>
        v ? <input key={k} type="hidden" name={k} value={v} /> : null,
      )}
      <input
        name="q"
        defaultValue={defaultValue}
        placeholder={placeholder}
        className="h-9 w-full min-w-0 rounded-lg border border-white/[0.08] bg-[#141417] px-3 text-sm placeholder:text-muted-foreground focus:border-primary/60 focus:outline-none sm:w-72"
      />
      <button
        type="submit"
        className="h-9 shrink-0 rounded-lg bg-white/[0.06] px-3 text-sm font-medium hover:bg-white/[0.1]"
      >
        Buscar
      </button>
    </form>
  );
}
