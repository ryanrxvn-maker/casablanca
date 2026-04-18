/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // FFmpeg WASM precisa de SharedArrayBuffer -> exige cross-origin isolation.
  // Usamos COEP: credentialless (e nao require-corp) para que imagens/videos
  // do Supabase Storage possam carregar sem precisar do header CORP. O
  // credentialless ainda garante window.crossOriginIsolated === true, que e
  // o que o core-mt do FFmpeg precisa para rodar em pool de threads.
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
          { key: 'Cross-Origin-Embedder-Policy', value: 'credentialless' },
        ],
      },
    ];
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**.supabase.co' },
    ],
  },
};

module.exports = nextConfig;
