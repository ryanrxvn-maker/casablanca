'use client';

/**
 * lib/lipsync-pipeline — pré/pós-produção client-side do LipSync, em cima
 * dos helpers ffmpeg.wasm que já existem (ffmpeg-worker + lipsync-postprocess).
 *
 * Tudo roda em WORKER (não trava a UI) e por TRECHO (chunk) curto — nunca
 * uma operação gigante de uma vez, então não estoura memória nem congela.
 *
 * Fases:
 *  - prepareFaceVideo: comprime o rosto pra ≤720p quando grande/alto-res
 *    (aceita input até 300MB, mas sobe leve — cabe nos limites de storage).
 *  - cleanAudioMp3: extrai+limpa o áudio (highpass+compress+loudnorm) → mp3
 *    pequeno (lip melhor + extrai áudio de mp4 também).
 *  - splitAudioChunks: divide áudio longo em trechos ≤~170s (motor processa
 *    até ~180s por vez → suportamos até 10min costurando os trechos).
 *  - enhanceLipVideo: realça o resultado (denoise+sharpen+grading).
 *  - concatLipVideos: costura os trechos (stream-copy de vídeo = leve).
 */

import type { FFmpeg } from '@ffmpeg/ffmpeg';
import {
  getFFmpeg,
  normalizeVolume,
  probeVideoMetadata,
  concatVideosFast,
  mountInputs,
  type FFLoadStage,
} from './ffmpeg-worker';
import { postprocessLipSyncOutput } from './lipsync-postprocess';
import {
  parseFramecrc,
  planFaceCuts,
  faceCoversAudio,
  MAX_SEG_SEC,
  type FaceInfo,
  type FacePlan,
  type Silence,
} from './lipsync-chunk-plan';

/**
 * Máx por trecho. Agora o disparo é ASSÍNCRONO (POST submete e volta; o cliente
 * acompanha o render por /status) — então o trecho NÃO precisa mais caber no
 * teto de 300s da função serverless. O único limite real é o do MOTOR, que
 * aceita ~180s por geração. Por isso voltamos a trechos longos: menos emendas,
 * menos uploads, mais rápido. Áudio ≤~178s vira UMA geração só (zero costura).
 */
export const MAX_CHUNK_SEC = 170;
/** Acima disso, o áudio é dividido em trechos (deixa folga sob o limite ~180s). */
export const CHUNK_THRESHOLD_SEC = 178;

/** Limite seguro do Supabase Storage (cap ~50MB) — abaixo disso vai nativo. */
const STORAGE_SAFE_BYTES = 44 * 1024 * 1024;

function ffToFile(data: Uint8Array | string, name: string, type: string): File {
  if (typeof data === 'string') return new File([data], name, { type });
  const copy = new Uint8Array(data.length);
  copy.set(data);
  return new File([copy.buffer], name, { type });
}

/**
 * SERIALIZA ffmpeg.wasm. O core é single-thread e a instância é um
 * SINGLETON (getFFmpeg) — dois `exec()` concorrentes corrompem o FS
 * virtual / quebram. Como agora o usuário pode disparar VÁRIAS gerações
 * ao mesmo tempo (cards não-bloqueantes), toda etapa de ffmpeg passa por
 * esta fila: roda uma de cada vez, na ordem em que chegou. A geração no
 * motor (rede) continua paralela — só o ffmpeg é serial.
 */
let ffChain: Promise<unknown> = Promise.resolve();
export function withFFLock<T>(fn: () => Promise<T>): Promise<T> {
  const result = ffChain.then(() => fn());
  // A corrente segue mesmo se um job falhar (não trava a fila).
  ffChain = result.then(() => undefined, () => undefined);
  return result;
}

/** Cronometra uma etapa e empilha em window.__lipTimings (debug/medição). */
function track<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  return fn().finally(() => {
    const ms = Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0);
    try {
      const w = window as unknown as { __lipTimings?: { label: string; ms: number }[] };
      w.__lipTimings = w.__lipTimings || [];
      w.__lipTimings.push({ label, ms });
    } catch {
      /* ignore */
    }
  });
}

/** Mede duração (s) de mídia via elemento HTML, sem ffmpeg. */
export function probeDurationSec(file: File): Promise<number> {
  return new Promise((resolve) => {
    try {
      const url = URL.createObjectURL(file);
      const el = document.createElement(file.type.startsWith('video') ? 'video' : 'audio');
      el.preload = 'metadata';
      el.onloadedmetadata = () => {
        const d = el.duration || 0;
        URL.revokeObjectURL(url);
        resolve(Number.isFinite(d) ? d : 0);
      };
      el.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(0);
      };
      el.src = url;
    } catch {
      resolve(0);
    }
  });
}

/** probeDurationSec com TETO de tempo: em aba de fundo o `loadedmetadata`
 *  pode nunca disparar, e o disparo não pode pendurar por isso. 0 = não sei. */
function probeDurationCapped(file: File, ms = 6000): Promise<number> {
  return Promise.race([
    probeDurationSec(file),
    new Promise<number>((resolve) => setTimeout(() => resolve(0), ms)),
  ]);
}

/**
 * PRÉ-PRODUÇÃO (áudio): extrai + limpa + normaliza → mp3 pequeno.
 * Melhora o lip (voz nítida e em nível constante) e funciona com mp4
 * (usa só o áudio). Sempre roda — o áudio é leve.
 */
export async function cleanAudioMp3(file: File, onStage?: FFLoadStage): Promise<File> {
  return track('pre_cleanAudio', async () =>
    withFFLock(async () => {
      const blob = await normalizeVolume(file, { output: 'mp3' }, { onStage });
      return new File([blob], 'voz_limpa.mp3', { type: 'audio/mpeg' });
    }),
  );
}

/**
 * EXTRAÇÃO sem limpeza ("limpar áudio" DESLIGADO): tira só a faixa de áudio
 * (descarta o vídeo) e transcodifica pra um mp3 TRANSPARENTE — SEM nenhum DSP
 * de limpeza (sem highpass/denoise/loudnorm/compressão). O tom fica idêntico
 * ao original; o que muda é só o tamanho (um mp4 de rosto+voz de 70MB vira um
 * mp3 de poucos MB), pra SEMPRE caber no upload. Resolve o bug "áudio grande
 * demais (73MB)" que acontecia quando a fonte de áudio era o próprio mp4.
 * Blindagem: se mesmo assim passar do teto (áudio absurdamente longo), recomprime
 * num bitrate menor — nunca devolve algo grande demais pro storage.
 */
export async function extractAudioMp3(file: File, onStage?: FFLoadStage): Promise<File> {
  return track('pre_extractAudio', async () =>
    withFFLock(async () => {
      const ff = await getFFmpeg(onStage);
      const { fetchFile } = await import('@ffmpeg/util');
      const uniq = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      const ext = (file.name.split('.').pop() || 'mp4').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 4) || 'mp4';
      const inName = `axin_${uniq}.${ext}`;
      const outName = `axout_${uniq}.mp3`;
      await ff.writeFile(inName, await fetchFile(file));
      const encode = async (codecArgs: string[]): Promise<Uint8Array> => {
        // -vn: descarta vídeo. SEM -af: nenhum filtro de limpeza (áudio original).
        await ff.exec(['-i', inName, '-vn', ...codecArgs, '-y', outName]);
        const d = await ff.readFile(outName);
        return d instanceof Uint8Array ? d : new Uint8Array();
      };
      // q:a 2 = VBR ~190kbps, perceptualmente transparente.
      let data = await encode(['-c:a', 'libmp3lame', '-q:a', '2']);
      // Rede de segurança: se ainda estourar o teto de upload, recomprime menor.
      if (data.length > STORAGE_SAFE_BYTES) data = await encode(['-c:a', 'libmp3lame', '-b:a', '96k']);
      try { await ff.deleteFile(inName); } catch { /* ignore */ }
      try { await ff.deleteFile(outName); } catch { /* ignore */ }
      return ffToFile(data, 'voz_original.mp3', 'audio/mpeg');
    }),
  );
}

/**
 * PRÉ-PRODUÇÃO (vídeo): só comprime o rosto quando o arquivo é grande
 * (> limite do storage). Vídeo pequeno passa NATIVO (instantâneo, ZERO
 * perda) — é o caso comum. Quando precisa comprimir, PRESERVA a qualidade:
 * mantém a resolução (até 1080p) no melhor bitrate que cabe no upload, em
 * preset veryfast (rápido). Nunca baixa pra 720p à toa.
 */
export async function prepareFaceVideo(file: File, onStage?: FFLoadStage): Promise<File> {
  // ≤ limite do storage → VÍDEO NATIVO (qualidade máxima, zero espera).
  if (file.size <= STORAGE_SAFE_BYTES) return file;
  // > limite → comprime RÁPIDO só pra caber no upload. Passa pela fila do
  // ffmpeg (não colide com outras gerações).
  return track('pre_compressFace', async () => withFFLock(() => compressFaceHQ(file, onStage)));
}

/**
 * Compressão RÁPIDA do rosto pra caber no storage. Como o motor SEMPRE
 * entrega 720p, comprimir o rosto pra 720p não muda a qualidade final —
 * então só comprimimos quando NÃO cabe no upload, e do jeito que PRESERVA
 * o máximo de qualidade: MANTÉM a resolução (até 1080p) com um BITRATE-ALVO
 * calculado pra caber no limite na duração real do vídeo (máxima qualidade
 * possível pro tamanho — sem chutar CRF nem baixar resolução à toa) +
 * preset veryfast (rápido e bem melhor que ultrafast no mesmo bitrate) +
 * SEM áudio (o motor usa o áudio separado). Fallback raro pra 720p só se o
 * vídeo for tão longo que nem 1080p caiba.
 */
async function compressFaceHQ(file: File, onStage?: FFLoadStage): Promise<File> {
  const ff = await getFFmpeg(onStage);
  const { fetchFile } = await import('@ffmpeg/util');
  const meta = await probeVideoMetadata(file).catch(() => null);
  const h = meta?.height || 0;
  const durSec = meta?.durationSec || 0;
  const uniq = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const inName = `fhq_${uniq}.mp4`;
  const outName = `fhqo_${uniq}.mp4`;
  await ff.writeFile(inName, await fetchFile(file));

  const encode = async (maxH: number, scaleBitrate = 1): Promise<Uint8Array> => {
    // bitrate-alvo: cabe em ~42MB (margem sob o limite) na duração real do
    // vídeo, até 9 Mbps. Vídeo curto (caso comum do rosto) → 9Mbps = 1080p
    // praticamente sem perda visível.
    // ⛔ Até 07.10 havia um PISO de 2 Mbps que vencia a conta: rosto de 3:54
    // saía 58MB (> teto do upload) e o 2º passe em 720p repetia o MESMO
    // bitrate — mesmo tamanho, minutos de wasm jogados fora. Agora o bitrate é
    // o que CABE, e o 2º passe desce de verdade.
    const budgetBits = 42 * 1024 * 1024 * 8;
    let vbps = durSec > 1 ? Math.floor((budgetBits / durSec) * 0.92) : 6_000_000;
    vbps = Math.floor(Math.max(500_000, Math.min(9_000_000, vbps)) * scaleBitrate);
    const args = ['-i', inName];
    if (!h || h > maxH) args.push('-vf', `scale=-2:${maxH}:flags=bicubic`); // só desce se >1080p
    args.push(
      '-an', // sem áudio: o motor usa o áudio separado → menor + mais rápido
      '-c:v', 'libx264', '-preset', 'veryfast',
      '-b:v', String(vbps), '-maxrate', String(Math.floor(vbps * 1.3)), '-bufsize', String(vbps * 2),
      '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-y', outName,
    );
    await ff.exec(args);
    const d = await ff.readFile(outName);
    return d instanceof Uint8Array ? d : new Uint8Array();
  };

  let data = await encode(1080); // mantém resolução (≤1080p), qualidade máxima pro tamanho
  if (data.length > STORAGE_SAFE_BYTES) data = await encode(720, 0.75); // raríssimo: menor E mais leve

  try { await ff.deleteFile(inName); } catch { /* ignore */ }
  try { await ff.deleteFile(outName); } catch { /* ignore */ }
  return ffToFile(data, 'rosto_hq.mp4', 'video/mp4');
}

/**
 * Divide o áudio (mp3) em trechos ≤chunkSec via segment muxer (stream-copy
 * = rápido, sem re-encode). Retorna a lista de Files na ordem.
 */
export async function splitAudioChunks(
  file: File,
  maxChunkSec = MAX_CHUNK_SEC,
  onStage?: FFLoadStage,
): Promise<File[]> {
  return withFFLock(async () => {
  const ff = await getFFmpeg(onStage);
  const { fetchFile } = await import('@ffmpeg/util');
  const uniq = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const inName = `csplit_${uniq}.mp3`;
  await ff.writeFile(inName, await fetchFile(file));

  // 1. Detecta silêncios — pra cortar SEM partir fala no meio.
  const silences: { start: number; end: number }[] = [];
  let duration = 0;
  const onLog = ({ message }: { message: string }) => {
    const ss = /silence_start:\s*(-?[\d.]+)/.exec(message);
    if (ss) silences.push({ start: parseFloat(ss[1]), end: -1 });
    const se = /silence_end:\s*(-?[\d.]+)/.exec(message);
    if (se && silences.length) silences[silences.length - 1].end = parseFloat(se[1]);
    const dm = /Duration:\s*(\d+):(\d+):([\d.]+)/.exec(message);
    if (dm) duration = +dm[1] * 3600 + +dm[2] * 60 + parseFloat(dm[3]);
  };
  ff.on('log', onLog);
  try {
    await ff.exec(['-i', inName, '-af', 'silencedetect=noise=-32dB:d=0.35', '-f', 'null', '-']);
  } finally {
    ff.off('log', onLog);
  }
  if (!duration) duration = await probeDurationSec(file);

  // 2. Pontos de corte no MEIO de um silêncio perto de cada limite (≤170s),
  //    pra nunca cortar no meio da fala. Sem silêncio na janela → corta no limite.
  const mids = silences.filter((s) => s.end > s.start).map((s) => (s.start + s.end) / 2);
  const points: number[] = [0];
  let target = maxChunkSec;
  while (target < duration - 4) {
    const lo = target - 25;
    const hi = Math.min(target + 8, duration - 1);
    const last = points[points.length - 1];
    const cands = mids.filter((m) => m >= lo && m <= hi && m > last + 5);
    const cut = cands.length
      ? cands.reduce((a, b) => (Math.abs(b - target) < Math.abs(a - target) ? b : a))
      : Math.min(target, duration);
    if (cut > last + 5 && cut < duration - 1) points.push(cut);
    target = cut + maxChunkSec;
  }
  points.push(duration);

  if (points.length <= 2) {
    try { await ff.deleteFile(inName); } catch { /* ignore */ }
    return [file];
  }

  // 3. Corta cada trecho exato (re-encode mp3 → duração precisa).
  const chunks: File[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const out = `cseg_${uniq}_${i}.mp3`;
    await ff.exec([
      '-i', inName,
      '-ss', points[i].toFixed(2),
      '-to', points[i + 1].toFixed(2),
      '-c:a', 'libmp3lame', '-q:a', '3',
      '-y', out,
    ]);
    let data: Uint8Array | string;
    try {
      data = await ff.readFile(out);
    } catch {
      continue;
    }
    chunks.push(ffToFile(data, `chunk_${i}.mp3`, 'audio/mpeg'));
    try { await ff.deleteFile(out); } catch { /* ignore */ }
  }
  try { await ff.deleteFile(inName); } catch { /* ignore */ }
  return chunks.length > 0 ? chunks : [file];
  });
}

// ═══════════════ ROSTO: os dois tetos do motor (tempo e tamanho) ═══════════════
//
// O motor aceita ~180s por geração e o nosso storage corta ~50MB. Até 07.10
// só o ÁUDIO respeitava isso: o rosto ia INTEIRO pra todo trecho. Um rosto de
// 3:54 / 88MB (HEVC 1080x1920) caía no compressFaceHQ, que nunca chegava a
// caber — minutos de wasm e o disparo morria ANTES de chegar no motor, com o
// card dizendo "o HeyGen não renderizou". Agora todo rosto que sobe respeita
// os dois tetos por construção (a conta mora em lib/lipsync-chunk-plan.ts).

/** Um par pronto pra UMA geração: rosto + áudio + duração (ms) que vai pro motor. */
export type LipPair = { face: File; audio: File; ms: number };

/**
 * O motor DESCARTA os primeiros ~94ms do áudio de cada geração e mantém o
 * vídeo alinhado ao rosto — medido 07.10 em dois trechos reais por correlação
 * (−94ms constantes, corr 0,99) e por comparação de frames (frame t da saída =
 * frame t do rosto). Num trecho único isso some no silêncio do começo; numa
 * EMENDA no meio da fala vira um pulo audível. Compensação: cada trecho começa
 * esse tanto ANTES do corte (o 1º ganha esse silêncio na frente) — a saída
 * volta exatamente pra linha do tempo original, rosto e voz.
 */
export const MOTOR_HEAD_DROP_SEC = 0.094;

/** Vão por CÓPIA (sem re-encode): codecs que o motor já provou aceitar, em
 *  containers que viram mp4 sem conversão. O resto é re-encodado. */
const COPY_CODECS = new Set(['h264', 'hevc']);
const COPY_EXTS = new Set(['mp4', 'mov', 'm4v']);

function safeExt(name: string, fallback: string): string {
  return (name.split('.').pop() || fallback).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 4) || fallback;
}

function uniqTag(): string {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** exec que devolve rc E log (o ffmpeg.wasm não lança em rc≠0). */
async function execWithLog(ff: FFmpeg, args: string[]): Promise<{ rc: number; log: string }> {
  const lines: string[] = [];
  const onLog = ({ message }: { message: string }) => { lines.push(message); };
  ff.on('log', onLog);
  try {
    const rc = await ff.exec(args);
    return { rc, log: lines.join('\n') };
  } finally {
    ff.off('log', onLog);
  }
}

/** Pausas do `silencedetect` — mesmos parâmetros do splitAudioChunks. */
function parseSilenceLog(log: string): Silence[] {
  const out: Silence[] = [];
  let open: number | null = null;
  for (const line of log.split('\n')) {
    const ss = /silence_start:\s*(-?[\d.]+)/.exec(line);
    if (ss) { open = parseFloat(ss[1]); continue; }
    const se = /silence_end:\s*(-?[\d.]+)/.exec(line);
    if (se && open !== null) {
      const end = parseFloat(se[1]);
      if (end > open) out.push({ start: open, end });
      open = null;
    }
  }
  return out;
}

function parseDurationLog(log: string): number {
  const dm = /Duration:\s*(\d+):(\d+):([\d.]+)/.exec(log);
  return dm ? +dm[1] * 3600 + +dm[2] * 60 + parseFloat(dm[3]) : 0;
}

/** Quanto o ffmpeg REALMENTE decodificou (o último `time=` do progresso). O
 *  `Duration:` do cabeçalho mp3 inclui o padding do encoder (~45ms a mais) —
 *  e a duração que vai pro motor tem que ser a do áudio de verdade. */
function parseDecodedSec(log: string): number {
  let last = 0;
  for (const m of Array.from(log.matchAll(/time=\s*(\d+):(\d+):([\d.]+)/g))) {
    last = +m[1] * 3600 + +m[2] * 60 + parseFloat(m[3]);
  }
  return last;
}

/**
 * Re-encoda [start, start+dur) do rosto num H.264 que SEMPRE cabe no upload:
 * o bitrate sai da conta (42MB na duração do trecho), sem piso que estoure.
 * Lado curto ≤720 — o motor entrega 720p, acima disso só pesa e demora.
 */
async function encodeFaceRange(ff: FFmpeg, inPath: string, start: number, dur: number, outName: string): Promise<Uint8Array> {
  const fit = Math.floor(((42 * 1024 * 1024 * 8) / Math.max(1, dur)) * 0.92);
  const run = async (vbps: number): Promise<Uint8Array> => {
    const rc = await ff.exec([
      ...(start > 0 ? ['-ss', start.toFixed(3)] : []),
      '-i', inPath,
      '-t', dur.toFixed(3),
      '-map', '0:v:0', '-an',
      '-vf', "scale='min(720,iw)':'min(720,ih)':force_original_aspect_ratio=increase:force_divisible_by=2",
      '-c:v', 'libx264', '-preset', 'veryfast',
      '-b:v', String(vbps), '-maxrate', String(Math.floor(vbps * 1.3)), '-bufsize', String(vbps * 2),
      '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-y', outName,
    ]);
    if (rc !== 0) throw new Error('Não consegui preparar o vídeo do rosto. Tenta com um arquivo mp4.');
    const d = await ff.readFile(outName);
    return d instanceof Uint8Array ? d : new Uint8Array();
  };
  let data = await run(Math.max(600_000, Math.min(8_000_000, fit)));
  if (data.length > STORAGE_SAFE_BYTES) data = await run(Math.max(400_000, Math.floor(fit * 0.7)));
  if (data.length < 4096 || data.length > STORAGE_SAFE_BYTES) {
    throw new Error('Não consegui preparar o vídeo do rosto. Tenta com um arquivo mp4.');
  }
  return data;
}

/** Corta o rosto em KEYFRAME, sem re-encode (segment muxer). Confere pela
 *  lista que o próprio ffmpeg escreve que cada corte caiu onde a conta mandou
 *  e que cada trecho cabe — qualquer coisa fora disso devolve null e o
 *  chamador re-encoda. */
async function splitFaceCopy(
  ff: FFmpeg, inPath: string, plan: FacePlan, uniq: string,
): Promise<Array<{ data: Uint8Array; start: number }> | null> {
  const times = [...plan.cuts, ...(plan.faceEnd != null ? [plan.faceEnd] : [])];
  const expected = times.length + 1;
  const listName = `v2vl_${uniq}.csv`;
  const segName = (i: number) => `v2vf_${uniq}_${String(i).padStart(3, '0')}.mp4`;
  try {
    const rc = await ff.exec([
      '-i', inPath, '-map', '0:v:0', '-c', 'copy', '-an',
      '-f', 'segment',
      // meio milissegundo antes: o muxer corta no 1º keyframe ≥ o instante
      '-segment_times', times.map((t) => Math.max(0, t - 0.0005).toFixed(4)).join(','),
      '-reset_timestamps', '1',
      '-segment_format_options', 'movflags=+faststart',
      '-segment_list', listName, '-segment_list_type', 'csv',
      '-y', `v2vf_${uniq}_%03d.mp4`,
    ]);
    if (rc !== 0) return null;
    const rows = String(await ff.readFile(listName, 'utf8'))
      .split('\n').map((l) => l.trim()).filter(Boolean)
      .map((l) => { const [name, s, e] = l.split(','); return { name, start: Number(s), end: Number(e) }; });
    if (rows.length !== expected) return null;
    for (let i = 1; i < rows.length; i++) {
      if (!(Math.abs(rows[i].start - times[i - 1]) <= 0.05)) return null;
    }
    const used = plan.faceEnd != null ? rows.slice(0, -1) : rows;
    const out: Array<{ data: Uint8Array; start: number }> = [];
    for (const r of used) {
      if (!(r.end - r.start <= MAX_SEG_SEC + 1)) return null;
      const d = await ff.readFile(r.name);
      if (!(d instanceof Uint8Array) || d.length < 4096 || d.length > STORAGE_SAFE_BYTES) return null;
      out.push({ data: d, start: r.start });
    }
    return out;
  } catch {
    return null;
  } finally {
    for (let i = 0; i < expected + 1; i++) { try { await ff.deleteFile(segName(i)); } catch { /* ignore */ } }
    try { await ff.deleteFile(listName); } catch { /* ignore */ }
  }
}

/** Re-encoda cada trecho do plano (fonte que não dá pra copiar). */
async function splitFaceEncode(
  ff: FFmpeg, inPath: string, plan: FacePlan, faceSec: number, uniq: string,
): Promise<Array<{ data: Uint8Array; start: number }>> {
  const bounds = [0, ...plan.cuts, plan.faceEnd ?? faceSec];
  const out: Array<{ data: Uint8Array; start: number }> = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    const name = `v2ve_${uniq}_${i}.mp4`;
    try {
      out.push({ data: await encodeFaceRange(ff, inPath, bounds[i], bounds[i + 1] - bounds[i], name), start: bounds[i] });
    } finally {
      try { await ff.deleteFile(name); } catch { /* ignore */ }
    }
  }
  return out;
}

/**
 * VIDEO TO VIDEO LONGO (áudio > CHUNK_THRESHOLD_SEC): divide rosto E áudio
 * nos MESMOS pontos — o trecho i do áudio vai com o trecho i do rosto, então
 * a boca nova cai em cima do movimento ORIGINAL daquele trecho (antes todo
 * trecho recomeçava o rosto do zero). Corte em keyframe perto de uma pausa,
 * sem re-encode; cada trecho ≤ MAX_SEG_SEC e ≤ o teto do upload.
 *
 * Devolve null quando o rosto é mais CURTO que o áudio (clipe de loop) — aí
 * o chamador segue o caminho de sempre (o mesmo rosto em todo trecho).
 */
export async function splitVideoToVideo(
  face: File, audio: File, audioSecHint: number, onStage?: FFLoadStage,
): Promise<LipPair[] | null> {
  return track('pre_splitV2V', async () => withFFLock(async () => {
    const ff = await getFFmpeg(onStage);
    const { fetchFile } = await import('@ffmpeg/util');
    const uniq = uniqTag();
    const faceExt = safeExt(face.name, 'mp4');
    // Rosto MONTADO (WORKERFS): até 300MB sem copiar pro heap do wasm.
    const mnt = await mountInputs(ff, [{ name: `face.${faceExt}`, data: face }]);
    const facePath = `${mnt.dir}/face.${faceExt}`;
    const audName = `v2va_${uniq}.mp3`;
    const crcName = `v2vk_${uniq}.txt`;
    const tmp = [audName, crcName];
    try {
      // 1. Pausas da fala + duração REAL do áudio que vai pro motor.
      await ff.writeFile(audName, await fetchFile(audio));
      const sil = await execWithLog(ff, ['-i', audName, '-af', 'silencedetect=noise=-32dB:d=0.35', '-f', 'null', '-']);
      const silences = parseSilenceLog(sil.log);
      const audioSec = parseDecodedSec(sil.log) || parseDurationLog(sil.log) || audioSecHint;

      // 2. Tabela de pacotes do rosto (tamanho + keyframe), SEM decodificar.
      const crc = await execWithLog(ff, ['-i', facePath, '-map', '0:v:0', '-c', 'copy', '-f', 'framecrc', '-y', crcName]);
      let info: FaceInfo = { codec: '', width: 0, height: 0, packets: [], durationSec: 0 };
      if (crc.rc === 0) {
        try { info = parseFramecrc(String(await ff.readFile(crcName, 'utf8'))); } catch { /* sem tabela → re-encode */ }
      }
      const faceSec = info.durationSec || parseDurationLog(crc.log) || (await probeDurationCapped(face));
      if (!faceCoversAudio(faceSec, audioSec)) return null;
      info = { ...info, durationSec: faceSec };

      // 3. Corta o rosto (cópia; se não der, re-encode do plano equivalente).
      const copyable = crc.rc === 0 && COPY_CODECS.has(info.codec) && COPY_EXTS.has(faceExt);
      let plan = planFaceCuts({ face: info, silences, audioSec, copyable });
      let faces = plan.mode === 'copy' ? await splitFaceCopy(ff, facePath, plan, uniq) : null;
      if (!faces) {
        if (plan.mode === 'copy') plan = planFaceCuts({ face: info, silences, audioSec, copyable: false });
        faces = await splitFaceEncode(ff, facePath, plan, faceSec, uniq);
      }

      // 4. Áudio cortado nos instantes REAIS do corte do rosto, com a
      //    compensação do que o motor come no começo (MOTOR_HEAD_DROP_SEC).
      const pairs: LipPair[] = [];
      for (let i = 0; i < faces.length; i++) {
        const a = faces[i].start;
        const last = i + 1 >= faces.length;
        const b = last ? audioSec : faces[i + 1].start;
        const pre = Math.min(MOTOR_HEAD_DROP_SEC, a); // trechos 2+: começa antes
        const pad = MOTOR_HEAD_DROP_SEC - pre; // 1º trecho: silêncio na frente
        const filters = [
          `atrim=start=${(a - pre).toFixed(4)}${last ? '' : `:end=${b.toFixed(4)}`}`,
          'asetpts=PTS-STARTPTS',
        ];
        if (pad > 0.0005) filters.push(`adelay=delays=${Math.round(pad * 1000)}:all=1`);
        const outName = `v2vc_${uniq}_${i}.mp3`;
        tmp.push(outName);
        const rc = await ff.exec(['-i', audName, '-af', filters.join(','), '-c:a', 'libmp3lame', '-q:a', '3', '-y', outName]);
        if (rc !== 0) throw new Error('Não consegui dividir o áudio. Tenta de novo.');
        const audioData = await ff.readFile(outName);
        if (!(audioData instanceof Uint8Array) || audioData.length < 512) {
          throw new Error('Não consegui dividir o áudio. Tenta de novo.');
        }
        pairs.push({
          face: ffToFile(faces[i].data, `rosto_${i + 1}.mp4`, 'video/mp4'),
          audio: ffToFile(audioData, `voz_${i + 1}.mp3`, 'audio/mpeg'),
          ms: Math.round((b - a + MOTOR_HEAD_DROP_SEC) * 1000),
        });
      }
      return pairs;
    } finally {
      for (const n of tmp) { try { await ff.deleteFile(n); } catch { /* ignore */ } }
      await mnt.cleanup();
    }
  }));
}

/** Corta o começo do rosto (o pedaço que o motor vai usar), sem re-encode
 *  quando dá; re-encode só se nem assim couber no upload. */
async function trimFace(file: File, needSec: number, onStage?: FFLoadStage): Promise<File> {
  const ff = await getFFmpeg(onStage);
  const ext = safeExt(file.name, 'mp4');
  const mnt = await mountInputs(ff, [{ name: `face.${ext}`, data: file }]);
  const inPath = `${mnt.dir}/face.${ext}`;
  const outName = `trim_${uniqTag()}.mp4`;
  try {
    if (COPY_EXTS.has(ext)) {
      const rc = await ff.exec(['-i', inPath, '-t', needSec.toFixed(3), '-map', '0:v:0', '-c', 'copy', '-an', '-movflags', '+faststart', '-y', outName]);
      if (rc === 0) {
        const d = await ff.readFile(outName);
        if (d instanceof Uint8Array && d.length >= 4096 && d.length <= STORAGE_SAFE_BYTES) {
          return ffToFile(d, 'rosto.mp4', 'video/mp4');
        }
      }
    }
    return ffToFile(await encodeFaceRange(ff, inPath, 0, needSec, outName), 'rosto.mp4', 'video/mp4');
  } finally {
    try { await ff.deleteFile(outName); } catch { /* ignore */ }
    await mnt.cleanup();
  }
}

/**
 * Rosto de UMA geração inteira (áudio ≤ CHUNK_THRESHOLD_SEC, ou o clipe de
 * loop reusado nos trechos). O motor usa o rosto do começo até o fim da fala
 * (frame t da saída = frame t do rosto), então:
 *  - cabe no storage e no teto de tempo → NATIVO, como sempre foi;
 *  - bem mais longo que a fala → sobe SÓ o pedaço usado (cópia, segundos);
 *  - do tamanho da fala mas pesado → comprime (prepareFaceVideo).
 */
export async function prepareFaceForAudio(file: File, audioSec: number, onStage?: FFLoadStage): Promise<File> {
  const faceSec = await probeDurationCapped(file);
  const needSec = audioSec + 1;
  const sobra = faceSec > needSec + 1;
  if (file.size <= STORAGE_SAFE_BYTES && !(sobra && faceSec > CHUNK_THRESHOLD_SEC)) return file;
  if (sobra) return track('pre_trimFace', async () => withFFLock(() => trimFace(file, needSec, onStage)));
  return prepareFaceVideo(file, onStage);
}

/**
 * PÓS-PRODUÇÃO: realça o lip do resultado (esconde "máscara" do queixo,
 * devolve nitidez aos dentes, grading sutil). Roda por trecho (curto).
 */
export async function enhanceLipVideo(blob: Blob, onStage?: FFLoadStage): Promise<Blob> {
  return track('post_enhance', async () => withFFLock(() => postprocessLipSyncOutput(blob, { onStage })));
}

/**
 * Costura os MP4s dos trechos num só. concatVideosFast copia o vídeo
 * (sem re-encode = leve/rápido) e só normaliza o áudio — como todos os
 * trechos saíram do mesmo encode (pós-produção idêntica), junta liso.
 */
export async function concatLipVideos(blobs: Blob[], onStage?: FFLoadStage): Promise<Blob> {
  if (blobs.length === 1) return blobs[0];
  return track('post_concat', async () => withFFLock(() => concatVideosFast(blobs, { onStage })));
}
