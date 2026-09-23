'use client';

import { useEffect, useState, useTransition } from 'react';
import { BarChart3, Check, Loader2, Lock } from 'lucide-react';
import { toast } from 'sonner';

import type { FeedPoll } from '@/lib/posts';
import { pollTimeLeft } from '@/lib/polls';
import { cn, formatTokens } from '@/lib/utils';
import { votePostPollAction } from '@/server/actions/posts';

/**
 * Encuesta de una publicacion.
 *
 * Antes de votar se ven las opciones como botones; al votar (o si ya termino,
 * o si es la propia creadora) se convierten en barras con el porcentaje. El
 * voto se pinta al instante y se corrige con la respuesta del servidor.
 */
export function PostPoll({
  poll: initial,
  canVote,
  lockedHint,
  showResults: forceResults = false,
  preview = false,
  onRequireLogin,
}: {
  poll: FeedPoll;
  /** Quien mira puede votar (con sesion, no es la autora, tiene acceso). */
  canVote: boolean;
  /** Si la publicacion esta bloqueada, el motivo para no poder votar. */
  lockedHint?: string;
  /** Mostrar siempre los resultados (la autora). */
  showResults?: boolean;
  /** Vista previa del publicador: se ve pero no reacciona. */
  preview?: boolean;
  /** Se llama al tocar una opcion sin sesion. */
  onRequireLogin?: () => boolean;
}) {
  const [state, setPoll] = useState(initial);
  // Si llegan datos nuevos (vista previa mientras se escribe, o el feed tras
  // un refresh) mandan sobre la copia local.
  useEffect(() => setPoll(initial), [initial]);
  const poll = preview ? initial : state;
  const [pendingOption, setPendingOption] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const results = forceResults || poll.isClosed || Boolean(poll.myOptionId);
  const maxVotes = Math.max(0, ...poll.options.map((o) => o.votes));
  const timeLeft = pollTimeLeft(poll.endsAt);

  function vote(optionId: string) {
    if (preview || results || pendingOption) return;
    if (onRequireLogin?.()) return;
    if (lockedHint) {
      toast.error(lockedHint);
      return;
    }
    if (!canVote) return;

    // Optimista: la barra aparece ya; si el servidor dice otra cosa se revierte.
    const previous = poll;
    setPendingOption(optionId);
    setPoll({
      ...poll,
      myOptionId: optionId,
      totalVotes: poll.totalVotes + 1,
      options: poll.options.map((o) => (o.id === optionId ? { ...o, votes: o.votes + 1 } : o)),
    });

    startTransition(async () => {
      const result = await votePostPollAction({ pollId: poll.id, optionId });
      setPendingOption(null);
      if (!result.ok || !result.data) {
        setPoll(previous);
        toast.error(result.error ?? 'No se pudo votar.');
        return;
      }
      const counts = new Map(result.data.options.map((o) => [o.id, o.votes]));
      setPoll((current) => ({
        ...current,
        totalVotes: result.data!.totalVotes,
        myOptionId: result.data!.myOptionId,
        options: current.options.map((o) => ({ ...o, votes: counts.get(o.id) ?? o.votes })),
      }));
    });
  }

  return (
    <div className="mx-4 mb-3 rounded-2xl bg-gradient-to-br from-primary/60 via-fantazy-red/30 to-champagne-gold/50 p-[1px]">
      <div className="rounded-[calc(1rem-1px)] bg-card p-3.5">
        <div className="mb-3 flex items-start gap-2">
          <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
            <BarChart3 className="h-3.5 w-3.5" />
          </span>
          <p className="text-sm font-semibold leading-snug">{poll.question}</p>
        </div>

        <div className="space-y-2">
          {poll.options.map((option) => {
            const pct = poll.totalVotes > 0 ? Math.round((option.votes / poll.totalVotes) * 100) : 0;
            const mine = poll.myOptionId === option.id;
            const leading = results && option.votes > 0 && option.votes === maxVotes;

            if (!results) {
              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => vote(option.id)}
                  disabled={preview}
                  className={cn(
                    'flex w-full items-center justify-center gap-2 rounded-xl border border-primary/40 px-3 py-2.5 text-sm font-medium transition-all',
                    !preview && 'hover:border-primary hover:bg-primary/10 active:scale-[0.98]',
                    preview && 'cursor-default',
                  )}
                >
                  {lockedHint && <Lock className="h-3.5 w-3.5 text-muted-foreground" />}
                  {option.text}
                </button>
              );
            }

            return (
              <div
                key={option.id}
                className={cn(
                  'relative overflow-hidden rounded-xl border px-3 py-2.5',
                  mine ? 'border-primary/60' : 'border-border/60',
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    'absolute inset-y-0 left-0 rounded-r-xl transition-[width] duration-700 ease-out',
                    leading ? 'bg-primary/30' : 'bg-muted',
                  )}
                  style={{ width: `${pct}%` }}
                />
                <span className="relative flex items-center gap-2 text-sm">
                  <span className={cn('min-w-0 flex-1 truncate', leading && 'font-semibold')}>
                    {option.text}
                  </span>
                  {mine &&
                    (pendingOption === option.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                    ) : (
                      <Check className="h-3.5 w-3.5 text-primary" />
                    ))}
                  <span className={cn('tabular-nums', leading ? 'font-bold' : 'text-muted-foreground')}>
                    {pct}%
                  </span>
                </span>
              </div>
            );
          })}
        </div>

        <p className="mt-2.5 flex flex-wrap items-center gap-x-1.5 text-[11px] text-muted-foreground">
          <span>
            {formatTokens(poll.totalVotes)} {poll.totalVotes === 1 ? 'voto' : 'votos'}
          </span>
          {timeLeft && <span>· {timeLeft}</span>}
          {!results && lockedHint && <span>· {lockedHint}</span>}
        </p>
      </div>
    </div>
  );
}
