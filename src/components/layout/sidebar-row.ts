/**
 * Estilo de una fila de la barra lateral. En tablet (md) la barra es
 * estrecha y solo lleva iconos (centrados); en escritorio (lg), icono y texto.
 */
export const SIDEBAR_ROW =
  'flex w-full items-center justify-center gap-4 rounded-xl px-3 py-2.5 text-[15px] font-medium text-foreground/90 transition-colors hover:bg-muted lg:justify-start';

/** El texto de cada fila: solo en escritorio. */
export const SIDEBAR_LABEL = 'hidden lg:inline';
