/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // El seed usa avatares/placeholders remotos. Anade aqui tu bucket S3/R2 publico si lo usas.
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
        // lleva URLs firmadas, saldos y datos de sesion.
        source: '/api/:path*',
        headers: [
          { key: 'Cache-Control', value: 'no-store, max-age=0' },
          { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
        ],
      },
    ];
  },
};

export default nextConfig;
