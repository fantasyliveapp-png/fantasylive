import Image from 'next/image';
import Link from 'next/link';

import { cn } from '@/lib/utils';

const ICON_SIZES = {
  sm: 32,
  md: 40,
} as const;

interface LogoProps {
  size?: keyof typeof ICON_SIZES;
  href?: string | null;
  className?: string;
  wordmarkClassName?: string;
}

/**
 * Lockup horizontal de marca (icono + wordmark), uso por defecto en
 * navbar/header/footer. El wordmark usa Akira Expanded exclusivamente
 * para el texto "Fantazy Live" (BRAND_HANDOFF.md #3).
 */
export function Logo({
  size = 'sm',
  href = '/',
  className,
  wordmarkClassName,
}: LogoProps) {
  const px = ICON_SIZES[size];

  const content = (
    <span className={cn('flex items-center gap-2', className)}>
      <Image
        src="/brand/logo-fantazy-live.png"
        alt="Fantazy Live"
        width={px}
        height={px}
        className="shrink-0 rounded-lg"
        priority
      />
      <span
        className={cn(
          'brand-wordmark text-lg leading-none tracking-tight text-foreground',
          wordmarkClassName,
        )}
      >
        FantasyLive
      </span>
    </span>
  );

  if (!href) return content;

  return (
    <Link href={href} className="flex items-center">
      {content}
    </Link>
  );
}
