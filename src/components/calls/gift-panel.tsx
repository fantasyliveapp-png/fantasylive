'use client';

import { useState, useTransition } from 'react';
import { Coins, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { GIFT_PRESETS } from '@/lib/constants';
import { sendGiftAction } from '@/server/actions/wallet';
import { formatTokens } from '@/lib/utils';

export function GiftPanel({
  receiverId,
  sessionId,
  balance,
  onClose,
  onSent,
}: {
  receiverId: string;
  sessionId?: string;
  balance: number;
  onClose: () => void;
  onSent?: (tokens: number) => void;
}) {
  const [custom, setCustom] = useState('');
  const [isPending, startTransition] = useTransition();

  function send(tokens: number, emoji?: string) {
    if (tokens <= 0) return;
    if (tokens > balance) {
      toast.error('No tienes suficientes tokens.');
      return;
    }

    startTransition(async () => {
      const result = await sendGiftAction({
        receiverId,
        tokens,
        sessionId,
        emoji,
      });

      if (result.ok) {
        toast.success(`${emoji ?? ''} Has enviado ${tokens} tokens`);
        setCustom('');
        onSent?.(tokens);
      } else {
        toast.error(result.error ?? 'No se pudo enviar el regalo');
      }
    });
  }

  return (
    <div className="w-64 rounded-xl border border-white/10 bg-black/85 p-3 backdrop-blur-xl">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm font-medium text-white">Enviar regalo</span>
        <button onClick={onClose} className="text-white/50 hover:text-white">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="grid grid-cols-5 gap-1.5">
        {GIFT_PRESETS.map((gift) => (
          <button
            key={gift.tokens}
            type="button"
            disabled={isPending || gift.tokens > balance}
            onClick={() => send(gift.tokens, gift.emoji)}
            title={`${gift.label} - ${gift.tokens} tokens`}
            className="flex flex-col items-center gap-0.5 rounded-lg border border-white/10 py-2 transition-colors hover:border-primary hover:bg-primary/10 disabled:opacity-30"
          >
            <span className="text-lg leading-none">{gift.emoji}</span>
            <span className="text-[10px] font-medium text-white/70">
              {gift.tokens}
            </span>
          </button>
        ))}
      </div>

      <div className="mt-3 flex gap-1.5">
        <Input
          type="number"
          min={1}
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          placeholder="Otra cantidad"
          className="h-9 border-white/10 bg-white/5 text-sm text-white"
        />
        <Button
          size="sm"
          variant="token"
          className="h-9"
          disabled={isPending || !custom}
          onClick={() => send(Number(custom), '🎁')}
        >
          {isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Coins className="h-4 w-4" />
          )}
        </Button>
      </div>

      <p className="mt-2 text-center text-[11px] text-white/40">
        Saldo: {formatTokens(balance)} tokens
      </p>
    </div>
  );
}
