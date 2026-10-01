/** Estados de una venta a fan y su texto (los usan servidor y pantallas). */
export const SALE_STATUSES = ['AWAITING_PAYMENT', 'PAID', 'DISPUTED', 'COMPLETED', 'CANCELLED'] as const;
export const SALE_STATUS_LABEL: Record<(typeof SALE_STATUSES)[number], string> = {
  AWAITING_PAYMENT: 'Esperando pago',
  PAID: 'Pagado, sin liberar',
  DISPUTED: 'En disputa',
  COMPLETED: 'Completada',
  CANCELLED: 'Cancelada',
};
