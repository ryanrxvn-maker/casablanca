import type { MetadataRoute } from 'next';

const SITE_URL = 'https://www.darkoautoedit.com';

// ATENÇÃO: não liste rota privada aqui (pentest 13.08, achado 3.7).
// `Disallow` NÃO é controle de acesso — não bloqueia ninguém e ainda publica,
// pra qualquer um que abra /robots.txt, o mapa exato de onde ficam admin, api
// e as telas de auth. Quem tira essas rotas do índice agora é o header
// `X-Robots-Tag: noindex` (definido em next.config.js → PRIVATE_ROUTES), que
// é o mecanismo que de fato impede indexação. Acesso, quem barra é o
// middleware de sessão.

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
 * pra busca tradicional E pra crawlers de IA, e aponta o sitemap. As rotas
 * privadas saem do índice pelo X-Robots-Tag (ver nota acima), não daqui.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: '*', allow: '/' },
      ...AI_BOTS.map((userAgent) => ({ userAgent, allow: '/' })),
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
