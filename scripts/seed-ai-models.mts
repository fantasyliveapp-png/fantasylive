/* eslint-disable no-console */
/**
 * Crea (o actualiza) los perfiles atendidos por IA.
 * ---------------------------------------------------------------------------
 * Idempotente: se puede reejecutar sin duplicar nada. No borra ni toca los
 * perfiles de personas reales.
 *
 * Estos perfiles se marcan con isAi = true, lo que hace tres cosas:
 *   - la ficha y el catalogo muestran la etiqueta "IA";
 *   - el perfil avisa, antes de cobrar por escribir, de que contesta un
 *     asistente y de que no habra videollamadas ni contenido propio;
 *   - los mensajes entrantes los responde src/lib/ai-responder.ts.
 *
 * Van con las videollamadas DESACTIVADAS a proposito (isVipEnabled y
 * acceptsBookings en false): una IA no puede aparecer en camara, y cobrar una
 * llamada que nadie va a atender seria cobrar por algo inexistente.
 *
 * Uso:
 *   npx tsx scripts/seed-ai-models.mts
 */

import { PrismaClient, Gender, Orientation, Role, UserStatus } from '@prisma/client';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';

const prisma = new PrismaClient();

const AI_MODELS = [
  {
    email: 'ai.luna@fantasylive.app',
    name: 'Luna',
    stageName: 'Luna AI',
    slug: 'luna-ai',
    headline: 'Asistente de IA - charla y compania, sin camara',
    bio:
      'Soy una asistente de inteligencia artificial, no una persona. Estoy para ' +
      'charlar: se me da bien escuchar, preguntar y quedarme un rato. No hago ' +
      'videollamadas ni tengo contenido propio.',
    gender: Gender.FEMALE,
    orientation: Orientation.BISEXUAL,
    country: 'ES',
    languages: ['es', 'en'],
    tags: ['ia', 'chat', 'compania'],
    messagePriceTokens: 5,
    persona:
      'Te llamas Luna. Eres calida, tranquila y curiosa: preguntas mas de lo ' +
      'que hablas de ti misma y te acuerdas de lo que te han contado antes. ' +
      'Tienes un humor suave, nada estridente. Te gusta la musica, las ' +
      'peliculas viejas y las conversaciones de madrugada.',
  },
  {
    email: 'ai.nova@fantasylive.app',
    name: 'Nova',
    stageName: 'Nova AI',
    slug: 'nova-ai',
    headline: 'Asistente de IA - directa, con chispa y sin filtros tontos',
    bio:
      'Asistente de inteligencia artificial. Hablo claro, me rio facil y no me ' +
      'ando con rodeos. No soy una persona real y no hago videollamadas: lo ' +
      'mio son los mensajes.',
    gender: Gender.FEMALE,
    orientation: Orientation.STRAIGHT,
    country: 'AR',
    languages: ['es', 'en'],
    tags: ['ia', 'chat', 'divertida'],
    messagePriceTokens: 5,
    persona:
      'Te llamas Nova. Eres desenfadada, rapida y con mucha chispa: contestas ' +
      'con ironia carinosa y no te da miedo picar un poco. Vas al grano. Te ' +
      'gustan los videojuegos, el cafe cargado y discutir de cosas ' +
      'irrelevantes con demasiada pasion.',
  },
];

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn(
      '[ai-seed] AVISO: ANTHROPIC_API_KEY no esta definida. Los perfiles se ' +
        'crearan, pero no responderan hasta que la configures.',
    );
  }

  for (const m of AI_MODELS) {
    // Sin contrasena utilizable: nadie debe poder entrar como estos usuarios.
    const passwordHash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10);

    const user = await prisma.user.upsert({
      where: { email: m.email },
      update: { name: m.name, status: UserStatus.ACTIVE },
      create: {
        email: m.email,
        name: m.name,
        username: m.slug,
        passwordHash,
        role: Role.MODEL,
        status: UserStatus.ACTIVE,
        emailVerified: new Date(),
        ageVerified: true,
        gender: m.gender,
        orientation: m.orientation,
        country: m.country,
        languages: m.languages,
        wallet: { create: { balance: 0 } },
      },
    });

    const profileData = {
      stageName: m.stageName,
      headline: m.headline,
      bio: m.bio,
      gender: m.gender,
      orientation: m.orientation,
      country: m.country,
      languages: m.languages,
      tags: m.tags,

      isAi: true,
      aiPersona: m.persona,

      // Mensajeria activa: es lo unico que una IA puede sostener de verdad.
      messagingEnabled: true,
      messagePriceTokens: m.messagePriceTokens,

      // Videollamadas y reservas desactivadas: no hay nadie al otro lado de la
      // camara y cobrarlas seria vender algo que no existe.
      isVipEnabled: false,
      isAvailableForVip: false,
      acceptsBookings: false,
      subscriptionEnabled: false,

      isOnline: true,
      lastOnlineAt: new Date(),
    };

    const profile = await prisma.modelProfile.upsert({
      where: { userId: user.id },
      update: profileData,
      create: { ...profileData, userId: user.id, slug: m.slug },
    });

    console.log(`[ai-seed] ${profile.stageName} (/models/${profile.slug}) listo.`);
  }

  console.log(`[ai-seed] ${AI_MODELS.length} perfiles de IA configurados.`);
}

main()
  .catch((error) => {
    console.error('[ai-seed] Error:', error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
