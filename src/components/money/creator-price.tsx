'use client';

import { useEffect, useState } from 'react';
import { Coins } from 'lucide-react';

import { creatorNetCents, type EconomyParams } from '@/lib/earnings';
import { cn, formatMoney } from '@/lib/utils';

/**
 * LO QUE LE LLEGA AL CREADOR, en dolares: es lo unico que se le enseña.
 * Comisiones y costes los cubre la plataforma, asi que no se mencionan: el
 * numero es exacto (lo que entra en su saldo y luego retira integro).
 */
export function creatorUsd(tokens: number, economy: EconomyParams) {
  return formatMoney(creatorNetCents(tokens, economy));
}

/** Tokens minimos para que al creador le lleguen `cents`. */
export function tokensForCreatorCents(cents: number, economy: EconomyParams) {
  if (cents <= 0) return 1;
  const share = ((100 - economy.platformCommissionPercent) / 100) * economy.payoutCentsPerToken;
  let t = Math.max(1, Math.floor(cents / Math.max(share, 0.01)));
  while (creatorNetCents(t, economy) < cents) t++;
  return t;
}

export function YouGet({
  tokens,
  economy,
  suffix,
  className,
}: {
  tokens: number;
  economy: EconomyParams;
  /** p. ej. "por venta", "por minuto" */
  suffix?: string;
  className?: string;
}) {
  return (
    <span className={cn('text-xs text-muted-foreground', className)}>
      Ganas <strong className="font-semibold text-state-connected">{creatorUsd(tokens, economy)}</strong>
      {suffix ? ` ${suffix}` : ''}
    </span>
  );
}

/**
 * Precio en tokens (lo que paga el fan) con su equivalente en $ para el
 * creador. Se puede escribir en cualquiera de los dos: si pone dolares, se
 * calcula cuantos tokens hacen falta para que le lleguen.
 */
export function CreatorPriceInput({
  value,
  onChange,
  economy,
  choices,
  suffix = 'por venta',
}: {
  value: number;
  onChange: (tokens: number) => void;
  economy: EconomyParams;
  choices?: number[];
  suffix?: string;
}) {
  const [usdText, setUsdText] = useState(() => (creatorNetCents(value, economy) / 100).toFixed(2));
  const [editingUsd, setEditingUsd] = useState(false);
  // Si cambian los tokens desde fuera (o tocando un precio), se recalcula el $.
  useEffect(() => {
    if (!editingUsd) setUsdText((creatorNetCents(value, economy) / 100).toFixed(2));
  }, [value, economy, editingUsd]);

  return (
    <div className="space-y-1.5">
      {choices && (
        <div className="flex flex-wrap gap-1.5">
          {choices.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => onChange(p)}
              className={cn(
                'h-8 rounded-full border px-3 text-xs font-semibold',
                value === p ? 'border-token bg-token/15 text-token' : 'border-border/60 text-muted-foreground',
              )}
            >
              {p} tk
            </button>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex h-9 items-center gap-1.5 rounded-md border border-input bg-background px-2.5">
          <Coins className="h-4 w-4 text-token" />
          <input
            type="number"
            min={1}
            value={value}
            onChange={(e) => onChange(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
            aria-label="Precio en tokens"
            className="w-16 bg-transparent text-sm font-semibold outline-none"
          />
          <span className="text-xs text-muted-foreground">tk</span>
        </label>
        <span className="text-xs text-muted-foreground">=</span>
        <label className="flex h-9 items-center gap-1 rounded-md border border-state-connected/40 bg-state-connected/5 px-2.5">
          <span className="text-xs text-muted-foreground">ganas</span>
          <input
            type="number"
            min={0}
            step="0.01"
            value={usdText}
            onFocus={() => setEditingUsd(true)}
            onBlur={() => setEditingUsd(false)}
            onChange={(e) => {
              setUsdText(e.target.value);
              const cents = Math.round((Number(e.target.value) || 0) * 100);
              onChange(tokensForCreatorCents(cents, economy));
            }}
            aria-label="Lo que ganas en dolares"
            className="w-16 bg-transparent text-sm font-semibold text-state-connected outline-none"
          />
          <span className="text-xs font-semibold text-state-connected">$</span>
        </label>
        <span className="text-xs text-muted-foreground">{suffix}</span>
      </div>
    </div>
  );
}
