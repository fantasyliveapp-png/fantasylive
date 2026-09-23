/**
 * FILTROS DE LAS PUBLICACIONES
 *
 * Se aplican pixel a pixel sobre el canvas del recorte, no con `filter` de
 * CSS: asi la miniatura del selector, la vista previa y el archivo que se sube
 * salen de la misma funcion y son identicos en cualquier navegador (Safari
 * no siempre respeta `ctx.filter`).
 */

export type PostFilterId =
  | 'none'
  | 'neon'
  | 'velvet'
  | 'midnight'
  | 'gold'
  | 'blush'
  | 'marble';

interface FilterParams {
  brightness?: number;
  contrast?: number;
  saturation?: number;
  /** Suma a rojo y resta a azul. */
  warmth?: number;
  tint?: [number, number, number];
  /** Levanta los negros (look "lavado"), 0-255. */
  fade?: number;
  /** Oscurece las esquinas, 0-1. */
  vignette?: number;
}

export interface PostFilter {
  id: PostFilterId;
  label: string;
  params: FilterParams;
}

export const POST_FILTERS: PostFilter[] = [
  { id: 'none', label: 'Original', params: {} },
  {
    id: 'neon',
    label: 'Neon',
    params: { contrast: 1.15, saturation: 1.35, tint: [12, -4, 16], vignette: 0.2 },
  },
  {
    id: 'velvet',
    label: 'Terciopelo',
    params: { warmth: 10, fade: 22, saturation: 0.9, contrast: 0.95 },
  },
  {
    id: 'midnight',
    label: 'Medianoche',
    params: {
      brightness: 0.92,
      contrast: 1.2,
      saturation: 0.85,
      tint: [-6, 0, 18],
      vignette: 0.4,
    },
  },
  {
    id: 'gold',
    label: 'Dorado',
    params: { warmth: 22, brightness: 1.05, saturation: 1.1, tint: [0, 6, -4] },
  },
  {
    id: 'blush',
    label: 'Rubor',
    params: { tint: [18, 0, 8], brightness: 1.05, fade: 12, saturation: 1.05 },
  },
  {
    id: 'marble',
    label: 'Marmol',
    params: { saturation: 0, contrast: 1.25, brightness: 1.02, vignette: 0.25 },
  },
];

export function getPostFilter(id: PostFilterId): PostFilter {
  return POST_FILTERS.find((f) => f.id === id) ?? POST_FILTERS[0]!;
}

/** Aplica el filtro en sitio sobre los pixeles de un canvas. */
export function applyPostFilter(image: ImageData, id: PostFilterId): void {
  const { params } = getPostFilter(id);
  if (id === 'none') return;

  const {
    brightness = 1,
    contrast = 1,
    saturation = 1,
    warmth = 0,
    tint = [0, 0, 0],
    fade = 0,
    vignette = 0,
  } = params;

  const { data, width, height } = image;
  const cx = width / 2;
  const cy = height / 2;
  const maxDist = cx * cx + cy * cy;
  const fadeScale = 1 - fade / 255;

  for (let y = 0; y < height; y++) {
    const dy = y - cy;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      let r = data[i]!;
      let g = data[i + 1]!;
      let b = data[i + 2]!;

      r *= brightness;
      g *= brightness;
      b *= brightness;

      r = (r - 128) * contrast + 128;
      g = (g - 128) * contrast + 128;
      b = (b - 128) * contrast + 128;

      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      r = lum + (r - lum) * saturation;
      g = lum + (g - lum) * saturation;
      b = lum + (b - lum) * saturation;

      r += warmth + tint[0];
      g += tint[1];
      b += tint[2] - warmth;

      if (fade) {
        r = r * fadeScale + fade;
        g = g * fadeScale + fade;
        b = b * fadeScale + fade;
      }

      if (vignette) {
        const dx = x - cx;
        const k = 1 - vignette * ((dx * dx + dy * dy) / maxDist);
        r *= k;
        g *= k;
        b *= k;
      }

      // Uint8ClampedArray ya recorta a 0-255.
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
    }
  }
}
