/**
 * MINIATURA DIFUMINADA PARA CONTENIDO DE PAGO (solo cliente)
 *
 * Un post bloqueado tiene que mostrar ALGO o nadie lo desbloquea. La tentacion
 * es servir la imagen completa y taparla con `filter: blur()`, pero eso no
 * protege nada: el original viaja en el HTML y se ve quitando el filtro desde
 * el inspector, o abriendo la URL directa desde la pestana de red.
 *
 * Aqui se genera, en el navegador de la creadora y antes de subir nada, una
 * miniatura de 32 px de ancho con el difuminado ya "cocido" en los pixeles.
 * A ese tamano no hay detalle que recuperar: es literalmente un borron de
 * colores. El original se sube a una clave distinta que solo se firma para
 * quien ha pagado.
 *
 * Se hace en el cliente a proposito: el servidor no necesita `sharp` ni
 * procesar imagenes, y la version reducida nunca pasa por nuestra memoria.
 */

import { applyPostFilter, type PostFilterId } from '@/lib/post-filters';
import { cropRect, type CropState } from '@/lib/post-formats';

/** Ancho de la miniatura. Suficiente para dar color y forma, nada mas. */
const PREVIEW_WIDTH = 32;

/** Radio de difuminado aplicado sobre la miniatura ya reducida. */
const PREVIEW_BLUR = 2;

export interface PreviewResult {
  blob: Blob;
  width: number;
  height: number;
}

/** Dimensiones reales de un archivo de imagen. */
export async function readImageSize(
  file: Blob,
): Promise<{ width: number; height: number } | null> {
  try {
    const bitmap = await createImageBitmap(file);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
  } catch {
    return null;
  }
}

/**
 * Genera la miniatura difuminada de una imagen.
 *
 * Devuelve null si el navegador no puede decodificar el archivo (por ejemplo
 * un video o un formato raro); quien llama decide si eso bloquea la subida.
 */
export async function createBlurredPreview(
  file: Blob,
): Promise<PreviewResult | null> {
  if (!file.type.startsWith('image/')) return null;

  try {
    const bitmap = await createImageBitmap(file);

    const ratio = bitmap.height / bitmap.width || 1;
    const width = PREVIEW_WIDTH;
    const height = Math.max(1, Math.round(width * ratio));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      bitmap.close();
      return null;
    }

    // El difuminado se aplica al dibujar, asi queda grabado en los pixeles de
    // la miniatura y no depende de ningun CSS del cliente que la muestre.
    ctx.filter = `blur(${PREVIEW_BLUR}px)`;
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.6),
    );
    if (!blob) return null;

    return { blob, width, height };
  } catch {
    return null;
  }
}

/**
 * Miniatura difuminada de un VIDEO: se toma un fotograma (al segundo 1, o a
 * mitad si es mas corto), se dibuja en un canvas y se difumina igual que una
 * foto. Asi un video de pago tambien se ve borroso en el feed sin mandar el
 * archivo a nadie. Devuelve null si el navegador no puede leer el video.
 */
export async function createVideoPreview(
  file: Blob,
  aspectRatio: number,
): Promise<PreviewResult | null> {
  const url = URL.createObjectURL(file);
  try {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.src = url;

    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error('video'));
    });
    const at = Math.min(1, (video.duration || 0) / 2);
    await new Promise<void>((resolve, reject) => {
      video.onseeked = () => resolve();
      video.onerror = () => reject(new Error('video'));
      video.currentTime = at;
    });

    // Recorte centrado a la proporcion del formato, como se ve en el feed.
    const width = PREVIEW_WIDTH;
    const height = Math.max(1, Math.round(width / aspectRatio));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx || !video.videoWidth) return null;

    const scale = Math.max(width / video.videoWidth, height / video.videoHeight);
    const w = video.videoWidth * scale;
    const h = video.videoHeight * scale;
    ctx.filter = `blur(${PREVIEW_BLUR}px)`;
    ctx.drawImage(video, (width - w) / 2, (height - h) / 2, w, h);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.6),
    );
    return blob ? { blob, width, height } : null;
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Duracion de un video en segundos (null si el navegador no la sabe leer). */
export async function readVideoDuration(file: Blob): Promise<number | null> {
  const url = URL.createObjectURL(file);
  try {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.src = url;
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error('video'));
    });
    return Number.isFinite(video.duration) ? Math.round(video.duration) : null;
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Dibuja el recorte (y el filtro) de una imagen ya decodificada en un canvas
 * de `width` x `height`. Es la unica funcion que genera pixeles de una
 * publicacion: la usan las miniaturas de filtros, la vista previa y el
 * archivo final, asi que las tres coinciden.
 */
export function renderCropCanvas(
  bitmap: ImageBitmap,
  width: number,
  height: number,
  crop: CropState,
  filter: PostFilterId = 'none',
): HTMLCanvasElement | null {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));

  const ctx = canvas.getContext('2d', { willReadFrequently: filter !== 'none' });
  if (!ctx) return null;

  const rect = cropRect(
    bitmap.width,
    bitmap.height,
    canvas.width,
    canvas.height,
    crop,
  );
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, rect.left, rect.top, rect.width, rect.height);

  if (filter !== 'none') {
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
    applyPostFilter(pixels, filter);
    ctx.putImageData(pixels, 0, 0);
  }
  return canvas;
}

/**
 * Recorta una imagen al formato estandar de publicacion con el encuadre y el
 * filtro que eligio la creadora, y la devuelve como JPEG de `format.width` x
 * `format.height`. Devuelve null si el navegador no puede decodificarla.
 */
export async function renderCroppedImage(
  file: Blob,
  format: { width: number; height: number },
  crop: CropState,
  filter: PostFilterId = 'none',
): Promise<Blob | null> {
  try {
    const bitmap = await createImageBitmap(file);
    const canvas = renderCropCanvas(
      bitmap,
      format.width,
      format.height,
      crop,
      filter,
    );
    bitmap.close();
    if (!canvas) return null;

    return await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.9),
    );
  } catch {
    return null;
  }
}

/** Sube un blob a una URL firmada. Devuelve true si el PUT fue aceptado. */
export async function putToSignedUrl(
  uploadUrl: string,
  body: Blob | File,
  contentType: string,
): Promise<boolean> {
  const response = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': contentType },
    body,
  });
  return response.ok;
}
