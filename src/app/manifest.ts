import type { MetadataRoute } from 'next';

import { config } from '@/lib/config';

/**
 * Ficha de la app instalable (PWA): con esto el movil ofrece "Instalar" y la
 * abre a pantalla completa, con su icono, como una app mas. No pasa por las
 * tiendas de apps (que no aceptan contenido para adultos).
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: config.app.name,
    short_name: config.app.name,
    description: 'Tus creadores favoritos: directos, videollamadas, mensajes y contenido exclusivo.',
    start_url: '/?source=app',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#0a0a0b',
    theme_color: '#0a0a0b',
    lang: 'es',
    categories: ['entertainment', 'social'],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
