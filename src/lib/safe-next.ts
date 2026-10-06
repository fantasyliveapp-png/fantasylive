/**
 * Ruta interna segura para volver despues de entrar o registrarse. Todo lo
 * que lleve a otra web ("//x.com", "/\x.com", "https://x.com", "javascript:")
 * se descarta: si no, un enlace a /login?callbackUrl=... serviria para mandar
 * a la gente, ya con la sesion iniciada, a una web falsa.
 */
export function safeNext(value: string | null | undefined): string | null {
  if (!value || value.length > 300) return null;
  // Los navegadores tratan "\" como "/" y se saltan tabuladores y saltos de linea.
  if (!value.startsWith('/') || /[\\\u0000-\u001f\u007f]/.test(value)) return null;
  try {
    const base = 'https://interno.invalid';
    const url = new URL(value, base);
    // "/..//x.com" se normaliza a "//x.com": tambien saltaria a otra web.
    if (url.origin !== base || url.pathname.startsWith('//')) return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}
