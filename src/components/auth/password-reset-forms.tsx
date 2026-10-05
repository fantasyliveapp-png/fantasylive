'use client';

import { useActionState, useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CheckCircle2, Loader2, MailWarning, X } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  requestEmailChangeAction,
  requestPasswordResetAction,
  resendVerificationAction,
  resetPasswordAction,
  verifyEmailCodeAction,
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
  if (hidden) return null;
  return (
    <div className="flex items-center gap-2 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs sm:text-sm">
      <MailWarning className="h-4 w-4 shrink-0 text-amber-500" />
      <p className="min-w-0 flex-1">
        <strong>Confirma tu email</strong> <span className="hidden sm:inline">({email})</span> para comprar tokens, hacerte
        creadora y retirar.
      </p>
      <Link href="/verificar-email" className="shrink-0 font-semibold text-primary">
        Escribir código
      </Link>
      <button type="button" onClick={() => setHidden(true)} aria-label="Ocultar" className="shrink-0 p-1 text-muted-foreground">
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

/** Codigo OTP de 6 cifras que llega por correo. */
export function VerifyCodeForm({ email, next }: { email: string; next: string }) {
  const router = useRouter();
  const [state, action, pending] = useActionState<EmailFormState, FormData>(verifyEmailCodeAction, {});
  const [resending, startResend] = useTransition();

  useEffect(() => {
    if (state.success) {
      toast.success(state.success);
      router.push(next);
      router.refresh();
    }
  }, [state.success, next, router]);

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Te enviamos un código de 6 cifras a <strong className="text-foreground">{email}</strong>. Caduca en 15 minutos.
      </p>
      <form action={action} className="space-y-3">
        <Input
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]{6}"
          maxLength={6}
          placeholder="000000"
          className="h-14 text-center font-mono text-2xl tracking-[0.5em]"
          autoFocus
          required
        />
        <FieldError errors={state.fieldErrors?.code} />
        {state.error && <p className="text-sm text-destructive">{state.error}</p>}
        <Button type="submit" variant="brand" size="lg" className="w-full" disabled={pending || Boolean(state.success)}>
          {pending && <Loader2 className="h-4 w-4 animate-spin" />}
          Confirmar email
        </Button>
      </form>
      <div className="flex items-center justify-between text-sm">
        <button
          type="button"
          disabled={resending}
          onClick={() =>
            startResend(async () => {
              const r = await resendVerificationAction();
              if (r.success) toast.success(r.success);
              else toast.error(r.error ?? 'No se pudo enviar.');
            })
          }
          className="font-semibold text-primary disabled:opacity-60"
        >
          {resending ? 'Enviando…' : 'Enviar otro código'}
        </button>
        <Link href={next} className="text-muted-foreground hover:text-foreground">
          Ahora no
        </Link>
      </div>
      <p className="text-xs text-muted-foreground">¿No llega? Revisa la carpeta de spam o promociones.</p>
    </div>
  );
}

/** Ajustes: cambiar el email (se confirma desde el correo nuevo). */
export function ChangeEmailForm() {
  const [state, action, pending] = useActionState<EmailFormState, FormData>(requestEmailChangeAction, {});
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        Cambiar email
      </Button>
    );
  }
  if (state.success) {
    return (
      <p className="flex items-start gap-2 rounded-lg bg-state-connected/10 p-3 text-sm">
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-state-connected" />
        {state.success}
      </p>
    );
  }
  return (
    <form action={action} className="space-y-3 rounded-xl border border-border/60 p-3">
      <div className="space-y-1.5">
        <Label htmlFor="newEmail">Email nuevo</Label>
        <Input id="newEmail" name="newEmail" type="email" autoComplete="email" required />
        <FieldError errors={state.fieldErrors?.newEmail} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="currentPassword">Tu contraseña actual</Label>
        <Input id="currentPassword" name="password" type="password" autoComplete="current-password" required />
        <FieldError errors={state.fieldErrors?.password} />
      </div>
      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
      <p className="text-xs text-muted-foreground">
        Te enviaremos un enlace al email nuevo. Hasta que lo abras seguirás usando el actual.
      </p>
      <div className="flex gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Cancelar
        </Button>
        <Button type="submit" variant="brand" size="sm" disabled={pending}>
          {pending && <Loader2 className="h-4 w-4 animate-spin" />}
          Enviar enlace
        </Button>
      </div>
    </form>
  );
}
