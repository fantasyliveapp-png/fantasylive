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
  serverExternalPackages: ['livekit-server-sdk', 'bcryptjs', '@prisma/client'],
};

export default nextConfig;
