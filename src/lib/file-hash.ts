/**
 * Huella de un archivo en el navegador (SHA-256 en hex), para detectar el
 * mismo contenido subido dos veces (ver src/lib/content-guard.ts).
 * Los archivos enormes no se calculan: devolveria null y se avisa igual.
 */
const MAX_HASH_BYTES = 300 * 1024 * 1024;

export async function hashFile(file: Blob): Promise<string | null> {
  if (file.size > MAX_HASH_BYTES || !globalThis.crypto?.subtle) return null;
  try {
    const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return null;
  }
}
