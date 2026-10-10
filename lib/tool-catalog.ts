/**
 * Catálogo das ferramentas que o painel "Ferramentas" do /admin controla.
 * Toda pasta app/tools/<rota> com page.tsx está aqui, menos as páginas da
 * conta (histórico, notificações) — scripts/test-tools-center-guards.mjs
 * reprova ferramenta nova que esquecer de entrar.
 *
 * `plan` é só o rótulo do painel (quem enxerga): o acesso de verdade continua
 * no middleware e no lib/use-tier.ts.
 */

export type ToolPlan = 'free' | 'premium' | 'admin';

export type CatalogTool = {
  path: string;
  label: string;
  plan: ToolPlan;
  /** Linha curta do que ela faz (pro admin achar rápido). */
  hint: string;
};

export const TOOL_CATALOG: readonly CatalogTool[] = [
  // ─── Clientes ───
  { path: '/tools/fakepass', label: 'FakePrint', plan: 'free', hint: 'Prints e stickers de redes sociais' },
  { path: '/tools/decupagem', label: 'Remover Silêncios', plan: 'free', hint: 'Corta silêncios do áudio e do vídeo' },
  { path: '/tools/downloader', label: 'Downloader', plan: 'free', hint: 'Baixa de YouTube, Instagram, TikTok' },
  { path: '/tools/compressor', label: 'Compressor', plan: 'free', hint: 'Diminui o peso do vídeo' },
  { path: '/tools/tipografia', label: 'Legendas Automáticas', plan: 'premium', hint: 'Legenda animada no tempo da fala' },
  { path: '/tools/lipsync', label: 'Lipsync Video to Video', plan: 'premium', hint: 'Rosto do vídeo falando um áudio novo' },
  { path: '/tools/camuflagem', label: 'Camuflagem de Áudio', plan: 'premium', hint: 'O público ouve um, a transcrição lê outro' },
  { path: '/tools/copy-srt', label: 'Gerador de SRT', plan: 'premium', hint: 'Áudio + copy viram legenda alinhada' },
  { path: '/tools/audio-split', label: 'Dividir Voz', plan: 'premium', hint: 'Divide o áudio pelas pausas' },
  { path: '/tools/acelerador', label: 'Mixer de Velocidade', plan: 'premium', hint: 'Acelera sem ficar robótico' },
  { path: '/tools/normalizador', label: 'Normalizador de Áudio', plan: 'premium', hint: 'Iguala volume e limpa chiado' },
  { path: '/tools/caixinha-pergunta', label: 'Caixinha de Pergunta', plan: 'premium', hint: 'Modelo de caixinha do FakePrint' },
  { path: '/tools/calculadora', label: 'Calculadora', plan: 'premium', hint: 'Preço por minuto dos vídeos' },
  // ─── Uso interno ───
  { path: '/tools/clickup-pilot', label: 'Pilot', plan: 'admin', hint: 'Disparo dos lipsyncs pelo ClickUp' },
  { path: '/tools/heygen-auto', label: 'Hey Auto', plan: 'admin', hint: 'Motor interno de disparo no HeyGen' },
  { path: '/tools/auto-broll', label: 'Auto B-roll', plan: 'admin', hint: 'Dezenas de b-rolls de uma lista' },
  { path: '/tools/auto-cortes', label: 'Auto Cortes', plan: 'admin', hint: 'Vídeo longo vira cortes prontos' },
  { path: '/tools/decupagem-copy', label: 'Remover Silêncios por Copy', plan: 'admin', hint: 'IA escolhe o take pela copy' },
  { path: '/tools/remover-elementos', label: 'Remover Legenda/Marca d’Água', plan: 'admin', hint: 'IA limpa legenda queimada' },
  { path: '/tools/separador-audio', label: 'Separador de Áudio', plan: 'admin', hint: 'Voz, instrumental e SFX separados' },
  { path: '/tools/famous-hey', label: 'Famous Hey', plan: 'admin', hint: 'Foto vira take falando no HeyGen' },
  { path: '/tools/ltx-video', label: 'LTX Video', plan: 'admin', hint: 'Geração de vídeo LTX' },
  { path: '/tools/voice-test', label: 'Isolar Voz', plan: 'admin', hint: 'Teste de isolamento de voz' },
  { path: '/tools/lipsync-history', label: 'Histórico de Avatares', plan: 'admin', hint: 'Lotes do Pilot e do VA' },
  { path: '/tools/background', label: 'Tarefas em Segundo Plano', plan: 'admin', hint: 'Fila do Pilot' },
  { path: '/tools/points', label: 'Pontos', plan: 'admin', hint: 'Sistema de pontos interno' },
];

/** Rotas de /tools que são página da conta, não ferramenta (não entram em manutenção). */
export const ACCOUNT_PAGES: readonly string[] = ['/tools/historico', '/tools/notificacoes'];

export const PLAN_LABEL: Record<ToolPlan, string> = { free: 'Free', premium: 'Premium', admin: 'Uso interno' };

const BY_PATH = new Map(TOOL_CATALOG.map((t) => [t.path, t]));

export function catalogTool(path: string): CatalogTool | undefined {
  return BY_PATH.get(path);
}

/** Nome humano (cai no slug quando a rota não está no catálogo). */
export function toolName(path: string): string {
  return BY_PATH.get(path)?.label ?? path.replace(/^\/tools\//, '');
}

/** Slug da rota, pro ícone (components/history/tool-icons.tsx). */
export const toolSlug = (path: string) => path.replace(/^\/tools\//, '');
