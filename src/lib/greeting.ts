import 'server-only';

import type { VisitSource } from '@prisma/client';

import { createNotification } from '@/lib/notifications';
import { prisma } from '@/lib/prisma';
import { utcDay } from '@/lib/visits';

/**
 * MENSAJE AUTOMATICO DE BIENVENIDA
 *
 * Se envia UNA SOLA VEZ a cada persona que entra al perfil o al directo de una
 * creadora que lo tenga activado, hasta agotar el tope diario.
 *
 * Decisiones que importan:
 *
 *  - Lo manda la CREADORA, asi que abrir la conversacion es gratis para quien
 *    lo recibe (`unlockPriceTokens: 0`). Cobrar por un mensaje que el usuario
 *    no pidio seria cobrar por spam.
 *
 *  - La foto adjunta SI puede llevar precio: es el gancho comercial. Se
 *    guarda como MessageAttachment normal, asi que se desbloquea por el mismo
 *    camino que cualquier otro adjunto y la comision se aplica igual.
 *
 *  - `AutoGreetingLog` con unique (modelId, userId) es lo que garantiza el
 *    "una sola vez": sin el, cada visita al perfil dispararia otro mensaje.
 *
 *  - El tope diario se cuenta contra el dia UTC guardado en
 *    `autoGreetingCounterDay`; al cambiar el dia se reinicia en el mismo
 *    UPDATE, sin necesidad de un cron.
 *
 *  - Nunca lanza: si algo falla, la pagina que lo disparo debe seguir
 *    renderizando. Un saludo perdido no es un error visible para nadie.
 */
export async function maybeSendAutoGreeting(params: {
  modelId: string;
  viewerId: string | null;
  source?: VisitSource;
}): Promise<boolean> {
  const { modelId, viewerId } = params;
  if (!viewerId) return false;

  try {
    const model = await prisma.modelProfile.findUnique({
      where: { id: modelId },
      select: {
        id: true,
        userId: true,
        slug: true,
        stageName: true,
        autoGreetingEnabled: true,
        autoGreetingText: true,
        autoGreetingAssetKey: true,
        autoGreetingAssetMime: true,
        autoGreetingPriceTokens: true,
        autoGreetingDailyLimit: true,
        autoGreetingSentToday: true,
        autoGreetingCounterDay: true,
      },
    });

    if (!model || !model.autoGreetingEnabled) return false;
    if (model.userId === viewerId) return false;
    if (!model.autoGreetingText && !model.autoGreetingAssetKey) return false;

    const today = utcDay();
    const sentToday =
      model.autoGreetingCounterDay === today ? model.autoGreetingSentToday : 0;
    if (model.autoGreetingDailyLimit > 0 && sentToday >= model.autoGreetingDailyLimit) {
      return false;
    }

    // Ya se le mando antes: el unique lo impediria de todas formas, pero
    // comprobarlo aqui evita abrir una transaccion para nada en el caso comun
    // (alguien que vuelve al perfil).
    const already = await prisma.autoGreetingLog.findUnique({
      where: { modelId_userId: { modelId, userId: viewerId } },
      select: { id: true },
    });
    if (already) return false;

    await prisma.$transaction(async (tx) => {
      // El log se crea PRIMERO: si dos peticiones simultaneas entran a la vez,
      // la segunda choca con el unique y aborta antes de duplicar el mensaje.
      await tx.autoGreetingLog.create({
        data: { modelId, userId: viewerId, source: params.source ?? 'PROFILE' },
      });

      const conversation = await tx.conversation.upsert({
        where: { userId_modelId: { userId: viewerId, modelId } },
        create: { userId: viewerId, modelId, unlockPriceTokens: 0 },
        update: { lastMessageAt: new Date() },
        select: { id: true },
      });

      const message = await tx.message.create({
        data: {
          conversationId: conversation.id,
          senderId: model.userId,
          body: model.autoGreetingText,
        },
        select: { id: true },
      });

      if (model.autoGreetingAssetKey) {
        await tx.messageAttachment.create({
          data: {
            messageId: message.id,
            storageKey: model.autoGreetingAssetKey,
            mimeType: model.autoGreetingAssetMime ?? 'image/jpeg',
            priceTokens: Math.max(0, model.autoGreetingPriceTokens),
          },
        });
      }

      await tx.modelProfile.update({
        where: { id: modelId },
        data: {
          autoGreetingCounterDay: today,
          autoGreetingSentToday: sentToday + 1,
        },
      });

      await createNotification(tx, {
        userId: viewerId,
        type: 'NEW_MESSAGE',
        title: `${model.stageName} te ha escrito`,
        body: model.autoGreetingText?.slice(0, 120) ?? undefined,
        link: `/dashboard/messages/${model.slug}`,
      });
    });

    return true;
  } catch {
    // Incluye la colision del unique cuando dos visitas coinciden: el saludo
    // ya se envio por el otro camino, asi que no hay nada que reportar.
    return false;
  }
}
