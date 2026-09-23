/**
 * Regla del @usuario: minusculas, numeros, punto, guion y guion bajo; de 3 a
 * 30 caracteres y sin empezar ni acabar en simbolo. Compartida entre el
 * editor (cliente) y la validacion del servidor.
 */
export const USERNAME_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{1,28}[a-z0-9])?$/;

/** Nombres que nadie puede usar: se confundirian con la plataforma. */
const RESERVED_USERNAMES = new Set([
  'admin',
  'administrador',
  'fantasylive',
  'fantasy',
  'soporte',
  'support',
  'ayuda',
  'moderador',
  'moderacion',
  'staff',
  'oficial',
  'official',
  'root',
  'sistema',
  'system',
]);

export function isReservedUsername(username: string): boolean {
  return RESERVED_USERNAMES.has(username) || username.startsWith('fantasylive');
}
