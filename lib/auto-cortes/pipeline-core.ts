/**
 * AUTO CORTES — máquina de estados do projeto (NÚCLEO PURO).
 *
 * Aqui mora TODA a orquestração: ordem das fases, persistência, fila de render
 * com gate que auto-cura, retomada, cancelamento, ZIP. Nada aqui toca DOM,
 * IndexedDB, ffmpeg ou rede: tudo isso entra por `PipelineDeps` (injeção), o
 * que deixa o comportamento inteiro testável em Node (`pipeline.test.ts`).
 * O arquivo `pipeline.ts` é só a fiação com os módulos reais do navegador.
 *
 * Máquina:
 *   fonte → baixando → audio → transcrevendo → analisando → renderizando → pronto
 *   (qualquer ponto → erro, guardando em `errorPhase` de onde retomar)
 *
 * Regras que NÃO podem regredir ([[feedback_blindagem_fluxos]]):
 *  1. PERSISTIR CEDO — o projeto nasce salvo, toda transição salva na hora e o
 *     progresso salva com debounce de 300 ms (com flush garantido nas
 *     transições, no cancelamento e no destroy). F5 nunca perde trabalho.
 *  2. RETOMÁVEL DE QUALQUER FASE — `execute()` pula o que já está pronto:
 *     transcrição existe → vai pra análise; cortes existem → só renderiza o que
 *     falta. Nenhum estado travado sem botão que funcione.
 *  3. ERRO DE UM CORTE NÃO DERRUBA O LOTE — retry 1× por corte e, se insistir,
 *     `renderStatus: 'erro'` naquele card enquanto os outros seguem.
 *  4. GATE QUE AUTO-CURA — a pista que sumir por 30 s tem o corte devolvido pra
 *     fila e é substituída, pra fila nunca ficar presa por uma pista morta.
 *  5. ESPERA NUNCA POR `setTimeout` DE TRABALHO — `deps.sleep` (relógio de
 *     Worker) pra aba em 2º plano não estrangular o watchdog.
 */

import {
  DEFAULT_CLIP_SETTINGS,
  LIMITS,
  type Clip,
  type ClipSettings,
  type CropPlan,
  type Project,
  type ProjectPhase,
  type ProjectWarning,
  type RenderStatus,
  type ResolvedCandidate,
  type SourceRef,
  type Transcript,
} from './types';

// ───────────────────────────────────────────────────────────────────────────
// Constantes de orquestração
// ───────────────────────────────────────────────────────────────────────────

/** Debounce da gravação de progresso (transições salvam na hora). */
export const PERSIST_DEBOUNCE_MS = 300;
/** De quanto em quanto tempo o watchdog olha as pistas de render. */
export const WATCHDOG_TICK_MS = 5_000;
/** Sem batimento por mais que isso, a pista é dada como órfã. */
export const WATCHDOG_STALE_MS = 30_000;
/** Tentativas por corte (1 original + 1 retry). */
export const CLIP_ATTEMPTS = 2;

// ───────────────────────────────────────────────────────────────────────────
// Contrato público (o agente da UI programa contra isto)
// ───────────────────────────────────────────────────────────────────────────

export type PipelineSource = { kind: 'upload'; file: File } | { kind: 'link'; url: string };

export type Pipeline = {
  getState(): Project;
  subscribe(fn: (p: Project) => void): () => void;
  start(args: { settings: ClipSettings; source: PipelineSource }): Promise<void>;
  /** Retoma da fase persistida (pula o que já está pronto). */
  resume(): Promise<void>;
  /** Aborta o que estiver rodando; o que já foi persistido continua lá. */
  cancel(): void;
  /** Depois de um F5 em projeto de upload: valida a assinatura do arquivo. */
  attachFile(file: File): { ok: true } | { ok: false; reason: string };
  /** true = a fonte era upload e o File não está mais em memória. */
  needsFile(): boolean;
  /** Refaz a seleção de cortes mantendo a transcrição. */
  reanalyze(settingsPatch?: Partial<ClipSettings>): Promise<void>;
  rerenderClip(clipId: string): Promise<void>;
  /** Troca legenda/headline/proporção sem re-transcrever nem re-analisar. */
  rerenderAll(settingsPatch: Partial<ClipSettings>): Promise<void>;
  /** Título/headline/bordas editados pelo cliente (persiste; não renderiza). */
  updateClip(clipId: string, patch: NonNullable<Clip['edited']>): void;
  getClipBlob(clipId: string): Promise<Blob | null>;
  /** Object URL cacheada da miniatura (revogada no destroy). */
  getThumbUrl(clipId: string): Promise<string | null>;
  buildSrt(clipId: string): string;
  buildZip(onProgress?: (ratio: number) => void): Promise<Blob>;
  destroy(): void;
};

// ───────────────────────────────────────────────────────────────────────────
// Dependências injetadas
// ───────────────────────────────────────────────────────────────────────────

export type CaptionBlocks = Clip['captionBlocks'];
export type Words = Transcript['words'];

export type IngestProgressLite = { ratio: number | null; label: string };

export type TranscribeProgressLite = { stage: 'audio' | 'asr'; done: number; total: number };

export type AnalyzeProgressLite =
  | { stage: 'map'; done: number; total: number; candidatesSoFar: number }
  | { stage: 'reduce' }
  | { stage: 'warning'; message: string };

export type AnalyzeOutcomeLite = {
  candidates: ResolvedCandidate[];
  clips: Array<{ plan: Clip['plan']; startMs: number; endMs: number }>;
  warnings: string[];
};

/** Uma instância do pool com a FONTE já montada (WORKERFS) — reusada entre cortes. */
export type RenderLane = {
  /** Corta `[startSec, endSec]` sem re-encode e devolve o pts absoluto do 1º frame. */
  cut(startSec: number, endSec: number): Promise<{ blob: Blob; firstPts: number }>;
  /** Áudio AAC do trecho (tempos RELATIVOS ao clipe cortado). */
  audio(clip: Blob, startSec: number, durSec: number): Promise<Blob>;
  close(): Promise<void>;
};

export type RenderJob = {
  clipId: string;
  absStart: number;
  absEnd: number;
  clipBlob: Blob;
  clipFirstPts: number;
  settings: ClipSettings;
  srcW: number;
  srcH: number;
  captionBlocks: CaptionBlocks;
  headline: string;
  audio: Blob | null;
  /** batimento + progresso; `stage` alimenta o card. */
  onStage: (stage: RenderStatus, ratio: number) => void;
  signal: AbortSignal;
};

export type RenderOutput = {
  blob: Blob;
  /** miniatura definitiva (já com o enquadro final); null = mantém a provisória */
  thumb: Blob | null;
  cropPlan: CropPlan | null;
  mode: 'decode' | 'seek' | null;
};

export type ThumbJob = {
  clipBlob: Blob;
  clipFirstPts: number;
  tAbs: number;
  absStart: number;
  settings: ClipSettings;
  srcW: number;
  srcH: number;
  captionBlocks: CaptionBlocks;
  headline: string;
  cropPlan: CropPlan | null;
};

export type RenderEngine = {
  /** Abre o lote (garante fontes, guarda a fonte). */
  begin(o: { file: File; source: SourceRef; settings: ClipSettings; signal: AbortSignal }): Promise<void>;
  /** Uma pista = uma instância do pool com a fonte montada. */
  lane(): Promise<RenderLane>;
  /** Dimensões REAIS da fonte, lidas de um clipe já cortado. */
  probeSize(clip: Blob): Promise<{ width: number; height: number } | null>;
  /** Miniatura barata (um seek) — o grid aparece antes do render terminar. */
  thumb(job: ThumbJob): Promise<Blob | null>;
  /** Reenquadro + composição + legenda/headline + mux + validação do MP4. */
  run(job: RenderJob): Promise<RenderOutput>;
  end(): Promise<void>;
};

export type ZipEntryLite = { name: string; data: Blob | Uint8Array };

export type PipelineDeps = {
  store: {
    saveProject(p: Project): Promise<void>;
    loadProject(id: string): Promise<Project | null>;
    saveBlob(key: string, blob: Blob, projectId: string): Promise<void>;
    loadBlob(key: string): Promise<Blob | null>;
    deleteBlob(key: string): Promise<void>;
    prune(opts: { keep?: string }): Promise<unknown>;
  };
  keys: {
    clip(projectId: string, clipId: string): string;
    thumb(projectId: string, clipId: string): string;
  };
  ingest: {
    link(
      url: string,
      o: {
        projectId: string;
        onProgress?: (p: IngestProgressLite) => void;
        onWarn?: (m: string) => void;
        signal?: AbortSignal;
      },
    ): Promise<{ file: File; source: SourceRef }>;
    upload(file: File): Promise<SourceRef>;
    signature(file: File): string;
    fromOpfs(path: string): Promise<File | null>;
  };
  transcribe(
    file: File,
    o: {
      durationSec: number;
      language: string;
      onProgress?: (p: TranscribeProgressLite) => void;
      onWarning?: (m: string) => void;
      onDuration?: (durationSec: number) => void;
      signal?: AbortSignal;
    },
  ): Promise<Transcript>;
  analyze(
    input: {
      transcript: Transcript;
      settings: ClipSettings;
      source: { name: string; durationSec: number };
      /** fonte montável — o curador local tira daqui o envelope de energia */
      file: File;
    },
    o: { onProgress?: (p: AnalyzeProgressLite) => void; signal?: AbortSignal },
  ): Promise<AnalyzeOutcomeLite>;
  engine: RenderEngine;
  captions(words: Words, startMs: number, endMs: number, pace: ClipSettings['captionPace']): CaptionBlocks;
  srt(blocks: CaptionBlocks): string;
  zip(entries: ZipEntryLite[]): Promise<Blob>;
  logHistory(ev: { tool: string; title: string; kind?: string; meta?: string }): void;
  /** Espera imune ao throttle de aba em 2º plano. */
  sleep(ms: number): Promise<void>;
  now(): number;
  objectUrl: { create(b: Blob): string; revoke(u: string): void };
  /** Erro cru → texto PT-BR acionável. */
  friendly(e: unknown, fallback: string): string;
  isCancel(e: unknown): boolean;
  /** Cria um erro cuja mensagem já é amigável. */
  makeError(message: string): Error;
};

// ───────────────────────────────────────────────────────────────────────────
// Projeto em branco
// ───────────────────────────────────────────────────────────────────────────

export function newProjectId(): string {
  return `ac_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function emptySource(): SourceRef {
  return {
    kind: 'upload',
    url: null,
    name: '',
    sizeBytes: 0,
    signature: '',
    opfsPath: null,
    durationSec: null,
    width: null,
    height: null,
  };
}

export function emptyProject(id: string, now = Date.now()): Project {
  return {
    id,
    createdAt: now,
    updatedAt: now,
    source: emptySource(),
    settings: { ...DEFAULT_CLIP_SETTINGS },
    phase: 'fonte',
    progress: { ratio: 0, label: 'Escolha o vídeo' },
    transcript: null,
    analysisKey: null,
    candidates: [],
    clips: [],
    warnings: [],
    lastError: null,
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Utilidades puras
// ───────────────────────────────────────────────────────────────────────────

/** Bordas EFETIVAS do corte (a edição manual do cliente manda). */
export function effectiveBounds(clip: Clip): { startMs: number; endMs: number } {
  const startMs = clip.edited?.startMs ?? clip.startMs;
  const endMs = clip.edited?.endMs ?? clip.endMs;
  return endMs > startMs ? { startMs, endMs } : { startMs: clip.startMs, endMs: clip.endMs };
}

export function clipTitle(clip: Clip): string {
  return (clip.edited?.title ?? clip.plan.title ?? '').trim() || `Corte ${clip.rank}`;
}

export function clipHeadline(clip: Clip): string {
  return (clip.edited?.headline ?? clip.plan.headline ?? '').trim();
}

/** Nome de arquivo seguro em Windows/macOS/Linux (o ZIP abre em qualquer um). */
export function safeFileName(s: string, max = 60): string {
  const clean = String(s ?? '')
    .replace(/[\\/:*?"<>| -]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
    .replace(/[. ]+$/, '');
  return clean || 'corte';
}

export function formatClock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Nome legível pra um link (só pro projeto não nascer "sem nome"). */
export function nameFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const last = u.pathname.split('/').filter(Boolean).pop();
    if (last && /\.[a-z0-9]{2,5}$/i.test(last)) return decodeURIComponent(last);
    return u.hostname.replace(/^www\./, '');
  } catch {
    return 'vídeo';
  }
}

/** Chave de cache da análise: transcrição + o que muda a seleção de cortes. */
export function analysisKeyOf(transcript: Transcript | null, s: ClipSettings): string | null {
  if (!transcript) return null;
  return [transcript.hash, s.length, String(s.count), s.genre, s.language, s.focusPrompt || ''].join('|');
}

function pct(done: number, total: number): number {
  if (!(total > 0)) return 0;
  return Math.max(0, Math.min(1, done / total));
}

// ───────────────────────────────────────────────────────────────────────────
// A máquina
// ───────────────────────────────────────────────────────────────────────────

export type CreateCoreOptions = {
  projectId: string;
  /** Estado já carregado do IDB (senão nasce um projeto novo). */
  initial?: Project | null;
  getFile?: () => File | null;
  deps: PipelineDeps;
};

export function createPipelineCore(opts: CreateCoreOptions): Pipeline {
  const { deps, projectId } = opts;

  let project: Project = opts.initial ?? emptyProject(projectId, deps.now());
  if (project.id !== projectId) project = { ...project, id: projectId };

  const subs = new Set<(p: Project) => void>();
  const thumbUrls = new Map<string, { key: string; url: string }>();

  let heldFile: File | null = null;
  let pendingUpload: File | null = null;
  let running: Promise<void> | null = null;
  let runCtrl: AbortController | null = null;
  let destroyed = false;

  let saveTimer: ReturnType<typeof setTimeout> | null = null;

  // ── estado / persistência ────────────────────────────────────────────────

  function emit(): void {
    for (const fn of Array.from(subs)) {
      try {
        fn(project);
      } catch (e) {
        console.warn('[auto-cortes] assinante do pipeline lançou (ignorado):', e);
      }
    }
  }

  async function persistNow(): Promise<void> {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    const snap = project;
    try {
      await deps.store.saveProject(snap);
    } catch (e) {
      // Persistir é blindagem, não pode virar erro do cliente. O próximo save
      // (debounce/transição) tenta de novo.
      console.warn('[auto-cortes] não consegui salvar o projeto agora:', e);
    }
  }

  function schedulePersist(): void {
    if (destroyed || saveTimer) return;
    saveTimer = setTimeout(() => {
      saveTimer = null;
      void persistNow();
    }, PERSIST_DEBOUNCE_MS);
  }

  /** Aplica a mudança num CLONE (o assinante recebe objeto novo) e persiste. */
  function mutate(fn: (p: Project) => void, flush = false): void {
    const next: Project = { ...project };
    fn(next);
    next.updatedAt = deps.now();
    project = next;
    emit();
    if (flush) void persistNow();
    else schedulePersist();
  }

  function setPhase(phase: ProjectPhase, label: string, ratio = 0): void {
    mutate((p) => {
      p.phase = phase;
      p.progress = { ratio, label };
      if (phase !== 'erro') {
        p.lastError = null;
        delete p.errorPhase;
      }
    }, true);
  }

  function setProgress(ratio: number, label: string, phase?: ProjectPhase): void {
    if (phase && phase !== project.phase) {
      setPhase(phase, label, ratio);
      return;
    }
    mutate((p) => {
      p.progress = { ratio: Math.max(0, Math.min(1, ratio)), label };
    });
  }

  function addWarning(message: string): void {
    const msg = String(message || '').trim();
    if (!msg) return;
    if (project.warnings.some((w) => w.message === msg)) return;
    mutate((p) => {
      p.warnings = [...p.warnings, { at: deps.now(), stage: p.phase, message: msg } as ProjectWarning].slice(-40);
    });
  }

  function patchClip(clipId: string, patch: Partial<Clip>, flush = false): void {
    mutate((p) => {
      p.clips = p.clips.map((c) => (c.id === clipId ? { ...c, ...patch } : c));
    }, flush);
  }

  function findClip(clipId: string): Clip | null {
    return project.clips.find((c) => c.id === clipId) ?? null;
  }

  function currentFile(): File | null {
    if (heldFile) return heldFile;
    const f = opts.getFile?.() ?? null;
    if (f) heldFile = f;
    return f;
  }

  function captionsFor(clip: Clip): CaptionBlocks {
    const words = project.transcript?.words ?? [];
    if (words.length === 0) return clip.captionBlocks ?? [];
    const b = effectiveBounds(clip);
    return deps.captions(words, b.startMs, b.endMs, project.settings.captionPace);
  }

  // ── ciclo de vida do run ─────────────────────────────────────────────────

  function abortRun(): void {
    try {
      runCtrl?.abort();
    } catch {
      /* já abortado */
    }
  }

  /** Cancela e ESPERA o run anterior morrer (toda ação pública passa por aqui). */
  async function stopAndWait(): Promise<void> {
    abortRun();
    const p = running;
    if (p) {
      try {
        await p;
      } catch {
        /* o próprio execute já tratou */
      }
    }
  }

  async function clearClipArtifacts(clips: Clip[]): Promise<void> {
    for (const c of clips) {
      for (const key of [c.blobKey, c.thumbKey]) {
        if (!key) continue;
        try {
          await deps.store.deleteBlob(key);
        } catch {
          /* lixo no store não pode travar o cliente */
        }
      }
      const cached = thumbUrls.get(c.id);
      if (cached) {
        try {
          deps.objectUrl.revoke(cached.url);
        } catch {
          /* ignora */
        }
        thumbUrls.delete(c.id);
      }
    }
  }

  // ── fase: fonte ──────────────────────────────────────────────────────────

  async function ensureFile(signal: AbortSignal): Promise<File> {
    if (pendingUpload) {
      const f = pendingUpload;
      pendingUpload = null;
      const ref = await deps.ingest.upload(f);
      heldFile = f;
      mutate((p) => {
        p.source = ref;
      }, true);
      return f;
    }

    const held = currentFile();
    if (held) return held;

    const src = project.source;
    if (src.opfsPath) {
      // Fonte de LINK: o arquivo está em disco (OPFS) e volta sozinho no F5.
      try {
        const f = await deps.ingest.fromOpfs(src.opfsPath);
        if (f && f.size > 0) {
          heldFile = f;
          return f;
        }
      } catch (e) {
        console.warn('[auto-cortes] não consegui reabrir a fonte do disco:', e);
      }
    }

    if (src.kind !== 'upload' && src.url) return downloadLink(src.url, signal);

    throw deps.makeError(
      `O arquivo saiu da memória quando a página recarregou. Selecione de novo o MESMO vídeo${
        src.name ? ` ("${src.name}")` : ''
      } — a transcrição e os cortes que já ficaram prontos continuam salvos.`,
    );
  }

  async function downloadLink(url: string, signal: AbortSignal): Promise<File> {
    setPhase('baixando', 'Conectando com o vídeo…', 0);
    const { file, source } = await deps.ingest.link(url, {
      projectId,
      signal,
      onWarn: addWarning,
      onProgress: (p) => setProgress(p.ratio ?? 0, p.label, 'baixando'),
    });
    heldFile = file;
    mutate((p) => {
      p.source = source;
    }, true);
    return file;
  }

  // ── fase: transcrição ────────────────────────────────────────────────────

  async function ensureTranscript(file: File, signal: AbortSignal): Promise<Transcript> {
    if (project.transcript && project.transcript.words.length > 0) return project.transcript;

    setPhase('audio', 'Preparando o áudio…', 0);
    const durationSec = project.source.durationSec ?? 0;
    const t = await deps.transcribe(file, {
      durationSec,
      language: project.settings.language,
      signal,
      onWarning: addWarning,
      onDuration: (sec) => {
        mutate((p) => {
          p.source.durationSec = sec;
        }, true);
      },
      onProgress: (p) => {
        if (p.stage === 'audio') {
          setProgress(pct(p.done, p.total), `Preparando o áudio ${p.done}/${p.total}`, 'audio');
        } else {
          setProgress(pct(p.done, p.total), `Transcrevendo ${p.done}/${p.total}`, 'transcrevendo');
        }
      },
    });
    mutate((p) => {
      p.transcript = t;
      p.progress = { ratio: 1, label: 'Transcrição pronta' };
    }, true);
    return t;
  }

  // ── fase: análise ────────────────────────────────────────────────────────

  function buildClips(finals: AnalyzeOutcomeLite['clips'], words: Words): Clip[] {
    const pace = project.settings.captionPace;
    return finals.map((f, i) => ({
      id: `c${String(i + 1).padStart(2, '0')}`,
      rank: i + 1,
      plan: f.plan,
      startMs: f.startMs,
      endMs: f.endMs,
      // As legendas são geradas SEMPRE (mesmo com "Sem legenda"): o SRT do ZIP
      // e o painel de transcrição usam os mesmos blocos; quem decide queimar
      // no vídeo é o overlay, lá no engine.
      captionBlocks: deps.captions(words, f.startMs, f.endMs, pace),
      cropPlan: null,
      renderStatus: 'pendente' as RenderStatus,
      renderProgress: 0,
      renderError: null,
      blobKey: null,
      thumbKey: null,
      outputBytes: null,
      renderMode: null,
      edited: null,
    }));
  }

  async function ensureClips(transcript: Transcript, file: File, signal: AbortSignal): Promise<void> {
    if (project.clips.length > 0) return;

    setPhase('analisando', 'Lendo a transcrição…', 0);
    const out = await deps.analyze(
      {
        transcript,
        settings: project.settings,
        source: { name: project.source.name || 'vídeo', durationSec: project.source.durationSec ?? 0 },
        file,
      },
      {
        signal,
        onProgress: (p) => {
          if (p.stage === 'map') {
            // 0-80 % no map, o resto é o reduce (que é 1 chamada só, mas longa)
            setProgress(pct(p.done, p.total) * 0.8, `Analisando trecho ${p.done} de ${p.total}`, 'analisando');
          } else if (p.stage === 'reduce') {
            setProgress(0.9, 'Escolhendo os melhores cortes…', 'analisando');
          }
          // 'warning' não entra aqui: o outcome já devolve a lista completa e
          // registrar nos dois lugares duplicaria o aviso na UI.
        },
      },
    );
    for (const w of out.warnings) addWarning(w);

    const clips = buildClips(out.clips, transcript.words);
    if (clips.length === 0) {
      throw deps.makeError(
        'Não encontrei nenhum trecho que funcione sozinho neste vídeo. Tente outra duração de corte ou descreva os momentos que você quer.',
      );
    }
    mutate((p) => {
      p.candidates = out.candidates;
      p.clips = clips;
      p.analysisKey = analysisKeyOf(transcript, p.settings);
      p.progress = { ratio: 1, label: `${clips.length} cortes encontrados` };
    }, true);
  }

  // ── fase: render (fila com gate que auto-cura) ───────────────────────────

  type Claim = { token: number; beat: number; ctrl: AbortController };

  async function renderPending(file: File, signal: AbortSignal): Promise<void> {
    const pendentes = project.clips.filter((c) => c.renderStatus !== 'pronto');
    if (pendentes.length === 0) return;

    // Corte que ficou em erro numa rodada anterior volta pra fila no "Retomar".
    mutate((p) => {
      p.clips = p.clips.map((c) =>
        c.renderStatus === 'pronto'
          ? c
          : { ...c, renderStatus: 'pendente' as RenderStatus, renderProgress: 0, renderError: null },
      );
    });

    const total = pendentes.length;
    setPhase('renderizando', `Renderizando 1 de ${total}`, 0);

    await deps.engine.begin({ file, source: project.source, settings: project.settings, signal });

    const claims = new Map<string, Claim>();
    const attempts = new Map<string, number>();
    let tokenSeq = 0;
    let done = 0;
    let finished = false;
    let laneError: unknown = null;
    let extraLanes = 0;
    let active = 0;
    let onIdle: (() => void) | null = null;

    const reportDone = () => {
      done++;
      setProgress(pct(done, total), `Renderizando ${Math.min(done + 1, total)} de ${total}`, 'renderizando');
    };

    const nextPending = (): Clip | null => {
      for (const c of project.clips) {
        if (c.renderStatus === 'pendente' && !claims.has(c.id)) return c;
      }
      return null;
    };

    const runClip = async (clip: Clip, lane: RenderLane, claim: Claim): Promise<'ok' | 'erro' | 'orfa'> => {
      const owns = () => claims.get(clip.id)?.token === claim.token;
      const beat = () => {
        const c = claims.get(clip.id);
        if (c && c.token === claim.token) c.beat = deps.now();
      };
      const stage = (st: RenderStatus, ratio: number) => {
        beat();
        if (owns()) patchClip(clip.id, { renderStatus: st, renderProgress: Math.max(0, Math.min(1, ratio)) });
      };

      const bounds = effectiveBounds(clip);
      const absStart = bounds.startMs / 1000;
      const absEnd = bounds.endMs / 1000;

      stage('cortando', 0);
      const cut = await lane.cut(Math.max(0, absStart - LIMITS.cutLeadSec), absEnd + LIMITS.cutTailSec);
      beat();
      if (!owns()) return 'orfa';

      // Dimensões da FONTE: o probe do ffmpeg só entrega altura, então quem diz
      // a largura é o próprio clipe cortado (videoWidth/videoHeight).
      let srcW = project.source.width ?? 0;
      let srcH = project.source.height ?? 0;
      if (!srcW || !srcH) {
        const dim = await deps.engine.probeSize(cut.blob).catch(() => null);
        if (dim && dim.width > 0 && dim.height > 0) {
          srcW = dim.width;
          srcH = dim.height;
          mutate((p) => {
            p.source = { ...p.source, width: dim.width, height: dim.height };
          });
        }
      }
      beat();
      if (!owns()) return 'orfa';

      // Legendas recalculadas AQUI: cobre borda editada e troca de ritmo.
      const captionBlocks = captionsFor(clip);
      if (captionBlocks !== clip.captionBlocks) patchClip(clip.id, { captionBlocks });
      const headline = clipHeadline(clip);

      // Miniatura ANTES do render: o grid aparece cedo (o card já mostra algo
      // enquanto o MP4 assa). Falhar aqui é cosmético — segue o render.
      try {
        const thumb = await deps.engine.thumb({
          clipBlob: cut.blob,
          clipFirstPts: cut.firstPts,
          tAbs: Math.min(absStart + 1, Math.max(absStart, absEnd - 0.05)),
          absStart,
          settings: project.settings,
          srcW,
          srcH,
          captionBlocks,
          headline,
          cropPlan: null,
        });
        beat();
        if (thumb && owns()) {
          const key = deps.keys.thumb(projectId, clip.id);
          await deps.store.saveBlob(key, thumb, projectId);
          patchClip(clip.id, { thumbKey: key });
        }
      } catch (e) {
        if (deps.isCancel(e)) throw e;
        console.warn(`[auto-cortes] miniatura do ${clip.id} falhou (segue o render):`, e);
      }
      if (!owns()) return 'orfa';

      // Áudio do corte, na MESMA instância do pool que já tem a fonte montada.
      stage('audio', 0.05);
      let audio: Blob | null = null;
      try {
        audio = await lane.audio(cut.blob, Math.max(0, absStart - cut.firstPts), Math.max(0.05, absEnd - absStart));
      } catch (e) {
        if (deps.isCancel(e)) throw e;
        console.warn(`[auto-cortes] áudio do ${clip.id} falhou — o corte sai mudo:`, e);
        addWarning(`O áudio do corte ${clip.rank} não pôde ser extraído — ele sai sem som. Tente "Renderizar de novo".`);
      }
      beat();
      if (!owns()) return 'orfa';

      const out = await deps.engine.run({
        clipId: clip.id,
        absStart,
        absEnd,
        clipBlob: cut.blob,
        clipFirstPts: cut.firstPts,
        settings: project.settings,
        srcW,
        srcH,
        captionBlocks,
        headline,
        audio,
        signal: claim.ctrl.signal,
        onStage: stage,
      });
      beat();
      if (!owns()) return 'orfa';

      const blobKey = deps.keys.clip(projectId, clip.id);
      await deps.store.saveBlob(blobKey, out.blob, projectId);
      let thumbKey = findClip(clip.id)?.thumbKey ?? null;
      if (out.thumb) {
        thumbKey = deps.keys.thumb(projectId, clip.id);
        await deps.store.saveBlob(thumbKey, out.thumb, projectId);
        const cached = thumbUrls.get(clip.id);
        if (cached) {
          try {
            deps.objectUrl.revoke(cached.url);
          } catch {
            /* ignora */
          }
          thumbUrls.delete(clip.id);
        }
      }
      if (!owns()) return 'orfa';

      patchClip(
        clip.id,
        {
          renderStatus: 'pronto',
          renderProgress: 1,
          renderError: null,
          blobKey,
          thumbKey,
          outputBytes: out.blob.size,
          renderMode: out.mode,
          cropPlan: out.cropPlan,
        },
        true,
      );
      return 'ok';
    };

    const lanePump = async (): Promise<void> => {
      let lane: RenderLane;
      try {
        lane = await deps.engine.lane();
      } catch (e) {
        // Uma pista a menos não é o fim: as outras seguem. Se NENHUMA abrir, o
        // erro guardado aqui vira o erro do lote lá embaixo.
        laneError = laneError ?? e;
        return;
      }
      try {
        for (;;) {
          if (signal.aborted || finished || destroyed) break;
          const clip = nextPending();
          if (!clip) break;

          const ctrl = new AbortController();
          const onAbort = () => ctrl.abort();
          signal.addEventListener('abort', onAbort);
          const claim: Claim = { token: ++tokenSeq, beat: deps.now(), ctrl };
          claims.set(clip.id, claim);

          let outcome: 'ok' | 'erro' | 'orfa' = 'erro';
          try {
            outcome = await runClip(clip, lane, claim);
          } catch (e) {
            if (signal.aborted || (deps.isCancel(e) && !ctrl.signal.aborted)) {
              claims.delete(clip.id);
              signal.removeEventListener('abort', onAbort);
              patchClip(clip.id, { renderStatus: 'pendente', renderProgress: 0 });
              break;
            }
            if (claims.get(clip.id)?.token !== claim.token) {
              // A pista foi dada como órfã enquanto isto rodava.
              outcome = 'orfa';
            } else {
              const tentativas = (attempts.get(clip.id) ?? 0) + 1;
              attempts.set(clip.id, tentativas);
              const msg = deps.friendly(e, 'Não consegui renderizar este corte.');
              console.error(`[auto-cortes] corte ${clip.id} falhou (tentativa ${tentativas}):`, e);
              if (tentativas < CLIP_ATTEMPTS) {
                // Retry: volta pra fila (qualquer pista pega).
                patchClip(clip.id, { renderStatus: 'pendente', renderProgress: 0, renderError: null });
                claims.delete(clip.id);
                signal.removeEventListener('abort', onAbort);
                continue;
              }
              patchClip(clip.id, { renderStatus: 'erro', renderProgress: 0, renderError: msg }, true);
              claims.delete(clip.id);
              signal.removeEventListener('abort', onAbort);
              reportDone();
              continue;
            }
          }

          signal.removeEventListener('abort', onAbort);
          if (outcome === 'orfa') {
            // Esta pista perdeu a posse (watchdog). Ela se aposenta — o
            // watchdog já subiu uma substituta, então a concorrência não muda.
            break;
          }
          claims.delete(clip.id);
          if (outcome === 'ok') reportDone();
        }
      } finally {
        try {
          await lane.close();
        } catch {
          /* desmontar não derruba resultado */
        }
      }
    };

    const spawn = (): void => {
      active++;
      void lanePump()
        .catch((e) => {
          laneError = laneError ?? e;
        })
        .finally(() => {
          active--;
          if (active === 0 && onIdle) {
            const fn = onIdle;
            onIdle = null;
            fn();
          }
        });
    };

    const watchdog = async (): Promise<void> => {
      while (!finished && !signal.aborted && !destroyed) {
        await deps.sleep(WATCHDOG_TICK_MS);
        if (finished || signal.aborted || destroyed) break;
        const agora = deps.now();
        for (const [id, cl] of Array.from(claims.entries())) {
          if (agora - cl.beat <= WATCHDOG_STALE_MS) continue;
          // Pista sem batimento: devolve o corte pra fila e repõe uma pista.
          console.warn(`[auto-cortes] pista do corte ${id} sem batimento há 30 s — devolvendo pra fila.`);
          claims.delete(id);
          try {
            cl.ctrl.abort();
          } catch {
            /* ignora */
          }
          patchClip(id, { renderStatus: 'pendente', renderProgress: 0 });
          if (extraLanes < LIMITS.renderConcurrency) {
            extraLanes++;
            spawn();
          }
        }
      }
    };

    const lanes = Math.max(1, Math.min(LIMITS.renderConcurrency, total));
    for (let i = 0; i < lanes; i++) spawn();
    const idle = new Promise<void>((resolve) => {
      if (active === 0) resolve();
      else onIdle = resolve;
    });
    const guard = watchdog();

    try {
      await idle;
    } finally {
      finished = true;
      try {
        await deps.engine.end();
      } catch {
        /* fechar o lote não derruba o resultado */
      }
    }
    // O watchdog dorme em `deps.sleep`; ele mesmo sai no próximo tique.
    void guard.catch(() => {});

    if (signal.aborted) return;

    const prontos = project.clips.filter((c) => c.renderStatus === 'pronto').length;
    if (prontos === 0) {
      throw laneError ?? deps.makeError('Nenhum corte conseguiu renderizar. Clique em Retomar pra tentar de novo.');
    }
    const comErro = project.clips.filter((c) => c.renderStatus === 'erro').length;
    if (comErro > 0) {
      addWarning(
        `${comErro} corte(s) não renderizaram. Use "Renderizar de novo" no card — os outros já estão prontos pra baixar.`,
      );
    }
  }

  // ── o motor ──────────────────────────────────────────────────────────────

  async function execute(): Promise<void> {
    if (destroyed) return;
    if (running) return running;

    const ctrl = new AbortController();
    runCtrl = ctrl;

    const task = (async () => {
      try {
        // Voltar de um erro: retoma exatamente da fase que falhou.
        if (project.phase === 'erro') {
          const back = project.errorPhase ?? 'fonte';
          mutate((p) => {
            p.phase = back;
            p.lastError = null;
            delete p.errorPhase;
          }, true);
        }

        const file = await ensureFile(ctrl.signal);
        if (ctrl.signal.aborted) return;

        const transcript = await ensureTranscript(file, ctrl.signal);
        if (ctrl.signal.aborted) return;

        await ensureClips(transcript, file, ctrl.signal);
        if (ctrl.signal.aborted) return;

        await renderPending(file, ctrl.signal);
        if (ctrl.signal.aborted) return;

        const prontos = project.clips.filter((c) => c.renderStatus === 'pronto').length;
        const jaEstava = project.phase === 'pronto';
        setPhase('pronto', prontos === 1 ? '1 corte pronto' : `${prontos} cortes prontos`, 1);
        if (!jaEstava) {
          deps.logHistory({
            tool: 'auto-cortes',
            kind: 'done',
            title: `${project.source.name || 'vídeo'} → ${prontos} cortes`,
            meta: `${project.settings.aspect} · ${project.settings.language}`,
          });
        }
      } catch (e) {
        if (ctrl.signal.aborted || deps.isCancel(e)) {
          // Cancelamento não é erro: a fase fica onde está e o Retomar funciona.
          await persistNow();
          return;
        }
        const msg = deps.friendly(e, 'Algo deu errado no meio do caminho. Clique em Retomar — nada do que ficou pronto se perde.');
        console.error('[auto-cortes] pipeline parou:', e);
        mutate((p) => {
          if (p.phase !== 'erro') p.errorPhase = p.phase;
          p.phase = 'erro';
          p.lastError = msg;
        }, true);
      } finally {
        if (runCtrl === ctrl) runCtrl = null;
        running = null;
        await persistNow();
      }
    })();

    running = task;
    return task;
  }

  // ── API pública ──────────────────────────────────────────────────────────

  const api: Pipeline = {
    getState() {
      return project;
    },

    subscribe(fn) {
      subs.add(fn);
      return () => {
        subs.delete(fn);
      };
    },

    async start(args) {
      if (destroyed) return;
      await stopAndWait();
      const src = args.source;
      mutate((p) => {
        p.settings = { ...p.settings, ...args.settings };
        p.phase = 'fonte';
        p.progress = { ratio: 0, label: 'Preparando…' };
        p.lastError = null;
        delete p.errorPhase;
        p.transcript = null;
        p.candidates = [];
        p.clips = [];
        p.analysisKey = null;
        p.warnings = [];
        if (src.kind === 'link') {
          p.source = {
            kind: 'url',
            url: src.url,
            name: nameFromUrl(src.url),
            sizeBytes: 0,
            signature: '',
            opfsPath: null,
            durationSec: null,
            width: null,
            height: null,
          };
        }
      }, true);

      heldFile = src.kind === 'upload' ? src.file : null;
      pendingUpload = src.kind === 'upload' ? src.file : null;

      // Faxina do store no começo do trabalho (nunca derruba nada).
      void Promise.resolve(deps.store.prune({ keep: projectId })).catch(() => {});

      await execute();
    },

    async resume() {
      if (destroyed) return;
      if (running) return running;
      // F5: se este pipeline nasceu em branco mas o IDB tem o projeto, adota o
      // que estava salvo antes de decidir qualquer coisa (senão o "Retomar"
      // recomeçaria um vídeo de 2 h que já estava transcrito).
      if (project.phase === 'fonte' && !project.transcript && project.clips.length === 0) {
        try {
          const salvo = await deps.store.loadProject(projectId);
          if (salvo && (salvo.transcript || salvo.clips.length > 0 || salvo.source.signature || salvo.source.url)) {
            project = salvo;
            emit();
          }
        } catch (e) {
          console.warn('[auto-cortes] não consegui reler o projeto salvo:', e);
        }
      }
      if (api.needsFile()) {
        throw deps.makeError(
          `Selecione de novo o MESMO vídeo${
            project.source.name ? ` ("${project.source.name}")` : ''
          } pra eu continuar de onde parei — a transcrição e os cortes prontos continuam salvos.`,
        );
      }
      await execute();
    },

    cancel() {
      abortRun();
      void persistNow();
    },

    attachFile(file) {
      if (!file || file.size === 0) return { ok: false, reason: 'Esse arquivo está vazio.' };
      const src = project.source;
      if (src.kind === 'upload' && src.signature) {
        if (deps.ingest.signature(file) !== src.signature) {
          return {
            ok: false,
            reason: `Esse não é o mesmo arquivo do projeto. Selecione exatamente "${src.name}" (nome, tamanho e data precisam bater).`,
          };
        }
      } else if (src.sizeBytes > 0 && file.size !== src.sizeBytes) {
        return {
          ok: false,
          reason: `Esse arquivo tem tamanho diferente do original ("${src.name}"). Selecione o mesmo vídeo.`,
        };
      }
      heldFile = file;
      emit();
      return { ok: true };
    },

    needsFile() {
      if (currentFile()) return false;
      const src = project.source;
      if (src.kind !== 'upload') return false;
      return !!src.signature;
    },

    async reanalyze(settingsPatch) {
      if (destroyed) return;
      await stopAndWait();
      const antigos = project.clips;
      mutate((p) => {
        if (settingsPatch) p.settings = { ...p.settings, ...settingsPatch };
        p.candidates = [];
        p.clips = [];
        p.analysisKey = null;
        p.phase = 'analisando';
        p.progress = { ratio: 0, label: 'Refazendo a análise…' };
        p.lastError = null;
        delete p.errorPhase;
      }, true);
      await clearClipArtifacts(antigos);
      await execute();
    },

    async rerenderClip(clipId) {
      if (destroyed) return;
      const alvo = findClip(clipId);
      if (!alvo) throw deps.makeError('Esse corte não existe mais neste projeto.');
      await stopAndWait();
      await clearClipArtifacts([alvo]);
      mutate((p) => {
        p.clips = p.clips.map((c) =>
          c.id === clipId
            ? {
                ...c,
                renderStatus: 'pendente' as RenderStatus,
                renderProgress: 0,
                renderError: null,
                blobKey: null,
                thumbKey: null,
                outputBytes: null,
                renderMode: null,
              }
            : c,
        );
        p.phase = 'renderizando';
        p.progress = { ratio: 0, label: `Renderizando o corte ${alvo.rank} de novo` };
        p.lastError = null;
        delete p.errorPhase;
      }, true);
      await execute();
    },

    async rerenderAll(settingsPatch) {
      if (destroyed) return;
      await stopAndWait();
      const antigos = project.clips;
      const mudouAspecto = !!settingsPatch.aspect && settingsPatch.aspect !== project.settings.aspect;
      mutate((p) => {
        p.settings = { ...p.settings, ...settingsPatch };
        p.clips = p.clips.map((c) => ({
          ...c,
          captionBlocks: captionsFor({ ...c }),
          // O plano de enquadro só é jogado fora quando a PROPORÇÃO muda —
          // trocar legenda/headline não precisa varrer rosto de novo.
          cropPlan: mudouAspecto ? null : c.cropPlan,
          renderStatus: 'pendente' as RenderStatus,
          renderProgress: 0,
          renderError: null,
          blobKey: null,
          thumbKey: null,
          outputBytes: null,
          renderMode: null,
        }));
        p.phase = 'renderizando';
        p.progress = { ratio: 0, label: 'Renderizando os cortes de novo' };
        p.lastError = null;
        delete p.errorPhase;
      }, true);
      await clearClipArtifacts(antigos);
      await execute();
    },

    updateClip(clipId, patch) {
      const alvo = findClip(clipId);
      if (!alvo) return;
      const merged: NonNullable<Clip['edited']> = { ...(alvo.edited ?? {}), ...patch };
      const mudouBorda =
        (patch.startMs !== undefined && patch.startMs !== alvo.edited?.startMs) ||
        (patch.endMs !== undefined && patch.endMs !== alvo.edited?.endMs);
      const atualizado: Clip = { ...alvo, edited: merged };
      const captionBlocks = mudouBorda ? captionsFor(atualizado) : alvo.captionBlocks;
      mutate((p) => {
        p.clips = p.clips.map((c) => (c.id === clipId ? { ...atualizado, captionBlocks } : c));
      }, true);
    },

    async getClipBlob(clipId) {
      const clip = findClip(clipId);
      if (!clip?.blobKey) return null;
      try {
        return await deps.store.loadBlob(clip.blobKey);
      } catch (e) {
        console.warn('[auto-cortes] não consegui ler o corte do armazenamento:', e);
        return null;
      }
    },

    async getThumbUrl(clipId) {
      const clip = findClip(clipId);
      if (!clip) return null;
      const cached = thumbUrls.get(clipId);
      if (cached && cached.key === clip.thumbKey) return cached.url;
      if (cached) {
        try {
          deps.objectUrl.revoke(cached.url);
        } catch {
          /* ignora */
        }
        thumbUrls.delete(clipId);
      }
      if (!clip.thumbKey) return null;
      try {
        const blob = await deps.store.loadBlob(clip.thumbKey);
        if (!blob) return null;
        const url = deps.objectUrl.create(blob);
        thumbUrls.set(clipId, { key: clip.thumbKey, url });
        return url;
      } catch (e) {
        console.warn('[auto-cortes] não consegui ler a miniatura:', e);
        return null;
      }
    },

    buildSrt(clipId) {
      const clip = findClip(clipId);
      if (!clip) return '';
      return deps.srt(clip.captionBlocks ?? []);
    },

    async buildZip(onProgress) {
      const prontos = project.clips
        .filter((c) => c.renderStatus === 'pronto' && c.blobKey)
        .sort((a, b) => a.rank - b.rank);
      if (prontos.length === 0) {
        throw deps.makeError('Ainda não há corte pronto pra baixar. Espere o render terminar (ou clique em Retomar).');
      }

      const entries: ZipEntryLite[] = [];
      const textos: string[] = [];
      const passos = prontos.length + 1;

      for (let i = 0; i < prontos.length; i++) {
        const c = prontos[i];
        const num = String(i + 1).padStart(2, '0');
        const base = `${num} - ${safeFileName(clipTitle(c))}`;
        const blob = await deps.store.loadBlob(c.blobKey as string);
        if (blob) entries.push({ name: `${base}.mp4`, data: blob });

        const srt = deps.srt(c.captionBlocks ?? []);
        if (srt.trim()) entries.push({ name: `${base}.srt`, data: encodeUtf8(srt) });

        const b = effectiveBounds(c);
        const hashtags = (c.plan.hashtags ?? []).map((h) => `#${String(h).replace(/^#+/, '')}`).join(' ');
        textos.push(
          [
            `${num} - ${clipTitle(c)}`,
            `Headline: ${clipHeadline(c) || '—'}`,
            `Duração: ${formatClock(b.endMs - b.startMs)} · Score ${c.plan.score}`,
            `Descrição: ${c.plan.description || '—'}`,
            `Hashtags: ${hashtags || '—'}`,
            '',
          ].join('\n'),
        );
        onProgress?.(pct(i + 1, passos));
      }

      const cabecalho = [
        `AUTO CORTES — ${project.source.name || 'vídeo'}`,
        `${prontos.length} cortes · ${project.settings.aspect}`,
        '',
        '',
      ].join('\n');
      entries.push({ name: 'textos.txt', data: encodeUtf8(cabecalho + textos.join('\n')) });

      const zip = await deps.zip(entries);
      onProgress?.(1);
      return zip;
    },

    destroy() {
      if (destroyed) return;
      destroyed = true;
      abortRun();
      if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
      }
      void persistNow();
      for (const { url } of Array.from(thumbUrls.values())) {
        try {
          deps.objectUrl.revoke(url);
        } catch {
          /* ignora */
        }
      }
      thumbUrls.clear();
      subs.clear();
      heldFile = null;
      pendingUpload = null;
    },
  };

  return api;
}

function encodeUtf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}
