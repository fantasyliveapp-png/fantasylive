'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Globe, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useI18n } from '@/components/providers/i18n-provider';
import { LOCALES, LOCALE_FLAGS, LOCALE_LABELS } from '@/lib/i18n/locales';
import { setLocaleAction } from '@/server/actions/i18n';
import { cn } from '@/lib/utils';

export function LanguageSwitcher({ className }: { className?: string }) {
  const router = useRouter();
  const { locale, t } = useI18n();
  const [isPending, startTransition] = useTransition();

  function choose(next: string) {
    if (next === locale) return;
    startTransition(async () => {
      await setLocaleAction(next);
      // El idioma se resuelve en servidor a partir de la cookie, asi que hace
      // falta volver a pedir el arbol para que se repinte traducido.
      router.refresh();
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t('common.language')}
          className={cn('relative', className)}
        >
          {isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Globe className="h-4 w-4" />
          )}
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-44">
        {LOCALES.map((option) => (
          <DropdownMenuItem
            key={option}
            onClick={() => choose(option)}
            className="gap-2"
          >
            <span aria-hidden>{LOCALE_FLAGS[option]}</span>
            <span className="flex-1">{LOCALE_LABELS[option]}</span>
            {option === locale && <Check className="h-4 w-4 text-primary" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
