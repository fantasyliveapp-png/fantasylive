'use client';

import { createContext, useCallback, useContext, useState } from 'react';
import Link from 'next/link';
import { BadgeCheck, Lock, Sparkles, VenetianMask, X } from 'lucide-react';

import { Button } from '@/components/ui/button';

/**
 * "UNETE GRATIS"
 *
 * Cualquiera puede entrar y mirar el Descubrir sin cuenta (tras confirmar
 * que es mayor de edad). Para HACER algo (me gusta, comentar, seguir,
 * escribir, desbloquear, suscribirse, llamar...) hay que registrarse: todos
 * los botones abren este mismo aviso, que lleva a crear la cuenta y luego
 * devuelve a la pagina donde estaba.
 */

type Ask = (reason?: string) => void;

const JoinPromptContext = createContext<Ask>(() => {});

/** Abre el aviso "Unete gratis". `reason`: "para dar me gusta", etc. */
export function useJoinPrompt(): Ask {
  return useContext(JoinPromptContext);
}

export function JoinPromptProvider({ children }: { children: React.ReactNode }) {
  const [reason, setReason] = useState<string | null>(null);
  const ask = useCallback<Ask>((r) => setReason(r ?? 'para hacer esto'), []);

  return (
    <JoinPromptContext.Provider value={ask}>
      {children}
      {reason !== null && <JoinSheet reason={reason} onClose={() => setReason(null)} />}
    </JoinPromptContext.Provider>
  );
}

function JoinSheet({ reason, onClose }: { reason: string; onClose: () => void }) {
  // Volver aqui despues de registrarse o entrar (el aviso solo se pinta en
  // el navegador, tras tocar un boton, asi que window existe).
  const next = encodeURIComponent(`${window.location.pathname}${window.location.search}`);

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center md:items-center" role="dialog" aria-modal="true" aria-label="Unete gratis">
      <button
        type="button"
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        aria-label="Cerrar"
      />
      <div className="relative w-full max-w-md rounded-t-[1.75rem] border-t border-border/60 bg-background p-6 shadow-2xl animate-in slide-in-from-bottom-8 duration-300 md:rounded-3xl md:border">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 rounded-full p-1.5 text-muted-foreground hover:bg-muted"
          aria-label="Cerrar"
        >
          <X className="h-5 w-5" />
        </button>

        <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-tr from-primary via-fantazy-red to-champagne-gold text-white">
          <Sparkles className="h-7 w-7" />
        </span>
        <h2 className="mt-4 font-heading text-2xl uppercase tracking-wide">Unete gratis</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Crea tu cuenta {reason}. Es gratis y tardas menos de un minuto.
        </p>

        <ul className="mt-4 space-y-2 text-sm">
          <li className="flex items-center gap-2.5">
            <VenetianMask className="h-4 w-4 shrink-0 text-primary" />
            Es anonimo: solo se ve tu alias, nunca tu nombre ni tu email
          </li>
          <li className="flex items-center gap-2.5">
            <BadgeCheck className="h-4 w-4 shrink-0 text-primary" />
            Crear la cuenta no cuesta nada
          </li>
          <li className="flex items-center gap-2.5">
            <Lock className="h-4 w-4 shrink-0 text-primary" />
            Solo para mayores de 18
          </li>
        </ul>

        <div className="mt-6 space-y-2">
          <Link href={`/register?next=${next}`} className="block" onClick={onClose}>
            <Button variant="brand" size="lg" className="h-12 w-full">
              Crear cuenta gratis
            </Button>
          </Link>
          <Link href={`/login?callbackUrl=${next}`} className="block" onClick={onClose}>
            <Button variant="outline" size="lg" className="h-12 w-full">
              Ya tengo cuenta
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
