/**
 * Pipeline de pos-producao do ClickUp Pilot.
 *
 * Quando uma task termina o batch HeyGen (TTS+upload+submit+poll+download),
 * pegamos os MP4s individuais e geramos versoes prontas pra publicacao:
 *
 * 1. ASSEMBLE: pra cada HOOK do briefing, gera HOOK[N] + BODY (concatenados).
 *    Nomenclatura final: <baseAdId>G<N><sufixo>.mp4 (ex: AD140G1GL.mp4).
 *    Reusa concatAvatarParts do ffmpeg-worker (ja normaliza 1080x1920@30).
 *
 * 2. DECUPAGEM: roda detectSilences + cutVideoSegments em cada video montado
 *    pra cortar silencios SEM mexer no lipsync (ffmpeg corta no audio +
 *    video preserva sync por construcao).
 *
 * 3. CAMUFLAGEM (opcional): se modo ON + WHITE definido, gera 3a copia com
 *    audio camuflado via inversao de fase (lib/camuflagem.ts).
 *
 * Output: { takesZip, montadoZip, camufladoZip? } pronto pra download.
 */

import { decodeAudioRobust, detectSilences } from './audio-engine';
import { concatAvatarParts, concatVideosFast, cutVideoSegments, muxAudioIntoVideo, extractAudio } from './ffmpeg-worker';
import { camuflar } from './camuflagem';

export type AssembledPart = {
  /** Nome do arquivo final ja com sufixo G[N], ex: AD140G1GL.mp4 */
  filename: string;
  /** Blob do video montado (HOOK + BODY concat) — ainda sem decupagem */
  rawAssembled: Blob;
  /** Blob apos decupagem */
  decupado?: Blob;
  /** Blob apos decupagem + camuflagem audio */
  camuflado?: Blob;
  /** Erros por estagio */
  errors?: { assemble?: string; decupagem?: string; camuflagem?: string };
};

export type PipelineProgress = {
  stage: 'assembling' | 'decupando' | 'camuflando' | 'done';
  currentFilename?: string;
  doneCount: number;
  totalCount: number;
};

export type PipelineInputs = {
  /** baseAdId da task (ex: AD140GL ou AD140G) — sufixo G[N] sera inserido */
  baseAdId: string;
  /** MP4s individuais ja baixados, na ordem do plan (HOOK 1, HOOK 2, ..., BODY 1, BODY 2, ...) */
  parts: Array<{ label: string; blob: Blob | null }>;
  /** Roda decupagem nos montados (sempre true atualmente) */
  decupagem: boolean;
  /** Roda camuflagem (gera 3a versao) */
  camuflagem: boolean;
  /** Audio WHITE pra camuflagem (file ou video — extrai audio se video) */
  whiteAudio?: Blob | null;
  /** Volume da camuflagem 5..100 (% do nivel padrao) */
  camuflagemVolume?: number;
  /** Tolerancia de silencio em segundos (margem mantida nas bordas — preserva
   *  inicio/fim de palavras pra nao cortar nada). Default 0.12s. */
  keepSilenceSec?: number;
  /** Callback de progresso */
  onProgress?: (p: PipelineProgress) => void;
};

/** Insere "G<N>" antes do sufixo final do baseAdId. Ex:
 *  ('AD140GL', 1) -> 'AD140G1GL'
 *  ('AD140G', 2)  -> 'AD140G2G' (idempotente sem letras finais)
 *  Heuristica: encontra o ultimo bloco AD\d+ + letras finais.
 */
function insertGSuffix(baseAdId: string, n: number): string {
  // Procura padrao tipo AD<num><sufixo_letras>
  const m = baseAdId.match(/^(AD\d+)([A-Z]*)$/i);
  if (m) {
    return `${m[1]}G${n}${m[2]}`;
  }
  // Fallback: append G<n>
  return `${baseAdId}G${n}`;
}

/** Identifica indices de hook + body do array de parts. Hook = label
 *  comeca com HOOK ou GANCHO. Body = label comeca com BODY ou PARTE. */
function classifyParts(parts: Array<{ label: string; blob: Blob | null }>) {
  const hooks: number[] = [];
  const bodies: number[] = [];
  parts.forEach((p, i) => {
    const up = p.label.toUpperCase();
    if (/^(HOOK|GANCHO)/.test(up)) hooks.push(i);
    else if (/^(BODY|PARTE)/.test(up)) bodies.push(i);
  });
  return { hooks, bodies };
}

export type PipelineResult = {
  /** Items finais (1 por HOOK, ou 1 so se sem HOOKs). Pode ter erros parciais. */
  items: AssembledPart[];
  /** Diagnostico: o que classifyParts encontrou nos labels recebidos */
  diagnostics: {
    totalParts: number;
    hooksFound: number;
    bodiesFound: number;
    unrecognizedLabels: string[];
    /** Mensagem-resumo amigavel pra mostrar no UI */
    summary: string;
  };
};

/** Roda pipeline completa. SEMPRE retorna info diagnostica — mesmo quando
 *  nao consegue produzir nada, explica por que. */
export async function runPostPipeline(input: PipelineInputs): Promise<PipelineResult> {
  // keepSilenceSec=0.12: margem mantida nas bordas das fala. Era 0.05 (muito
  // agressivo, video ficava entrecortado). 0.12 da pausa natural entre takes
  // sem soar robotico — feedback do user em 12/05/2026.
  const { baseAdId, parts, decupagem, camuflagem, whiteAudio, camuflagemVolume = 30, keepSilenceSec = 0.12, onProgress } = input;
  const { hooks, bodies } = classifyParts(parts);
  const out: AssembledPart[] = [];
  const unrecognized = parts.filter((p, i) => !hooks.includes(i) && !bodies.includes(i)).map((p) => p.label);

  console.log('[clickup-pilot-pipeline] start', { baseAdId, totalParts: parts.length, hooks: hooks.length, bodies: bodies.length, unrecognized, camuflagem });

  // Sem hooks → 1 versao so do body (se tiver). Se nao tem body tambem, retorna vazio.
  // gNum vem do LABEL do hook (HOOK 1 → 1, HOOK 3 → 3) pra preservar nomenclatura
  // do briefing — mesmo com gaps tipo G1+G3 sem G2, o output sai com numero correto.
  const groupings: Array<{ hookIdx: number | null; gNum: number }> = [];
  if (hooks.length === 0) {
    if (bodies.length > 0) groupings.push({ hookIdx: null, gNum: 1 });
  } else {
    hooks.forEach((idx, i) => {
      const m = parts[idx].label.toUpperCase().match(/^(?:HOOK|GANCHO)\s*(\d+)/);
      const gNum = m ? parseInt(m[1], 10) : i + 1;
      groupings.push({ hookIdx: idx, gNum });
    });
  }

  const total = groupings.length;
  if (total === 0) {
    const summary = `Nenhum HOOK ou BODY identificado nas ${parts.length} partes. Labels recebidas: ${parts.map(p=>p.label).join(', ')}`;
    console.warn('[clickup-pilot-pipeline]', summary);
    return {
      items: [],
      diagnostics: { totalParts: parts.length, hooksFound: 0, bodiesFound: 0, unrecognizedLabels: unrecognized, summary },
    };
  }

  // === Stage 1: ASSEMBLE (HOOK[N] + BODYs concatenados) ===
  for (let g = 0; g < groupings.length; g++) {
    const { hookIdx, gNum } = groupings[g];
    const filename = `${insertGSuffix(baseAdId, gNum)}.mp4`;
    onProgress?.({ stage: 'assembling', currentFilename: filename, doneCount: g, totalCount: total });

    const piecesIdx: number[] = [];
    if (hookIdx !== null) piecesIdx.push(hookIdx);
    piecesIdx.push(...bodies);
    console.log(`[clickup-pilot-pipeline] assemble ${filename}: pecas=${piecesIdx.length}`, piecesIdx.map(i=>parts[i]?.label));

    const blobs: Blob[] = [];
    const skippedLabels: string[] = [];
    for (const i of piecesIdx) {
      const p = parts[i];
      if (!p?.blob) {
        // PARTE SEM BLOB — PULA, não aborta. Comum: BODY vazia
        // ("(vazio — esse part nao vai gerar nada)") nunca dispara/renderiza,
        // OU 1 parte falhou no download mas as outras estão OK.
        // User reportou (2026-05-27): RETOMAR travava porque 1 parte vazia
        // fazia break → montagem inteira abortava. Agora monta com o que tem.
        skippedLabels.push(p?.label || '?');
        continue;
      }
      blobs.push(p.blob);
    }
    if (skippedLabels.length > 0) {
      console.warn(`[clickup-pilot-pipeline] assemble ${filename}: PULOU ${skippedLabels.length} parte(s) sem video (${skippedLabels.join(', ')}), montando com ${blobs.length} disponíveis`);
    }
    if (blobs.length === 0) {
      console.warn(`[clickup-pilot-pipeline] assemble ${filename}: SKIP - nenhuma parte com video`);
      out.push({ filename, rawAssembled: new Blob(), errors: { assemble: 'nenhuma parte com video disponivel' } });
      continue;
    }

    // Tenta fast concat (5-10x mais rapido) primeiro. Mas fast concat sem
    // re-encode pode produzir output corrompido se codec/dimensao divergem
    // entre as partes (raro com HeyGen mesmo avatar, mas acontece). Por isso
    // a validacao real fica no proximo loop (decupagem) que tenta decodificar
    // o audio — se falhar, re-faz assemble com re-encode pesado.
    // Fast-path: concat sem re-encode (5-10x mais rapido). Funciona pra HeyGen
    // MP4s do mesmo avatar. Se output for invalido (decupagem nao consegue
    // decodar), Stage 2 detecta e refaz com slow re-encode.
    let assembled: Blob;
    let usedFastPath = false;
    try {
      const tFast = Date.now();
      try {
        assembled = await concatVideosFast(blobs);
        usedFastPath = true;
        console.log(`[clickup-pilot-pipeline] assemble ${filename}: FAST OK ${(assembled.size/(1024*1024)).toFixed(1)}MB em ${((Date.now()-tFast)/1000).toFixed(1)}s`);
      } catch (fastErr) {
        console.warn(`[clickup-pilot-pipeline] assemble ${filename}: fast FALHOU (${(fastErr as Error)?.message?.slice(0,80)}), tentando re-encode...`);
        const tSlow = Date.now();
        assembled = await concatAvatarParts(blobs);
        console.log(`[clickup-pilot-pipeline] assemble ${filename}: SLOW OK ${(assembled.size/(1024*1024)).toFixed(1)}MB em ${((Date.now()-tSlow)/1000).toFixed(1)}s`);
      }
    } catch (e) {
      console.error(`[clickup-pilot-pipeline] assemble ${filename}: FAIL (ambos paths)`, e);
      out.push({ filename, rawAssembled: new Blob(), errors: { assemble: (e as Error)?.message || 'falha no concat' } });
      continue;
    }
    out.push({ filename, rawAssembled: assembled, _usedFastPath: usedFastPath } as AssembledPart & { _usedFastPath: boolean });
  }

  // === Stage 2: DECUPAGEM (com retry de assemble se fast produziu lixo) ===
  // Quando `decupagem: false`, pula stage inteiro — user pediu ad montado
  // sem cortes de silencio. Toggle por task no ClickUp Pilot.
  if (!decupagem) {
    console.log('[clickup-pilot-pipeline] decupagem desligada pelo toggle — pulando stage 2');
  } else for (let g = 0; g < out.length; g++) {
    const item = out[g] as AssembledPart & { _usedFastPath?: boolean };
    if (!item.rawAssembled || item.errors?.assemble) continue;
    onProgress?.({ stage: 'decupando', currentFilename: item.filename, doneCount: g, totalCount: total });

    const tryDecup = async (source: Blob): Promise<{ ok: true; decupado: Blob } | { ok: false; reason: string }> => {
      try {
        const audioBuf = await decodeAudioRobust(source);
        const silences = detectSilences(audioBuf);
        const segments = computeSpeechSegments(silences, audioBuf.duration, keepSilenceSec);
        console.log(`[clickup-pilot-pipeline] decup ${item.filename}: ${silences.length} silencios, ${segments.length} segmentos de fala`);
        if (segments.length === 0) return { ok: false, reason: 'Sem fala detectada' };
        const decupado = await cutVideoSegments(source, segments);
        return { ok: true, decupado };
      } catch (e) {
        return { ok: false, reason: (e as Error)?.message || 'falha decupagem' };
      }
    };

    let res = await tryDecup(item.rawAssembled);

    // Se fast concat foi usado e decupagem falhou (output sem timestamps validos),
    // re-faz assemble com re-encode + retenta decupagem
    if (!res.ok && item._usedFastPath) {
      console.warn(`[clickup-pilot-pipeline] decup ${item.filename}: fast deu output bogus (${res.reason.slice(0,80)}), re-fazendo assemble com re-encode...`);
      try {
        const { hookIdx } = groupings[g];
        const piecesIdx: number[] = [];
        if (hookIdx !== null) piecesIdx.push(hookIdx);
        piecesIdx.push(...bodies);
        const blobs = piecesIdx.map(i => parts[i].blob!).filter(Boolean);
        const tSlow = Date.now();
        const reAssembled = await concatAvatarParts(blobs);
        console.log(`[clickup-pilot-pipeline] re-assemble ${item.filename}: SLOW OK em ${((Date.now()-tSlow)/1000).toFixed(1)}s`);
        item.rawAssembled = reAssembled;
        item._usedFastPath = false;
        res = await tryDecup(reAssembled);
      } catch (e) {
        console.error(`[clickup-pilot-pipeline] re-assemble ${item.filename}: FAIL`, e);
      }
    }

    if (res.ok) {
      item.decupado = res.decupado;
      console.log(`[clickup-pilot-pipeline] decup ${item.filename}: OK ${(item.decupado.size/(1024*1024)).toFixed(1)}MB`);
    } else {
      console.error(`[clickup-pilot-pipeline] decup ${item.filename}: FAIL`, res.reason);
      item.errors = { ...item.errors, decupagem: res.reason };
    }
  }

  // === Stage 3: CAMUFLAGEM ===
  if (camuflagem) {
    if (!whiteAudio) {
      // Sem WHITE, marca erro em todos
      for (const item of out) {
        item.errors = { ...item.errors, camuflagem: 'Sem audio WHITE — selecione um arquivo na ferramenta' };
      }
    } else {
      // Se whiteAudio for video, extrai o audio primeiro
      let whiteBlob: Blob = whiteAudio;
      try {
        const isVideo = (whiteAudio.type || '').startsWith('video/') ||
          /\.(mp4|mov|webm|mkv)$/i.test((whiteAudio as File).name || '');
        if (isVideo) {
          whiteBlob = await extractAudio(whiteAudio);
        }
      } catch (e) {
        console.error(`[clickup-pilot-pipeline] camu extractAudio(white): FAIL`, e);
        for (const item of out) {
          item.errors = { ...item.errors, camuflagem: 'Falha extraindo audio do video WHITE: ' + (e as Error)?.message };
        }
        const summary = `${out.length} montagens · ${out.filter(i=>i.decupado).length} decupados · 0 camuflados (white falhou)`;
        return { items: out, diagnostics: { totalParts: parts.length, hooksFound: hooks.length, bodiesFound: bodies.length, unrecognizedLabels: unrecognized, summary } };
      }

      for (let g = 0; g < out.length; g++) {
        const item = out[g];
        const source = item.decupado || item.rawAssembled;
        if (!source || item.errors?.assemble) continue;
        onProgress?.({ stage: 'camuflando', currentFilename: item.filename, doneCount: g, totalCount: total });
        try {
          // Extrai audio do montado+decupado (BLACK)
          const blackAudio = await extractAudio(source);
          // Aplica camuflagem
          const camuWav = await camuflar({ black: blackAudio, white: whiteBlob, volumePercent: camuflagemVolume });
          // Substitui audio no video
          item.camuflado = await muxAudioIntoVideo(source, camuWav);
          console.log(`[clickup-pilot-pipeline] camu ${item.filename}: OK`);
        } catch (e) {
          console.error(`[clickup-pilot-pipeline] camu ${item.filename}: FAIL`, e);
          item.errors = { ...item.errors, camuflagem: (e as Error)?.message || 'falha camuflagem' };
        }
      }
    }
  }

  onProgress?.({ stage: 'done', doneCount: total, totalCount: total });
  const decupCount = out.filter(i=>i.decupado).length;
  const camuCount = out.filter(i=>i.camuflado).length;
  const summary = `${out.length} montagens · ${decupCount} decupados${camuflagem ? ` · ${camuCount} camuflados` : ''}`;
  console.log('[clickup-pilot-pipeline] DONE', summary);
  return { items: out, diagnostics: { totalParts: parts.length, hooksFound: hooks.length, bodiesFound: bodies.length, unrecognizedLabels: unrecognized, summary } };
}

/** Helper local — derivado de app/tools/decupagem/page.tsx pra evitar import
 *  cross-route. Calcula regioes "com som" como complemento das silenciosas. */
function computeSpeechSegments(
  silences: Array<{ start: number; end: number }>,
  totalDur: number,
  keepSilence: number,
): Array<{ start: number; end: number }> {
  const segs: Array<{ start: number; end: number }> = [];
  let cursor = 0;
  for (const s of silences) {
    const silStart = Math.max(0, s.start + keepSilence);
    const silEnd = Math.min(totalDur, s.end - keepSilence);
    if (silEnd > silStart) {
      if (silStart > cursor) segs.push({ start: cursor, end: silStart });
      cursor = silEnd;
    }
  }
  if (cursor < totalDur) segs.push({ start: cursor, end: totalDur });
  return segs.filter((s) => s.end - s.start > 0.05);
}
