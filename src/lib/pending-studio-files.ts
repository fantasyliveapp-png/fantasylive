/**
 * Archivos elegidos desde el boton "+" de la barra inferior, a la espera de
 * que el estudio de publicacion los recoja.
 *
 * El selector de archivos del sistema solo se puede abrir con un toque del
 * usuario, asi que se abre en el propio menu "+" y los archivos viajan hasta la
 * pagina del estudio por aqui (la navegacion es del lado del cliente, el
 * modulo sigue vivo). Solo cliente.
 */
let pending: File[] | null = null;

export function setPendingStudioFiles(files: File[]) {
  pending = files.length > 0 ? files : null;
}

/** Lee sin borrar: el estado inicial de React puede calcularse dos veces. */
export function peekPendingStudioFiles(): File[] | null {
  return pending;
}

export function clearPendingStudioFiles() {
  pending = null;
}
