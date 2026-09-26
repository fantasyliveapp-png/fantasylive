import type { VaultSection } from '@prisma/client';

/**
 * BOVEDA: el contenido privado de la creadora, listo para enviar por chat.
 *
 * - "Para enganchar": fotos provocativas que se envian SIEMPRE gratis para
 *   motivar al fan.
 * - Niveles de pago, de mas suave a mas fuerte, cada uno con su precio
 *   sugerido (la creadora lo decide y se puede cambiar al enviar).
 * - Ademas, carpetas propias ("Lenceria", "Ducha"...) para ordenar.
 */

export const VAULT_SECTIONS: {
  id: VaultSection;
  label: string;
  short: string;
  hint: string;
}[] = [
  {
    id: 'TEASER',
    label: 'Para enganchar',
    short: 'Enganchar',
    hint: 'Fotos provocativas que se envian gratis para motivar al fan.',
  },
  {
    id: 'LEVEL_1',
    label: 'Nivel 1 · Suave',
    short: 'Nivel 1',
    hint: 'Precio bajo, para la primera compra.',
  },
  { id: 'LEVEL_2', label: 'Nivel 2 · Subido', short: 'Nivel 2', hint: 'Un paso mas.' },
  { id: 'LEVEL_3', label: 'Nivel 3 · Explicito', short: 'Nivel 3', hint: 'Contenido fuerte.' },
  { id: 'SPECIAL', label: 'Especial', short: 'Especial', hint: 'Lo mas exclusivo y caro.' },
];

export const VAULT_SECTION_IDS = VAULT_SECTIONS.map((s) => s.id);

export function sectionLabel(id: VaultSection) {
  return VAULT_SECTIONS.find((s) => s.id === id)?.label ?? id;
}

/** Orden de "fuerza" para saber hasta que nivel ha comprado un fan. */
export const SECTION_RANK: Record<VaultSection, number> = {
  TEASER: 0,
  LEVEL_1: 1,
  LEVEL_2: 2,
  LEVEL_3: 3,
  SPECIAL: 4,
};

export interface VaultPrices {
  vaultPriceLevel1: number;
  vaultPriceLevel2: number;
  vaultPriceLevel3: number;
  vaultPriceSpecial: number;
}

/** Precio sugerido de un archivo: el suyo, o el de su nivel. Enganchar = 0. */
export function suggestedPrice(
  item: { section: VaultSection; priceTokens: number | null },
  prices: VaultPrices,
): number {
  if (item.section === 'TEASER') return 0;
  if (item.priceTokens != null) return item.priceTokens;
  switch (item.section) {
    case 'LEVEL_1':
      return prices.vaultPriceLevel1;
    case 'LEVEL_2':
      return prices.vaultPriceLevel2;
    case 'LEVEL_3':
      return prices.vaultPriceLevel3;
    default:
      return prices.vaultPriceSpecial;
  }
}

export const MAX_VAULT_PRICE = 10000;
export const MAX_VAULT_ITEMS = 2000;
