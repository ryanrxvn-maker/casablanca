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
  palavrasDoHookNoAsr,
  type LegendaCfg,
  type ZoomCfg,
} from './pilot-pos-producao';
import type { CaptionTemplate } from './typography/caption-script';
import {
  janelasDosInserts,
  palcoDoLayout,
  coberturaNoInstante,
  planoDeVelocidade,
  tempoNaMidia,
  cortesDoVideo,
  janelaDaHeadline,
  textoDaHeadline,
  type Insert,
  type HeadlineCfg,
} from './pilot-inserts';

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
  /** o caller já segura o lock do ffmpeg (o pipeline SEMPRE segura) — sem
   *  isto o mux de áudio do render pede o lock de novo e trava pra sempre */
  ffmpegJaExclusivo?: boolean;
  /** INSERTS: b-roll na montagem, ancorado numa palavra da copy */
  inserts?: Insert[];
  /** HEADLINE: texto parado por cima, saindo num corte */
  headline?: HeadlineCfg;
  /** lê os bytes de uma mídia de insert (IndexedDB) */
  lerMidia?: (key: string) => Promise<Blob | null>;
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

/** Espelho local do que o render espera (evita import cíclico com export.ts). */
type FonteLocal = {
  id: string;
  w: number;
  h: number;
  quadro: (tRel: number) => CanvasImageSource | null;
};
type PlanoInsertLocal = {
  janelas: Array<{ id: string; start: number; end: number }>;
  porId: (id: string, W: number, H: number) => { palco: unknown; focoAvatarY: number; blur?: number } | null;
  cobertura: (t: number) => { cor: 'preto' | 'branco'; alpha: number } | null;
  fontes: Map<string, FonteLocal>;
};



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
  const temInserts = (cfg.inserts?.length || 0) > 0 && !!cfg.lerMidia;
  const querHeadline = !!cfg.headline?.on;
  if (!querLegenda && !querZoom && !temInserts && !querHeadline) return { blob: null, avisos };

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

    // ── ASR: serve à legenda E à âncora dos inserts ──
    // O insert é ancorado numa PALAVRA da copy; sem o ASR não há como saber em
    // que segundo ela é falada (a lib cai no rateio proporcional, que erra por
    // segundos). Então transcrevemos também quando só há insert.
    let palavrasParaAncora: PalavraAsr[] = [];
    let blocks: import('./typography/engine').Block[] = [];
    let style: import('./typography/engine').StyleState = { ...DEFAULT_STYLE, presetId: 'keynote' };
    if (!querLegenda && (temInserts || querHeadline)) {
      try {
        cfg.onEtapa?.('lendo a fala pra ancorar insert/headline');
        palavrasParaAncora = await transcreverMontado(blob, cfg.idioma);
      } catch (e) {
        avisos.push(
          `inserts: não consegui transcrever (${(e as Error)?.message?.slice(0, 50)}) — ` +
            'a posição sai por estimativa da copy',
        );
      }
    }
    if (querLegenda) {
      try {
        cfg.onEtapa?.('legendando: transcrevendo');
        const palavras = await transcreverMontado(blob, cfg.idioma);
        palavrasParaAncora = palavras;
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
        // FRONTEIRA DO HOOK POR ALINHAMENTO: mede quantas palavras do ÁUDIO o
        // hook realmente ocupa. Sem isto a fronteira era a contagem da copy do
        // doc — e uma palavra de diferença do ASR fazia a legenda trocar de
        // estilo antes da hora (o "daqui." do AD02 saiu com o estilo do body).
        const palavrasDosBlocos = bls.flatMap((b) => b.words.map((w) => w.text));
        const fronteira = palavrasDoHookNoAsr(palavrasDosBlocos, hook);
        if (hook.trim()) {
          console.log(
            `[pos-producao] hook: ${fronteira != null ? `${fronteira} palavras no áudio` : 'alinhamento não confiável — usando a contagem da copy'}` +
              ` (copy tem ${hook.trim().split(/\s+/).length})`,
          );
        }
        const segs = montarRoteiro(tpl, hook, body, fronteira);
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

    // ── INSERTS: abre as mídias e monta o plano de composição ──
    // Vídeo vira um <video> que o render busca por seek (o insert é curto —
    // 2-5s — então o custo é baixo e não precisa decodificar tudo na memória).
    // Imagem vira um <img> desenhado direto.
    let planoInserts: PlanoInsertLocal | undefined;
    const fechaveis: Array<() => void> = [];
    if (temInserts) {
      try {
        cfg.onEtapa?.('preparando inserts');
        const fontes = new Map<string, FonteLocal>();
        const durNatural = new Map<string, number>();
        const videosPorId = new Map<string, { v: HTMLVideoElement; natural: number }>();
        // preenchido DEPOIS de conhecer as janelas (a velocidade depende delas)
        const velocidadePorId = new Map<string, ReturnType<typeof planoDeVelocidade>>();
        for (const ins of cfg.inserts!) {
          const blob = await cfg.lerMidia!(ins.midiaKey);
          if (!blob) {
            avisos.push(`insert "${ins.midiaNome}" não voltou do armazenamento — foi ignorado`);
            continue;
          }
          const url = URL.createObjectURL(blob);
          fechaveis.push(() => URL.revokeObjectURL(url));
          if (ins.midiaTipo === 'imagem') {
            const img = await new Promise<HTMLImageElement | null>((res) => {
              const im = new Image();
              im.onload = () => res(im);
              im.onerror = () => res(null);
              im.src = url;
            });
            if (!img) { avisos.push(`insert "${ins.midiaNome}" não abriu`); continue; }
            fontes.set(ins.id, { id: ins.id, w: img.naturalWidth, h: img.naturalHeight, quadro: () => img });
          } else {
            const v = document.createElement('video');
            v.muted = true;
            v.preload = 'auto';
            v.playsInline = true;
            const abriu = await new Promise<boolean>((res) => {
              const t = setTimeout(() => res(false), 15000);
              v.onloadeddata = () => { clearTimeout(t); res(true); };
              v.onerror = () => { clearTimeout(t); res(false); };
              v.src = url;
            });
            if (!abriu) { avisos.push(`insert "${ins.midiaNome}" não abriu`); continue; }
            const natural = v.duration || 0;
            durNatural.set(ins.id, natural);
            videosPorId.set(ins.id, { v, natural });
            // O `quadro` só sabe o tempo DA JANELA; a conversão pro tempo da
            // MÍDIA depende do plano de velocidade, que só existe depois de a
            // janela ser calculada. Por isso ele consulta o mapa na hora.
            fontes.set(ins.id, {
              id: ins.id,
              w: v.videoWidth,
              h: v.videoHeight,
              quadro: (tRel: number) => {
                const pv = velocidadePorId.get(ins.id);
                const alvo = pv ? tempoNaMidia(tRel, pv, natural) : Math.min(tRel, Math.max(0, natural - 0.04));
                if (Math.abs(v.currentTime - alvo) > 0.03) v.currentTime = alvo;
                return v;
              },
            });
          }
        }

        const usaveis = cfg.inserts!.filter((i) => fontes.has(i.id));
        if (usaveis.length > 0) {
          const janelas = janelasDosInserts(
            usaveis,
            cfg.partes,
            palavrasParaAncora,
            durSec,
            (id) => durNatural.get(id) ?? null,
          );
          // ⭐ AGORA dá pra decidir a velocidade: cada mídia tem que caber na
          // janela dela. Longa CORTA (roda normal e morre no fim da parte),
          // curta DESACELERA. É o que faz o insert preencher o trecho da fala
          // sem buraco e sem sobra.
          for (const j of janelas) {
            const nat = durNatural.get(j.id) || 0;
            const pv = planoDeVelocidade(nat, j.end - j.start);
            velocidadePorId.set(j.id, pv);
            if (pv.motivo !== 'exato' && pv.motivo !== 'sem-duracao') {
              const nome = usaveis.find((x) => x.id === j.id)?.midiaNome || j.id;
              console.log(
                `[pos-producao] insert "${nome}": ${nat.toFixed(1)}s em janela de ` +
                  `${(j.end - j.start).toFixed(1)}s → ${pv.motivo}` +
                  (pv.velocidade !== 1 ? ` (${pv.velocidade.toFixed(2)}x)` : ''),
              );
              if (pv.motivo === 'desacelerou-e-congelou') {
                avisos.push(
                  `insert "${nome}" é curto demais pro trecho (${nat.toFixed(1)}s em ${(j.end - j.start).toFixed(1)}s): ` +
                    'desacelerou até o limite e o resto ficou no último frame',
                );
              }
            }
          }
          const porId = new Map(usaveis.map((i) => [i.id, i]));
          planoInserts = {
            janelas,
            // W/H vêm do RENDER (o vídeo real), não de uma régua fixa — senão
            // o card do avatar cai fora da tela em qualquer resolução != 1080p.
            porId: (id: string, W: number, H: number) => {
              const ins = porId.get(id);
              if (!ins) return null;
              return {
                palco: palcoDoLayout(ins.layout, W, H),
                focoAvatarY: ins.focoAvatarY,
                blur: velocidadePorId.get(id)?.blur ?? 0,
              };
            },
            cobertura: (t: number) =>
              coberturaNoInstante(t, janelas, (id) => porId.get(id)?.transicao || 'nenhuma'),
            fontes,
          };
          console.log(
            `[pos-producao] ${info.filename}: ${janelas.length} insert(s) — ` +
              janelas.map((j) => `${j.start.toFixed(1)}→${j.end.toFixed(1)}s`).join(', '),
          );
        }
      } catch (e) {
        avisos.push(`inserts não entraram (${(e as Error)?.message?.slice(0, 60)}) — vídeo segue sem eles`);
        planoInserts = undefined;
      }
    }

    // ── HEADLINE: texto parado por cima, ENTRANDO E SAINDO NUM CORTE ──
    // A saída no corte é o ponto: texto que some no meio da fala denuncia o
    // automático, porque nada mais na tela muda junto. No corte, a troca de
    // imagem mascara o sumiço.
    let headlines: import('./typography/headline').Headline[] | undefined;
    if (querHeadline && cfg.headline) {
      try {
        const cortes = cortesDoVideo(info.partesSec, info.cortesInternosSec);
        const jan = janelaDaHeadline(cfg.headline, cfg.partes, palavrasParaAncora, durSec, cortes);
        const texto = textoDaHeadline(cfg.headline, cfg.partes);
        if (jan && texto) {
          const hl = await import('./typography/headline');
          headlines = [
            {
              id: 'pilot-hl',
              text: texto,
              start: jan.start * 1000,
              end: jan.end * 1000,
              style: {
                ...hl.HEADLINE_STYLE_DEFAULT,
                presetId: cfg.headline.presetId,
                posY: cfg.headline.posY,
              },
            },
          ];
          console.log(
            `[pos-producao] headline: ${jan.start.toFixed(1)}→${jan.end.toFixed(1)}s ` +
              `(saída ${cortes.some((c) => Math.abs(c - jan.end) < 0.01) ? 'NO CORTE' : 'sem corte por perto'})`,
          );
        } else if (!texto) {
          avisos.push('headline: sem texto (nem escrito, nem hook na copy) — não entrou');
        }
      } catch (e) {
        avisos.push(`headline não entrou (${(e as Error)?.message?.slice(0, 60)})`);
      }
    }

    if (blocks.length === 0 && plano.length === 0 && !planoInserts && !headlines) {
      for (const f of fechaveis) f();
      return { blob: null, avisos };
    }

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
        ffmpegJaExclusivo: cfg.ffmpegJaExclusivo,
        inserts: planoInserts as never,
        headlines,
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
      for (const f of fechaveis) f();
    }
    const seg = ((Date.now() - t0) / 1000).toFixed(0);
    console.log(
      `[pos-producao] ${info.filename}: render ${r.mode || '?'}/${r.hw ? 'hardware' : 'software'} em ${seg}s · ` +
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
