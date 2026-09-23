import type { Metadata } from 'next';
import Link from 'next/link';

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
import { config } from '@/lib/config';

export const metadata: Metadata = { title: 'Recuperar contrasena' };

export default function ForgotPasswordPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-2xl">Recuperar contrasena</CardTitle>
        <CardDescription>
          Te enviaremos un enlace para restablecerla.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="email">Email de tu cuenta</Label>
          <Input id="email" type="email" placeholder="tu@email.com" />
        </div>

        <Button variant="brand" size="lg" className="w-full" disabled>
          Enviar enlace
        </Button>

        <div className="rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">
          El envio de emails transaccionales aun no esta conectado. Configura un
          proveedor (Resend, SendGrid o Amazon SES) y activa el proveedor
          &ldquo;email&rdquo; de Auth.js para habilitar este flujo. Mientras
          tanto, un administrador puede restablecer la contrasena manualmente
          desde{' '}
          <span className="font-mono">{config.moderation.adminAlertEmail}</span>.
        </div>

        <p className="text-center text-sm text-muted-foreground">
          <Link href="/login" className="text-primary hover:underline">
            Volver a iniciar sesion
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
