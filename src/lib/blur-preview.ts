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
  file: File,
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
  file: File,
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
