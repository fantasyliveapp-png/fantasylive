'use client';

import { useState, useTransition } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { cn } from '@/lib/utils';
import { setMessagePrivacyAction } from '@/server/actions/chat';

type Privacy = 'EVERYONE' | 'FOLLOWING' | 'NOBODY';

const OPTIONS: { value: Privacy; label: string; hint: string }[] = [
  {
    value: 'EVERYONE',
    label: 'Todos',
    hint: 'Quien no sigues te llega como solicitud y decides si la aceptas.',
  },
  {
    value: 'FOLLOWING',
    label: 'Personas que sigo',
    hint: 'Solo pueden escribirte las cuentas que tu sigues.',
  },
  { value: 'NOBODY', label: 'Nadie', hint: 'Nadie puede empezar un chat contigo.' },
];

/** Ajuste "Quien puede escribirme", con guardado inmediato. */
export function MessagePrivacySetting({ initial }: { initial: Privacy }) {
  const [value, setValue] = useState<Privacy>(initial);
  const [isPending, startTransition] = useTransition();

  function choose(next: Privacy) {
    if (next === value) return;
    const previous = value;
    setValue(next);
    startTransition(async () => {
      const result = await setMessagePrivacyAction(next);
      if (!result.ok) {
        setValue(previous);
        toast.error(result.error ?? 'No se pudo guardar.');
      }
    });
  }

  return (
    <div className="space-y-2" role="radiogroup" aria-label="Quien puede escribirme">
      {OPTIONS.map((o) => {
        const active = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => choose(o.value)}
            className={cn(
              'flex w-full items-start gap-3 rounded-xl border p-3 text-left transition-colors',
              active ? 'border-primary bg-primary/10' : 'border-border/60 hover:border-muted-foreground/50',
            )}
          >
            <span
              className={cn(
                'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border',
                active ? 'border-primary' : 'border-muted-foreground/50',
              )}
            >
              {active && <span className="h-2 w-2 rounded-full bg-primary" />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">{o.label}</span>
              <span className="block text-xs text-muted-foreground">{o.hint}</span>
            </span>
            {active && isPending && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          </button>
        );
      })}
    </div>
  );
}
