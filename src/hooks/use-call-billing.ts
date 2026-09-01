'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export interface BillingState {
  balance: number;
  tokensSpent: number;
  elapsedSeconds: number;
  lastCharge: number;
  isTerminating: boolean;
  reason?: string;
  /** Llamada sin tarifa (prueba gratuita) */
  isFreeTrial: boolean;
  /** Segundos gratis restantes, o null si no aplica */
  freeSecondsRemaining: number | null;
  /** El servidor confirma que aun no hay nadie al otro lado */
  waitingForPartner: boolean;
}

/**
 * Temporizador y cobro por minuto de una llamada.
 *
 * El cliente solo dispara el tick: el importe se calcula en el servidor con sus
 * propios timestamps, asi que manipular el intervalo desde el navegador no
 * altera lo que se cobra. Cuando el saldo no cubre el siguiente intervalo, o se
 * agotan los minutos gratis, el servidor devuelve shouldTerminate.
 *
 * DETALLE IMPORTANTE: los callbacks se guardan en refs y NO entran en las
 * dependencias del intervalo. Antes si lo hacian, y como el cronometro visual
 * provoca un render cada segundo, el intervalo de 15 s se destruia y recreaba
 * continuamente sin llegar a dispararse nunca: los tokens no se descontaban.
 */
export function useCallBilling({
  sessionId,
  ratePerMinute,
  intervalSeconds,
  active,
  initialBalance,
  onTerminate,
  onLowBalance,
}: {
  sessionId: string;
  ratePerMinute: number;
  intervalSeconds: number;
  active: boolean;
  initialBalance: number;
  onTerminate: (reason: string) => void;
  onLowBalance?: (remainingMinutes: number) => void;
}) {
  const [state, setState] = useState<BillingState>({
    balance: initialBalance,
    tokensSpent: 0,
    elapsedSeconds: 0,
    lastCharge: 0,
    isTerminating: false,
    isFreeTrial: false,
    freeSecondsRemaining: null,
    waitingForPartner: false,
  });

  const startedAtRef = useRef<number | null>(null);
  const lowBalanceWarnedRef = useRef(false);
  const terminatedRef = useRef(false);

  // Los callbacks cambian de identidad en cada render del componente padre.
  // Guardarlos en refs mantiene sendTick estable y, con el, el intervalo.
  const onTerminateRef = useRef(onTerminate);
  const onLowBalanceRef = useRef(onLowBalance);
  useEffect(() => {
    onTerminateRef.current = onTerminate;
    onLowBalanceRef.current = onLowBalance;
  });

  const rateRef = useRef(ratePerMinute);
  rateRef.current = ratePerMinute;

  const sendTick = useCallback(async () => {
    try {
      const res = await fetch(`/api/calls/${sessionId}/billing`, {
        method: 'POST',
        // Evita que un proxy intermedio sirva una respuesta cacheada
        cache: 'no-store',
      });
      if (!res.ok) return;

      const data = await res.json();

      setState((prev) => ({
        ...prev,
        balance: data.balance ?? prev.balance,
        tokensSpent: prev.tokensSpent + (data.tokensCharged ?? 0),
        lastCharge: data.tokensCharged ?? 0,
        isTerminating: Boolean(data.shouldTerminate),
        reason: data.reason,
        isFreeTrial: Boolean(data.isFreeTrial),
        freeSecondsRemaining: data.freeSecondsRemaining ?? null,
        waitingForPartner: Boolean(data.waitingForPartner),
      }));

      if (data.shouldTerminate && !terminatedRef.current) {
        terminatedRef.current = true;
        onTerminateRef.current(data.reason ?? 'INSUFFICIENT_TOKENS');
      }

      // Aviso cuando quedan menos de 3 minutos de saldo
      const rate = rateRef.current;
      if (rate > 0 && !lowBalanceWarnedRef.current) {
        const remaining = Math.floor((data.balance ?? 0) / rate);
        if (remaining <= 3) {
          lowBalanceWarnedRef.current = true;
          onLowBalanceRef.current?.(remaining);
        }
      }
    } catch {
      // Un fallo puntual de red no debe cortar la llamada
    }
  }, [sessionId]);

  // Cronometro visual (1 s)
  useEffect(() => {
    if (!active) return;
    if (startedAtRef.current === null) startedAtRef.current = Date.now();

    const timer = setInterval(() => {
      setState((prev) => ({
        ...prev,
        elapsedSeconds: Math.floor(
          (Date.now() - (startedAtRef.current ?? Date.now())) / 1000,
        ),
        // Descuenta el tiempo gratis entre ticks para que el contador no vaya
        // a saltos; el servidor lo corrige en cada tick.
        freeSecondsRemaining:
          prev.freeSecondsRemaining !== null && !prev.waitingForPartner
            ? Math.max(0, prev.freeSecondsRemaining - 1)
            : prev.freeSecondsRemaining,
      }));
    }, 1000);

    return () => clearInterval(timer);
  }, [active]);

  // Ticks de cobro / control de la prueba gratuita.
  //
  // Corre tambien en llamadas gratuitas: es el servidor quien decide cuando se
  // agotan los 5 minutos, y sin ticks nunca se enteraria.
  useEffect(() => {
    if (!active) return;

    // Primer tick inmediato: confirma presencia y arranca el contador real.
    void sendTick();

    const timer = setInterval(() => {
      void sendTick();
    }, Math.max(5, intervalSeconds) * 1000);

    return () => clearInterval(timer);
  }, [active, intervalSeconds, sendTick]);

  // Cobro del tramo final SOLO al desmontar de verdad (no en cada render).
  useEffect(() => {
    return () => {
      void sendTick();
    };
  }, [sendTick]);

  const remainingMinutes =
    ratePerMinute > 0 ? Math.floor(state.balance / ratePerMinute) : Infinity;

  return { ...state, remainingMinutes, sendTick };
}
