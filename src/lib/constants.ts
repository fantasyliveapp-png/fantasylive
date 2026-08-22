import type {
  BookingStatus,
  CallType,
  ContentRequestStatus,
  Gender,
  KycStatus,
  ModelTier,
  Orientation,
  PayoutStatus,
  ReportReason,
  ReportStatus,
  Role,
  TransactionType,
  UserStatus,
} from '@prisma/client';

export const GENDER_LABELS: Record<Gender, string> = {
  FEMALE: 'Mujer',
  MALE: 'Hombre',
  TRANS_FEMALE: 'Trans femenina',
  TRANS_MALE: 'Trans masculino',
  NON_BINARY: 'No binario',
  COUPLE: 'Pareja',
};

export const ORIENTATION_LABELS: Record<Orientation, string> = {
  STRAIGHT: 'Hetero',
  GAY: 'Gay',
  LESBIAN: 'Lesbiana',
  BISEXUAL: 'Bisexual',
  PANSEXUAL: 'Pansexual',
  QUEER: 'Queer',
  ASEXUAL: 'Asexual',
};

export const ROLE_LABELS: Record<Role, string> = {
  USER: 'Usuario',
  MODEL: 'Modelo',
  ADMIN: 'Administrador',
};

export const USER_STATUS_LABELS: Record<UserStatus, string> = {
  ACTIVE: 'Activo',
  SUSPENDED: 'Suspendido',
  BANNED: 'Baneado',
  PENDING_VERIFICATION: 'Pendiente de verificar',
};

export const TIER_LABELS: Record<ModelTier, string> = {
  STANDARD: 'Standard',
  VIP: 'VIP',
  ELITE: 'Elite',
};

export const CALL_TYPE_LABELS: Record<CallType, string> = {
  RANDOM: 'Aleatoria',
  VIP_RANDOM: 'VIP aleatoria',
  PRIVATE: 'Privada reservada',
};

export const KYC_STATUS_LABELS: Record<KycStatus, string> = {
  NOT_SUBMITTED: 'Sin enviar',
  PENDING: 'En revision',
  APPROVED: 'Aprobado',
  REJECTED: 'Rechazado',
  EXPIRED: 'Caducado',
};

export const BOOKING_STATUS_LABELS: Record<BookingStatus, string> = {
  PENDING_CONFIRMATION: 'Pendiente',
  CONFIRMED: 'Confirmada',
  IN_PROGRESS: 'En curso',
  COMPLETED: 'Completada',
  CANCELLED_BY_USER: 'Cancelada por el usuario',
  CANCELLED_BY_MODEL: 'Cancelada por la modelo',
  NO_SHOW: 'No asistio',
  REFUNDED: 'Reembolsada',
};

export const PAYOUT_STATUS_LABELS: Record<PayoutStatus, string> = {
  REQUESTED: 'Solicitado',
  APPROVED: 'Aprobado',
  PROCESSING: 'Procesando',
  PAID: 'Pagado',
  REJECTED: 'Rechazado',
};

export const CONTENT_REQUEST_STATUS_LABELS: Record<ContentRequestStatus, string> = {
  PENDING: 'Esperando cotizacion',
  QUOTED: 'Cotizado',
  PAID: 'Pagado, pendiente de entrega',
  DELIVERED: 'Entregado',
  DECLINED: 'Rechazado',
  CANCELLED: 'Cancelado',
};

export const REPORT_REASON_LABELS: Record<ReportReason, string> = {
  UNDERAGE: 'Sospecha de menor de edad',
  NON_CONSENSUAL: 'Contenido no consentido',
  HARASSMENT: 'Acoso o abuso',
  SPAM: 'Spam o publicidad',
  IMPERSONATION: 'Suplantacion de identidad',
  PAYMENT_DISPUTE: 'Disputa de pago',
  TECHNICAL_ISSUE: 'Problema tecnico',
  OTHER: 'Otro',
};

export const REPORT_STATUS_LABELS: Record<ReportStatus, string> = {
  OPEN: 'Abierto',
  UNDER_REVIEW: 'En revision',
  RESOLVED: 'Resuelto',
  DISMISSED: 'Descartado',
  ESCALATED: 'Escalado',
};

export const TRANSACTION_TYPE_LABELS: Record<TransactionType, string> = {
  TOKEN_PURCHASE: 'Compra de tokens',
  SIGNUP_BONUS: 'Bono de bienvenida',
  ADMIN_CREDIT: 'Credito manual',
  ADMIN_DEBIT: 'Debito manual',
  CALL_CHARGE: 'Consumo en llamada',
  CALL_EARNING: 'Ganancia por llamada',
  CONTENT_UNLOCK: 'Desbloqueo de contenido',
  CONTENT_EARNING: 'Ganancia por contenido',
  TIP: 'Propina enviada',
  TIP_EARNING: 'Propina recibida',
  BOOKING_HOLD: 'Retencion por reserva',
  BOOKING_REFUND: 'Devolucion de reserva',
  PAYOUT: 'Retiro',
  REFUND: 'Reembolso',
  PLATFORM_FEE: 'Comision de plataforma',
  SUBSCRIPTION_PURCHASE: 'Suscripcion mensual',
  SUBSCRIPTION_EARNING: 'Ganancia por suscripcion',
  CONTENT_REQUEST_PAYMENT: 'Pedido de contenido a medida',
  CONTENT_REQUEST_EARNING: 'Ganancia por pedido a medida',
  MESSAGE_UNLOCK: 'Desbloqueo de conversacion',
  MESSAGE_UNLOCK_EARNING: 'Ganancia por conversacion',
  MESSAGE_ATTACHMENT_UNLOCK: 'Desbloqueo de archivo adjunto',
  MESSAGE_ATTACHMENT_EARNING: 'Ganancia por archivo adjunto',
};

/** Cantidades rapidas del boton de regalo durante una llamada */
export const GIFT_PRESETS = [
  { tokens: 5, emoji: '🌹', label: 'Rosa' },
  { tokens: 15, emoji: '🍸', label: 'Copa' },
  { tokens: 50, emoji: '🔥', label: 'Fuego' },
  { tokens: 100, emoji: '💎', label: 'Diamante' },
  { tokens: 500, emoji: '👑', label: 'Corona' },
] as const;

/** Etiquetas visibles en el catalogo publico (filtro de descubrimiento). */
export const PUBLIC_MODEL_TAGS = [
  'latina',
  'europea',
  'asiatica',
  'fitness',
  'tatuajes',
  'piercing',
  'rubia',
  'morena',
  'pelirroja',
  'curvy',
  'roleplay',
  'gamer',
  'cosplay',
  'pareja',
] as const;

/**
 * Etiquetas adicionales que una creadora puede sumar a su propio perfil.
 * No aparecen como filtro en el catalogo publico (que ahora se ve como
 * discovery general), solo en el editor de perfil y en su ficha.
 */
const PRIVATE_ONLY_MODEL_TAGS = ['milf', 'domina', 'sumisa', 'fetiche'] as const;

/** Lista completa: usada en el editor de perfil de la propia creadora. */
export const MODEL_TAGS = [
  ...PUBLIC_MODEL_TAGS,
  ...PRIVATE_ONLY_MODEL_TAGS,
] as const;

export const LANGUAGES = [
  'Espanol',
  'Ingles',
  'Portugues',
  'Frances',
  'Italiano',
  'Aleman',
  'Ruso',
] as const;

export const BOOKING_DURATIONS = [10, 15, 20, 30, 45, 60] as const;
