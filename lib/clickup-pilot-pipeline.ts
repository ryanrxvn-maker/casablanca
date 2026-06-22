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
import { concatAvatarParts, concatVideosFast, cutVideoSegments, muxAudioIntoVideo, extractAudio, prepareVoiceForDecupagem } from './ffmpeg-worker';
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
  /** Labels de partes ESPERADAS (expected:true) que faltaram blob e foram
   *  puladas → a montagem saiu INCOMPLETA ("faltando texto"). Se preenchido,
   *  a task NUNCA deve marcar 100% pronto nem liberar download limpo. */
  missingParts?: string[];
};

export type PipelineProgress = {
  stage: 'assembling' | 'regulando' | 'decupando' | 'camuflando' | 'done';
  currentFilename?: string;
  doneCount: number;
  totalCount: number;
};

export type PipelineInputs = {
  /** baseAdId da task (ex: AD140GL ou AD140G) — sufixo G[N] sera inserido */
  baseAdId: string;
  /** MP4s individuais ja baixados, na ordem do plan (HOOK 1, HOOK 2, ..., BODY 1, BODY 2, ...)
   *  `expected: true` = essa parte TEM conteúdo (foi disparada/renderizada) e
   *  DEVE ter blob. Se vier sem blob, a montagem é flagada como incompleta
   *  (≠ parte intencionalmente vazia, que vem com expected ausente/false). */
  parts: Array<{ label: string; blob: Blob | null; expected?: boolean }>;
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

  // Helper compartilhado: roda uma promise com timeout. ffmpeg-wasm pode TRAVAR
  // (loop infinito) num decode de áudio corrompido — sem timeout o pipeline
  // ficava pendurado pra sempre (user reportou RETOMAR travando, 2026-05-28).
  const withTimeout = <T,>(p: Promise<T>, ms: number, label: string): Promise<T> =>
    Promise.race([
      p,
      new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`${label} timeout ${ms / 1000}s`)), ms)),
    ]);

  // Regula a voz de UM clipe a -16 LUFS: denoise (limpa hiss/ruído) +
  // nivelamento transparente (loudnorm linear, perfil 'natural' SEM speechnorm
  // → sem robótico) + true-peak -1.5 (anti-clipping). NUNCA lança: se
  // falhar/timeout, devolve o blob original intacto.
  const regularVoz = async (blob: Blob, label: string): Promise<Blob> => {
    try {
      return await withTimeout(
        prepareVoiceForDecupagem(blob, { onStage: (s) => console.log(`[clickup-pilot-pipeline] regul ${label}: ${s}`) }),
        150_000,
        'regulagemVoz',
      );
    } catch (e) {
      console.warn(`[clickup-pilot-pipeline] regul ${label}: falhou (${(e as Error)?.message?.slice(0, 80)}), mantendo clipe original`);
      return blob;
    }
  };

  // Nivela CADA parte a -16 LUFS ANTES de concatenar. É o que IGUALA o volume
  // de avatares/renders diferentes (HOOK gravado alto, BODY baixo, etc.): como
  // um editor profissional, normaliza cada clipe pro mesmo patamar e SÓ DEPOIS
  // monta. Nivelar o montado inteiro (loudnorm linear) NÃO resolvia — aplica um
  // ganho único, então a parte alta continua alta e a baixa baixa (medido: gap
  // de 20 LUFS só caía pra 7.6). Por-parte → todas no MESMO patamar (~-16 LUFS;
  // o dynaudnorm já junta as partes e o ganho estático mira -16, capando só
  // picos raros — resíduo <2 LUFS, bem abaixo do gap audível de antes).
  // Sequencial (não Promise.all): ffmpeg-wasm é instância única, exec paralelo
  // colidiria no FS virtual. Roda mesmo com decupagem DESLIGADA.
  const nivelarPartes = async (blobs: Blob[], label: string): Promise<Blob[]> => {
    const out2: Blob[] = [];
    for (let i = 0; i < blobs.length; i++) {
      out2.push(await regularVoz(blobs[i], `${label} parte ${i + 1}/${blobs.length}`));
    }
    return out2;
  };

  // === Stage 1: ASSEMBLE (HOOK[N] + BODYs concatenados, cada parte nivelada) ===
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
    // Partes ESPERADAS (expected:true = tinha conteúdo/foi renderizada) que
    // chegaram SEM blob → a montagem vai sair "faltando texto". Isso NÃO é
    // uma parte intencionalmente vazia: é conteúdo perdido (download falhou,
    // cache sumiu, etc). Tem que travar o "100% pronto" e o download limpo.
    const missingExpected: string[] = [];
    for (const i of piecesIdx) {
      const p = parts[i];
      if (!p?.blob) {
        // PARTE SEM BLOB — PULA, não aborta. Comum: BODY vazia
        // ("(vazio — esse part nao vai gerar nada)") nunca dispara/renderiza,
        // OU 1 parte falhou no download mas as outras estão OK.
        // User reportou (2026-05-27): RETOMAR travava porque 1 parte vazia
        // fazia break → montagem inteira abortava. Agora monta com o que tem.
        skippedLabels.push(p?.label || '?');
        if (p?.expected) missingExpected.push(p.label || '?');
        continue;
      }
      blobs.push(p.blob);
    }
    if (skippedLabels.length > 0) {
      console.warn(`[clickup-pilot-pipeline] assemble ${filename}: PULOU ${skippedLabels.length} parte(s) sem video (${skippedLabels.join(', ')}), montando com ${blobs.length} disponíveis`);
    }
    if (missingExpected.length > 0) {
      console.error(`[clickup-pilot-pipeline] assemble ${filename}: INCOMPLETA — faltou ${missingExpected.length} parte(s) ESPERADA(s) (${missingExpected.join(', ')}). Montagem NÃO está 100%.`);
    }
    if (blobs.length === 0) {
      console.warn(`[clickup-pilot-pipeline] assemble ${filename}: SKIP - nenhuma parte com video`);
      out.push({ filename, rawAssembled: new Blob(), errors: { assemble: 'nenhuma parte com video disponivel' } });
      continue;
    }

    // NIVELA cada parte a -16 LUFS ANTES de juntar → iguala avatares/renders
    // de volumes diferentes + limpa hiss + crava true-peak (anti-clipping).
    onProgress?.({ stage: 'regulando', currentFilename: filename, doneCount: g, totalCount: total });
    const leveledBlobs = await nivelarPartes(blobs, filename);

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
        assembled = await concatVideosFast(leveledBlobs);
        usedFastPath = true;
        console.log(`[clickup-pilot-pipeline] assemble ${filename}: FAST OK ${(assembled.size/(1024*1024)).toFixed(1)}MB em ${((Date.now()-tFast)/1000).toFixed(1)}s`);
      } catch (fastErr) {
        console.warn(`[clickup-pilot-pipeline] assemble ${filename}: fast FALHOU (${(fastErr as Error)?.message?.slice(0,80)}), tentando re-encode...`);
        const tSlow = Date.now();
        assembled = await concatAvatarParts(leveledBlobs);
        console.log(`[clickup-pilot-pipeline] assemble ${filename}: SLOW OK ${(assembled.size/(1024*1024)).toFixed(1)}MB em ${((Date.now()-tSlow)/1000).toFixed(1)}s`);
      }
    } catch (e) {
      console.error(`[clickup-pilot-pipeline] assemble ${filename}: FAIL (ambos paths)`, e);
      out.push({ filename, rawAssembled: new Blob(), errors: { assemble: (e as Error)?.message || 'falha no concat' } });
      continue;
    }
    out.push({
      filename,
      rawAssembled: assembled,
      missingParts: missingExpected.length ? missingExpected : undefined,
      _usedFastPath: usedFastPath,
      // Guarda as partes JÁ NIVELADAS pra Stage 2 decupar uma a uma (arquivos
      // pequenos = ffmpeg-wasm confiável, sem estouro de memória da montagem
      // gigante). Liberadas após a decupagem.
      _leveledParts: leveledBlobs,
    } as AssembledPart & { _usedFastPath: boolean; _leveledParts: Blob[] });
  }

  // (A regulagem de voz agora acontece POR PARTE no Stage 1, antes do concat —
  // ver nivelarPartes/regularVoz acima. Assim o montado já sai limpo, nivelado
  // e com volumes IGUAIS entre as partes, com ou sem decupagem.)

  // === Stage 2: DECUPAGEM POR PARTE (robusto p/ montagem grande) ===
  // ANTES: decupava a montagem JÁ CONCATENADA (ex: 181MB, vários min) num
  // cutVideoSegments só. Em vídeo grande o ffmpeg-wasm estourava MEMÓRIA/timeout
  // → 0 decupados → task travava em INCOMPLETO mesmo com TODOS os takes prontos.
  // Aumentar o timeout só resolvia o caso médio (montagem de ~5min cabia), NÃO o
  // grande (181MB continuava estourando memória).
  //
  // AGORA: decupa CADA PARTE nivelada individualmente (arquivo pequeno ~10-40s =
  // ffmpeg-wasm SEMPRE engole, rápido e sem estouro) e concatena os decupados.
  // Se uma parte falhar (sem fala/erro), usa a versão nivelada ORIGINAL dela →
  // NUNCA perde conteúdo. O resultado: decupagem funciona em qualquer tamanho de
  // montagem. Bônus: o keepSilence=0.12 nas bordas de cada parte vira a pausa
  // natural entre takes que o user pediu.
  // Quando `decupagem: false`, pula stage inteiro (toggle por task).
  if (!decupagem) {
    console.log('[clickup-pilot-pipeline] decupagem desligada pelo toggle — pulando stage 2');
  } else for (let g = 0; g < out.length; g++) {
    const item = out[g] as AssembledPart & { _leveledParts?: Blob[] };
    if (item.errors?.assemble) continue;
    const leveled = item._leveledParts || [];
    if (leveled.length === 0) continue;

    // Decupa UMA parte. Retorna o blob cortado, ou null se não dá pra cortar
    // (sem fala detectável OU erro) — aí o chamador usa a parte original.
    const tryDecupOne = async (src: Blob, label: string): Promise<Blob | null> => {
      try {
        const audioBuf = await withTimeout(decodeAudioRobust(src), 90_000, `decode ${label}`);
        const durSec = audioBuf.duration || 0;
        const silences = detectSilences(audioBuf);
        const segments = computeSpeechSegments(silences, durSec, keepSilenceSec);
        if (segments.length === 0) return null; // sem fala detectável → mantém original
        // Parte é curta; teto generoso por segurança (não é o tempo esperado).
        const cutMs = Math.max(60_000, Math.ceil(durSec) * 6000 + 30_000);
        return await withTimeout(cutVideoSegments(src, segments), cutMs, `cut ${label}`);
      } catch (e) {
        console.warn(`[clickup-pilot-pipeline] decup ${label}: falhou (${(e as Error)?.message?.slice(0, 70)}), mantendo parte original`);
        return null;
      }
    };

    const decupadoParts: Blob[] = [];
    let cutCount = 0;
    for (let k = 0; k < leveled.length; k++) {
      onProgress?.({ stage: 'decupando', currentFilename: `${item.filename} (${k + 1}/${leveled.length})`, doneCount: g, totalCount: total });
      const cut = await tryDecupOne(leveled[k], `${item.filename} p${k + 1}/${leveled.length}`);
      if (cut && cut.size > 1024) { decupadoParts.push(cut); cutCount++; }
      else decupadoParts.push(leveled[k]); // fallback: parte nivelada original (sem corte)
    }

    if (cutCount === 0) {
      // Nenhuma parte tinha fala detectável pra cortar → não há decupagem real;
      // deixa o rawAssembled como entrega (montado sem corte).
      console.warn(`[clickup-pilot-pipeline] decup ${item.filename}: 0/${leveled.length} partes cortadas — entregando montado sem decupagem`);
      item.errors = { ...item.errors, decupagem: 'nenhuma parte com fala detectável pra decupar' };
      item._leveledParts = undefined;
      continue;
    }

    // Concatena os decupados. Se TODAS as partes foram cortadas, elas têm codec/
    // params idênticos (cutVideoSegments usa params fixos) → fast concat (copy,
    // sem re-encode, sem perda). Se houve MISTURA (alguma parte original como
    // fallback, codec pode divergir) → slow concat que normaliza tudo.
    try {
      let dec: Blob;
      if (decupadoParts.length === 1) {
        dec = decupadoParts[0];
      } else if (cutCount === leveled.length) {
        try { dec = await concatVideosFast(decupadoParts); }
        catch { dec = await concatAvatarParts(decupadoParts); }
      } else {
        dec = await concatAvatarParts(decupadoParts);
      }
      item.decupado = dec;
      console.log(`[clickup-pilot-pipeline] decup ${item.filename}: OK ${cutCount}/${leveled.length} partes cortadas · ${(dec.size / (1024 * 1024)).toFixed(1)}MB`);
    } catch (e) {
      console.error(`[clickup-pilot-pipeline] decup ${item.filename}: concat dos decupados FAIL`, e);
      item.errors = { ...item.errors, decupagem: 'concat dos decupados falhou: ' + ((e as Error)?.message || '?') };
    }
    item._leveledParts = undefined; // libera memória das partes niveladas
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
  const incompletas = out.filter(i=>i.missingParts?.length);
  const incompletoStr = incompletas.length
    ? ` · ⚠ ${incompletas.length} INCOMPLETA(s) [${incompletas.map(i=>`${i.filename}: faltou ${i.missingParts!.join('/')}`).join('; ')}]`
    : '';
  const summary = `${out.length} montagens · ${decupCount} decupados${camuflagem ? ` · ${camuCount} camuflados` : ''}${incompletoStr}`;
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
