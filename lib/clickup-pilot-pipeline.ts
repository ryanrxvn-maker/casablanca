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
import { concatAvatarParts, cutVideoSegments, muxAudioIntoVideo, extractAudio } from './ffmpeg-worker';
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
   *  inicio/fim de palavras pra nao cortar nada) */
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

/** Roda pipeline completa. Retorna lista de versoes prontas (1 por hook).
 *  Se nao tem hook (so body), gera 1 versao com baseAdId + corpo decupado. */
export async function runPostPipeline(input: PipelineInputs): Promise<AssembledPart[]> {
  const { baseAdId, parts, camuflagem, whiteAudio, camuflagemVolume = 30, keepSilenceSec = 0.05, onProgress } = input;
  const { hooks, bodies } = classifyParts(parts);
  const out: AssembledPart[] = [];

  // Sem hooks → 1 versao so do body (se tiver). Se nao tem body tambem, retorna vazio.
  const groupings: Array<{ hookIdx: number | null; gNum: number }> = [];
  if (hooks.length === 0) {
    if (bodies.length > 0) groupings.push({ hookIdx: null, gNum: 1 });
  } else {
    hooks.forEach((idx, i) => groupings.push({ hookIdx: idx, gNum: i + 1 }));
  }

  const total = groupings.length;

  // === Stage 1: ASSEMBLE (HOOK[N] + BODYs concatenados) ===
  for (let g = 0; g < groupings.length; g++) {
    const { hookIdx, gNum } = groupings[g];
    const filename = `${insertGSuffix(baseAdId, gNum)}.mp4`;
    onProgress?.({ stage: 'assembling', currentFilename: filename, doneCount: g, totalCount: total });

    const piecesIdx: number[] = [];
    if (hookIdx !== null) piecesIdx.push(hookIdx);
    piecesIdx.push(...bodies);

    const blobs: Blob[] = [];
    let assembleErr: string | undefined;
    for (const i of piecesIdx) {
      const p = parts[i];
      if (!p?.blob) {
        assembleErr = `Parte "${p?.label || '?'}" sem video disponivel`;
        break;
      }
      blobs.push(p.blob);
    }
    if (assembleErr || blobs.length === 0) {
      out.push({ filename, rawAssembled: blobs[0] || new Blob(), errors: { assemble: assembleErr || 'sem partes' } });
      continue;
    }

    let assembled: Blob;
    try {
      assembled = await concatAvatarParts(blobs);
    } catch (e) {
      out.push({ filename, rawAssembled: new Blob(), errors: { assemble: (e as Error)?.message || 'falha no concat' } });
      continue;
    }
    out.push({ filename, rawAssembled: assembled });
  }

  // === Stage 2: DECUPAGEM ===
  for (let g = 0; g < out.length; g++) {
    const item = out[g];
    if (!item.rawAssembled || item.errors?.assemble) continue;
    onProgress?.({ stage: 'decupando', currentFilename: item.filename, doneCount: g, totalCount: total });
    try {
      const audioBuf = await decodeAudioRobust(item.rawAssembled);
      const silences = detectSilences(audioBuf);
      const segments = computeSpeechSegments(silences, audioBuf.duration, keepSilenceSec);
      if (segments.length === 0) {
        item.errors = { ...item.errors, decupagem: 'Sem fala detectada' };
        continue;
      }
      item.decupado = await cutVideoSegments(item.rawAssembled, segments);
    } catch (e) {
      item.errors = { ...item.errors, decupagem: (e as Error)?.message || 'falha decupagem' };
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
        for (const item of out) {
          item.errors = { ...item.errors, camuflagem: 'Falha extraindo audio do video WHITE: ' + (e as Error)?.message };
        }
        return out;
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
        } catch (e) {
          item.errors = { ...item.errors, camuflagem: (e as Error)?.message || 'falha camuflagem' };
        }
      }
    }
  }

  onProgress?.({ stage: 'done', doneCount: total, totalCount: total });
  return out;
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
