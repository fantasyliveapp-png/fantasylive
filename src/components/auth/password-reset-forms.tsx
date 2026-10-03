'use client';

import { useActionState, useState, useTransition } from 'react';
import Link from 'next/link';
import { CheckCircle2, Loader2, MailWarning, X } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  requestPasswordResetAction,
  resendVerificationAction,
  resetPasswordAction,
  type EmailFormState,
} from '@/server/actions/account-email';

function FieldError({ errors }: { errors?: string[] }) {
  if (!errors?.length) return null;
  return <p className="text-xs text-destructive">{errors[0]}</p>;
}

/** Paso 1: pedir el enlace por correo. */
export function ForgotPasswordForm() {
  const [state, action, pending] = useActionState<EmailFormState, FormData>(requestPasswordResetAction, {});
  if (state.success) {
    return (
      <div className="space-y-4">
        <p className="flex items-start gap-2 rounded-lg bg-state-connected/10 p-3 text-sm">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-state-connected" />
          {state.success}
        </p>
      </div>
    );
  }
  return (
    <form action={action} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="email">Email de tu cuenta</Label>
        <Input id="email" name="email" type="email" autoComplete="email" placeholder="tu@email.com" required />
        <FieldError errors={state.fieldErrors?.email} />
      </div>
      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
      <Button type="submit" variant="brand" size="lg" className="w-full" disabled={pending}>
        {pending && <Loader2 className="h-4 w-4 animate-spin" />}
        Enviar enlace
      </Button>
    </form>
  );
}

/**
 * Paso 2: contraseña nueva con el enlace del correo. `valid` lo decide el
 * servidor al abrir la pagina; tras guardar, el enlace ya esta gastado pero
 * se sigue mostrando el exito (el estado vive aqui, no en la pagina).
 */
export function ResetPasswordForm({ token, valid }: { token: string; valid: boolean }) {
  const [state, action, pending] = useActionState<EmailFormState, FormData>(resetPasswordAction, {});
  if (!state.success && !valid) {
    return (
      <div className="space-y-3 text-sm text-muted-foreground">
        <p>Este enlace no es válido o ha caducado. Los enlaces duran 1 hora y solo sirven una vez.</p>
        <Link href="/forgot-password" className="block">
          <Button variant="brand" size="lg" className="w-full">
            Pedir otro enlace
          </Button>
        </Link>
      </div>
    );
  }
  if (state.success) {
    return (
      <div className="space-y-4">
        <p className="flex items-start gap-2 rounded-lg bg-state-connected/10 p-3 text-sm">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-state-connected" />
          {state.success}
        </p>
        <Link href="/login" className="block">
          <Button variant="brand" size="lg" className="w-full">
            Iniciar sesión
          </Button>
        </Link>
      </div>
    );
  }
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="token" value={token} />
      <div className="space-y-2">
        <Label htmlFor="password">Contraseña nueva</Label>
        <Input id="password" name="password" type="password" autoComplete="new-password" required />
        <p className="text-xs text-muted-foreground">Mínimo 8 caracteres, con letras y números.</p>
        <FieldError errors={state.fieldErrors?.password} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="confirm">Repítela</Label>
        <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required />
        <FieldError errors={state.fieldErrors?.confirm} />
      </div>
      {state.error && (
        <p className="text-sm text-destructive">
          {state.error}{' '}
          <Link href="/forgot-password" className="underline">
            Pedir otro enlace
          </Link>
        </p>
      )}
      <Button type="submit" variant="brand" size="lg" className="w-full" disabled={pending}>
        {pending && <Loader2 className="h-4 w-4 animate-spin" />}
        Guardar contraseña
      </Button>
    </form>
  );
}

/** Aviso fino arriba de la web mientras el email no este confirmado. */
export function VerifyEmailBanner({ email }: { email: string }) {
  const [hidden, setHidden] = useState(false);
  const [pending, start] = useTransition();
  if (hidden) return null;
  return (
    <div className="flex items-center gap-2 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs sm:text-sm">
      <MailWarning className="h-4 w-4 shrink-0 text-amber-500" />
      <p className="min-w-0 flex-1">
        <strong>Confirma tu email</strong> <span className="hidden sm:inline">({email})</span> para comprar tokens, hacerte
        creadora y retirar.
      </p>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await resendVerificationAction();
            if (r.success) toast.success(r.success);
            else toast.error(r.error ?? 'No se pudo enviar.');
          })
        }
        className="shrink-0 font-semibold text-primary disabled:opacity-60"
      >
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Enviar enlace'}
      </button>
      <button type="button" onClick={() => setHidden(true)} aria-label="Ocultar" className="shrink-0 p-1 text-muted-foreground">
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
