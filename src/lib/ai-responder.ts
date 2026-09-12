import 'server-only';

import { generateModelReply, isAiConfigured } from '@/lib/ai';
import { createNotification } from '@/lib/notifications';
import { prisma } from '@/lib/prisma';

/**
 * Contesta como el perfil de IA de una conversacion.
 *
 * Se llama despues de que el usuario haya enviado su mensaje y ANTES de que la
 * server action retorne, porque el hilo se refresca con router.refresh(): asi
 * el usuario ve su mensaje y la respuesta en el mismo repintado.
 *
 * Nunca lanza. Si algo falla, la conversacion se queda con el mensaje del
 * usuario sin respuesta, que es el fallo menos malo: no se cobra de mas (la
 * mensajeria cobra por el mensaje del usuario, no por la respuesta) y no se
 * inventa contenido.
 */
export async function maybeReplyAsAi(conversationId: string): Promise<boolean> {
  if (!isAiConfigured()) return false;

  try {
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: {
        id: true,
        userId: true,
        model: {
          select: {
            userId: true,
            stageName: true,
            slug: true,
            isAi: true,
            aiPersona: true,
            aiModel: true,
          },
        },
        user: { select: { name: true } },
      },
    });

    if (!conversation?.model.isAi) return false;

    const history = await prisma.message.findMany({
      where: { conversationId, body: { not: null } },
      orderBy: { createdAt: 'desc' },
      take: 40,
      select: { senderId: true, body: true },
    });

    // findMany devuelve del mas nuevo al mas viejo; el modelo necesita el orden
    // cronologico.
    history.reverse();

    // Si el ultimo mensaje ya es de la IA, no encadenamos otra respuesta.
    const last = history.at(-1);
    if (!last || last.senderId !== conversation.userId) return false;

    const reply = await generateModelReply({
      stageName: conversation.model.stageName,
      persona: conversation.model.aiPersona,
      model: conversation.model.aiModel,
      userName: conversation.user.name,
      history: history.map((message) => ({
        fromUser: message.senderId === conversation.userId,
        body: message.body ?? '',
      })),
    });

    if (!reply) return false;

    await prisma.$transaction(async (tx) => {
      await tx.message.create({
        data: {
          conversationId,
          senderId: conversation.model.userId,
          body: reply,
          isAiGenerated: true,
        },
      });

      await tx.conversation.update({
        where: { id: conversationId },
        data: { lastMessageAt: new Date() },
      });

      await createNotification(tx, {
        userId: conversation.userId,
        type: 'NEW_MESSAGE',
        title: `${conversation.model.stageName} te respondio`,
        link: `/dashboard/messages/${conversation.model.slug}`,
      });
    });

    return true;
  } catch (error) {
    console.error('[ai-responder] No se pudo responder:', error);
    return false;
  }
}
