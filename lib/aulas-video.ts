/**
 * Aulas em vídeo das ferramentas — ficam no canal do Darko Auto Edit no
 * YouTube como NÃO LISTADAS (não aparecem na busca nem no canal; só abre com o
 * link). O app embute o vídeo no "Como usar" de cada ferramenta e só mostra a
 * aula pra quem tem acesso à ferramenta (tierAllowsTool), então quem não pagou
 * não chega no link.
 *
 * Chave = rota da ferramenta (a mesma do GUIDES/GUIDE_PATHS).
 */
export type AulaVideo = {
  /** id do vídeo no YouTube (o que vem depois de ?v=) */
  id: string;
  titulo: string;
  /** duração exibida no botão — a mesma que o YouTube mostra (segundos arredondados PRA CIMA), ex.: "1:09" */
  duracao: string;
  /** capa da aula (public/aulas) — a cartela da própria aula, com o nome da ferramenta */
  capa: string;
};

export const AULAS_VIDEO: Record<string, AulaVideo> = {
  '/tools/decupagem': { id: 'nqAZUvZypP8', titulo: 'Como usar o Remover Silêncios', duracao: '1:06', capa: '/aulas/remover.jpg' },
  '/tools/tipografia': { id: 'Gz9-QA5PAcA', titulo: 'Como usar as Legendas Automáticas', duracao: '1:24', capa: '/aulas/legendas.jpg' },
  '/tools/copy-srt': { id: '4CnlbQWq134', titulo: 'Como usar o Gerador de SRT', duracao: '1:15', capa: '/aulas/srt.jpg' },
  '/tools/fakepass': { id: 'u3VwYcmCEmw', titulo: 'Como usar o FakePrint', duracao: '1:00', capa: '/aulas/fakeprint.jpg' },
  '/tools/downloader': { id: 'GUlIdTZ4K9Y', titulo: 'Como instalar e usar o Downloader', duracao: '1:33', capa: '/aulas/downloader.jpg' },
  '/tools/camuflagem': { id: 'hGhAFqtVRzA', titulo: 'Como usar a Camuflagem de Áudio', duracao: '1:09', capa: '/aulas/camuflagem.jpg' },
  '/tools/compressor': { id: 'eMVG-gb7dRY', titulo: 'Como usar o Compressor', duracao: '1:00', capa: '/aulas/compressor.jpg' },
  '/tools/audio-split': { id: 'nSiGlRFSlzQ', titulo: 'Como usar o Dividir Voz', duracao: '0:47', capa: '/aulas/dividir.jpg' },
  '/tools/acelerador': { id: '79dVqhj6oXo', titulo: 'Como usar o Mixer de Velocidade', duracao: '0:43', capa: '/aulas/mixer.jpg' },
  '/tools/normalizador': { id: '6bc9VEOAZB0', titulo: 'Como usar o Normalizador de Áudio', duracao: '0:52', capa: '/aulas/normalizador.jpg' },
  '/tools/lipsync': { id: '', titulo: 'Como usar o Lipsync Video to Video', duracao: '0:51', capa: '/aulas/lipsync.jpg' },
  '/configuracoes/api': { id: '', titulo: 'Como configurar as Chaves de IA', duracao: '2:03', capa: '/aulas/chaves.jpg' },
};

/** Aula da rota, só se o vídeo já foi publicado (id preenchido). */
export function aulaDaRota(path: string | null | undefined): AulaVideo | null {
  if (!path) return null;
  const a = AULAS_VIDEO[path];
  return a && a.id ? a : null;
}
