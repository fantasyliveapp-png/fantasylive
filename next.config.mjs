import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // La raiz es esta carpeta. Sin esto, un package-lock.json suelto en una
  // carpeta superior hace que Next tome esa como raiz y vigile/rastree mucho
  // mas de lo necesario (compilaciones lentisimas en desarrollo).
  outputFileTracingRoot: dirname(fileURLToPath(import.meta.url)),
  // El seed usa avatares/placeholders remotos. Añade aqui tu bucket S3/R2 publico si lo usas.
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'i.pravatar.cc' },
      { protocol: 'https', hostname: 'picsum.photos' },
      { protocol: 'https', hostname: 'images.unsplash.com' },
      { protocol: 'https', hostname: '**.r2.dev' },
      { protocol: 'https', hostname: '**.amazonaws.com' },
    ],
  },
  eslint: {
    // El build de Vercel no debe romperse por reglas de estilo.
    ignoreDuringBuilds: true,
  },
  experimental: {
    serverActions: {
      bodySizeLimit: '4mb',
    },
  },
  // livekit-server-sdk y bcryptjs deben ejecutarse en Node runtime, no en Edge.
  // geoip-lite carga su base MaxMind desde disco: debe quedar fuera del bundle.
  serverExternalPackages: [
    'livekit-server-sdk',
    'bcryptjs',
    '@prisma/client',
    'geoip-lite',
  ],
  // No anunciar la version del framework.
  poweredByHeader: false,
  // Direcciones antiguas en femenino: siguen funcionando para no romper los
  // enlaces que ya se han compartido (invitaciones, redes...).
  async redirects() {
    return [
      { source: '/hazte-creadora', destination: '/hazte-creador', permanent: true },
      { source: '/r/:slug/creadora', destination: '/r/:slug/creador', permanent: true },
    ];
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          // Impide que la app se embeba en un iframe ajeno (clickjacking).
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            // La camara y el microfono solo para la propia app (videollamadas).
            key: 'Permissions-Policy',
            value:
              'camera=(self), microphone=(self), geolocation=(), payment=(self), interest-cohort=()',
          },
          {
            // 2 anos + preload: la app solo debe servirse por HTTPS.
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
          { key: 'X-DNS-Prefetch-Control', value: 'on' },
          {
            // Equivalente moderno de X-Frame-Options. No se define una CSP
            // completa porque Next inyecta scripts inline con nonce propio y
            // una politica mal ajustada romperia la app en produccion.
            key: 'Content-Security-Policy',
            value: "frame-ancestors 'none'",
          },
        ],
      },
      {
        // Nada de lo que sirve la API debe cachearse en proxies intermedios:
        // lleva URLs firmadas, saldos y datos de sesion. Salvo las fotos de
        // perfil (public-media) y las imagenes de vista previa (og), que son
        // publicas y ponen su propia cache: si no, esta regla la pisaria.
        source: '/api/:path((?!public-media/|og/).*)',
        headers: [{ key: 'Cache-Control', value: 'no-store, max-age=0' }],
      },
      {
        source: '/api/:path*',
        headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }],
      },
      {
        // Recursos de los correos (logo, fuente): los programas de correo los
        // piden desde fuera; sin esto la fuente de la marca no carga.
        source: '/email-assets/:path*',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: '*' },
          { key: 'Cache-Control', value: 'public, max-age=604800' },
        ],
      },
    ];
  },
};

export default nextConfig;
