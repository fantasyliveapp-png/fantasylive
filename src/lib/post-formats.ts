/**
 * FORMATOS ESTANDAR DE LAS PUBLICACIONES
 *
 * Cada publicacion elige UN formato y todas sus fotos se recortan a esas
 * dimensiones exactas antes de subirse. Asi el feed es regular (nada de fotos
 * panoramicas finisimas al lado de capturas de movil larguisimas) y lo que la
 * creadora ve en la vista previa es exactamente lo que vera su publico.
 *
 * El formato no se guarda aparte: queda implicito en el width/height de los
 * archivos, que la tarjeta del feed usa para fijar la proporcion.
 */

export type PostFormatId = 'portrait' | 'square' | 'landscape';

export interface PostFormat {
  id: PostFormatId;
  label: string;
  hint: string;
  /** Dimensiones de salida en pixeles. */
  width: number;
  height: number;
}

export const POST_FORMATS: PostFormat[] = [
  {
    id: 'portrait',
    label: 'Vertical 4:5',
    hint: 'Ocupa mas pantalla en el movil. Recomendado.',
    width: 1080,
    height: 1350,
  },
  {
    id: 'square',
    label: 'Cuadrado 1:1',
    hint: 'Clasico, se ve bien en cualquier pantalla.',
    width: 1080,
    height: 1080,
  },
  {
    id: 'landscape',
    label: 'Horizontal 16:9',
    hint: 'Para paisajes y capturas de video.',
    width: 1920,
    height: 1080,
  },
];

export const DEFAULT_POST_FORMAT: PostFormatId = 'portrait';

export function getPostFormat(id: PostFormatId): PostFormat {
  return POST_FORMATS.find((f) => f.id === id) ?? POST_FORMATS[0]!;
}

/** Proporcion de las publicaciones antiguas, sin dimensiones guardadas. */
const LEGACY_RATIO = 4 / 5;

/**
 * Proporcion (ancho/alto) con la que la tarjeta muestra los archivos.
 *
 * Se toma del primer archivo y se limita al rango de los formatos estandar,
 * para que una publicacion antigua con una foto rara no rompa el feed.
 */
export function postAspectRatio(
  assets: { width: number | null; height: number | null }[],
): number {
  const first = assets.find((a) => a.width && a.height);
  if (!first?.width || !first.height) return LEGACY_RATIO;
  const ratio = first.width / first.height;
  return Math.min(16 / 9, Math.max(4 / 5, ratio));
}

/**
 * Encuadre de una foto dentro del formato.
 *
 * `zoom` >= 1 sobre el tamano minimo que cubre el marco. `x`/`y` van de -1 a 1:
 * la fraccion del desplazamiento posible hacia cada lado, independiente del
 * tamano en pixeles. Por eso el mismo encuadre sirve para el editor en
 * pantalla y para el recorte final a 1080 px.
 */
export interface CropState {
  zoom: number;
  x: number;
  y: number;
}

export const DEFAULT_CROP: CropState = { zoom: 1, x: 0, y: 0 };

/**
 * Rectangulo donde dibujar una imagen de `imgW` x `imgH` para que, con el
 * encuadre dado, cubra un marco de `frameW` x `frameH`.
 */
export function cropRect(
  imgW: number,
  imgH: number,
  frameW: number,
  frameH: number,
  crop: CropState,
) {
  const scale = Math.max(frameW / imgW, frameH / imgH) * crop.zoom;
  const width = imgW * scale;
  const height = imgH * scale;
  const slackX = (width - frameW) / 2;
  const slackY = (height - frameH) / 2;
  return {
    width,
    height,
    left: -slackX + crop.x * slackX,
    top: -slackY + crop.y * slackY,
    slackX,
    slackY,
  };
}
