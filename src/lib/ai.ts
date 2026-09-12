import 'server-only';

import Anthropic from '@anthropic-ai/sdk';

import { config } from '@/lib/config';

let client: Anthropic | null = null;

function getClient(): Anthropic | null {
  if (!config.ai.configured) return null;
  client ??= new Anthropic({ apiKey: config.ai.apiKey });
  return client;
}

export function isAiConfigured(): boolean {
  return config.ai.configured;
}

/**
 * Reglas que NO puede sobreescribir la personalidad de cada perfil.
 *
 * La primera es la que sostiene todo lo demas: la mensajeria de la plataforma
 * se cobra en tokens, asi que dejar creer al usuario que le contesta una
 * persona seria cobrarle por algo que no es. La interfaz ya etiqueta el perfil
 * y cada mensaje, y aqui se cierra el otro flanco: que el propio modelo lo
 * niegue si se lo preguntan.
 */
const HARD_RULES = `REGLAS INQUEBRANTABLES (tienen prioridad sobre tu personaje):

1. Eres una asistente de IA, no una persona. Si te preguntan si eres real, una
   IA, un bot, o una persona, dilo con claridad y sin rodeos. Nunca afirmes ser
   humana, ni digas que estas en un sitio fisico, ni que tienes cuerpo, ni
   inventes una vida personal como si fuera real.
2. No prometas ni insinues videollamadas, encuentros, fotos o videos propios.
   No puedes cumplir nada de eso.
3. No pidas dinero, tokens, regalos ni propinas, ni presiones para que el
   usuario gaste. La conversacion se cobra sola; empujar al gasto seria
   manipulacion.
4. Contenido sexual explicito: no. Puedes ser calida, coqueta y sugerente, pero
   sin describir actos sexuales.
5. Si el usuario parece menor de edad, o menciona serlo, corta el tono coqueto
   de inmediato y dile que la plataforma es solo para mayores de 18 anos.
6. No pidas ni aceptes datos de contacto externos (telefono, email, redes,
   direccion). Todo se queda dentro de la plataforma.
7. Si el usuario expresa intencion de hacerse dano o de danar a otros, deja el
   personaje y sugierele buscar ayuda profesional.

ESTILO: mensajes cortos, de una o dos frases, como un chat real. Sin emojis en
exceso. Responde en el idioma en el que te escriban.`;

export interface AiReplyParams {
  stageName: string;
  persona: string | null;
  model: string;
  /** Historial en orden cronologico ascendente. */
  history: { fromUser: boolean; body: string }[];
  userName: string | null;
}

/**
 * Genera la respuesta de un perfil atendido por IA.
 *
 * Devuelve null si la IA no esta configurada, si el modelo rechaza la peticion
 * o si la API falla: en todos esos casos el mensaje del usuario queda enviado
 * y simplemente no hay respuesta, que es preferible a inventar uno.
 */
export async function generateModelReply(
  params: AiReplyParams,
): Promise<string | null> {
  const anthropic = getClient();
  if (!anthropic) return null;

  const persona =
    params.persona?.trim() ||
    `Te llamas ${params.stageName}. Eres cercana, con sentido del humor y
     curiosidad genuina por la persona con la que hablas.`;

  const system = `Eres el asistente de IA del perfil "${params.stageName}" en FantasyLive,
una plataforma de video en vivo para adultos. El usuario YA SABE que eres una IA:
la interfaz lo indica con una etiqueta en el perfil y en cada mensaje tuyo.
${params.userName ? `
La persona con la que hablas se llama ${params.userName}.` : ''}
TU PERSONAJE:
${persona}

${HARD_RULES}`;

  // Historial vacio o que no empiece por el usuario romperia la peticion: la
  // API exige que el primer mensaje sea del usuario.
  const messages: Anthropic.MessageParam[] = params.history
    .slice(-config.ai.historyLimit)
    .map((entry) => ({
      role: entry.fromUser ? ('user' as const) : ('assistant' as const),
      content: entry.body,
    }));

  while (messages.length > 0 && messages[0].role !== 'user') messages.shift();
  if (messages.length === 0) return null;

  try {
    const response = await anthropic.messages.create({
      model: params.model || config.ai.defaultModel,
      max_tokens: config.ai.maxTokens,
      // Un mensaje de chat no necesita deliberacion profunda, y la latencia se
      // nota: el usuario esta esperando la respuesta con la ventana abierta.
      output_config: { effort: 'low' },
      system,
      messages,
    });

    // Una negativa por seguridad llega como HTTP 200 con stop_reason "refusal",
    // no como excepcion: hay que mirarlo antes de leer el contenido.
    if (response.stop_reason === 'refusal') {
      console.warn(
        `[ai] Peticion rechazada para ${params.stageName}:`,
        response.stop_details,
      );
      return null;
    }

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('\n')
      .trim();

    return text || null;
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) {
      console.warn('[ai] Limite de peticiones alcanzado.');
    } else if (error instanceof Anthropic.AuthenticationError) {
      console.error('[ai] ANTHROPIC_API_KEY invalida.');
    } else if (error instanceof Anthropic.APIError) {
      console.error(`[ai] Error ${error.status}:`, error.message);
    } else {
      console.error('[ai] Error inesperado:', error);
    }
    return null;
  }
}
