import type { MetadataRoute } from 'next';

const SITE_URL = 'https://www.darkoautoedit.com';

// Rotas privadas (app/admin/auth/api) — fora do índice de busca E de IA.
const DISALLOW = [
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

// Crawlers de IA que queremos EXPLICITAMENTE liberar nas páginas públicas —
// é assim que o site vira fonte citável no ChatGPT, Perplexity, Claude e nas
// AI Overviews do Google. (O '*' já liberaria, mas ser explícito garante a
// intenção e evita bloqueio por engano.)
const AI_BOTS = [
  'GPTBot', // OpenAI / ChatGPT
  'OAI-SearchBot', // OpenAI Search
  'ChatGPT-User', // ChatGPT browsing
  'ClaudeBot', // Anthropic / Claude
  'PerplexityBot', // Perplexity
  'Google-Extended', // Gemini / AI Overviews
  'Applebot-Extended', // Apple Intelligence
];

/**
 * /robots.txt — libera o marketing público (landing/planos/termos/política)
 * pra busca tradicional E pra crawlers de IA, e mantém app/admin/auth/api fora
 * do índice. Aponta o sitemap.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: '*', allow: '/', disallow: DISALLOW },
      ...AI_BOTS.map((userAgent) => ({
        userAgent,
        allow: '/',
        disallow: DISALLOW,
      })),
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
