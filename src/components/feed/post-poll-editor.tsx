'use client';

import { BarChart3, Plus, Trash2, X } from 'lucide-react';

import {
  POLL_DURATIONS,
  POLL_MAX_OPTIONS,
  POLL_MIN_OPTIONS,
  POLL_OPTION_MAX,
  POLL_QUESTION_MAX,
} from '@/lib/polls';
import { cn } from '@/lib/utils';

export interface PollDraft {
  question: string;
  options: string[];
  durationHours: number | null;
}

export const EMPTY_POLL: PollDraft = {
  question: '',
  options: ['', ''],
  durationHours: 24,
};

/** Error de una encuesta a medio escribir, o null si se puede publicar. */
export function pollDraftError(poll: PollDraft): string | null {
  if (!poll.question.trim()) return 'Escribe la pregunta de la encuesta.';
  const options = poll.options.map((o) => o.trim());
  if (options.some((o) => !o)) return 'Rellena todas las opciones de la encuesta (o quita las vacias).';
  if (options.length < POLL_MIN_OPTIONS) return 'La encuesta necesita al menos 2 opciones.';
  if (new Set(options.map((o) => o.toLowerCase())).size !== options.length) {
    return 'Las opciones de la encuesta no pueden repetirse.';
  }
  return null;
}

/** Editor de la encuesta dentro del estudio de publicacion. */
export function PollEditor({
  poll,
  onChange,
  onRemove,
}: {
  poll: PollDraft;
  onChange: (poll: PollDraft) => void;
  onRemove: () => void;
}) {
  function setOption(index: number, text: string) {
    onChange({ ...poll, options: poll.options.map((o, i) => (i === index ? text : o)) });
  }

  return (
    <div className="rounded-2xl bg-gradient-to-br from-primary/60 via-fantazy-red/30 to-champagne-gold/50 p-[1px] animate-in fade-in slide-in-from-top-1">
      <div className="space-y-3 rounded-[calc(1rem-1px)] bg-card p-3.5">
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/15 text-primary">
            <BarChart3 className="h-3.5 w-3.5" />
          </span>
          <span className="flex-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Encuesta
          </span>
          <button
            type="button"
            onClick={onRemove}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Quitar
          </button>
        </div>

        <input
          value={poll.question}
          onChange={(e) => onChange({ ...poll, question: e.target.value })}
          maxLength={POLL_QUESTION_MAX}
          placeholder="Haz una pregunta a tus fans..."
          className="w-full bg-transparent text-sm font-semibold outline-none placeholder:font-normal placeholder:text-muted-foreground"
          autoFocus
        />

        <div className="space-y-2">
          {poll.options.map((option, index) => (
            <div key={index} className="flex items-center gap-2">
              <input
                value={option}
                onChange={(e) => setOption(index, e.target.value)}
                maxLength={POLL_OPTION_MAX}
                placeholder={`Opcion ${index + 1}`}
                className="h-10 w-full min-w-0 rounded-xl border border-border/60 bg-background/40 px-3 text-sm outline-none transition-colors focus:border-primary"
              />
              {poll.options.length > POLL_MIN_OPTIONS && (
                <button
                  type="button"
                  onClick={() =>
                    onChange({ ...poll, options: poll.options.filter((_, i) => i !== index) })
                  }
                  className="shrink-0 rounded-full p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                  aria-label={`Quitar opcion ${index + 1}`}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          ))}

          {poll.options.length < POLL_MAX_OPTIONS && (
            <button
              type="button"
              onClick={() => onChange({ ...poll, options: [...poll.options, ''] })}
              className="flex h-10 w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-border text-xs font-medium text-muted-foreground transition-colors hover:border-primary/60 hover:text-primary"
            >
              <Plus className="h-3.5 w-3.5" />
              Anadir opcion
            </button>
          )}
        </div>

        <div>
          <p className="mb-1.5 text-[11px] text-muted-foreground">Duracion</p>
          <div className="flex flex-wrap gap-1.5">
            {POLL_DURATIONS.map((d) => (
              <button
                key={d.label}
                type="button"
                onClick={() => onChange({ ...poll, durationHours: d.hours })}
                className={cn(
                  'rounded-full border px-3 py-1 text-xs transition-colors',
                  poll.durationHours === d.hours
                    ? 'border-primary bg-primary/15 font-medium'
                    : 'border-border/60 text-muted-foreground hover:border-muted-foreground/50',
                )}
              >
                {d.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
