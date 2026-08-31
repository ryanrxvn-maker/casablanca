/**
 * ORQUESTRADOR da pós-produção do Pilot — SÓ BROWSER (ASR + render WebCodecs).
 * As decisões puras (plano de zoom, roteiro hook×body) moram em
 * [[lib/pilot-pos-producao.ts]], que compila sozinho no harness de teste;
 * este arquivo arrasta export.ts/ffmpeg e por isso vive separado.
 */

import {
  planejarZoom,
  separarHookBody,
  montarRoteiro,
  type LegendaCfg,
  type ZoomCfg,
} from './pilot-pos-producao';
import type { CaptionTemplate } from './typography/caption-script';

/* ═══════════════════════════ orquestrador (browser) ══════════════════════ */

export type PosProducaoCfg = {
  legenda: LegendaCfg;
  zoom: ZoomCfg;
  /** copy por parte, na ordem do plano (label diz o que é hook) */
  partes: Array<{ label: string; text: string }>;
  /** idioma do ASR ('pt', 'en', 'cs'...) */
  idioma: string;
  /** templates disponíveis (builtin + salvos) — resolvidos pelo caller */
  templates: CaptionTemplate[];
  onEtapa?: (msg: string) => void;
};

export type PosProducaoInfo = {
  filename: string;
  partesSec: number[] | null;
  /** durações dos pedaços de cada parte depois da decupagem (jump cuts) */
  cortesInternosSec?: number[][] | null;
};

/** Palavra do ASR no shape do engine. */
type PalavraAsr = { text: string; start: number; end: number };

/**
 * Aplica legenda e/ou zoom num montado. Devolve `null` quando NÃO há nada a
 * fazer ou quando algo falhou (o caller mantém o original) — o motivo vai em
 * `avisos`. Nunca lança.
 */
export async function montarPosProducao(
  blob: Blob,
  info: PosProducaoInfo,
  cfg: PosProducaoCfg,
): Promise<{ blob: Blob | null; avisos: string[] }> {
  const avisos: string[] = [];
  const querLegenda = cfg.legenda.on;
  const querZoom = cfg.zoom.on;
  if (!querLegenda && !querZoom) return { blob: null, avisos };

  try {
    const [{ renderTypographyVideo }, engine, grupo, roteiro, copyFix] = await Promise.all([
      import('./typography/export'),
      import('./typography/engine'),
      import('./typography/group'),
      import('./typography/caption-script'),
      import('./typography/copy-fix'),
    ]);
    const { DEFAULT_STYLE } = engine;
    const { getPreset } = await import('./typography/presets');
    const { emptyIdentity } = await import('./typography/blocks-edit');

    // duração do vídeo final (pro plano de zoom)
    const durSec = await duracaoDoBlob(blob);
    if (!durSec) {
      avisos.push('pós-produção: não consegui ler a duração do montado — entregue sem legenda/zoom');
      return { blob: null, avisos };
    }

    const plano = querZoom ? planejarZoom(cfg.zoom, durSec, info.partesSec, info.cortesInternosSec) : [];

    // ── legenda: ASR → correção pela copy → roteiro do template ──
    let blocks: import('./typography/engine').Block[] = [];
    let style: import('./typography/engine').StyleState = { ...DEFAULT_STYLE, presetId: 'keynote' };
    if (querLegenda) {
      try {
        cfg.onEtapa?.('legendando: transcrevendo');
        const palavras = await transcreverMontado(blob, cfg.idioma);
        let bls = grupo.groupWords(palavras, 'rapido');

        // correção pela copy do doc (grafia + palavras comidas pelo ASR)
        const copyToda = cfg.partes.map((p) => p.text).filter(Boolean).join('\n');
        try {
          bls = copyFix.correctBlocksByCopy(bls, copyToda).blocks;
        } catch (e) {
          avisos.push(`legenda: correção pela copy não rodou (${(e as Error)?.message?.slice(0, 60)}) — segue o ASR puro`);
        }

        const tpl =
          cfg.templates.find((t) => t.id === cfg.legenda.templateId) ||
          cfg.templates[0] ||
          roteiro.BUILTIN_TEMPLATES[0];
        const { hook, body } = separarHookBody(cfg.partes);
        const segs = montarRoteiro(tpl, hook, body);
        const aplicado = roteiro.applyCaptionScript(bls, segs, emptyIdentity());
        blocks = aplicado.blocks;
        style = {
          ...DEFAULT_STYLE,
          presetId: (segs[segs.length - 1]?.style?.presetId as string) || 'keynote',
          perBlock: aplicado.blockStyles,
          highlights: aplicado.highlights,
          wordStyles: aplicado.wordStyles,
        };
      } catch (e) {
        avisos.push(`legenda falhou (${(e as Error)?.message?.slice(0, 80)}) — vídeo segue sem legenda`);
        blocks = [];
        if (!querZoom) return { blob: null, avisos };
      }
    }

    if (blocks.length === 0 && plano.length === 0) return { blob: null, avisos };

    // ── RENDER com PROGRESSO REAL e TETO DE TEMPO ──
    // O render de um AD de 90s são ~2.700 frames com legenda desenhada em cada
    // um: leva minutos. Sem o ratio na tela isso PARECIA travado (era só uma
    // string parada). E sem teto, um decoder que engasga ficava pra sempre —
    // agora aborta e entrega o montado original, que é a regra da casa.
    const verbo = blocks.length ? 'legendando' : 'aplicando zoom';
    cfg.onEtapa?.(`${verbo}: preparando`);
    const t0 = Date.now();
    const ctrl = new AbortController();
    // Teto PROPORCIONAL: ~6s de render por segundo de vídeo, piso de 4min e
    // teto de 25min. Régua medida no harness (12s → ~29s por render) com
    // folga de 2x pra PC carregado.
    const tetoMs = Math.min(25 * 60_000, Math.max(4 * 60_000, Math.round(durSec * 6_000)));
    const alarme = setTimeout(() => ctrl.abort(), tetoMs);
    let r: Awaited<ReturnType<typeof renderTypographyVideo>>;
    try {
      r = await renderTypographyVideo({
        file: blob,
        blocks,
        preset: getPreset(style.presetId),
        style,
        zoom: plano,
        signal: ctrl.signal,
        onProgress: (pr) => {
          // 'frames' é a fase longa — é dela que sai a porcentagem honesta.
          const pct = Math.round((pr.ratio || 0) * 100);
          cfg.onEtapa?.(
            pr.phase === 'frames'
              ? `${verbo}: ${pct}% (${pr.frame ?? 0}/${pr.totalFrames ?? 0} frames)`
              : `${verbo}: ${pr.phase}`,
          );
        },
      });
    } finally {
      clearTimeout(alarme);
    }
    const seg = ((Date.now() - t0) / 1000).toFixed(0);
    console.log(
      `[pos-producao] ${info.filename}: render ${r.mode || '?'} em ${seg}s · ` +
        `${r.width}x${r.height}@${r.fps} · ${(r.blob.size / 1e6).toFixed(1)}MB · audioOk=${r.audioOk}`,
    );
    if (!r.blob || r.blob.size < 50_000) {
      avisos.push('pós-produção: render saiu vazio — entregue o montado original');
      return { blob: null, avisos };
    }
    if (!r.audioOk) avisos.push('pós-produção: o áudio não remuxou — confere o som do montado');
    return { blob: r.blob, avisos };
  } catch (e) {
    const msg = (e as Error)?.message || String(e);
    avisos.push(
      /abort|cancel/i.test(msg)
        ? 'pós-produção: o render estourou o tempo — entregue o montado original (sem legenda/zoom)'
        : `pós-produção falhou (${msg.slice(0, 80)}) — entregue o montado original`,
    );
    return { blob: null, avisos };
  }
}

/** Duração (s) de um blob de vídeo via metadata — 0 quando não dá pra ler. */
async function duracaoDoBlob(blob: Blob): Promise<number> {
  if (typeof document === 'undefined') return 0;
  const url = URL.createObjectURL(blob);
  try {
    return await new Promise<number>((resolve) => {
      const v = document.createElement('video');
      const timer = setTimeout(() => resolve(0), 12_000);
      v.preload = 'metadata';
      v.muted = true;
      v.onloadedmetadata = () => {
        clearTimeout(timer);
        resolve(isFinite(v.duration) && v.duration > 0 ? v.duration : 0);
      };
      v.onerror = () => {
        clearTimeout(timer);
        resolve(0);
      };
      v.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** ASR do montado: extrai o áudio e chama a MESMA rota das Legendas Automáticas. */
async function transcreverMontado(blob: Blob, idioma: string): Promise<PalavraAsr[]> {
  const { extractAudioForTranscription } = await import('./ffmpeg-worker');
  const audio = await extractAudioForTranscription(blob, {}, undefined);
  if (audio.size > 4_400_000) {
    throw new Error(`áudio grande demais pro ASR (${(audio.size / 1e6).toFixed(1)}MB)`);
  }
  const fd = new FormData();
  fd.append('audio', audio, 'audio.opus');
  fd.append('language', /^[a-z]{2}(-[a-z]{2})?$/.test(idioma) ? idioma : 'pt');
  const res = await fetch('/api/tipografia/transcribe', { method: 'POST', body: fd });
  const json = (await res.json().catch(() => null)) as { words?: PalavraAsr[]; error?: string } | null;
  if (!res.ok || !json?.words?.length) {
    throw new Error(json?.error || `ASR respondeu ${res.status}`);
  }
  return json.words;
}
