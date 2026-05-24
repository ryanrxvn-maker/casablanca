/**
 * runMagnificPipelineV2 — drop-in compatível com runMagnificPipeline,
 * mas roda 100% server-side via /api/auto-broll-v2/generate (API direta
 * Magnific.com, sem extension, sem aba aberta, sem CDP).
 *
 * Vantagens:
 *   - 10x mais rápido (12 image / 6 video simultâneo, sem overhead de UI)
 *   - Sobrevive a fechar a aba (rode no fundo)
 *   - Sem conflitos com Spaces/Vue Flow/Liveblocks
 *
 * Limitações vs v1:
 *   - Sem "spaceId" real — retorna pseudo-id (`api-v2:<jobId>`)
 *   - Progresso é estimado (a API só responde quando termina TODOS os takes).
 *     Aproximamos com timer: dispara ticks a cada 2s, percent cresce
 *     conforme tempo decorrido vs ETA (60s base + 90s/take adicional).
 *   - ZIP de takes é montado client-side com fetch das URLs assinadas.
 */

import type {
  MagnificPipelineConfig,
  PipelineCallbacks,
  TakeState,
  PipelineProgress,
} from './magnific-pipeline';
import { buildZip, type ZipEntry } from './zip-builder';

type ApiResp = {
  total: number;
  success: number;
  failed: number;
  imageConcurrency: number;
  videoConcurrency: number;
  results: Array<{
    idx: number;
    imagePrompt: string;
    videoPrompt: string;
    imageUrl?: string;
    videoUrl?: string;
    imageMs?: number;
    videoMs?: number;
    error?: string;
  }>;
};

type RunnerResultV2 = {
  ok: boolean;
  spaceId?: string;
  spaceUrl?: string;
  takes: TakeState[];
  zipBlob?: Blob;
  zipName?: string;
  successCount: number;
  failedCount: number;
  complete?: boolean;
  missingIdxs?: number[];
};

const DEFAULT_IMAGE_CONC = 12;
const DEFAULT_VIDEO_CONC = 6;

/** ETA grosseira: base + tempo proporcional por take (Kling 2.5 ~5-8min cada,
 * mas com 6 simultâneo paraleliza). Pra UX, assume 90s/take amortizado. */
function estimateEtaMs(numTakes: number): number {
  return 60_000 + numTakes * 90_000;
}

export async function runMagnificPipelineV2(
  cfg: MagnificPipelineConfig,
  cb: PipelineCallbacks = {},
): Promise<RunnerResultV2> {
  const { takes, spaceName } = cfg;
  const total = takes.length;
  const imageConcurrency = cfg.imageConcurrency ?? DEFAULT_IMAGE_CONC;
  const videoConcurrency = cfg.videoConcurrency ?? DEFAULT_VIDEO_CONC;

  if (total === 0) {
    return {
      ok: false,
      takes: [],
      successCount: 0,
      failedCount: 0,
      complete: false,
      missingIdxs: [],
    };
  }

  // Estado interno: 1 entry por take (idx começa em 1 pra bater com v1)
  const takeStates: TakeState[] = takes.map((t) => ({
    idx: t.idx,
    status: 'running',
    phase: 'queued',
    percent: 0,
    message: 'Aguardando dispatch...',
  }));

  function emit(message: string, phase: string, percent: number) {
    const p: PipelineProgress = {
      spaceId: `api-v2:${spaceName}`,
      spaceUrl: undefined,
      takes: takeStates,
      ready: takeStates.filter((s) => s.status === 'ready').length,
      total,
      message,
      phase,
      percent,
    };
    cb.onProgress?.(p);
  }

  // Tick estimado enquanto API processa
  const eta = estimateEtaMs(total);
  const startedAt = Date.now();
  let ticker: ReturnType<typeof setInterval> | null = null;
  let aborted = false;

  cb.signal?.addEventListener('abort', () => {
    aborted = true;
  });

  emit(
    `Disparando ${total} takes via API direta (${imageConcurrency} img / ${videoConcurrency} vid)...`,
    'dispatch',
    2,
  );

  ticker = setInterval(() => {
    if (aborted) return;
    const elapsed = Date.now() - startedAt;
    // Cresce até 90% durante a espera (reserva 10% pro download/zip)
    const pct = Math.min(90, Math.round((elapsed / eta) * 90));
    emit(
      `Gerando no Magnific (${Math.round(elapsed / 1000)}s / ETA ~${Math.round(eta / 1000)}s)...`,
      'generating',
      pct,
    );
  }, 2000);

  // Chamada
  let resp: ApiResp;
  try {
    const r = await fetch('/api/auto-broll-v2/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        takes: takes.map((t) => ({
          imagePrompt: t.imagePrompt,
          videoPrompt: t.videoPrompt || t.imagePrompt,
        })),
        imageConcurrency,
        videoConcurrency,
      }),
      signal: cb.signal,
    });
    if (!r.ok) {
      const j = (await r.json().catch(() => ({}))) as { error?: string };
      throw new Error(j.error || `HTTP ${r.status}`);
    }
    resp = (await r.json()) as ApiResp;
  } catch (e) {
    if (ticker) clearInterval(ticker);
    const msg = e instanceof Error ? e.message : String(e);
    takeStates.forEach((s, i) => {
      takeStates[i] = { idx: s.idx, status: 'failed', error: msg };
    });
    emit(`Falha geral: ${msg}`, 'failed', 0);
    return {
      ok: false,
      takes: takeStates,
      successCount: 0,
      failedCount: total,
      complete: false,
      missingIdxs: takes.map((t) => t.idx),
    };
  }
  if (ticker) clearInterval(ticker);

  // Aplica resultado do API → takeStates
  for (let i = 0; i < takeStates.length; i++) {
    const idx = takeStates[i].idx;
    const r = resp.results.find((x) => x.idx === idx);
    if (!r) {
      takeStates[i] = {
        idx,
        status: 'failed',
        error: 'Sem resposta do servidor.',
      };
      continue;
    }
    if (r.error || !r.videoUrl) {
      takeStates[i] = {
        idx,
        status: 'failed',
        error: r.error || 'Sem URL final.',
      };
    } else {
      takeStates[i] = {
        idx,
        status: 'video-done',
        imageUrl: r.imageUrl || '',
        videoUrl: r.videoUrl,
      };
    }
  }

  emit('Baixando vídeos finais...', 'downloading', 92);

  // Download → ZIP
  const entries: ZipEntry[] = [];
  let downloaded = 0;
  for (const s of takeStates) {
    if (s.status !== 'video-done') continue;
    try {
      const r = await fetch(s.videoUrl, { signal: cb.signal });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const ab = await r.arrayBuffer();
      entries.push({
        name: `take_${String(s.idx).padStart(2, '0')}.mp4`,
        data: ab,
      });
      // Marca como ready
      const i = takeStates.findIndex((x) => x.idx === s.idx);
      takeStates[i] = {
        idx: s.idx,
        status: 'ready',
        videoUrl: s.videoUrl,
        mp4Size: ab.byteLength,
      };
      downloaded++;
      emit(
        `Baixados ${downloaded}/${entries.length} takes...`,
        'downloading',
        92 + Math.round((downloaded / total) * 6),
      );
    } catch (e) {
      const i = takeStates.findIndex((x) => x.idx === s.idx);
      takeStates[i] = {
        idx: s.idx,
        status: 'failed',
        error: 'Falha download: ' + (e instanceof Error ? e.message : String(e)),
      };
    }
  }

  let zipBlob: Blob | undefined;
  let zipName: string | undefined;
  if (entries.length > 0) {
    emit('Empacotando ZIP...', 'zipping', 99);
    zipBlob = await buildZip(entries);
    zipName = `${spaceName.replace(/[^\w\d-]+/g, '_').slice(0, 60)}_takes.zip`;
  }

  const success = takeStates.filter((s) => s.status === 'ready').length;
  const failed = takeStates.filter((s) => s.status === 'failed').length;
  const missingIdxs = takeStates
    .filter((s) => s.status !== 'ready')
    .map((s) => s.idx);

  emit(
    success === total
      ? `✓ ${success}/${total} takes prontos.`
      : `Concluído: ${success}/${total} ok, ${failed} falharam.`,
    'done',
    100,
  );

  return {
    ok: success > 0,
    spaceId: `api-v2:${spaceName}`,
    takes: takeStates,
    zipBlob,
    zipName,
    successCount: success,
    failedCount: failed,
    complete: success === total,
    missingIdxs,
  };
}
