'use client';

import { useEffect, useState } from 'react';
import { ShieldAlert } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { AGE_COOKIE, AGE_LEGACY_STORAGE_KEY } from '@/lib/age-gate';

function rememberConfirmation() {
  document.cookie = `${AGE_COOKIE}=1; Max-Age=${60 * 60 * 24 * 365}; Path=/; SameSite=Lax${
    location.protocol === 'https:' ? '; Secure' : ''
  }`;
}

/**
 * Verificacion de edad obligatoria (18+).
 * Requisito legal minimo para plataformas de contenido adulto; en produccion
 * debe complementarse con verificacion de identidad real segun jurisdiccion.
 *
 * El servidor ya la manda dentro de la pagina si no ve la cookie
 * (`initialConfirmed`), asi que se ve desde el primer instante.
 */
export function AgeGate({ initialConfirmed }: { initialConfirmed: boolean }) {
  const [confirmed, setConfirmed] = useState(initialConfirmed);

  useEffect(() => {
    if (confirmed) return;
    // Quien ya acepto con la version anterior (localStorage), o una pagina
    // estatica que no pudo leer la cookie: se oculta y se guarda la cookie.
    let legacy = false;
    try {
      legacy = window.localStorage.getItem(AGE_LEGACY_STORAGE_KEY) === 'true';
    } catch {
      // Sin almacenamiento local: se queda la ventana.
    }
    if (legacy || document.cookie.split('; ').includes(`${AGE_COOKIE}=1`)) {
      rememberConfirmation();
      setConfirmed(true);
    }
  }, [confirmed]);

  if (confirmed) return null;

  const accept = () => {
    rememberConfirmation();
    try {
      window.localStorage.setItem(AGE_LEGACY_STORAGE_KEY, 'true');
    } catch {
      // La cookie basta.
    }
    setConfirmed(true);
  };

  // Sin desenfoque: con el fondo casi opaco no se notaba y en moviles es caro.
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/95 p-6">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 text-center shadow-2xl">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-destructive/15">
          <ShieldAlert className="h-7 w-7 text-destructive" />
        </div>

        <h2 className="text-2xl font-bold">Confirma tu edad</h2>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          Fantasy Live conecta personas mayores de edad para chatear en vivo y
          descubrir contenido de sus creadores favoritos. Algunas áreas son
          privadas y pueden incluir contenido íntimo. Al continuar declaras
          tener al menos 18 años o la mayoría de edad legal en tu
          jurisdicción.
        </p>

        <div className="mt-7 space-y-3">
          <Button variant="brand" size="lg" className="w-full" onClick={accept}>
            Tengo 18 años o más - Entrar
          </Button>
          <Button
            variant="outline"
            size="lg"
            className="w-full"
            onClick={() => {
              window.location.href = 'https://www.google.com';
            }}
          >
            Soy menor de 18 - Salir
          </Button>
        </div>

        <p className="mt-6 text-xs text-muted-foreground">
          Este sitio está etiquetado con RTA. Puedes bloquearlo con software de
          control parental.
        </p>
      </div>
    </div>
  );
}
