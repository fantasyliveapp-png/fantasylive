'use client';

import { useEffect, useState } from 'react';
import { ShieldAlert } from 'lucide-react';

import { Button } from '@/components/ui/button';

const STORAGE_KEY = 'fl_age_confirmed_v1';

/**
 * Verificacion de edad obligatoria (18+).
 * Requisito legal minimo para plataformas de contenido adulto; en produccion
 * debe complementarse con verificacion de identidad real segun jurisdiccion.
 */
export function AgeGate() {
  const [confirmed, setConfirmed] = useState(true); // evita flash en SSR

  useEffect(() => {
    setConfirmed(window.localStorage.getItem(STORAGE_KEY) === 'true');
  }, []);

  if (confirmed) return null;

  const accept = () => {
    window.localStorage.setItem(STORAGE_KEY, 'true');
    setConfirmed(true);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/95 p-6 backdrop-blur-md">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 text-center shadow-2xl">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-destructive/15">
          <ShieldAlert className="h-7 w-7 text-destructive" />
        </div>

        <h2 className="text-2xl font-bold">Confirma tu edad</h2>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          FantasyLive conecta personas mayores de edad para chatear en vivo y
          descubrir contenido de sus creadores favoritos. Algunas areas son
          privadas y pueden incluir contenido intimo. Al continuar declaras
          tener al menos 18 anos o la mayoria de edad legal en tu
          jurisdiccion.
        </p>

        <div className="mt-7 space-y-3">
          <Button variant="brand" size="lg" className="w-full" onClick={accept}>
            Tengo 18 anos o mas - Entrar
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
          Este sitio esta etiquetado con RTA. Puedes bloquearlo con software de
          control parental.
        </p>
      </div>
    </div>
  );
}
