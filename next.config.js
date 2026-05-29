/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: { ignoreDuringBuilds: true },
  // Sem source maps em producao — dificulta engenharia reversa do bundle.
  productionBrowserSourceMaps: false,
  // Remove o "X-Powered-By: Next.js" header.
  poweredByHeader: false,

  // @gradio/client é ESM com deps (ws/etc) que não devem ser empacotadas
  // pelo bundler do server — roda como módulo Node externo.
  experimental: {
    serverComponentsExternalPackages: ['@gradio/client'],
  },

  async headers() {
    // CSP afinada pro stack: Next (inline), FFmpeg WASM (wasm-unsafe-eval +
    // workers blob), Stripe Elements (js/frames), Supabase (api/realtime).
    // Bloqueia script/frame/conexão de qualquer outra origem.
    const csp = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' https://js.stripe.com https://va.vercel-scripts.com",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data:",
      "media-src 'self' blob: data: https:",
      "worker-src 'self' blob:",
      "connect-src 'self' blob: data: https://*.supabase.co wss://*.supabase.co https://*.stripe.com",
      "frame-src 'self' https://js.stripe.com https://hooks.stripe.com",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self' https://checkout.stripe.com",
      "frame-ancestors 'none'",
      'upgrade-insecure-requests',
    ].join('; ');

    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
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
