/**
 * ESTADO DE UN DIRECTO (compartido servidor / navegador)
 *
 * Lo que la creadora cambia desde el menu "Mas" mientras emite: titulo,
 * mensaje fijado, pausa, espejo, acceso, filtro de palabras y menu de
 * propinas. Se guarda en la base (quien entra tarde lo recibe al unirse) y
 * cada cambio se anuncia a la sala desde el servidor como `{ type: 'state' }`.
 */

export type LiveAccessModeValue = 'PUBLIC' | 'SUBSCRIBERS' | 'PAID';

export interface TipMenuItem {
  id: string;
  label: string;
  tokens: number;
  /**
   * Contenido exclusivo de directo (una publicacion con liveExclusiveAt). Si
   * esta, el precio es el de la publicacion y cada fan solo lo compra una vez.
   */
  postId?: string;
}

/** Lo que ve un fan de un contenido exclusivo antes (y despues) de comprarlo. */
export interface LiveExclusiveInfo {
  postId: string;
  label: string;
  body: string | null;
  priceTokens: number;
  photos: number;
  videos: number;
  /** Suma de la duracion de los videos (segundos). */
  videoSeconds: number;
  /** Miniaturas difuminadas (nunca el original). */
  previews: string[];
  owned: boolean;
}

export interface LiveAccess {
  mode: LiveAccessModeValue;
  ticketTokens: number | null;
  freeForSubscribers: boolean;
}

/** Paneles que la creadora puede mover por la pantalla. */
export type LiveWidgetId = 'goal' | 'poll' | 'pinned' | 'tipmenu';

/** Esquina superior izquierda del panel, en fracciones del escenario (0-1). */
export interface WidgetPos {
  x: number;
  y: number;
}

export type WidgetLayout = Partial<Record<LiveWidgetId, WidgetPos>>;

/** Donde va cada panel si la creadora no lo ha movido. */
export const DEFAULT_WIDGET_LAYOUT: Record<LiveWidgetId, WidgetPos> = {
  goal: { x: 0.03, y: 0.15 },
  poll: { x: 0.03, y: 0.25 },
  pinned: { x: 0.03, y: 0.53 },
  tipmenu: { x: 0.56, y: 0.15 },
};

const clamp01 = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

/** Lee y sanea una disposicion guardada (JSON) o recibida. */
export function parseWidgetLayout(value: unknown): WidgetLayout {
  if (!value || typeof value !== 'object') return {};
  const out: WidgetLayout = {};
  for (const id of ['goal', 'poll', 'pinned', 'tipmenu'] as const) {
    const pos = (value as Record<string, unknown>)[id] as { x?: unknown; y?: unknown } | undefined;
    if (pos && typeof pos.x === 'number' && typeof pos.y === 'number' && Number.isFinite(pos.x) && Number.isFinite(pos.y)) {
      out[id] = { x: clamp01(pos.x, 0, 0.95), y: clamp01(pos.y, 0.04, 0.95) };
    }
  }
  return out;
}

export interface LiveRoomState {
  title: string | null;
  pinned: string | null;
  paused: boolean;
  mirrored: boolean;
  access: LiveAccess;
  blockedWords: string[];
  tipMenu: TipMenuItem[];
  /** La creadora ha puesto el menu de propinas en pantalla. */
  tipMenuOnScreen: boolean;
  layout: WidgetLayout;
  /** Acepta privados 1 a 1 en este directo: los espectadores ven el boton. */
  acceptsPrivate: boolean;
  /** El directo termino porque se fue a un privado 1 a 1. */
  wentPrivate?: boolean;
}

export interface LivePollState {
  id: string;
  question: string;
  options: string[];
  counts: number[];
  total: number;
  closed: boolean;
}

/** Por que alguien no puede ver un directo (y que puede hacer). */
export interface LivePaywall {
  mode: 'SUBSCRIBERS' | 'PAID';
  ticketTokens: number | null;
  freeForSubscribers: boolean;
  modelSlug: string;
}

export const EMPTY_LIVE_STATE: LiveRoomState = {
  title: null,
  pinned: null,
  paused: false,
  mirrored: false,
  access: { mode: 'PUBLIC', ticketTokens: null, freeForSubscribers: true },
  blockedWords: [],
  tipMenu: [],
  tipMenuOnScreen: false,
  layout: {},
  acceptsPrivate: false,
};

export const LIVE_LIMITS = {
  titleMax: 120,
  pinnedMax: 200,
  pollOptionsMin: 2,
  pollOptionsMax: 4,
  pollTextMax: 80,
  blockedWordsMax: 100,
  tipMenuMax: 12,
  tipLabelMax: 40,
  ticketMin: 5,
  ticketMax: 10_000,
} as const;

/** Minusculas y sin acentos: "Tonta" y "tónta" cuentan igual. */
export function normalizeWord(text: string) {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

/** ¿El mensaje contiene alguna palabra bloqueada (como palabra suelta)? */
export function hasBlockedWord(text: string, words: string[]) {
  if (words.length === 0) return false;
  const tokens = new Set(normalizeWord(text).split(/[^a-z0-9ñ]+/).filter(Boolean));
  const normalized = normalizeWord(text);
  return words.some((w) => (w.includes(' ') ? normalized.includes(w) : tokens.has(w)));
}

/** Lee el menu de propinas guardado (JSON) descartando lo que no valga. */
export function parseTipMenu(value: unknown): TipMenuItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (i): i is TipMenuItem =>
        typeof i === 'object' &&
        i !== null &&
        typeof (i as TipMenuItem).id === 'string' &&
        typeof (i as TipMenuItem).label === 'string' &&
        Number.isInteger((i as TipMenuItem).tokens) &&
        (i as TipMenuItem).tokens > 0,
    )
    .map((i) => ({
      id: i.id,
      label: i.label,
      tokens: i.tokens,
      ...(typeof i.postId === 'string' ? { postId: i.postId } : {}),
    }))
    .slice(0, LIVE_LIMITS.tipMenuMax);
}
