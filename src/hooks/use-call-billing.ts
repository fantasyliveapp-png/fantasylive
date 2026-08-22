'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export interface BillingState {
  balance: number;
  tokensSpent: number;
  elapsedSeconds: number;
  lastCharge: number;
  isTerminating: boolean;
  reason?: string;
}

/**
 * Temporizador y cobro por minuto de una llamada.
 *
 * El cliente solo dispara el tick: el importe se calcula en el servidor con sus
 * propios timestamps, asi que manipular el intervalo desde el navegador no
 * altera lo que se cobra. Cuando el saldo no cubre el siguiente intervalo, el
 * servidor devuelve shouldTerminate y aqui se corta la llamada.
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
  });

  const startedAtRef = useRef<number | null>(null);
  const lowBalanceWarnedRef = useRef(false);

  const sendTick = useCallback(async () => {
    try {
      const res = await fetch(`/api/calls/${sessionId}/billing`, {
        method: 'POST',
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
      }));

      if (data.shouldTerminate) {
        onTerminate(data.reason ?? 'INSUFFICIENT_TOKENS');
      }

      // Aviso cuando quedan menos de 3 minutos de saldo
      if (ratePerMinute > 0 && !lowBalanceWarnedRef.current) {
        const remaining = Math.floor((data.balance ?? 0) / ratePerMinute);
        if (remaining <= 3) {
          lowBalanceWarnedRef.current = true;
          onLowBalance?.(remaining);
        }
      }
    } catch {
      // Un fallo puntual de red no debe cortar la llamada
    }
  }, [onLowBalance, onTerminate, ratePerMinute, sessionId]);

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
      }));
    }, 1000);

    return () => clearInterval(timer);
  }, [active]);

  // Ticks de cobro
  useEffect(() => {
    if (!active || ratePerMinute <= 0) return;

    const timer = setInterval(() => {
      void sendTick();
    }, intervalSeconds * 1000);

    return () => {
      clearInterval(timer);
      // Cobro del tramo final al desmontar
      void sendTick();
    };
  }, [active, intervalSeconds, ratePerMinute, sendTick]);

  const remainingMinutes =
    ratePerMinute > 0 ? Math.floor(state.balance / ratePerMinute) : Infinity;

  return { ...state, remainingMinutes, sendTick };
}
