/**
 * Rotas que têm guia de ferramenta.
 *
 * Fica num módulo separado de propósito: o FAB (carregado no layout de todas
 * as ferramentas) só precisa saber SE existe guia — o conteúdo pesado
 * (guides.tsx) é lazy-loaded apenas quando o usuário abre o card.
 *
 * ⚠ Manter em sincronia com as chaves de GUIDES em guides.tsx
 *   (GuidePanel avisa no console em dev se alguma rota ficar órfã).
 */
export const GUIDE_PATHS = new Set<string>([
  '/tools/acelerador',
  '/tools/audio-split',
  '/tools/auto-broll',
  '/tools/background',
  '/tools/caixinha-pergunta',
  '/tools/calculadora',
  '/tools/camuflagem',
  '/tools/clickup-pilot',
  '/tools/compressor',
  '/tools/copy-srt',
  '/tools/decupagem',
  '/tools/decupagem-copy',
  '/tools/downloader',
  '/tools/fakepass',
  '/tools/heygen-auto',
  '/tools/lipsync',
  '/tools/lipsync-history',
  '/tools/ltx-video',
  '/tools/normalizador',
  '/tools/points',
  '/tools/separador-audio',
  '/tools/voice-test',
]);
