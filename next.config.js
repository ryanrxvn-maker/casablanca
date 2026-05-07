/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Sem source maps em producao — dificulta engenharia reversa do bundle.
  productionBrowserSourceMaps: false,
  // Remove o "X-Powered-By: Next.js" header.
  poweredByHeader: false,

  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          // FFmpeg WASM precisa de SharedArrayBuffer -> exige cross-origin
          // isolation. credentialless permite carregar mídia do Supabase
          // Storage sem header CORP em cada asset.
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
          { key: 'Cross-Origin-Embedder-Policy', value: 'credentialless' },

          // Anti-clone / anti-embed: nao deixa o app rodar em iframe
          // de outro dominio, nao deixa o browser sniffar tipos.
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Permissions-Policy',
            value:
              'camera=(), microphone=(), geolocation=(), browsing-topics=()',
          },
          // HSTS so faz sentido em HTTPS (Vercel sempre).
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=31536000; includeSubDomains',
          },
        ],
      },
    ];
  },
  images: {
    remotePatterns: [{ protocol: 'https', hostname: '**.supabase.co' }],
  },
};

module.exports = nextConfig;
