'use client';

import { useState } from 'react';

import { cn } from '@/lib/utils';

/** Texto recortado a unas lineas con "mas", como la bio de Instagram. */
export function ExpandableText({
  text,
  lines = 3,
  className,
}: {
  text: string;
  lines?: number;
  className?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const long = text.length > 160 || text.split('\n').length > lines;

  return (
    <div className={className}>
      <p
        className={cn('whitespace-pre-line', !expanded && long && 'line-clamp-3')}
        style={!expanded && long ? { WebkitLineClamp: lines } : undefined}
      >
        {text}
      </p>
      {long && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-0.5 text-xs font-semibold text-foreground hover:underline"
        >
          {expanded ? 'Ver menos' : 'Ver mas'}
        </button>
      )}
    </div>
  );
}
