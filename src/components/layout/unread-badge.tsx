import { cn } from '@/lib/utils';

/** Numerito rojo sobre un icono (mensajes sin leer). Nada si es 0. */
export function UnreadBadge({ count, className }: { count: number; className?: string }) {
  if (count <= 0) return null;
  return (
    <span
      className={cn(
        'absolute -right-2 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold leading-none text-primary-foreground ring-2 ring-background',
        className,
      )}
      aria-label={`${count} ${count === 1 ? 'chat sin leer' : 'chats sin leer'}`}
    >
      {count > 9 ? '9+' : count}
    </span>
  );
}
