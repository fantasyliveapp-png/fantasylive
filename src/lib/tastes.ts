import type { Gender } from '@prisma/client';

/**
 * GUSTOS: las opciones de las preguntas de bienvenida. Se comparten entre el
 * asistente (cliente) y el recomendador (servidor).
 */

export const GENDER_CHOICES: { id: string; label: string; emoji: string; genders: Gender[] }[] = [
  { id: 'women', label: 'Mujeres', emoji: '👩', genders: ['FEMALE'] },
  { id: 'men', label: 'Hombres', emoji: '👨', genders: ['MALE'] },
  { id: 'trans', label: 'Personas trans', emoji: '🏳️‍⚧️', genders: ['TRANS_FEMALE', 'TRANS_MALE', 'NON_BINARY'] },
  { id: 'couples', label: 'Parejas', emoji: '💑', genders: ['COUPLE'] },
];

/** Etiquetas que se pueden elegir (las publicas del catalogo), con su emoji. */
export const TASTE_TAGS: { id: string; label: string; emoji: string }[] = [
  { id: 'latina', label: 'Latina', emoji: '💃' },
  { id: 'europea', label: 'Europea', emoji: '🇪🇺' },
  { id: 'asiatica', label: 'Asiatica', emoji: '🌸' },
  { id: 'fitness', label: 'Fitness', emoji: '💪' },
  { id: 'tatuajes', label: 'Tatuajes', emoji: '🖋️' },
  { id: 'piercing', label: 'Piercing', emoji: '💍' },
  { id: 'rubia', label: 'Rubia', emoji: '👱‍♀️' },
  { id: 'morena', label: 'Morena', emoji: '🤎' },
  { id: 'pelirroja', label: 'Pelirroja', emoji: '🦊' },
  { id: 'curvy', label: 'Curvy', emoji: '🍑' },
  { id: 'roleplay', label: 'Roleplay', emoji: '🎭' },
  { id: 'gamer', label: 'Gamer', emoji: '🎮' },
  { id: 'cosplay', label: 'Cosplay', emoji: '🦸‍♀️' },
  { id: 'pareja', label: 'En pareja', emoji: '💞' },
];

export const LOOKING_FOR_CHOICES: { id: string; label: string; hint: string; emoji: string }[] = [
  { id: 'fotos', label: 'Fotos y videos', hint: 'Ver sus publicaciones', emoji: '📸' },
  { id: 'directos', label: 'Directos', hint: 'Verlas en vivo', emoji: '🔴' },
  { id: 'chatear', label: 'Chatear', hint: 'Hablar por mensajes', emoji: '💬' },
  { id: 'videollamadas', label: 'Videollamadas', hint: 'Llamadas 1 a 1', emoji: '📹' },
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
