/**
 * Cookie de "tengo 18 años o más". Es una cookie (y no solo localStorage)
 * para que el servidor sepa si debe mandar la ventana de edad ya dentro de la
 * pagina: asi aparece desde el primer instante, sin dejar ver la web un par
 * de segundos mientras carga el JavaScript.
 */
export const AGE_COOKIE = 'fl_age_ok';

/** Donde se guardaba antes (se pasa a la cookie al volver). */
export const AGE_LEGACY_STORAGE_KEY = 'fl_age_confirmed_v1';
