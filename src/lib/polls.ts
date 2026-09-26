/** Opciones de duracion de una encuesta (horas; null = sin cierre). */
export const POLL_DURATIONS = [
  { hours: 24, label: '1 dia' },
  { hours: 72, label: '3 dias' },
  { hours: 168, label: '1 semana' },
  { hours: null, label: 'Sin limite' },
] as const;

export const POLL_MIN_OPTIONS = 2;
export const POLL_MAX_OPTIONS = 4;
export const POLL_QUESTION_MAX = 140;
export const POLL_OPTION_MAX = 60;

/** "Quedan 2 dias", "Quedan 5 h", "Terminada". */
export function pollTimeLeft(endsAt: string | null, now = Date.now()): string | null {
  if (!endsAt) return null;
  const ms = new Date(endsAt).getTime() - now;
  if (ms <= 0) return 'Terminada';
  const hours = Math.ceil(ms / 3600_000);
  if (hours >= 48) return `Quedan ${Math.round(hours / 24)} dias`;
  if (hours >= 24) return 'Queda 1 dia';
  return `Quedan ${hours} h`;
}
