/** Temas de las consultas de soporte (compartido por cliente y servidor). */
export const SUPPORT_CATEGORIES = [
  { value: 'cuenta', label: 'Mi cuenta' },
  { value: 'pagos', label: 'Compras y tokens' },
  { value: 'retiros', label: 'Retiros y ganancias' },
  { value: 'verificacion', label: 'Verificacion de identidad' },
  { value: 'contenido', label: 'Contenido o moderacion' },
  { value: 'otro', label: 'Otra cosa' },
] as const;

export function supportCategoryLabel(value: string) {
  return SUPPORT_CATEGORIES.find((c) => c.value === value)?.label ?? value;
}

export const SUPPORT_STATUS_LABELS = {
  OPEN: 'Esperando al equipo',
  ANSWERED: 'Respondida',
  CLOSED: 'Cerrada',
} as const;
