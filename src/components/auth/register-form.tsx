'use client';

import { useActionState, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Loader2, Sparkles } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { GENDER_LABELS } from '@/lib/constants';
import { registerAction, type ActionState } from '@/server/actions/auth';

const initialState: ActionState = {};

export function RegisterForm({ defaultRole }: { defaultRole: 'USER' | 'MODEL' }) {
  const router = useRouter();
  // Una sola cuenta para todos. Si viene de "trabaja con nosotros"
  // (?role=model), tras registrarse va directa a activar el modo creadora.
  const wantsCreator = defaultRole === 'MODEL';
  const [gender, setGender] = useState<string>('');
  const [state, formAction, isPending] = useActionState(
    registerAction,
    initialState,
  );

  useEffect(() => {
    if (state.success) {
      toast.success(state.success);
      // A los fans se les pregunta que les gusta para su Descubrir.
      router.push(wantsCreator ? '/hazte-creadora' : '/bienvenida');
      router.refresh();
    }
    if (state.error) toast.error(state.error);
  }, [state, wantsCreator, router]);

  // Fecha maxima permitida: hoy menos 18 años
  const maxBirthDate = new Date();
  maxBirthDate.setFullYear(maxBirthDate.getFullYear() - 18);

  const fieldError = (name: string) => state.fieldErrors?.[name]?.[0];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-2xl">Crear cuenta</CardTitle>
        <CardDescription>
          Recibe 25 tokens de bienvenida al registrarte.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <form action={formAction} className="space-y-4">
          {wantsCreator && (
            <div className="flex gap-2 rounded-lg border border-primary/30 bg-primary/5 p-3 text-xs text-muted-foreground">
              <Sparkles className="h-4 w-4 shrink-0 text-primary" />
              <span>
                Crea tu cuenta y despues activas el modo creadora en un minuto.
                Para cobrar tendras que verificar tu identidad.
              </span>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="name">Nombre</Label>
            <Input id="name" name="name" required placeholder="Como quieres que te llamen" />
            {fieldError('name') && (
              <p className="text-xs text-destructive">{fieldError('name')}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" required placeholder="tu@email.com" />
            {fieldError('email') && (
              <p className="text-xs text-destructive">{fieldError('email')}</p>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="password">Contrasena</Label>
              <Input
                id="password"
                name="password"
                type="password"
                required
                minLength={8}
                placeholder="Min. 8 caracteres"
              />
              {fieldError('password') && (
                <p className="text-xs text-destructive">{fieldError('password')}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirmPassword">Repetir</Label>
              <Input
                id="confirmPassword"
                name="confirmPassword"
                type="password"
                required
                placeholder="********"
              />
              {fieldError('confirmPassword') && (
                <p className="text-xs text-destructive">
                  {fieldError('confirmPassword')}
                </p>
              )}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="birthDate">Fecha de nacimiento</Label>
              <Input
                id="birthDate"
                name="birthDate"
                type="date"
                required
                max={maxBirthDate.toISOString().slice(0, 10)}
              />
              {fieldError('birthDate') && (
                <p className="text-xs text-destructive">{fieldError('birthDate')}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="country">Pais</Label>
              <Input id="country" name="country" placeholder="Espana" />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Genero</Label>
            <Select value={gender} onValueChange={setGender}>
              <SelectTrigger>
                <SelectValue placeholder="Selecciona" />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(GENDER_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <input type="hidden" name="gender" value={gender} />
          </div>

          <label className="flex items-start gap-2.5 text-xs text-muted-foreground">
            <input
              type="checkbox"
              name="acceptTerms"
              required
              className="mt-0.5 h-4 w-4 rounded border-border accent-[hsl(var(--primary))]"
            />
            <span>
              Confirmo que tengo 18 años o más y acepto los términos de servicio
              y la política de privacidad.
            </span>
          </label>

          <Button
            type="submit"
            variant="brand"
            size="lg"
            className="w-full"
            disabled={isPending}
          >
            {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Crear cuenta
          </Button>
        </form>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          Ya tienes cuenta?{' '}
          <Link href="/login" className="font-medium text-primary hover:underline">
            Iniciar sesion
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
