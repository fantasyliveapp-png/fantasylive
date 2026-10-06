import type { Metadata } from 'next';

import { config } from '@/lib/config';

/** Imagen de vista previa de toda la web (1200x630). */
export const SHARE_IMAGE = {
  url: '/brand/og-image.png',
  width: 1200,
  height: 630,
  alt: 'Fantasy Live: directos, videollamadas y contenido exclusivo',
};

/**
 * Titulo + descripcion de una pagina, tambien para la vista previa al
 * compartir el enlace (WhatsApp, Telegram, X...).
 *
 * Next sustituye el bloque openGraph/twitter entero del layout en vez de
 * mezclarlo: por eso aqui se repiten siteName, type, locale, imagen y card.
 */
export function pageMeta(title: string, description: string): Metadata {
  const full = `${title} | ${config.app.name}`;
  return {
    title,
    description,
    openGraph: {
      title: full,
      description,
      siteName: config.app.name,
      type: 'website',
      locale: 'es_ES',
      images: [SHARE_IMAGE],
    },
    twitter: { card: 'summary_large_image', title: full, description, images: [SHARE_IMAGE.url] },
  };
}

/** Descripcion de un perfil: su frase si tiene, si no una generica. */
export function creatorDescription(stageName: string, headline?: string | null) {
  const own = headline?.trim();
  if (own) return own.length > 155 ? `${own.slice(0, 152).trimEnd()}…` : own;
  return `Sigue a ${stageName} en ${config.app.name}: directos, videollamadas, mensajes y contenido exclusivo.`;
}
