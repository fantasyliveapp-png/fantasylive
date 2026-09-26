/** Ruta interna segura para volver despues de registrarse ("/..." y no "//..."). */
export function safeNext(value: string | null | undefined): string | null {
  if (!value) return null;
  return value.startsWith('/') && !value.startsWith('//') ? value.slice(0, 300) : null;
}
