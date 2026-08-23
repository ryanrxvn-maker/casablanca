/**
 * AUTO CORTES — contrato de tipos (v1).
 *
 * Este arquivo é a ÚNICA fonte de verdade dos dados que circulam entre
 * ingestão → áudio → ASR → análise (Claude) → reenquadro → render → store → UI.
 * Estruturado pelo Fable 5 (22.08.2026); ver docs/auto-cortes/ARQUITETURA.md.
 *
 * Regras:
 * - Tempo em MILISSEGUNDOS (`Ms`) em tudo que é transcrição/legenda (compatível com
 *   lib/typography: TWord/Block) e em SEGUNDOS (`Sec`) só onde o ffmpeg/WebCodecs
 *   falam em segundos (cortes de mídia). O sufixo do campo diz a unidade.
 * - Nada aqui importa React nem DOM — é compartilhado por rotas, libs e testes.
 * - O modelo de IA NUNCA devolve timestamp cru: ele referencia ids de frase
 *   (`SentenceId`), e o código resolve pra tempo. Ver `Candidate`.
 */

import type { Block, TWord } from '../typography/engine';

export type Ms = number;
export type Sec = number;

// ───────────────────────────────────────────────────────────────────────────
// Configuração do pré-disparo
// ───────────────────────────────────────────────────────────────────────────

export type AspectRatio = '9:16' | '4:5' | '1:1' | '16:9';

export const ASPECT_OUTPUT: Record<AspectRatio, { w: number; h: number }> = {
  '9:16': { w: 1080, h: 1920 },
  '4:5': { w: 1080, h: 1350 },
  '1:1': { w: 1080, h: 1080 },
  '16:9': { w: 1920, h: 1080 },
};

/** Mesmas faixas do Opus Clip (+ auto com viés 30–90 s). */
export type ClipLengthPreset = 'auto' | 'lt30' | '30-59' | '60-89' | '90-180' | '180-300';

export const CLIP_LENGTH_RANGE_SEC: Record<ClipLengthPreset, { min: Sec; max: Sec; ideal: Sec }> = {
  auto: { min: 20, max: 180, ideal: 60 },
  lt30: { min: 8, max: 30, ideal: 22 },
  '30-59': { min: 30, max: 59, ideal: 45 },
  '60-89': { min: 60, max: 89, ideal: 75 },
  '90-180': { min: 90, max: 180, ideal: 120 },
  '180-300': { min: 180, max: 300, ideal: 220 },
};

export type ClipCountPreset = 'auto' | 5 | 10 | 15 | 20 | 30;

/** Gêneros do Opus Clip, em PT. `auto` = o modelo infere pelo conteúdo. */
export type Genre =
  | 'auto'
  | 'podcast'
  | 'entrevista' // "Perguntas e respostas"
  | 'comentario'
  | 'marketing'
  | 'webinar'
  | 'motivacional'
  | 'academico'
  | 'lista'
  | 'review'
  | 'tutorial'
  | 'comedia'
  | 'esporte'
  | 'igreja'
  | 'noticias'
  | 'vlog'
  | 'games'
  | 'outros';

export const GENRE_LABEL: Record<Genre, string> = {
  auto: 'Automático',
  podcast: 'Podcast',
  entrevista: 'Perguntas e respostas',
  comentario: 'Comentário',
  marketing: 'Marketing',
  webinar: 'Webinar',
  motivacional: 'Discurso motivacional',
  academico: 'Acadêmico / aula',
  lista: 'Lista',
  review: 'Avaliação de produto',
  tutorial: 'Tutorial',
  comedia: 'Comédia',
  esporte: 'Comentário esportivo',
  igreja: 'Igreja / pregação',
  noticias: 'Notícias',
  vlog: 'Vlog',
  games: 'Jogos',
  outros: 'Outros',
};

export type ReframeMode = 'auto' | 'seguir' | 'dividir' | 'centro' | 'ajustar';

export type HeadlineDuration = 'todo' | 'primeiros5s';

export type CaptionPace = 'palavra' | 'rapido' | 'equilibrado' | 'frases';

export type ClipSettings = {
  aspect: AspectRatio;
  length: ClipLengthPreset;
  count: ClipCountPreset;
  genre: Genre;
  /** ISO-639-1 ('pt', 'en'…) ou 'auto'. */
  language: string;
  /** id de preset de lib/typography ou null = sem legenda. */
  captionPresetId: string | null;
  captionPace: CaptionPace;
  /** id de preset da lista HEADLINE_PRESETS ou null = sem headline. */
  headlinePresetId: string | null;
  headlineDuration: HeadlineDuration;
  reframe: ReframeMode;
  /** "Incluir momentos específicos" (texto livre do cliente). */
  focusPrompt: string;
  /** Trecho do vídeo a analisar (segundos absolutos); null = tudo. */
  range: { startSec: Sec; endSec: Sec } | null;
  /** P2 — remover pausas > 1,2 s dentro do corte. */
  removePauses: boolean;
};

export const DEFAULT_CLIP_SETTINGS: ClipSettings = {
  aspect: '9:16',
  length: 'auto',
  count: 'auto',
  genre: 'auto',
  language: 'auto',
  captionPresetId: 'vermelho-sangue',
  captionPace: 'rapido',
  headlinePresetId: 'hl-caixa-branca',
  headlineDuration: 'todo',
  reframe: 'auto',
  focusPrompt: '',
  range: null,
  removePauses: false,
};

// ───────────────────────────────────────────────────────────────────────────
// Fonte
// ───────────────────────────────────────────────────────────────────────────

export type SourceKind = 'upload' | 'youtube' | 'drive' | 'url';

export type SourceRef = {
  kind: SourceKind;
  /** URL original (links) ou null (upload). */
  url: string | null;
  /** Nome do arquivo (pra título do projeto e do ZIP). */
  name: string;
  sizeBytes: number;
  /** Assinatura `nome:tamanho:lastModified` usada pra reconhecer o MESMO upload após F5. */
  signature: string;
  /** Caminho no OPFS quando o arquivo foi baixado por link (persistente). */
  opfsPath: string | null;
  durationSec: Sec | null;
  width: number | null;
  height: number | null;
};

// ───────────────────────────────────────────────────────────────────────────
// Transcrição
// ───────────────────────────────────────────────────────────────────────────

export type Word = TWord; // { text; start: Ms; end: Ms }

export type SentenceId = string; // 'S0001'

export type Sentence = {
  id: SentenceId;
  startMs: Ms;
  endMs: Ms;
  text: string;
  /** índices inclusivos em Transcript.words */
  wordFrom: number;
  wordTo: number;
};

export type Transcript = {
  words: Word[];
  sentences: Sentence[];
  /** idioma detectado/forçado (ISO-639-1) */
  language: string;
  provider: string;
  /** hash estável (words+language) pra cache de análise */
  hash: string;
};

export type AudioChunkPlan = { idx: number; startSec: Sec; durSec: Sec };

export type ChunkWords = { idx: number; startSec: Sec; durSec: Sec; words: Word[] };

// ───────────────────────────────────────────────────────────────────────────
// Análise (Claude) — MAP → REDUCE
// ───────────────────────────────────────────────────────────────────────────

export type ScoreBreakdown = {
  /** força do gancho nos primeiros 3 s (0-100) */
  hook: number;
  /** valor percebido / insight (0-100) */
  value: number;
  /** emoção / energia (0-100) */
  emotion: number;
  /** completude: começa e termina sem deixar pergunta no ar (0-100) */
  completeness: number;
  /** compartilhabilidade / citabilidade (0-100) */
  shareability: number;
};

/** Saída do MAP — 1 por momento encontrado numa janela. Referencia frases, nunca tempo. */
export type Candidate = {
  /** id local da janela (o reduce usa pra dedup) — preenchido pelo servidor, não pelo modelo */
  id: string;
  startId: SentenceId;
  endId: SentenceId;
  /** frase que funciona como gancho (normalmente = startId; pode ser outra se o corte deveria começar nela) */
  hookId: SentenceId;
  topic: string;
  /** por que esse trecho funciona sozinho, em 1 frase */
  why: string;
  scores: ScoreBreakdown;
  /** tipo do momento (pra diversidade no reduce) */
  kind:
    | 'historia'
    | 'opiniao_forte'
    | 'insight'
    | 'dica_pratica'
    | 'polemica'
    | 'humor'
    | 'numero_prova'
    | 'pergunta_resposta'
    | 'emocional'
    | 'outro';
};

export type MapResult = { candidates: Omit<Candidate, 'id'>[] };

/** Candidato já resolvido pra tempo (servidor), após filtro de faixa e dedup. */
export type ResolvedCandidate = Candidate & {
  startMs: Ms;
  endMs: Ms;
  durationSec: Sec;
  firstSentence: string;
  lastSentence: string;
};

/** Saída do REDUCE — 1 por corte escolhido. */
export type ClipPlan = {
  /** id do candidato escolhido (ResolvedCandidate.id) */
  candidateId: string;
  /** título pro post (≤ 70 caracteres) */
  title: string;
  /** headline queimada no vídeo (≤ 8 palavras, ≤ 2 linhas) */
  headline: string;
  /** gancho em 1 frase curta (texto da abertura, pode ser usado como legenda do post) */
  hook: string;
  /** descrição do post (2-3 linhas) — sem hashtags */
  description: string;
  /** exatamente 5, sem '#' */
  hashtags: string[];
  /** 0-99, ranking RELATIVO dentro do vídeo */
  score: number;
  scoreBreakdown: ScoreBreakdown;
  /** explicação curta mostrada no card ("Por que esse corte") */
  why: string;
  /** ajuste de borda sugerido pelo modelo em nº de FRASES (±2), resolvido pelo código */
  extendStartSentences: number;
  extendEndSentences: number;
};

export type ReduceResult = { clips: ClipPlan[] };

// ───────────────────────────────────────────────────────────────────────────
// Reenquadro
// ───────────────────────────────────────────────────────────────────────────

/** Caixa em coordenadas NORMALIZADAS da fonte (0..1). */
export type NormBox = { x: number; y: number; w: number; h: number };

export type FaceSample = { tSec: Sec; faces: Array<NormBox & { score: number }> };

export type CropKeyframe = { tSec: Sec; box: NormBox };

export type CropPlan =
  | { layout: 'single'; mode: Exclude<ReframeMode, 'auto' | 'dividir'>; keyframes: CropKeyframe[] }
  | {
      layout: 'split';
      /** caixa de cada pessoa (em cada instante); sempre 2 */
      tracks: [CropKeyframe[], CropKeyframe[]];
    }
  | { layout: 'fit' }
  | { layout: 'none' };

// ───────────────────────────────────────────────────────────────────────────
// Corte (estado completo, persistido)
// ───────────────────────────────────────────────────────────────────────────

export type RenderStatus =
  | 'pendente'
  | 'cortando'
  | 'enquadrando'
  | 'renderizando'
  | 'audio'
  | 'pronto'
  | 'erro';

export type Clip = {
  id: string; // 'c01'…
  rank: number; // 1 = melhor
  plan: ClipPlan;
  /** tempos finais ABSOLUTOS (após refineBounds e edições do cliente) */
  startMs: Ms;
  endMs: Ms;
  /** legendas já deslocadas pra t=0 do corte */
  captionBlocks: Block[];
  cropPlan: CropPlan | null;
  renderStatus: RenderStatus;
  renderProgress: number; // 0..1
  renderError: string | null;
  /** chaves do store de blobs (IDB) */
  blobKey: string | null;
  thumbKey: string | null;
  outputBytes: number | null;
  /** qual caminho de decode rodou (QA) */
  renderMode: 'decode' | 'seek' | null;
  /** edições manuais do cliente sobrevivem a "renderizar de novo" */
  edited: { title?: string; headline?: string; startMs?: Ms; endMs?: Ms } | null;
};

// ───────────────────────────────────────────────────────────────────────────
// Projeto (registro do IDB)
// ───────────────────────────────────────────────────────────────────────────

export type ProjectPhase =
  | 'fonte' // aguardando arquivo/link
  | 'baixando'
  | 'audio'
  | 'transcrevendo'
  | 'analisando'
  | 'renderizando'
  | 'pronto'
  | 'erro';

export type ProjectWarning = { at: number; stage: ProjectPhase; message: string };

export type Project = {
  id: string;
  createdAt: number;
  updatedAt: number;
  source: SourceRef;
  settings: ClipSettings;
  phase: ProjectPhase;
  /** progresso 0..1 da fase atual + texto humano ("Transcrevendo 4/12") */
  progress: { ratio: number; label: string };
  transcript: Transcript | null;
  /** hash(settings que afetam análise + transcript.hash) — cache do reduce */
  analysisKey: string | null;
  candidates: ResolvedCandidate[];
  clips: Clip[];
  warnings: ProjectWarning[];
  lastError: string | null;
  /**
   * Fase em que o erro aconteceu (só quando `phase === 'erro'`). É o que o
   * "Retomar" usa pra voltar EXATAMENTE pro passo que faltava em vez de
   * recomeçar o vídeo inteiro. Campo aditivo (B1, 22.08).
   */
  errorPhase?: ProjectPhase;
};

// ───────────────────────────────────────────────────────────────────────────
// Rota /api/auto-cortes/analyze — UMA chamada por passo (o navegador orquestra).
// Motivo: função da Vercel tem teto de 300 s; map de 10 janelas + reduce numa
// chamada só estouraria. Cada request faz 1 janela (map) ou o reduce.
// ───────────────────────────────────────────────────────────────────────────

export type AnalyzeSettings = Pick<ClipSettings, 'length' | 'count' | 'genre' | 'language' | 'focusPrompt'>;

export type AnalyzeMapRequest = {
  op: 'map';
  windowIdx: number;
  windowTotal: number;
  /** só as frases da janela (já com overlap aplicado pelo cliente) */
  sentences: Sentence[];
  settings: AnalyzeSettings;
  source: { name: string; durationSec: Sec };
};

export type AnalyzeReduceRequest = {
  op: 'reduce';
  candidates: ResolvedCandidate[];
  settings: AnalyzeSettings;
  source: { name: string; durationSec: Sec };
  /** nº final de cortes já resolvido pelo cliente (auto → autoClipCount) */
  count: number;
};

export type AnalyzeRequest = AnalyzeMapRequest | AnalyzeReduceRequest;

export type AnalyzeMapResponse = {
  op: 'map';
  windowIdx: number;
  candidates: ResolvedCandidate[];
  model: string;
  usage: { inputTokens: number; outputTokens: number };
};

export type AnalyzeReduceResponse = {
  op: 'reduce';
  clips: ClipPlan[];
  model: string;
  usage: { inputTokens: number; outputTokens: number };
};

export type AnalyzeErrorResponse = { error: string; showConfig?: boolean; retryAfterSec?: number };

/** Progresso emitido pelo orquestrador do navegador (analyze-client.ts). */
export type AnalyzeProgress =
  | { stage: 'map'; done: number; total: number; candidatesSoFar: number }
  | { stage: 'reduce' }
  | { stage: 'warning'; message: string };

// ───────────────────────────────────────────────────────────────────────────
// Ponte com a extensão (v1.8.0) — mensagens window.postMessage
// page → ext: source 'darko-dl'   |   ext → page: source 'darko-dl-ext'
// ───────────────────────────────────────────────────────────────────────────

export type ExtFetchKind = 'engine' | 'drive';

export type ExtFetchRequest = {
  type: 'DL_FETCH';
  reqId: string;
  url: string;
  kind: ExtFetchKind;
  mode: 'video';
  quality: '1080';
};

export type ExtFetchEvent =
  | { type: 'DL_FETCH_META'; reqId: string; filename: string; size: number | null; mime: string }
  | { type: 'DL_FETCH_CHUNK'; reqId: string; idx: number; buf: ArrayBuffer }
  /** pulso do SW (5 s) — o Motor roda o yt-dlp inteiro antes do 1º byte; sem isso o watchdog mataria download saudável */
  | { type: 'DL_FETCH_PROGRESS'; reqId: string; received: number; total: number | null; phase: 'preparando' | 'baixando' }
  | { type: 'DL_FETCH_DONE'; reqId: string; total: number; chunks: number }
  | { type: 'DL_FETCH_ERROR'; reqId: string; error: string };

export const AUTO_CORTES_MIN_EXT_VERSION = [1, 8, 0] as const;

// ───────────────────────────────────────────────────────────────────────────
// Limites
// ───────────────────────────────────────────────────────────────────────────

export const LIMITS = {
  maxInputBytes: 4 * 1024 * 1024 * 1024, // 4 GB
  maxDurationSec: 4 * 3600,
  audioChunkSec: 540,
  audioChunkOverlapSec: 3,
  audioChunkMaxBytes: 4_200_000,
  asrConcurrency: 4,
  analyzeWindowSec: 720,
  analyzeWindowOverlapSec: 90,
  analyzeMapConcurrency: 2,
  renderConcurrency: 2,
  cutLeadSec: 6, // margem antes do corte no -c copy (keyframe)
  cutTailSec: 1,
  driveServerFallbackMaxBytes: 800 * 1024 * 1024,
  minClips: 3,
  maxClips: 30,
} as const;

export function autoClipCount(durationSec: Sec): number {
  const n = Math.round(durationSec / 360);
  return Math.max(LIMITS.minClips, Math.min(LIMITS.maxClips, n));
}
