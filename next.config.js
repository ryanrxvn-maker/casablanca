/**
 * Rotas privadas (app, admin, auth, api). Elas saíam do índice via `Disallow`
 * no robots.txt — o que, como o próprio pentest apontou, entregava o mapa do
 * app pro atacante SEM impedir indexação (Disallow não é controle de acesso;
 * o Google pode listar a URL mesmo sem rastrear). Agora o robots.txt não cita
 * nenhuma delas e quem tira do índice é o X-Robots-Tag abaixo, que é o
 * mecanismo que realmente funciona.
 */
const PRIVATE_ROUTES = [
  '/tools',
  '/admin',
  '/configuracoes',
  '/api',
  '/login',
  '/register',
  '/verify',
  '/verify-phone',
  '/trocar-senha',
  '/reset-password',
  '/forgot-password',
  '/access-revoked',
  '/auth',
];

const NOINDEX_HEADER = [
  { key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive' },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  // BUILD ISOLADO (31.08): `next build` e `next dev` compartilham o .next e se
  // atropelam — o build morre em "Cannot find module for page: /_document" com
  // o dev server no ar. Com NEXT_DIST_DIR o build vai pra outra pasta e os dois
  // convivem. Sem a env, nada muda (o padrão continua .next).
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : null),
  eslint: { ignoreDuringBuilds: true },
  // Sem source maps em producao — dificulta engenharia reversa do bundle.
  productionBrowserSourceMaps: false,
  // Remove o "X-Powered-By: Next.js" header.
  poweredByHeader: false,

  // @gradio/client é ESM com deps (ws/etc) que não devem ser empacotadas
  // pelo bundler do server — roda como módulo Node externo.
  experimental: {
    // @gradio/client e undici rodam como módulos Node externos (não
    // empacotados pelo bundler do server). undici só é carregado quando
    // DREAMFACE_PROXY_URL está setado (proxy de IP fixo do DreamFace).
    serverComponentsExternalPackages: ['@gradio/client', 'undici'],
  },

  // ── Cache do webpack em MEMÓRIA no dev (Windows) ───────────────────────
  // O cache em DISCO (.next/cache/webpack/*.pack.gz) quebra com frequência
  // nesta máquina: o rename do .pack.gz_ falha com ENOENT (antivírus/OneDrive
  // segurando o arquivo), o cache fica podre e o dev passa a servir HTML no
  // lugar dos chunks — a página carrega sem React ("missing required error
  // components"). Em memória isso não acontece. NÃO afeta `next build`/produção.
  webpack: (config, { dev }) => {
    if (dev) config.cache = { type: 'memory' };
    return config;
  },

  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          // ── CSP camada 1: BLOQUEANTE, e só com diretiva de risco zero ────
          // Nenhuma delas pode quebrar ferramenta: o app não tem <object>/
          // <embed>, nenhum <form action=...> (todo submit é fetch), e já
          // recusa iframe via X-Frame-Options. NÃO tem default-src nem
          // script-src de propósito — o que não está aqui segue liberado.
          //
          // O que isso já barra de verdade: sequestro de <base> (reescreve o
          // destino de TODO caminho relativo da página), plugin/objeto
          // injetado, e roubo de dados por form apontado pra fora.
          {
            key: 'Content-Security-Policy',
            value: [
              "base-uri 'self'",
              "object-src 'none'",
              "form-action 'self'",
              "frame-ancestors 'none'",
            ].join('; '),
          },

          // ── CSP camada 2: política ESTRITA em modo OBSERVAÇÃO ────────────
          // Report-Only NÃO bloqueia nada — só reporta violação no console do
          // browser. É o degrau seguro antes de fechar de vez: as ferramentas
          // pesadas dependem de wasm (ffmpeg/MediaPipe), Worker em blob:, CDN
          // (unpkg/jsdelivr) e injeção das extensões, então uma política
          // bloqueante escrita no escuro derruba tudo isso de uma vez.
          //
          // COMO PROMOVER (depois de rodar as ferramentas e ver o console
          // limpo): troque a key abaixo por 'Content-Security-Policy' e apague
          // a camada 1. Se aparecer violação, adicione a origem aqui ANTES.
          //
          // Nota: script-src fica com 'unsafe-inline' porque o Next injeta
          // script inline de hidratação em toda página; tirar isso exige nonce
          // por request, o que força render dinâmico no site inteiro (custo de
          // latência/SEO na landing). 'wasm-unsafe-eval' é obrigatório pro
          // ffmpeg.wasm; sem ele o Chrome recusa compilar o WebAssembly.
          {
            key: 'Content-Security-Policy-Report-Only',
            value: [
              "default-src 'self'",
              "base-uri 'self'",
              "object-src 'none'",
              "form-action 'self'",
              "frame-ancestors 'none'",
              // blob: = core do ffmpeg virando script; chrome-extension: = as
              // extensões (Hey Auto/Downloader/Magnific) injetando na página.
              "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' blob: chrome-extension: https://js.stripe.com https://unpkg.com https://cdn.jsdelivr.net",
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
              "font-src 'self' data: https://fonts.gstatic.com",
              "img-src 'self' data: blob: https:",
              "media-src 'self' data: blob: https:",
              // Exfiltração de dados passa por aqui — é a diretiva que mais
              // paga a pena de manter estreita. storage.googleapis.com = modelo
              // do MediaPipe; localhost = motor local do downloader.
              "connect-src 'self' blob: data: https://*.supabase.co wss://*.supabase.co https://unpkg.com https://cdn.jsdelivr.net https://storage.googleapis.com https://api.stripe.com http://localhost:* http://127.0.0.1:*",
              "worker-src 'self' blob:",
              "child-src 'self' blob:",
              "frame-src 'self' https://js.stripe.com https://hooks.stripe.com",
              "manifest-src 'self'",
            ].join('; '),
          },

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
          // preload: entra na lista embutida dos browsers, que passam a exigir
          // HTTPS já no PRIMEIRO acesso (sem ele, a primeira visita em http
          // ainda é interceptável). Só ative o envio em hstspreload.org quando
          // tiver certeza de que nenhum subdomínio precisa de http puro.
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
        ],
      },

      // noindex REAL nas rotas privadas (achado 3.7). Duas entradas por rota:
      // a própria (/tools) e tudo abaixo dela (/tools/qualquer/coisa).
      ...PRIVATE_ROUTES.flatMap((route) => [
        { source: route, headers: NOINDEX_HEADER },
        { source: `${route}/:path*`, headers: NOINDEX_HEADER },
      ]),
    ];
  },
  images: {
    remotePatterns: [{ protocol: 'https', hostname: '**.supabase.co' }],
  },
};

module.exports = nextConfig;
