'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import type { Gender } from '@prisma/client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { GENDER_LABELS } from '@/lib/constants';
import { cn } from '@/lib/utils';
import { createModelProfileAction } from '@/server/actions/onboarding';

/**
 * Activar el modo creadora en un paso: nombre y como se presenta. Todo lo
 * demas (foto, bio, precios) se hace despues desde el panel, con el tutorial.
 */
export function OnboardingForm({
  defaultName,
  defaultGender,
}: {
  defaultName: string;
  defaultGender: Gender | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [stageName, setStageName] = useState(defaultName);
  const [gender, setGender] = useState<Gender | null>(defaultGender);

  function submit() {
    if (stageName.trim().length < 2) {
      toast.error('Elige un nombre de creador.');
      return;
    }
    if (!gender) {
      toast.error('Elige como te presentas.');
      return;
    }
    startTransition(async () => {
      const result = await createModelProfileAction({ stageName: stageName.trim(), gender });
      if (result.ok) {
        toast.success('¡Listo! Tu perfil de creador esta activo.');
        router.push('/dashboard/model');
        router.refresh();
      } else {
        toast.error(result.error ?? 'No se pudo activar');
      }
    });
  }

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="stageName">Tu nombre de creador</Label>
        <Input
          id="stageName"
          value={stageName}
          onChange={(e) => setStageName(e.target.value)}
          maxLength={40}
          placeholder="Como quieres que te conozcan"
        />
        <p className="text-xs text-muted-foreground">Lo puedes cambiar cuando quieras.</p>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium">Te presentas como</p>
        <div className="flex flex-wrap gap-2">
          {(Object.entries(GENDER_LABELS) as [Gender, string][]).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setGender(value)}
              className={cn(
                'rounded-full border px-3 py-1.5 text-sm transition-colors',
                gender === value
                  ? 'border-primary bg-primary/15 text-foreground'
                  : 'border-border/60 text-muted-foreground hover:text-foreground',
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <Button
        variant="brand"
        size="lg"
        className="h-12 w-full"
        onClick={submit}
        disabled={isPending || !gender}
      >
        {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
        Activar modo creador
      </Button>
    </div>
  );
}
