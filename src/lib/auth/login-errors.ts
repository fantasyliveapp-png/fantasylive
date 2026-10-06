/** Mensaje para cada `code` con el que el login rechaza una entrada. */
export const LOGIN_ERROR_MESSAGES: Record<string, string> = {
  too_many: 'Demasiados intentos fallidos. Espera 15 minutos o recupera tu contraseña.',
  banned: 'Esta cuenta ha sido baneada.',
  suspended: 'Esta cuenta está suspendida temporalmente.',
};

export const LOGIN_ERROR_DEFAULT = 'Email o contraseña incorrectos.';

export function loginErrorMessage(code: string | null | undefined): string {
  return (code && LOGIN_ERROR_MESSAGES[code]) || LOGIN_ERROR_DEFAULT;
}
