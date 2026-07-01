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
import { concatAvatarParts, concatVideosFast, cutVideoSegments, muxAudioIntoVideo, extractAudio, prepareVoiceForDecupagem, cancelFFmpeg, normalizeForConcat } from './ffmpeg-worker';
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

  /** ── Cache de clips intermediários por PARTE (acelera RETOMAR/rebuild) ──
   *  Nivelar e decupar cada parte é o trabalho pesado (ffmpeg-wasm). Num
   *  re-run (RETOMAR/Atualizar montagem) o conteúdo das partes é o MESMO, então
   *  podemos reaproveitar o que já foi processado em vez de refazer do zero
   *  (o que fazia o RETOMAR levar ~100min). O caller persiste em IndexedDB.
   *
   *  `readClipCache`: LÊ do cache? Fresh dispatch passa false (conteúdo pode
   *  ter mudado — recomputa) mas SEMPRE escreve, populando p/ o próximo resume.
   *  Resume/rebuild passa true (conteúdo idêntico → reusa). */
  readClipCache?: boolean;
  loadCachedClip?: (kind: 'leveled' | 'decupado', label: string) => Promise<Blob | null>;
  saveCachedClip?: (kind: 'leveled' | 'decupado', label: string, blob: Blob) => Promise<void>;
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

/** Lê as durações das faixas de VÍDEO e ÁUDIO de um MP4 parseando o `moov` (puro
 *  JS, sem ffmpeg → rápido e sem tocar o singleton). Serve pra DETECTAR montagem
 *  dessincronizada: o concat por cópia (-c:v copy) com uma parte de params
 *  divergentes dropa o vídeo dela mas mantém o áudio → faixa de vídeo fica bem
 *  mais curta que a de áudio. Retorna null se não conseguir medir (aí o caller
 *  confia no resultado, pra não piorar). */
async function probeAVSync(blob: Blob): Promise<{ videoSec: number; audioSec: number } | null> {
  try {
    // Lê só um PREFIXO quando o blob é grande. Materializar 181MB inteiros logo
    // após um concat que já estressou a memória podia lançar RangeError/OOM → o
    // catch retornava null → o gate de sync se AUTO-DESLIGAVA justo na montagem
    // gigante (onde o desync é mais provável). Como TODO output da montagem grava
    // com +faststart (moov no INÍCIO — confirmado em concatAvatarParts/
    // normalizeForConcat/concatVideosFast/cutVideoSegments/muxAudioIntoVideo), 32MB
    // de prefixo bastam pra ler as durações das faixas. Se por acaso o moov não
    // estiver no prefixo, videoSec/audioSec saem 0 → null (fallback seguro atual).
    const CAP = 32 * 1024 * 1024;
    const head = blob.size > CAP ? blob.slice(0, CAP) : blob;
    const u8 = new Uint8Array(await head.arrayBuffer());
    if (u8.length < 16) return null;
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    const fourcc = (p: number) => String.fromCharCode(u8[p], u8[p + 1], u8[p + 2], u8[p + 3]);
    const boxes = (start: number, end: number, cb: (type: string, contentStart: number, boxEnd: number) => void) => {
      let p = start;
      while (p + 8 <= end) {
        let size = dv.getUint32(p);
        const type = fourcc(p + 4);
        let hdr = 8;
        if (size === 1) { size = Number(dv.getBigUint64(p + 8)); hdr = 16; }
        else if (size === 0) { size = end - p; }
        if (size < hdr || p + size > end) break;
        cb(type, p + hdr, p + size);
        p += size;
      }
    };
    let videoSec = 0, audioSec = 0;
    boxes(0, u8.length, (t, cs, be) => {
      if (t !== 'moov') return;
      boxes(cs, be, (t2, cs2, be2) => {
        if (t2 !== 'trak') return;
        let hdlr: string | null = null;
        let dur = 0;
        (function descend(s: number, e: number) {
          boxes(s, e, (t3, cs3, be3) => {
            if (t3 === 'mdia') descend(cs3, be3);
            else if (t3 === 'hdlr') hdlr = fourcc(cs3 + 8);
            else if (t3 === 'mdhd') {
              const ver = u8[cs3];
              const o = ver === 1 ? cs3 + 20 : cs3 + 12;
              const ts = dv.getUint32(o);
              const du = ver === 1 ? Number(dv.getBigUint64(o + 4)) : dv.getUint32(o + 4);
              if (ts > 0) dur = du / ts;
            }
          });
        })(cs2, be2);
        if (hdlr === 'vide') videoSec = Math.max(videoSec, dur);
        else if (hdlr === 'soun') audioSec = Math.max(audioSec, dur);
      });
    });
    if (videoSec <= 0 || audioSec <= 0) return null;
    return { videoSec, audioSec };
  } catch {
    return null;
  }
}

/** Roda pipeline completa. SEMPRE retorna info diagnostica — mesmo quando
 *  nao consegue produzir nada, explica por que. */
export async function runPostPipeline(input: PipelineInputs): Promise<PipelineResult> {
  // keepSilenceSec=0.12: margem mantida nas bordas das fala. Era 0.05 (muito
  // agressivo, video ficava entrecortado). 0.12 da pausa natural entre takes
  // sem soar robotico — feedback do user em 12/05/2026.
  const { baseAdId, parts, decupagem, camuflagem, whiteAudio, camuflagemVolume = 30, keepSilenceSec = 0.12, onProgress, readClipCache = false, loadCachedClip, saveCachedClip } = input;
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
      new Promise<T>((_, rej) => setTimeout(() => {
        // ffmpeg-wasm TRAVOU no worker. CRÍTICO: mata o worker (cancelFFmpeg) pra
        // a PRÓXIMA op — e o RETOMAR — começarem com instância LIMPA. Sem isso a
        // instância poisoned fazia TODA op seguinte (resto do nivelamento, concat,
        // decupagem) travar também → a task ficava presa em "regulando" pra sempre
        // e o RETOMAR re-travava no mesmo ponto (user reportou 2026-06-23). O
        // getFFmpeg() reinicializa sozinho na próxima chamada. Pipeline é serial,
        // então matar a instância aqui não afeta nenhuma outra op em andamento.
        try { cancelFFmpeg(); } catch { /* ignora */ }
        rej(new Error(`${label} timeout ${ms / 1000}s`));
      }, ms)),
    ]);

  // Timeout GENEROSO p/ concat (proporcional ao tamanho total) — nunca mata um
  // re-encode legítimo (mesmo de montagem grande), só pega um HANG infinito do
  // ffmpeg-wasm. fast=remux (rápido); slow=re-encode (lento). Pisos altos.
  const concatTimeoutMs = (blobs: Blob[], slow: boolean): number => {
    const mb = blobs.reduce((s, b) => s + (b?.size || 0), 0) / (1024 * 1024);
    return slow
      ? Math.max(600_000, Math.round(mb * 15_000))   // re-encode: 15s/MB, piso 10min
      : Math.max(180_000, Math.round(mb * 4_000));    // remux: 4s/MB, piso 3min
  };

  // Roda uma op ffmpeg-wasm com timeout + AUTO-RETRY (mata o worker entre
  // tentativas → instância limpa a cada try). Mesma lógica assertiva da
  // decupagem, reusável pras etapas frágeis transitórias (ex camuflagem). Só
  // p/ falhas TRANSITÓRIAS (hang/poison) — não usar onde a falha é determinística
  // (ex fast-concat com codec incompatível, que tem o slow-concat como fallback).
  const retryFFmpeg = async <T,>(fn: () => Promise<T>, ms: number, label: string, tries = 3): Promise<T> => {
    let lastErr: unknown = null;
    for (let attempt = 1; attempt <= tries; attempt++) {
      try {
        return await withTimeout(fn(), ms, `${label} (t${attempt})`);
      } catch (e) {
        lastErr = e;
        try { cancelFFmpeg(); } catch { /* ignora */ }
        if (attempt < tries) {
          console.warn(`[clickup-pilot-pipeline] ${label}: t${attempt} falhou (${(e as Error)?.message?.slice(0, 70)}) — reset+retry`);
        }
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(`${label}: esgotou ${tries} tentativas`);
  };

  // Concat ROBUSTO p/ montagem (multi-avatar / códecs diferentes): re-encoda
  // cada parte pros params UNIFORMES INDIVIDUALMENTE (memória pequena por
  // chamada, sem OOM do ffmpeg-wasm) e depois fast-concat (copy, sem re-encode).
  // Evita o concatAvatarParts MONOLÍTICO (N inputs num filter_complex de uma vez)
  // que ESTOURA a memória do wasm em montagem grande/multi-avatar (AD46: 13
  // partes Avatar 1+2 → concat falhava → "INCOMPLETO 0 montagens"). Se a
  // normalização de uma parte falhar, usa a original (o fast-concat tenta; e há
  // o fallback monolítico no fim).
  const concatRobust = async (blobs: Blob[], label: string): Promise<Blob> => {
    if (blobs.length === 1) return blobs[0];
    const normalized: Blob[] = [];
    let allNormalized = true;
    for (let i = 0; i < blobs.length; i++) {
      try {
        normalized.push(await retryFFmpeg(() => normalizeForConcat(blobs[i]), 120_000, `norm ${label} p${i + 1}/${blobs.length}`, 2));
      } catch {
        console.warn(`[clickup-pilot-pipeline] norm ${label} p${i + 1}: falhou — parte fica com params ORIGINAIS (não-uniformes)`);
        normalized.push(blobs[i]);
        allNormalized = false;
      }
    }
    // CRÍTICO: o fast-concat (concatVideosFast) usa -c:v copy. Ele SÓ é seguro se
    // TODAS as partes têm params de vídeo idênticos. Se UMA parte não normalizou
    // (ficou com params originais divergentes), o copy-concat DROPA o vídeo dela
    // mantendo o áudio → montagem dessincronizada (vídeo curto, áudio longo) SEM
    // erro. Por isso: só usa fast-concat quando TODAS normalizaram; se alguma
    // falhou, vai direto pro re-encode monolítico (filter_complex força uniforme,
    // nunca dropa stream). O gate de sync abaixo (verifyConcatSync) é a rede final.
    if (allNormalized) {
      try {
        return await withTimeout(concatVideosFast(normalized), concatTimeoutMs(normalized, false), `concat-norm ${label}`);
      } catch {
        return await retryFFmpeg(() => concatAvatarParts(normalized), concatTimeoutMs(normalized, true), `concat-mono ${label}`, 2);
      }
    }
    // alguma parte NÃO normalizou → re-encode monolítico direto (não arrisca copy)
    return await retryFFmpeg(() => concatAvatarParts(normalized), concatTimeoutMs(normalized, true), `concat-mono ${label}`, 2);
  };

  // ── GATE DE SINCRONIA (rede final) ────────────────────────────────────────
  // Mede a duração das faixas de VÍDEO e ÁUDIO do resultado de um concat. Se
  // divergirem além da tolerância, o concat dropou/truncou vídeo (bug do
  // copy-concat com parte divergente) → REFAZ com re-encode (concatAvatarParts,
  // que sincroniza por construção). Se MESMO ASSIM ficar fora de sync, LANÇA —
  // melhor falhar do que entregar um AD com lip-sync quebrado. probeAVSync é puro
  // (parse do moov, sem ffmpeg); null = não deu pra medir → não piora, confia.
  const verifyConcatSync = async (out: Blob, parts: Blob[], label: string): Promise<Blob> => {
    if (parts.length <= 1) return out;
    const sync = await probeAVSync(out);
    if (!sync) return out;
    const diff = Math.abs(sync.audioSec - sync.videoSec);
    // DETECÇÃO: cauda natural de áudio do HeyGen acumula <~0.5s; acima disso é
    // desync de verdade (copy-concat dropou o vídeo de uma parte).
    if (diff <= Math.max(0.5, sync.audioSec * 0.02)) return out;
    console.warn(`[clickup-pilot-pipeline] ${label}: DESSINCRONIZADO v=${sync.videoSec.toFixed(1)}s a=${sync.audioSec.toFixed(1)}s (diff ${diff.toFixed(1)}s) → re-encode pra sincronizar`);
    let fixed: Blob | null = null;
    try {
      fixed = await retryFFmpeg(() => concatAvatarParts(parts), concatTimeoutMs(parts, true), `concat-resync ${label}`, 2);
    } catch (e) {
      console.warn(`[clickup-pilot-pipeline] ${label}: re-encode de sync falhou (${(e as Error)?.message?.slice(0, 60)})`);
    }
    if (fixed) {
      // O re-encode (filter_complex + aresample=async=1) SINCRONIZA por construção
      // → é a MELHOR versão possível. ENTREGA ela. NÃO re-lança por uma sobra
      // pequena: era isso que bloqueava montado BOM (cauda natural em multi-avatar)
      // como "INCOMPLETO" à toa. O re-encode nunca dropa stream, então é seguro.
      const s2 = await probeAVSync(fixed);
      console.log(`[clickup-pilot-pipeline] ${label}: re-sync ${s2 ? `v=${s2.videoSec.toFixed(1)}s a=${s2.audioSec.toFixed(1)}s` : 'ok'}`);
      return fixed;
    }
    // Re-encode FALHOU (OOM/erro). Só BLOQUEIA (lança) se o desync original for
    // GRANDE (vídeo de fato faltando, tipo 14s do AD24) — aí não pode entregar
    // quebrado. Desync moderado → entrega o montado completo (não trava à toa).
    // Só BLOQUEIA (lança) quando o VÍDEO está de fato TRUNCADO — faixa de vídeo bem
    // mais curta que a de áudio (o copy-concat dropou o vídeo de uma parte, ex AD24).
    // Uma `diff` grande TAMBÉM aparece por CAUDA DE ÁUDIO legítima em multi-avatar
    // (aresample=async=1 estica o áudio alguns segundos) com o vídeo ÍNTEGRO — nesse
    // caso jogar fora o montado bom era um beco sem saída. Checamos o LADO do vídeo,
    // com a MESMA margem de antes, pra manter o bloqueio real e parar de descartar bom.
    const videoTruncado = sync.videoSec < sync.audioSec - Math.max(4, sync.audioSec * 0.15);
    if (videoTruncado) {
      throw new Error(`montagem ${label} com vídeo faltando (v=${sync.videoSec.toFixed(1)}s a=${sync.audioSec.toFixed(1)}s) e re-encode falhou`);
    }
    console.warn(`[clickup-pilot-pipeline] ${label}: re-encode falhou mas VÍDEO ÍNTEGRO (v=${sync.videoSec.toFixed(1)}s a=${sync.audioSec.toFixed(1)}s — cauda de áudio) → entrega o montado original`);
    return out;
  };

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
  // partLabels[i] = label da parte i (ex 'BODY 3') → chave do cache de clip.
  // Se readClipCache e há clip 'leveled' salvo dessa parte, REUSA (pula o
  // nivelamento pesado). Sempre ESCREVE pra acelerar o próximo resume.
  const nivelarPartes = async (blobs: Blob[], partLabels: string[], groupLabel: string): Promise<Blob[]> => {
    const out2: Blob[] = [];
    for (let i = 0; i < blobs.length; i++) {
      const lbl = partLabels[i];
      if (readClipCache && loadCachedClip && lbl) {
        try {
          const cached = await loadCachedClip('leveled', lbl);
          if (cached && cached.size > 1024) {
            console.log(`[clickup-pilot-pipeline] nivel ${lbl}: CACHE HIT (pulou nivelamento)`);
            out2.push(cached);
            continue;
          }
        } catch {}
      }
      const leveled = await regularVoz(blobs[i], `${groupLabel} parte ${i + 1}/${blobs.length}`);
      out2.push(leveled);
      if (saveCachedClip && lbl) {
        try { await saveCachedClip('leveled', lbl, leveled); } catch {}
      }
    }
    return out2;
  };

  // CLEAN SLATE por task: mata qualquer instância ffmpeg-wasm HERDADA (de uma
  // task anterior do MESMO lote, ou de um run que travou) pra ESTE pipeline
  // começar com worker FRESCO. Cross-task poisoning (instância degradada pela
  // task anterior) era o que fazia "o 1º do lote vai e o resto trava em
  // decupando/regulando". getFFmpeg() reinicializa sozinho na 1ª op (~1-3s, do
  // cache). O pipeline roda SERIAL (runPostPipelineSerial) → matar a instância
  // aqui nunca atinge outra op em andamento.
  try { cancelFFmpeg(); } catch { /* ignora */ }

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
    const blobLabels: string[] = []; // labels das partes COM blob (paralelo a `blobs`)
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
      blobLabels.push(p.label);
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
    const leveledBlobs = await nivelarPartes(blobs, blobLabels, filename);

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
        assembled = await withTimeout(concatVideosFast(leveledBlobs), concatTimeoutMs(leveledBlobs, false), `concat-fast ${filename}`);
        usedFastPath = true;
        console.log(`[clickup-pilot-pipeline] assemble ${filename}: FAST OK ${(assembled.size/(1024*1024)).toFixed(1)}MB em ${((Date.now()-tFast)/1000).toFixed(1)}s`);
      } catch (fastErr) {
        console.warn(`[clickup-pilot-pipeline] assemble ${filename}: fast FALHOU (${(fastErr as Error)?.message?.slice(0,80)}), normalizando parte-a-parte (anti-OOM)...`);
        const tSlow = Date.now();
        // ROBUSTO: normaliza cada parte individualmente + fast-concat — NÃO o
        // concat monolítico (que estoura memória em montagem multi-avatar).
        assembled = await concatRobust(leveledBlobs, filename);
        console.log(`[clickup-pilot-pipeline] assemble ${filename}: ROBUST OK ${(assembled.size/(1024*1024)).toFixed(1)}MB em ${((Date.now()-tSlow)/1000).toFixed(1)}s`);
      }
      // GATE: garante que o montado não saiu dessincronizado (vídeo curto/áudio
      // longo do copy-concat). Se saiu, refaz com re-encode; se nem assim, lança
      // → cai no catch abaixo (assemble error) e NÃO entrega versão quebrada.
      assembled = await verifyConcatSync(assembled, leveledBlobs, `assemble ${filename}`);
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
      // gigante). Liberadas após a decupagem. _partLabels = chaves do cache.
      _leveledParts: leveledBlobs,
      _partLabels: blobLabels,
    } as AssembledPart & { _usedFastPath: boolean; _leveledParts: Blob[]; _partLabels: string[] });
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
    const item = out[g] as AssembledPart & { _leveledParts?: Blob[]; _partLabels?: string[] };
    if (item.errors?.assemble) continue;
    const leveled = item._leveledParts || [];
    const partLabels = item._partLabels || [];
    if (leveled.length === 0) continue;

    // Decupa UMA parte. Retorna o blob cortado, ou null se não dá pra cortar
    // (sem fala detectável OU erro persistente) — aí o chamador usa a original.
    // ASSERTIVIDADE: o ffmpeg-wasm trava de forma INTERMITENTE (uma parte que
    // falha numa tentativa costuma passar na seguinte com instância limpa). Em
    // vez de depender do user clicar RETOMAR de novo, AUTO-TENTA até 3x, MATANDO
    // o worker entre tentativas (cancelFFmpeg → getFFmpeg reinicia fresco). Só
    // "sem fala detectável" (não é erro) retorna na hora, sem retry.
    const tryDecupOne = async (src: Blob, label: string): Promise<Blob | null> => {
      const MAX = 3;
      for (let attempt = 1; attempt <= MAX; attempt++) {
        try {
          const audioBuf = await withTimeout(decodeAudioRobust(src), 90_000, `decode ${label} (t${attempt})`);
          const durSec = audioBuf.duration || 0;
          const silences = detectSilences(audioBuf);
          const segments = computeSpeechSegments(silences, durSec, keepSilenceSec);
          if (segments.length === 0) return null; // sem fala → mantém original (NÃO é erro)
          // Parte é curta; teto generoso por segurança (não é o tempo esperado).
          const cutMs = Math.max(60_000, Math.ceil(durSec) * 6000 + 30_000);
          return await withTimeout(cutVideoSegments(src, segments), cutMs, `cut ${label} (t${attempt})`);
        } catch (e) {
          const msg = (e as Error)?.message?.slice(0, 70);
          // Mata o worker pra a PRÓXIMA tentativa pegar instância LIMPA (timeout
          // já reseta via withTimeout; numa falha não-timeout reseta aqui).
          try { cancelFFmpeg(); } catch { /* ignora */ }
          if (attempt < MAX) {
            console.warn(`[clickup-pilot-pipeline] decup ${label}: t${attempt} falhou (${msg}) — reset+retry`);
            continue;
          }
          console.warn(`[clickup-pilot-pipeline] decup ${label}: ${MAX}x falhou (${msg}), mantendo parte original`);
          return null;
        }
      }
      return null;
    };

    const decupadoParts: Blob[] = [];
    let cutCount = 0;
    for (let k = 0; k < leveled.length; k++) {
      onProgress?.({ stage: 'decupando', currentFilename: `${item.filename} (${k + 1}/${leveled.length})`, doneCount: g, totalCount: total });
      const lbl = partLabels[k];
      // CACHE: num re-run, reusa o decupado já feito dessa parte (pula corte).
      let cut: Blob | null = null;
      if (readClipCache && loadCachedClip && lbl) {
        try {
          const c = await loadCachedClip('decupado', lbl);
          if (c && c.size > 1024) { cut = c; console.log(`[clickup-pilot-pipeline] decup ${lbl}: CACHE HIT (pulou corte)`); }
        } catch {}
      }
      if (!cut) {
        cut = await tryDecupOne(leveled[k], `${item.filename} p${k + 1}/${leveled.length}`);
        if (cut && cut.size > 1024 && saveCachedClip && lbl) {
          try { await saveCachedClip('decupado', lbl, cut); } catch {}
        }
      }
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
        // todas cortadas com params idênticos → fast concat; se falhar, robusto.
        try { dec = await withTimeout(concatVideosFast(decupadoParts), concatTimeoutMs(decupadoParts, false), `decup-concat-fast ${item.filename}`); }
        catch { dec = await concatRobust(decupadoParts, `decup ${item.filename}`); }
      } else {
        // MISTURA (parte cortada + original) → códecs divergem → robusto (anti-OOM).
        dec = await concatRobust(decupadoParts, `decup ${item.filename}`);
      }
      // GATE: o caso MISTO (alguma parte caiu no leveled original) é justamente o
      // que dropava o vídeo de UMA parte no copy-concat (AD24: BODY 1.1 sumiu do
      // vídeo, áudio ficou → 13s de dessync). Verifica e, se preciso, refaz com
      // re-encode. Se nem assim sincronizar, lança → vira erro de decupagem (cai
      // no montado completo já verificado), nunca entrega decupado quebrado.
      dec = await verifyConcatSync(dec, decupadoParts, `decup ${item.filename}`);
      item.decupado = dec;
      console.log(`[clickup-pilot-pipeline] decup ${item.filename}: OK ${cutCount}/${leveled.length} partes cortadas · ${(dec.size / (1024 * 1024)).toFixed(1)}MB`);
    } catch (e) {
      console.error(`[clickup-pilot-pipeline] decup ${item.filename}: concat dos decupados FAIL`, e);
      item.errors = { ...item.errors, decupagem: 'concat dos decupados falhou: ' + ((e as Error)?.message || '?') };
    }
    item._leveledParts = undefined; // libera memória das partes niveladas
  }

  // === GARANTIA DE CONCLUSÃO (decupagem é REALCE, não conteúdo) ===
  // Toda montagem COMPLETA (conteúdo íntegro) PRECISA ter um `decupado` pra task
  // chegar a 100% PRONTO (o gate pipeOk exige okDecupados === expectedMontagens).
  // Se a decupagem (passo frágil do ffmpeg-wasm) não produziu corte pra alguma —
  // sem fala detectável, timeout, concat falho, etc. — ENTREGA o montado completo
  // como resultado. Assim a task SEMPRE conclui no RETOMAR; nunca fica presa em
  // "PÓS-PROCESSO PARCIAL" só porque o corte não rodou. NÃO mexe em quem teve
  // FALHA DE CONTEÚDO (assemble falho / parte faltando) — esses ficam bloqueados
  // de propósito (gate de incompleta). NÃO é cacheado como 'decupado' → um
  // RETOMAR futuro com ffmpeg saudável ainda tenta o corte de verdade.
  if (decupagem) {
    for (const item of out) {
      if (item.errors?.assemble) continue;       // montagem falhou → bloqueia (correto)
      if (item.missingParts?.length) continue;   // falta conteúdo → bloqueia (correto)
      if (!item.decupado && item.rawAssembled && item.rawAssembled.size > 0) {
        item.decupado = item.rawAssembled;       // fallback: entrega montado completo → task conclui
        console.warn(`[clickup-pilot-pipeline] decup ${item.filename}: SEM corte — entregue montado COMPLETO (task conclui, decupagem é realce)`);
      }
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
          whiteBlob = await retryFFmpeg(() => extractAudio(whiteAudio), 180_000, 'extractAudio(white)');
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
          // AUTO-RETRY (reset entre tentativas): extrai BLACK → camufla → remuxa.
          // Camuflagem é HARD requirement do META (não pode entregar áudio NÃO
          // camuflado), então na falha FINAL fica como ERRO (bloqueia) — diferente
          // da decupagem (realce, que cai no montado completo). Timeout generoso
          // proporcional ao tamanho do montado.
          const camuMs = Math.max(180_000, Math.round((source.size / (1024 * 1024)) * 8_000));
          item.camuflado = await retryFFmpeg(async () => {
            const blackAudio = await extractAudio(source);                                  // BLACK
            const camuWav = await camuflar({ black: blackAudio, white: whiteBlob, volumePercent: camuflagemVolume });
            return await muxAudioIntoVideo(source, camuWav);                                // substitui audio
          }, camuMs, `camu ${item.filename}`);
          console.log(`[clickup-pilot-pipeline] camu ${item.filename}: OK`);
        } catch (e) {
          console.error(`[clickup-pilot-pipeline] camu ${item.filename}: FAIL (após retries)`, e);
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
