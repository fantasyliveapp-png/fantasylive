import type { Gender } from '@prisma/client';

/**
 * GUSTOS: las opciones de las preguntas de bienvenida. Se comparten entre el
 * asistente (cliente) y el recomendador (servidor).
 */

export const GENDER_CHOICES: { id: string; label: string; genders: Gender[] }[] = [
  { id: 'women', label: 'Mujeres', genders: ['FEMALE'] },
  { id: 'men', label: 'Hombres', genders: ['MALE'] },
  { id: 'trans', label: 'Personas trans', genders: ['TRANS_FEMALE', 'TRANS_MALE', 'NON_BINARY'] },
  { id: 'couples', label: 'Parejas', genders: ['COUPLE'] },
];

/** Etiquetas que se pueden elegir (las publicas del catalogo). Sus iconos van en el asistente. */
export const TASTE_TAGS: { id: string; label: string }[] = [
  { id: 'latina', label: 'Latina' },
  { id: 'europea', label: 'Europea' },
  { id: 'asiatica', label: 'Asiatica' },
  { id: 'fitness', label: 'Fitness' },
  { id: 'tatuajes', label: 'Tatuajes' },
  { id: 'piercing', label: 'Piercing' },
  { id: 'rubia', label: 'Rubia' },
  { id: 'morena', label: 'Morena' },
  { id: 'pelirroja', label: 'Pelirroja' },
  { id: 'curvy', label: 'Curvy' },
  { id: 'roleplay', label: 'Roleplay' },
  { id: 'gamer', label: 'Gamer' },
  { id: 'cosplay', label: 'Cosplay' },
  { id: 'pareja', label: 'En pareja' },
];

export const LOOKING_FOR_CHOICES: { id: string; label: string; hint: string }[] = [
  { id: 'fotos', label: 'Fotos y videos', hint: 'Ver sus publicaciones' },
  { id: 'directos', label: 'Directos', hint: 'Verlas en vivo' },
  { id: 'chatear', label: 'Chatear', hint: 'Hablar por mensajes' },
  { id: 'videollamadas', label: 'Videollamadas', hint: 'Llamadas 1 a 1' },
];

export const TASTE_TAG_IDS = TASTE_TAGS.map((t) => t.id);
export const LOOKING_FOR_IDS = LOOKING_FOR_CHOICES.map((c) => c.id);

/** Gustos de una persona tal y como los usa el recomendador. */
export interface Tastes {
  preferredGenders: Gender[];
  interests: string[];
  lookingFor: string[];
}

export function hasTastes(t: Tastes | null | undefined): t is Tastes {
  return Boolean(
    t && (t.preferredGenders.length || t.interests.length || t.lookingFor.length),
  );
}
