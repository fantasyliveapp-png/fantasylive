import type { Gender } from '@prisma/client';

/**
 * PALABRAS SEGUN EL GENERO DE CADA PERFIL
 *
 * La plataforma es para creadoras y creadores. La regla de los textos es:
 *
 * - Hablando en general (menus, portada, avisos): masculino generico,
 *   "creadores", "Hazte creador".
 * - Hablando de una persona concreta: segun el genero de su perfil,
 *   "Valentina esta conectada", "Mateo esta conectado", "Jules & Sam estan
 *   conectados".
 *
 * Las personas no binarias usan la forma general. Si algun dia se prefiere
 * otra (una forma neutra, reescribir sin adjetivo...), se cambia aqui y en
 * ningun otro sitio.
 */

export type GenderForm = 'f' | 'm' | 'pl';

export function genderForm(gender: Gender | null | undefined): GenderForm {
  switch (gender) {
    case 'FEMALE':
    case 'TRANS_FEMALE':
      return 'f';
    case 'COUPLE':
      return 'pl';
    default:
      return 'm';
  }
}

/**
 * Elige la forma segun el genero. Si no se da forma para pareja, se usa la
 * masculina (el generico).
 *
 *   gw(model.gender, { f: 'conectada', m: 'conectado', pl: 'conectados' })
 */
export function gw(
  gender: Gender | null | undefined,
  forms: { f: string; m: string; pl?: string },
): string {
  const form = genderForm(gender);
  if (form === 'pl') return forms.pl ?? forms.m;
  return forms[form];
}

/** "creadora" / "creador" / "creadores" para una persona concreta. */
export function creatorWord(gender: Gender | null | undefined): string {
  return gw(gender, { f: 'creadora', m: 'creador', pl: 'creadores' });
}

/** "Creadora" / "Creador" / "Creadores" (con mayuscula, para etiquetas). */
export function creatorLabel(gender: Gender | null | undefined): string {
  return gw(gender, { f: 'Creadora', m: 'Creador', pl: 'Creadores' });
}

/** "Conectada" / "Conectado" / "Conectados". */
export function onlineLabel(gender: Gender | null | undefined, online: boolean): string {
  return online
    ? gw(gender, { f: 'Conectada', m: 'Conectado', pl: 'Conectados' })
    : gw(gender, { f: 'Desconectada', m: 'Desconectado', pl: 'Desconectados' });
}

/** Insignia del programa de las primeras cuentas: "Fundadora" / "Fundador". */
export function founderLabel(gender: Gender | null | undefined): string {
  return gw(gender, { f: 'Fundadora', m: 'Fundador', pl: 'Fundadores' });
}
