/**
 * Pipeline Variacao de Avatar (VA) — feature DARKO LAB.
 *
 * Fluxo (diferente do clickup-pilot normal):
 *  1. Download MP4 do AD original (Drive ID) via extension
 *  2. Extract audio via ffmpeg-worker
 *  3. Split audio em N segmentos ~20s respeitando silencios
 *     (NUNCA corta fala — splita SO em pausa)
 *  4. Pra cada avatar de variacao (2-10):
 *     - Loop por segmento → dispatch HeyGen modo audio (lipsync)
 *     - Quando todos prontos, baixa + concat na ordem
 *     - Decupagem (remove silencios das bordas) — opcional, herda config
 *  5. Output: ZIP com N videos finais nomeados:
 *     <baseAdId>-AVA01.mp4, <baseAdId>-AVA02.mp4, ...
 *     + DEPOIMENTO-AVA<X>.mp4 se task tem depoimento
 *
 * Pre-req: extension v4.2.2+, sessao HeyGen logada, AD video acessivel
 * (Drive compartilhado OU public OR user logado tem acesso).
 */

import { decodeAudioRobust, detectSilences } from './audio-engine';
import { resolveVaSpeakers } from './resolve-va-speakers';
import { extractAudio, concatAvatarParts, concatVideosFast, cutVideoSegments, overlaySegmentsOnVideo } from './ffmpeg-worker';
import { isolateVoice, type VoiceIsolatorMode } from './voice-isolator';
import { isolateVoiceNeural } from './voice-isolator-neural';
import { detectFacePresence, type SegmentFaceResult } from './face-detector';

/** Avatar HeyGen de UM papel dentro de uma variacao (multi-locutor).
 *  Ex AVA01 do AD126: papel 0 = Doutor (radyrahbanmd), papel 1 =
 *  Depoimento Mulher (gihribeiroo20). O rank do locutor (0 = quem mais
 *  fala) mapeia no indice do papel: principal fala mais, depoimento menos. */
export type VAPipelineRoleAvatar = {
  /** Label do papel ('Doutor', 'Depoimento Mulher', 'UGC') — so pra logs */
  roleLabel: string;
  isDepoimento: boolean;
  avatarId: string;
  avatarName: string;
  /** Voz escolhida pro papel (Espelhamento de Voz usa ela no sts_pending) */
  voiceId?: string | null;
};

export type VAPipelineAvatar = {
  /** AVA01, AVA02, ... — usado no filename de output */
  avaCode: string;
  /** Avatar HeyGen escolhido (já matched no slot da UI) */
  avatarId: string;
  avatarName: string;
  /** MULTI-LOCUTOR: papeis da variacao (roleAvatars[0] = principal —
   *  mesmo avatarId acima). 2+ papeis + input.diarize → cada segmento de
   *  fala vai pro avatar do papel correspondente ao locutor. Ausente/1
   *  papel = comportamento classico (1 avatar pro AD inteiro). */
  roleAvatars?: VAPipelineRoleAvatar[];
  /** Inverte o mapeamento locutor↔papel (UI: botao 'inverter locutores'
   *  caso a heuristica de tempo-de-fala erre). So com 2 papeis. */
  swapSpeakers?: boolean;
};

/** Turno de fala vindo da diarizacao (segundos). */
export type VASpeakerUtterance = { speaker: string; start: number; end: number; text?: string };

export type VAPipelineInput = {
  /** Base AD ID (ex 'AD10G1VN-PRPB06') — vira prefixo dos arquivos */
  baseAdId: string;
  /** Bytes do MP4 do AD original (ja baixado) */
  adVideoBytes: Uint8Array | Blob;
  /** Avatares de variacao com IDs HeyGen ja resolvidos */
  avatares: VAPipelineAvatar[];
  /** Numero alvo de splits do audio (mais alto = mais takes curtos).
   *  Default: divide pra ficar com segments de ~20s */
  targetSegmentSec?: number;
  /** Min segment seconds — nao splita abaixo disso */
  minSegmentSec?: number;
  /** Max segment seconds — split mesmo se silencio nao bate (fallback) */
  maxSegmentSec?: number;
  /** Callback progresso */
  onProgress?: (msg: VAPipelineProgress) => void;
  /** Funcao pra disparar 1 take HeyGen via extension (audio mode).
   *  Recebe (avatarId, audioBlob, label) → resolve com videoBlob.
   *  Caller injeta — pipeline nao tem dependencia direta do bridge. */
  dispatchAudioTake: (params: {
    avatarId: string;
    audioBytes: Uint8Array;
    audioFilename: string;
    label: string;
    /** Voz do papel (multi-locutor). Presente quando o segmento foi
     *  roteado por diarizacao; caller usa em vez do lookup por avatarId. */
    voiceId?: string | null;
  }) => Promise<Blob>;
  /** MULTI-LOCUTOR: diarizacao do audio (voz isolada) — retorna turnos de
   *  fala em SEGUNDOS. Caller injeta (comprime + chama /api/va/diarize).
   *  So roda quando algum avatar tem roleAvatars com 2+ papeis. Se falhar
   *  ou detectar 1 locutor so, pipeline cai no fluxo classico (1 avatar). */
  diarize?: (audioBlob: Blob) => Promise<VASpeakerUtterance[]>;
  /** COPY-ANCHOR: texto do roteiro que o avatar PRINCIPAL lê (do "Link da
   *  Copy" do doc). Quando presente, é a fonte primária de atribuição de
   *  locutor (trecho que casa = principal; resto = depoimento) — vence o
   *  pitch e o speaker_labels. Caller busca o doc e injeta. */
  copyText?: string | null;
  /** VA DE AVATAR — modo HeyGen Studio cena-por-cena (Mirror voice).
   *  Quando presente, SUBSTITUI o dispatchAudioTake+mount: pra cada
   *  avatar dispara UMA sessao Studio com TODAS as partes (1 parte =
   *  1 cena). O HeyGen concatena as cenas no video final na ordem, com
   *  o timing exato do audio original (sem decupagem do nosso lado).
   *  Incompativel com smartMode (Studio gera o video cheio por avatar).
   *  Caller injeta — pipeline nao depende do bridge direto. */
  dispatchAvatarStudio?: (params: {
    avatarId: string;
    avatarName: string;
    avaCode: string;
    voiceName?: string | null;
    segments: Array<{ audioBytes: Uint8Array; filename: string; label: string }>;
  }) => Promise<Blob>;
  /** Voz custom por avatar (opcional) — so usado no modo Studio.
   *  Key: avaCode → voiceName. Mirror voice ja usa a voz do avatar; isso
   *  so sobrescreve se o user escolheu voz custom. */
  studioVoiceByAva?: Record<string, string | null>;
  /** Cancelado? */
  isCancelled?: () => boolean;
  /** Voice isolation antes do split (CRITICO pra lipsync nao ficar
   *  horrivel quando AD original tem musica/SFX). Default TRUE.
   *  - true: aplica isolateVoice() apos extractAudio
   *  - false: usa audio raw (NAO RECOMENDADO — lipsync vai mixar voz+musica) */
  useVoiceIsolation?: boolean;
  /** Modo do voice isolator. Default 'auto' (detecta stereo/mono).
   *  - 'auto': stereo→CCE, mono→bandpass
   *  - 'center': forca CCE (so use se confirmado stereo bem mixado)
   *  - 'bandpass': so highpass+lowpass+compand
   *  - 'aggressive': denoise + compand mais pesado (audio sujo) */
  voiceIsolatorMode?: VoiceIsolatorMode;
  /** SMART MODE: detecta face em cada segmento do video original, e
   *  substitui APENAS os segmentos com avatar (face presente). B-rolls
   *  ficam intactos. Output: 1 MP4 final por avatar com swap aplicado.
   *  - true: ativa smart mode (default false)
   *  - threshold default: 0.5 (50% dos frames sampled tem face = "tem avatar")
   *  - samples per segment default: 5 */
  smartMode?: boolean;
  /** Threshold (0-1) de face ratio pra considerar segmento "tem avatar" */
  smartModeThreshold?: number;
  /** Samples por segmento na deteccao de face (default 5) */
  smartModeSamplesPerSegment?: number;
};

export type VAPipelineProgress = {
  stage:
    | 'extract_audio'
    | 'isolate_voice'   // voice isolation pre-split pra lipsync limpo
    | 'diarize'         // MULTI-LOCUTOR: turnos de fala via AssemblyAI
    | 'split_audio'
    | 'detect_faces'    // SMART MODE: face detection nos segmentos
    | 'dispatch'
    | 'mount'
    | 'assemble_smart'  // SMART MODE: overlay lipsync no video original
    | 'zip'
    | 'done';
  message: string;
  percent: number;
  avatarIdx?: number;
  segmentIdx?: number;
};

export type VAPipelineResult = {
  /** Final videos por avatar: {avaCode → Blob mp4 final} */
  items: Array<{ avaCode: string; filename: string; blob: Blob | null; error?: string }>;
  /** Audio segmentos (debug) */
  audioSegmentCount: number;
  /** Resumo */
  summary: string;
  /** SMART MODE stats (so preenchido se smartMode:true) */
  smartModeStats?: {
    totalSegments: number;
    swapSegments: number;       // segmentos com face detectada
    keepSegments: number;       // segmentos sem face (b-roll mantido)
    fallbackSegments: number;   // segmentos com fallback "assume talking"
    detectorFailed: boolean;    // se MediaPipe nao carregou
  };
};

/* ============================== AUDIO SPLIT ============================== */

/** Split AudioBuffer em segmentos respeitando silencios.
 *  Algoritmo:
 *    1. Detecta silencios via detectSilences (audio-engine)
 *    2. Calcula targets de boundary baseado em targetSegmentSec
 *    3. Pra cada target, escolhe silence mais proximo (dentro de tolerancia)
 *       — se nao tiver silence, split duro (so como ultimo recurso)
 *  Retorna lista de {start, end} em segundos. */
export function planAudioSplitBoundaries(
  totalDur: number,
  silences: Array<{ start: number; end: number }>,
  targetSec: number,
  minSec: number,
  maxSec: number,
): Array<{ start: number; end: number }> {
  if (totalDur <= targetSec) return [{ start: 0, end: totalDur }];

  const segments: Array<{ start: number; end: number }> = [];
  let cursor = 0;
  while (cursor < totalDur) {
    const targetEnd = cursor + targetSec;
    if (targetEnd >= totalDur - minSec) {
      segments.push({ start: cursor, end: totalDur });
      break;
    }
    // Encontra silencio mais proximo do targetEnd, preferindo dentro da janela
    // [cursor + minSec, cursor + maxSec]. Boundary = MEIO do silencio.
    const candidates = silences
      .map((s) => ({ s, mid: (s.start + s.end) / 2 }))
      .filter(({ mid }) => mid > cursor + minSec && mid < cursor + maxSec)
      .sort((a, b) => Math.abs(a.mid - targetEnd) - Math.abs(b.mid - targetEnd));

    let boundary: number;
    if (candidates.length > 0) {
      boundary = candidates[0].mid;
    } else {
      // Sem silencio na janela — fallback split duro em targetEnd
      // (preferimos isso a um segmento > maxSec)
      boundary = Math.min(targetEnd, totalDur);
    }
    segments.push({ start: cursor, end: boundary });
    cursor = boundary;
  }

  // POS-PROCESSO CRITICO: o ULTIMO segmento (ou qualquer um) pode sair < 1s
  // quando o corte anterior cai perto do fim. O HeyGen RECUSA clipes < 1s
  // ("Video duration must be at least 1 second"), o que deixava a VA
  // incompleta. Fundimos qualquer segmento minusculo no vizinho — garante
  // que NENHUM segmento fique abaixo de MIN_HARD.
  const MIN_HARD = 1.2; // margem de seguranca acima do limite de 1s do HeyGen
  const merged: Array<{ start: number; end: number }> = [];
  for (const seg of segments) {
    const dur = seg.end - seg.start;
    if (dur < MIN_HARD && merged.length > 0) {
      // Funde no segmento anterior (estende o fim).
      merged[merged.length - 1].end = seg.end;
    } else {
      merged.push({ ...seg });
    }
  }
  // Se o PRIMEIRO segmento ficou minusculo (sem anterior pra fundir), funde
  // no proximo.
  if (merged.length > 1 && merged[0].end - merged[0].start < MIN_HARD) {
    merged[1].start = merged[0].start;
    merged.shift();
  }
  return merged;
}

/** MULTI-LOCUTOR: monta os cortes a partir dos TURNOS DE FALA.
 *  1. Funde utterances consecutivas do mesmo locutor em BLOCOS
 *  2. Boundary entre blocos = MEIO do gap (gap entre turnos = silencio)
 *  3. Cobre [0, totalDur] (estende primeiro/ultimo bloco)
 *  4. Funde micro-turnos (<1.2s — diarizacao solta espurios tipo 'né?')
 *  5. Bloco > maxSec → sub-divide com o planner por silencio (offset local)
 *  Retorna segmentos COM o locutor dono de cada um. */
export function planSpeakerBoundaries(
  utts: VASpeakerUtterance[],
  totalDur: number,
  silences: Array<{ start: number; end: number }>,
  targetSec: number,
  minSec: number,
  maxSec: number,
): Array<{ start: number; end: number; speaker: string }> {
  type Block = { start: number; end: number; speaker: string };
  const sorted = [...utts]
    .filter((u) => u.end > u.start)
    .sort((a, b) => a.start - b.start);
  if (sorted.length === 0) return [{ start: 0, end: totalDur, speaker: 'A' }];

  // 1. funde turnos consecutivos do mesmo locutor
  const blocks: Block[] = [];
  for (const u of sorted) {
    const last = blocks[blocks.length - 1];
    if (last && last.speaker === u.speaker) last.end = Math.max(last.end, u.end);
    else blocks.push({ start: u.start, end: u.end, speaker: u.speaker });
  }
  // 2+3. boundaries no meio dos gaps + cobertura total
  for (let i = 0; i < blocks.length; i++) {
    if (i === 0) blocks[i].start = 0;
    if (i === blocks.length - 1) blocks[i].end = totalDur;
    if (i > 0) {
      const mid = Math.min(Math.max((blocks[i - 1].end + blocks[i].start) / 2, blocks[i - 1].start), blocks[i].start);
      blocks[i - 1].end = mid;
      blocks[i].start = mid;
    }
  }
  // 4. micro-turnos fundem no vizinho anterior (HeyGen recusa clip < 1s)
  const MIN_HARD = 1.2;
  const merged: Block[] = [];
  for (const b of blocks) {
    const last = merged[merged.length - 1];
    if (last && (b.end - b.start < MIN_HARD || last.speaker === b.speaker)) {
      last.end = b.end;
    } else {
      merged.push({ ...b });
    }
  }
  if (merged.length > 1 && merged[0].end - merged[0].start < MIN_HARD) {
    merged[1].start = merged[0].start;
    merged.shift();
  }
  // 5. sub-divide blocos longos respeitando silencios DENTRO do bloco
  const out: Block[] = [];
  for (const b of merged) {
    const dur = b.end - b.start;
    if (dur <= maxSec) { out.push(b); continue; }
    const localSilences = silences
      .filter((s) => s.start >= b.start && s.end <= b.end)
      .map((s) => ({ start: s.start - b.start, end: s.end - b.start }));
    const subs = planAudioSplitBoundaries(dur, localSilences, targetSec, minSec, maxSec);
    for (const s of subs) out.push({ start: b.start + s.start, end: b.start + s.end, speaker: b.speaker });
  }
  return out;
}

/** Encode AudioBuffer em WAV PCM 16-bit. */
function encodeWAV(audioBuffer: AudioBuffer): Uint8Array {
  const numChannels = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  const numSamples = audioBuffer.length;
  const bitsPerSample = 16;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;
  const dataSize = numSamples * blockAlign;
  const buf = new ArrayBuffer(44 + dataSize);
  const v = new DataView(buf);
  const ws = (off: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)); };
  ws(0, 'RIFF'); v.setUint32(4, 36 + dataSize, true);
  ws(8, 'WAVE'); ws(12, 'fmt '); v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); v.setUint16(22, numChannels, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, byteRate, true);
  v.setUint16(32, blockAlign, true); v.setUint16(34, bitsPerSample, true);
  ws(36, 'data'); v.setUint32(40, dataSize, true);
  const channels: Float32Array[] = [];
  for (let c = 0; c < numChannels; c++) channels.push(audioBuffer.getChannelData(c));
  let off = 44;
  for (let i = 0; i < numSamples; i++) {
    for (let c = 0; c < numChannels; c++) {
      const s = Math.max(-1, Math.min(1, channels[c][i]));
      v.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      off += 2;
    }
  }
  return new Uint8Array(buf);
}

/** Extrai um trecho de AudioBuffer (start..end em segundos) como WAV. */
function sliceAudioBufferToWAV(audioBuffer: AudioBuffer, startSec: number, endSec: number): Uint8Array {
  const sr = audioBuffer.sampleRate;
  const startSample = Math.floor(startSec * sr);
  const endSample = Math.floor(endSec * sr);
  const numSamples = endSample - startSample;
  const numChannels = audioBuffer.numberOfChannels;
  // Cria AudioBuffer "virtual" via OfflineAudioContext? Mais simples: clone manual em ArrayBuffer.
  const sliced = {
    numberOfChannels: numChannels,
    sampleRate: sr,
    length: numSamples,
    getChannelData: (c: number) => audioBuffer.getChannelData(c).subarray(startSample, endSample),
  } as unknown as AudioBuffer;
  return encodeWAV(sliced);
}

/* ============================== PIPELINE ============================== */

export async function runVAPipeline(input: VAPipelineInput): Promise<VAPipelineResult> {
  const targetSec = input.targetSegmentSec ?? 20;
  const minSec = input.minSegmentSec ?? 8;
  const maxSec = input.maxSegmentSec ?? 35;
  const progress = input.onProgress ?? (() => {});

  // 1. Extract audio do MP4
  progress({ stage: 'extract_audio', message: 'Extraindo audio do AD original...', percent: 5 });
  const adVideoBlob = input.adVideoBytes instanceof Blob
    ? input.adVideoBytes
    : new Blob([input.adVideoBytes as BlobPart], { type: 'video/mp4' });
  const rawAudioBlob = await extractAudio(adVideoBlob);

  // 1.5. Voice isolation — OBRIGATORIO pra VA (sem musica/SFX/ruido).
  //
  // ESTRATEGIA EM CASCATA (qualidade > velocidade):
  //   1. Demucs neural via HF Space (qualidade PROFISSIONAL — sem artefatos)
  //   2. Se Demucs falhar/timeout/quota: FFmpeg local aggressive (fallback)
  //   3. Se AMBOS falharem: ABORTA pipeline (zero chance de trilha vazar)
  //
  // Por que Demucs primeiro:
  //   FFmpeg filter (highpass+lowpass+afftdn) deixa artefatos audíveis,
  //   altera o timbre, gera "bolha" residual da música. Demucs v4 (Meta)
  //   é state-of-the-art em music source separation — separa voz dos outros
  //   stems (drums/bass/other) com qualidade studio-grade.
  //
  // CRITICAL: user reportou 2026-05-25 que (a) audio ia com trilha sonora
  // e (b) qualidade da voz isolada ficava ruim com artefatos. Fix:
  //   - Demucs neural como default (qualidade pro)
  //   - useVoiceIsolation:false IGNORADO (sempre roda)
  //   - Validação: blob isolado > 1KB
  //   - Fallback graceful entre métodos
  const useVoiceIsolation = input.useVoiceIsolation !== false;
  if (!useVoiceIsolation) {
    console.warn('[va-pipeline] useVoiceIsolation=false IGNORADO — VA exige audio limpo. Forçando isolation.');
  }
  let audioBlob: Blob | null = null;
  let isolationMethod = 'pending';

  // === TENTATIVA 1: Demucs neural (qualidade profissional) ===
  progress({
    stage: 'isolate_voice',
    message: 'Isolando voz com Demucs neural (qualidade profissional)...',
    percent: 10,
  });
  try {
    const neural = await isolateVoiceNeural(rawAudioBlob, {
      onProgress: (msg, pct) => {
        progress({
          stage: 'isolate_voice',
          message: `Demucs · ${msg}`,
          percent: 10 + Math.round(((pct ?? 0) / 100) * 4),
        });
      },
      timeoutMs: 5 * 60 * 1000, // 5min — Demucs em ZeroGPU pode demorar
    });
    if (neural.ok && neural.vocalsBlob.size > 1024) {
      audioBlob = neural.vocalsBlob;
      isolationMethod = 'demucs-neural';
      const secs = Math.round(neural.elapsedMs / 1000);
      progress({
        stage: 'isolate_voice',
        message: `Voz isolada com Demucs neural em ${secs}s — sem artefatos, timbre preservado.`,
        percent: 14,
      });
    } else if (!neural.ok) {
      console.warn(`[va-pipeline] Demucs neural falhou (${neural.kind}): ${neural.error}. Caindo pro ffmpeg fallback...`);
    }
  } catch (e) {
    console.warn('[va-pipeline] Demucs neural throw inesperado:', e);
  }

  // === TENTATIVA 2 (fallback): FFmpeg local 'bandpass' (natural) ===
  // FIX 2026-05-30: era 'aggressive' que cortava acima de 6.5kHz + 2x FFT
  // denoise super agressivo + compansor pesado = voz "de radio AM antigo".
  // User reclamou: "voz horrivel como se tivesse saido de um radio".
  // Trocado pra 'bandpass' (so voice-band 80-8000Hz, sem destruir timbre).
  if (!audioBlob) {
    const isolatorMode = input.voiceIsolatorMode ?? 'bandpass';
    progress({
      stage: 'isolate_voice',
      message: `⚠ Demucs neural indisponivel — usando fallback FFmpeg ${isolatorMode} (qualidade menor; recomenda verificar REPLICATE_API_TOKEN no Vercel pra ativar Demucs).`,
      percent: 11,
    });

    async function tryFfmpeg(mode: VoiceIsolatorMode): Promise<Blob> {
      const out = await isolateVoice(rawAudioBlob, {
        mode,
        format: 'wav',
        onProgress: (p) => {
          progress({
            stage: 'isolate_voice',
            message: `FFmpeg · ${mode} · ${Math.round(p.ratio * 100)}%`,
            percent: 11 + Math.round(p.ratio * 3),
          });
        },
      });
      if (!out || out.size < 1024) {
        throw new Error(`ffmpeg retornou blob inválido (${out?.size ?? 0} bytes)`);
      }
      return out;
    }

    try {
      audioBlob = await tryFfmpeg(isolatorMode);
      isolationMethod = `ffmpeg-${isolatorMode}`;
      progress({
        stage: 'isolate_voice',
        message: `Voz isolada (ffmpeg ${isolatorMode}). Qualidade menor que Demucs.`,
        percent: 14,
      });
    } catch (e1) {
      console.warn('[va-pipeline] ffmpeg primeira tentativa falhou:', e1);
      try {
        audioBlob = await tryFfmpeg('aggressive');
        isolationMethod = 'ffmpeg-aggressive-retry';
        progress({
          stage: 'isolate_voice',
          message: 'Voz isolada (ffmpeg aggressive retry).',
          percent: 14,
        });
      } catch (e2) {
        const msg = (e2 as Error)?.message || String(e2);
        throw new Error(
          `Voice isolation falhou em TODAS as tentativas (Demucs neural + ffmpeg 2x). ` +
          `Erro final: ${msg}. NÃO podemos mandar audio com trilha pro HeyGen — abortando. ` +
          `Tenta recarregar a página e disparar de novo.`,
        );
      }
    }
  }
  console.log(`[va-pipeline] voice isolation OK via: ${isolationMethod} · ${audioBlob.size} bytes`);

  // 2. Decode + detect silencios + plan boundaries
  progress({ stage: 'split_audio', message: 'Analisando silencios pra split sem cortar fala...', percent: 15 });
  const audioBuffer = await decodeAudioRobust(audioBlob);
  const silences = detectSilences(audioBuffer);
  let boundaries = planAudioSplitBoundaries(audioBuffer.duration, silences, targetSec, minSec, maxSec);
  progress({ stage: 'split_audio', message: `Split planejado: ${boundaries.length} segmentos`, percent: 20 });

  // 2.5 === MULTI-LOCUTOR (diarizacao) ===
  // AD com 2+ avatares no doc (ex Doutor + Depoimento Mulher): diariza a
  // voz isolada, RE-PLANEJA os cortes nos turnos de fala e mapeia cada
  // segmento pro papel certo. Rank por tempo de fala: locutor que mais
  // fala = papel principal (roleAvatars[0]), segundo = depoimento.
  // Falhou/1 locutor so → fluxo classico (1 avatar pro AD inteiro).
  const maxRolesInPipeline = Math.max(0, ...input.avatares.map((a) => a.roleAvatars?.length || 0));
  const wantsMultiSpeaker = !!input.diarize && maxRolesInPipeline >= 2;
  let segRoleRank: number[] | null = null; // por segmento: 0 = principal, 1 = depoimento...
  if (wantsMultiSpeaker) {
    progress({ stage: 'diarize', message: 'Detectando locutores (diarizacao AssemblyAI)...', percent: 16 });
    // HARD FAIL (user reportou 2026-06-11): antes, diarizacao falhada caia
    // em fallback silencioso "avatar principal fala tudo" — saia video
    // ERRADO (principal dublando o depoimento da mulher) e o user so via
    // no resultado final. VA multi-avatar agora EXIGE diarizacao OK: sem
    // ela, aborta com erro acionavel — nunca gera saida errada calada.
    let diarizeFailure: string | null = null;
    try {
      const rawUtts = await input.diarize!(audioBlob);
      // === RESOLVER UNICO (copy > pitch > AssemblyAI) — 2026-06-11 ===
      // AssemblyAI da TEXTO+timestamps confiaveis. QUEM fala cada trecho:
      //  1. COPY-ANCHOR: o "Link da Copy" e o roteiro que o principal le —
      //     trecho que casa = principal, resto = depoimento (GROUND TRUTH).
      //  2. PITCH/F0: tom de voz separa homem/mulher por fisica.
      //  3. speaker_labels: ultimo recurso.
      let resolveNote = '';
      if (maxRolesInPipeline === 2 && rawUtts && rawUtts.length > 0) {
        const resolved = resolveVaSpeakers({
          utterances: rawUtts.map((u) => ({ speaker: u.speaker, start: u.start, end: u.end, text: u.text || '' })),
          expectedSpeakers: 2,
          channelData: audioBuffer.getChannelData(0),
          sampleRate: audioBuffer.sampleRate,
          copyText: input.copyText || null,
        });
        // relabela por rank resolvido — planSpeakerBoundaries roteia por isso
        for (let i = 0; i < rawUtts.length; i++) rawUtts[i].speaker = `P${resolved.ranks[i] ?? 0}`;
        resolveNote = ` · ${resolved.method}`;
        if (!resolved.confident) {
          // sem copy nem pitch confiavel: NAO arrisca video errado.
          diarizeFailure = `nao consegui separar os locutores com confianca (${resolved.reason}). ` +
            `Cole o "Link da Copy" no doc (roteiro do principal) ou confira que o AD tem 2 vozes claras.`;
        }
      }
      const speakers = Array.from(new Set((rawUtts || []).map((u) => u.speaker)));
      if (!diarizeFailure && rawUtts && speakers.length >= 2) {
        const planned = planSpeakerBoundaries(rawUtts, audioBuffer.duration, silences, targetSec, minSec, maxSec);
        boundaries = planned.map((p) => ({ start: p.start, end: p.end }));
        // Rank por tempo de fala TOTAL (das utterances ja relabeladas)
        const talk = new Map<string, number>();
        for (const u of rawUtts) talk.set(u.speaker, (talk.get(u.speaker) || 0) + (u.end - u.start));
        const ranked = Array.from(talk.entries()).sort((a, b) => b[1] - a[1]).map(([s]) => s);
        segRoleRank = planned.map((p) => Math.max(0, ranked.indexOf(p.speaker)));
        const turnCount = segRoleRank.reduce((acc, r, i) => acc + (i > 0 && segRoleRank![i - 1] !== r ? 1 : 0), 0) + 1;
        progress({
          stage: 'diarize',
          message: `${speakers.length} locutores · ${turnCount} turnos · ${boundaries.length} segmentos roteados por papel${resolveNote}`,
          percent: 19,
        });
      } else if (!diarizeFailure) {
        diarizeFailure = `detectou ${speakers.length || 0} locutor(es), mas o doc indica ${maxRolesInPipeline} papeis (avatares diferentes)${resolveNote}`;
      }
    } catch (e) {
      diarizeFailure = (e as Error)?.message || String(e);
    }
    if (diarizeFailure) {
      throw new Error(
        `VA multi-avatar exige diarizacao OK — sem ela o avatar principal dublaria o trecho do outro papel (video errado). ` +
        `Falha: ${diarizeFailure}. ` +
        `Confira a chave AssemblyAI em Configuracoes → API e dispare de novo. ` +
        `Se o AD original tiver SO 1 locutor de verdade (ouca no 👁), o doc esta com papel a mais.`,
      );
    }
  }

  /** Resolve avatar+voz de UM segmento pro avatar/variacao dado.
   *  Sem diarizacao ou sem roles: principal (comportamento classico). */
  const resolveSegRole = (
    av: VAPipelineAvatar,
    rankList: number[] | null,
    si: number,
  ): { avatarId: string; avatarName: string; voiceId: string | null | undefined } => {
    const roles = av.roleAvatars && av.roleAvatars.length > 0 ? av.roleAvatars : null;
    if (!roles || !rankList) {
      return { avatarId: av.avatarId, avatarName: av.avatarName, voiceId: roles?.[0]?.voiceId };
    }
    let rank = rankList[si] ?? 0;
    if (av.swapSpeakers && roles.length >= 2) rank = rank === 0 ? 1 : rank === 1 ? 0 : rank;
    const r = roles[Math.min(rank, roles.length - 1)];
    return { avatarId: r.avatarId, avatarName: r.avatarName, voiceId: r.voiceId };
  };

  // ============== MODO STUDIO (VA DE AVATAR) ==============
  // 1 parte = 1 cena. Pra cada avatar, dispara UMA sessao Studio com
  // TODAS as partes; o HeyGen concatena as cenas (timing exato do
  // audio original, sem decupagem). Substitui dispatch+mount.
  if (input.dispatchAvatarStudio) {
    const studioSegments = boundaries.map((b, i) => ({
      audioBytes: sliceAudioBufferToWAV(audioBuffer, b.start, b.end),
      filename: `parte${i + 1}.wav`,
      label: `parte${i + 1}`,
    }));
    const studioItems: VAPipelineResult['items'] = [];
    for (let ai = 0; ai < input.avatares.length; ai++) {
      if (input.isCancelled?.()) break;
      const av = input.avatares[ai];
      const filename = `${input.baseAdId}-${av.avaCode}.mp4`;
      progress({
        stage: 'dispatch',
        message: `Studio ${ai + 1}/${input.avatares.length} (${av.avaCode}) — ${studioSegments.length} cenas, Mirror voice...`,
        percent: 20 + Math.round((ai / input.avatares.length) * 70),
        avatarIdx: ai,
      });
      try {
        const blob = await input.dispatchAvatarStudio({
          avatarId: av.avatarId,
          avatarName: av.avatarName,
          avaCode: av.avaCode,
          voiceName: input.studioVoiceByAva?.[av.avaCode] ?? null,
          segments: studioSegments,
        });
        studioItems.push({ avaCode: av.avaCode, filename, blob });
      } catch (e) {
        studioItems.push({ avaCode: av.avaCode, filename, blob: null, error: (e as Error)?.message || 'falha Studio' });
      }
    }
    progress({ stage: 'done', message: 'Pipeline VA (Studio) concluido', percent: 100 });
    return {
      items: studioItems,
      audioSegmentCount: studioSegments.length,
      summary: `${studioItems.filter((i) => i.blob).length}/${studioItems.length} avatares OK · Studio cena-por-cena (Mirror voice) · ${studioSegments.length} cenas/avatar`,
    };
  }

  // 3. SMART MODE: face detection nos segmentos do video original
  const smartMode = input.smartMode === true;
  let faceResults: SegmentFaceResult[] = [];
  let smartModeStats: VAPipelineResult['smartModeStats'] | undefined;
  let activeSwapBoundaries: typeof boundaries = boundaries;
  let swapIndices: number[] = boundaries.map((_, i) => i); // por default, todos

  if (smartMode) {
    progress({
      stage: 'detect_faces',
      message: `Smart Mode: detectando face em ${boundaries.length} segmentos...`,
      percent: 22,
    });
    try {
      faceResults = await detectFacePresence({
        videoBlob: adVideoBlob,
        segments: boundaries.map((b) => ({ start: b.start, end: b.end })),
        samplesPerSegment: input.smartModeSamplesPerSegment ?? 5,
        threshold: input.smartModeThreshold ?? 0.5,
        isCancelled: input.isCancelled,
        onProgress: (done, total, msg) => {
          progress({
            stage: 'detect_faces',
            message: msg,
            percent: 22 + Math.round((done / total) * 8),
          });
        },
      });
      const fallbackCount = faceResults.filter((r) => r.reason === 'fallback_assume_talking' || r.reason === 'detector_failed').length;
      const swapCount = faceResults.filter((r) => r.hasAvatar).length;
      smartModeStats = {
        totalSegments: faceResults.length,
        swapSegments: swapCount,
        keepSegments: faceResults.length - swapCount,
        fallbackSegments: fallbackCount,
        detectorFailed: faceResults.every((r) => r.reason === 'detector_failed'),
      };
      // Filter swap boundaries
      swapIndices = faceResults.filter((r) => r.hasAvatar).map((r) => r.segmentIdx);
      activeSwapBoundaries = swapIndices.map((i) => boundaries[i]);
      progress({
        stage: 'detect_faces',
        message: `Smart Mode: ${swapCount}/${boundaries.length} segmentos com avatar (${faceResults.length - swapCount} b-rolls mantidos)`,
        percent: 30,
      });
      if (activeSwapBoundaries.length === 0) {
        // Nada pra trocar — output = original.
        progress({ stage: 'done', message: 'Smart Mode: nenhum segmento com avatar detectado. Output = original.', percent: 100 });
        return {
          items: input.avatares.map((av) => ({
            avaCode: av.avaCode,
            filename: `${input.baseAdId}-${av.avaCode}-smart.mp4`,
            blob: adVideoBlob, // copia original
          })),
          audioSegmentCount: 0,
          summary: 'Smart Mode: zero swap (nenhum segmento com face). Output = original.',
          smartModeStats,
        };
      }
    } catch (e) {
      // Face detection completamente falhou — fallback: assume todos talking
      console.warn('[va-pipeline] face detection falhou (fallback):', e);
      smartModeStats = {
        totalSegments: boundaries.length,
        swapSegments: boundaries.length,
        keepSegments: 0,
        fallbackSegments: boundaries.length,
        detectorFailed: true,
      };
    }
  }

  // 3.1. Slice cada segmento em WAV (apenas dos segmentos a serem trocados em smart mode)
  const segmentWavs: Uint8Array[] = activeSwapBoundaries.map((b) =>
    sliceAudioBufferToWAV(audioBuffer, b.start, b.end),
  );
  // MULTI-LOCUTOR: re-indexa o rank por segmento pros indices ativos
  // (smart mode filtra segmentos; classico usa todos)
  const activeRankList = segRoleRank ? swapIndices.map((i) => segRoleRank![i] ?? 0) : null;

  // 4. Pra cada avatar, dispatcha cada segmento + monta
  const items: VAPipelineResult['items'] = [];
  const totalDispatches = input.avatares.length * activeSwapBoundaries.length;
  let dispatchDone = 0;

  for (let ai = 0; ai < input.avatares.length; ai++) {
    if (input.isCancelled?.()) break;
    const av = input.avatares[ai];
    const filename = `${input.baseAdId}-${av.avaCode}.mp4`;
    progress({
      stage: 'dispatch',
      message: `Avatar ${ai + 1}/${input.avatares.length} (${av.avaCode}) — dispatching ${segmentWavs.length} takes...`,
      percent: 20 + (dispatchDone / totalDispatches) * 60,
      avatarIdx: ai,
    });

    // Dispatch sequencial (HeyGen Auto Dynamic limita paralelismo via extension)
    const videoBlobs: (Blob | null)[] = [];
    let avatarErr: string | undefined;
    for (let si = 0; si < segmentWavs.length; si++) {
      if (input.isCancelled?.()) break;
      try {
        // MULTI-LOCUTOR: cada segmento vai pro avatar do PAPEL do locutor
        // (Doutor fala → avatar do Doutor; depoimento → avatar do depoimento)
        const segRole = resolveSegRole(av, activeRankList, si);
        const videoBlob = await input.dispatchAudioTake({
          avatarId: segRole.avatarId,
          audioBytes: segmentWavs[si],
          audioFilename: `parte${si + 1}.wav`,
          label: `${av.avaCode}_parte${si + 1}`,
          voiceId: segRole.voiceId,
        });
        videoBlobs.push(videoBlob);
      } catch (e) {
        avatarErr = `segmento ${si + 1}: ${(e as Error)?.message || 'falha'}`;
        videoBlobs.push(null);
        break;
      }
      dispatchDone++;
      progress({
        stage: 'dispatch',
        message: `${av.avaCode} · take ${si + 1}/${segmentWavs.length} OK`,
        percent: 20 + (dispatchDone / totalDispatches) * 60,
        avatarIdx: ai,
        segmentIdx: si,
      });
    }

    if (avatarErr || videoBlobs.some((v) => !v)) {
      items.push({ avaCode: av.avaCode, filename, blob: null, error: avatarErr || 'algum take falhou' });
      continue;
    }

    if (smartMode) {
      // SMART MODE: overlay cada lipsync no video original no timestamp exato.
      // Output: 1 MP4 mesma duracao do original, com avatar trocado apenas onde
      // tem face (b-rolls intactos). Cut puro, frame-perfect.
      const smartFilename = `${input.baseAdId}-${av.avaCode}-smart.mp4`;
      progress({
        stage: 'assemble_smart',
        message: `${av.avaCode} · overlay smart: ${videoBlobs.length} segmentos no original...`,
        percent: 80 + (ai / input.avatares.length) * 15,
        avatarIdx: ai,
      });
      try {
        const overlays = activeSwapBoundaries.map((b, idx) => ({
          start: b.start,
          end: b.end,
          video: videoBlobs[idx] as Blob,
        }));
        const finalVideo = await overlaySegmentsOnVideo(adVideoBlob, overlays);
        items.push({ avaCode: av.avaCode, filename: smartFilename, blob: finalVideo });
      } catch (e) {
        items.push({
          avaCode: av.avaCode,
          filename: smartFilename,
          blob: null,
          error: 'smart overlay: ' + (e as Error)?.message,
        });
      }
      continue;
    }

    // Mount classico: concat na ordem (sem smart mode)
    progress({
      stage: 'mount',
      message: `Montando ${av.avaCode} (${videoBlobs.length} takes)...`,
      percent: 80 + (ai / input.avatares.length) * 15,
      avatarIdx: ai,
    });
    try {
      let mounted: Blob;
      try {
        mounted = await concatVideosFast(videoBlobs as Blob[]);
      } catch {
        // Fast falhou → fallback slow re-encode
        mounted = await concatAvatarParts(videoBlobs as Blob[]);
      }
      items.push({ avaCode: av.avaCode, filename, blob: mounted });
    } catch (e) {
      items.push({ avaCode: av.avaCode, filename, blob: null, error: 'mount: ' + (e as Error)?.message });
    }
  }

  progress({ stage: 'done', message: 'Pipeline concluido', percent: 100 });
  const summary = smartMode
    ? `${items.filter((i) => i.blob).length}/${items.length} avatares OK · Smart Mode: ${activeSwapBoundaries.length}/${boundaries.length} segmentos trocados`
    : `${items.filter((i) => i.blob).length}/${items.length} avatares OK · ${segmentWavs.length} takes por avatar`;
  return { items, audioSegmentCount: segmentWavs.length, summary, smartModeStats };
}
