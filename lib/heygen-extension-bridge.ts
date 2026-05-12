/**
 * Bridge entre DARKO LAB <-> Chrome Extension HeyGen Auto.
 *
 * Protocolo (window.postMessage):
 *
 * Page → Extension:
 *   { source: 'darkolab', type: 'HG_PING' }
 *   { source: 'darkolab', type: 'HG_GENERATE', requestId, payload: { copy, avatarId, voiceId, motor } }
 *
 * Extension → Page:
 *   { source: 'darkolab-ext', type: 'HG_PONG', version: '1.x.x' }
 *   { source: 'darkolab-ext', type: 'HG_PROGRESS', requestId, stage, percent? }
 *   { source: 'darkolab-ext', type: 'HG_RESULT', requestId, videoUrl }
 *   { source: 'darkolab-ext', type: 'HG_ERROR', requestId, error }
 *
 * Alem disso, a extension faz o download da MP4 final via fetch dentro do
 * proprio contexto autenticado do HeyGen e devolve a URL CDN. O DARKO LAB
 * baixa via /api/mind-ads/proxy (CORS-safe whitelist HeyGen CDN).
 */

export type ExtensionStatus =
  | { connected: true; version: string }
  | { connected: false };

export type HeygenJobPayload = {
  copy?: string;          // modo texto: copy a falar
  audioBase64?: string;   // modo audio: arquivo de audio em base64 (audio.mp3 / audio.wav)
  audioFilename?: string; // nome do arquivo (ex: "parte1.mp3")
  avatarId: string;       // look_id especifico (passado pra match na img src)
  avatarName?: string;    // nome do look ("Photo Avatar", "Radiant Redhead")
  groupName?: string;     // nome do grupo HeyGen ("Emma", "Johan") - usado no search
  voiceId?: string;
  motor: 'III' | 'IV' | 'V';
  partLabel?: string;
};

type Pending = {
  resolve: (videoUrl: string) => void;
  reject: (e: Error) => void;
  onProgress?: (stage: string, percent?: number) => void;
};

const pending = new Map<string, Pending>();

let listenerInstalled = false;

function installListener() {
  if (listenerInstalled || typeof window === 'undefined') return;
  listenerInstalled = true;
  window.addEventListener('message', (ev: MessageEvent) => {
    const data = ev.data;
    if (!data || typeof data !== 'object') return;
    if (data.source !== 'darkolab-ext') return;

    const requestId = String(data.requestId ?? '');
    if (!requestId) return;
    const p = pending.get(requestId);
    if (!p) return;

    if (data.type === 'HG_PROGRESS') {
      p.onProgress?.(String(data.stage ?? ''), data.percent);
    } else if (data.type === 'HG_RESULT') {
      pending.delete(requestId);
      p.resolve(String(data.videoUrl ?? ''));
    } else if (data.type === 'HG_ERROR') {
      pending.delete(requestId);
      p.reject(new Error(String(data.error ?? 'Erro na extension.')));
    }
  });
}

/**
 * Detecta se a extension esta instalada + ativa.
 * Retorna em ate 700ms.
 */
export function detectExtension(): Promise<ExtensionStatus> {
  installListener();
  return new Promise((resolve) => {
    if (typeof window === 'undefined') {
      resolve({ connected: false });
      return;
    }
    let resolved = false;
    const handler = (ev: MessageEvent) => {
      if (
        ev.data &&
        ev.data.source === 'darkolab-ext' &&
        ev.data.type === 'HG_PONG'
      ) {
        resolved = true;
        window.removeEventListener('message', handler);
        resolve({ connected: true, version: String(ev.data.version ?? '?') });
      }
    };
    window.addEventListener('message', handler);
    window.postMessage({ source: 'darkolab', type: 'HG_PING' }, '*');
    setTimeout(() => {
      if (!resolved) {
        window.removeEventListener('message', handler);
        resolve({ connected: false });
      }
    }, 700);
  });
}

/**
 * Envia uma job de geracao pra extension. Resolve com URL do MP4 quando
 * pronto. SEM TIMEOUT — extension/HeyGen decide quando termina.
 */
export function generateAvatarPart(
  payload: HeygenJobPayload,
  onProgress?: (stage: string, percent?: number) => void,
): Promise<string> {
  installListener();
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined') {
      reject(new Error('Sem window — bridge so funciona client-side.'));
      return;
    }
    const requestId = `hg_${Date.now()}_${Math.random()
      .toString(36)
      .slice(2, 8)}`;
    pending.set(requestId, { resolve, reject, onProgress });
    window.postMessage(
      {
        source: 'darkolab',
        type: 'HG_GENERATE',
        requestId,
        payload,
      },
      '*',
    );
  });
}

/**
 * Pede pra extensao listar os avatares EXATAMENTE como aparecem na
 * biblioteca da conta HeyGen do user (espelho 1:1, sem stock publico).
 *
 * Retorna lista crua com id, nome, thumb, version. Sem filtro de motor —
 * motor so afeta o generate, nao a listagem.
 */
export type LibraryAvatar = {
  id: string;
  name: string;
  thumb: string | null;
  videoPreview: string | null;
  type: 'avatar' | 'photo';
  version: 'III' | 'IV' | 'V';
  // groupId/groupName so existem em avatars retornados via listMyHeyGenAvatars
  // (extension v2.6.0+) - antes nao tinhamos hierarquia.
  groupId?: string;
  groupName?: string;
  /** voice_id default ja embutido (extension v4.0.14+) */
  voiceId?: string | null;
  /** voice_name (geralmente @username do material clonado) — extension v4.0.17+
   *  Critico pra avatar matching: briefings referenciam @username, nao nome do avatar */
  voiceName?: string | null;
};

/**
 * Avatar agrupado (espelho 1:1 da estrutura HeyGen "Choose an Avatar"):
 * 1 entrada por AVATAR principal (Emma, Johan, etc.), com array de looks
 * (variacoes/cenarios/angulos) aninhados. Cada look tem o id real usado
 * na hora de gerar.
 */
export type LibraryAvatarGroup = {
  id: string;
  name: string;
  thumb: string | null;
  type: 'avatar' | 'photo';
  version: 'III' | 'IV' | 'V';
  looksCount: number;
  looks: LibraryAvatar[];
};

export function listMyHeyGenAvatars(): Promise<{
  ok: boolean;
  avatars: LibraryAvatar[];
  groups: LibraryAvatarGroup[];
  error?: string;
}> {
  installListener();
  return new Promise((resolve) => {
    if (typeof window === 'undefined') {
      resolve({ ok: false, avatars: [], groups: [], error: 'Sem window.' });
      return;
    }
    const requestId = `list_${Date.now()}_${Math.random()
      .toString(36)
      .slice(2, 6)}`;
    console.log('[DARKO LAB page] >>> listMyHeyGenAvatars start, requestId:', requestId);
    const handler = (ev: MessageEvent) => {
      // Loga TUDO que chega de darkolab-ext pra debug
      if (ev.data?.source === 'darkolab-ext') {
        console.log('[DARKO LAB page] <-- got darkolab-ext msg:', ev.data?.type, 'reqId:', ev.data?.requestId, 'matches:', ev.data?.requestId === requestId);
      }
      if (
        ev.data?.source === 'darkolab-ext' &&
        ev.data?.type === 'HG_AVATARS_RESULT' &&
        ev.data?.requestId === requestId
      ) {
        window.removeEventListener('message', handler);
        clearTimeout(timeoutId);
        console.log('[DARKO LAB page] <<< HG_AVATARS_RESULT match! ok=', ev.data.ok, 'count=', Array.isArray(ev.data.avatars) ? ev.data.avatars.length : 0);
        resolve({
          ok: !!ev.data.ok,
          avatars: Array.isArray(ev.data.avatars) ? ev.data.avatars : [],
          groups: Array.isArray(ev.data.groups) ? ev.data.groups : [],
          error: ev.data.error ?? undefined,
        });
      }
    };
    window.addEventListener('message', handler);
    window.postMessage(
      { source: 'darkolab', type: 'HG_LIST_AVATARS', requestId },
      '*',
    );
    const timeoutId = setTimeout(() => {
      window.removeEventListener('message', handler);
      console.warn('[DARKO LAB page] !!! TIMEOUT 90s — nenhuma resposta darkolab-ext com type HG_AVATARS_RESULT chegou pra reqId', requestId);
      resolve({
        ok: false,
        avatars: [],
        groups: [],
        error:
          'Extensao nao respondeu em 90s. Abre F12 na aba do DARKO LAB e cola os logs (procura "[DARKO LAB page]"). Tambem cola os logs da aba app.heygen.com.',
      });
    }, 90000);
  });
}

/**
 * Pinga a extensao e pede pra ela checar se a sessao HeyGen esta valida
 * (faz uma chamada leve pro endpoint de user info do HeyGen com cookies).
 *
 * Retorna { ok, detail }. Se ok=true, gerar via extensao deve funcionar.
 */
export function testHeygenSession(): Promise<{
  ok: boolean;
  detail?: string;
}> {
  installListener();
  return new Promise((resolve) => {
    if (typeof window === 'undefined') {
      resolve({ ok: false, detail: 'Sem window.' });
      return;
    }
    const requestId = `test_${Date.now()}_${Math.random()
      .toString(36)
      .slice(2, 6)}`;
    const handler = (ev: MessageEvent) => {
      if (
        ev.data?.source === 'darkolab-ext' &&
        ev.data?.type === 'HG_TEST_RESULT' &&
        ev.data?.requestId === requestId
      ) {
        window.removeEventListener('message', handler);
        resolve({
          ok: !!ev.data.ok,
          detail: ev.data.detail ?? '',
        });
      }
    };
    window.addEventListener('message', handler);
    window.postMessage(
      { source: 'darkolab', type: 'HG_TEST_SESSION', requestId },
      '*',
    );
    setTimeout(() => {
      window.removeEventListener('message', handler);
      resolve({
        ok: false,
        detail: 'Extensao nao respondeu em 8s.',
      });
    }, 8000);
  });
}

/* ============================== VOICE CLONE ==============================
 * Clona uma voz no HeyGen a partir de arquivo de audio (mp3/wav) OU video
 * (mp4/mov/webm). Pra video, extrai audio antes via ffmpeg-worker pra
 * reduzir upload.
 *
 * Nome do clone vem do filename SEM extensao (ex: "marcella.malvar2.mp4"
 * → clone chamado "marcella.malvar2"). HeyGen aceita ate ~50 chars.
 *
 * Flags noise/music ligadas por default (user quer clean).
 *
 * Retorna { voiceId, voiceName } quando ready, OU error string.
 */

export type CloneVoiceOptions = {
  /** Override do display name (default = filename sem extensao) */
  displayName?: string;
  removeBackgroundNoise?: boolean;
  removeBackgroundMusic?: boolean;
  /** ISO code: "pt", "en", etc. Auto se omitir */
  language?: string | null;
  /** Modelo do clone — V3 (default, melhor qualidade PT/EN),
   *  V2 (legacy, custo menor), multilingual (50+ langs). */
  model?: 'V3' | 'V2' | 'multilingual';
  /** Trunca audio pra no maximo N segundos antes de upload — acelera
   *  bastante (HeyGen so precisa ~30-90s pra clonar bem). Default 90. */
  trimToSeconds?: number | null;
  /** Callback de progresso 0..100 */
  onProgress?: (stage: string, percent?: number, message?: string) => void;
};

export type CloneVoiceResult = {
  ok: true;
  voiceId: string;
  voiceName: string;
} | {
  ok: false;
  error: string;
};

/** Deriva nome do clone a partir do filename: strip extensao + lower */
function filenameToDisplayName(file: File): string {
  const base = file.name.replace(/\.[^.]+$/, '');
  return base.trim();
}

/** Converte Blob audio em base64 sem prefixo data: */
async function blobToBase64(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)));
  }
  return btoa(binary);
}

/** Decodifica audio + corta pros primeiros N segundos. Retorna WAV blob.
 *  Retorna null se nao conseguir (caller usa o blob original). */
async function trimAudioToSeconds(blob: Blob, maxSec: number): Promise<Blob | null> {
  try {
    const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return null;
    const ac: AudioContext = new Ctx();
    try {
      const buf = await blob.arrayBuffer();
      const decoded = await ac.decodeAudioData(buf.slice(0));
      if (decoded.duration <= maxSec + 0.5) {
        await ac.close();
        return null;
      }
      const sampleRate = decoded.sampleRate;
      const channels = Math.min(decoded.numberOfChannels, 1); // mono pra clone (HeyGen so usa 1ch)
      const totalSamples = Math.floor(maxSec * sampleRate);
      const out = ac.createBuffer(1, totalSamples, sampleRate);
      const src0 = decoded.getChannelData(0);
      const src1 = decoded.numberOfChannels > 1 ? decoded.getChannelData(1) : src0;
      const dst = out.getChannelData(0);
      for (let i = 0; i < totalSamples; i++) {
        dst[i] = (src0[i] + (channels > 1 ? src1[i] : src0[i])) / (channels > 1 ? 2 : 1);
      }
      await ac.close();
      return encodeWAV(out);
    } catch (e) {
      await ac.close();
      throw e;
    }
  } catch (e) {
    console.warn('[trimAudioToSeconds] failed:', e);
    return null;
  }
}

/** Encoda um AudioBuffer em WAV 16-bit PCM mono. */
function encodeWAV(audioBuffer: AudioBuffer): Blob {
  const numCh = 1;
  const sr = audioBuffer.sampleRate;
  const samples = audioBuffer.getChannelData(0);
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buf);
  let p = 0;
  const wstr = (s: string) => { for (let i = 0; i < s.length; i++) view.setUint8(p++, s.charCodeAt(i)); };
  wstr('RIFF');
  view.setUint32(p, 36 + samples.length * 2, true); p += 4;
  wstr('WAVE');
  wstr('fmt ');
  view.setUint32(p, 16, true); p += 4;
  view.setUint16(p, 1, true); p += 2;
  view.setUint16(p, numCh, true); p += 2;
  view.setUint32(p, sr, true); p += 4;
  view.setUint32(p, sr * numCh * 2, true); p += 4;
  view.setUint16(p, numCh * 2, true); p += 2;
  view.setUint16(p, 16, true); p += 2;
  wstr('data');
  view.setUint32(p, samples.length * 2, true); p += 4;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(p, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    p += 2;
  }
  return new Blob([buf], { type: 'audio/wav' });
}

/* ============================ HEYGEN CREDITS ============================
 * Pega saldo de creditos HeyGen via extension (cookies sessao).
 * Cache em memoria de 30s pra evitar bater o endpoint demais. */

export type HeyGenCredits = {
  ok: boolean;
  error?: string;
  /** Creditos pagos do plano — usado pra Avatar IV/V */
  plan_credit?: { amount: number; total: number };
  /** Slots Avatar III prioritarios (rapido) — limite mensal separado */
  unlimited_regular?: { amount: number; total: number };
  plan_name?: string | null;
  tier?: string | null;
  is_unlimited?: boolean;
  is_paid?: boolean;
  left_days?: number | null;
  expired_ts?: number | null;
  monthly_priority?: { count: number; limit: number };
  usage?: {
    paid_videos_last_14_days: number;
    paid_videos_since_billing: number;
    next_renewal_ts: number | null;
    last_billing_ts: number | null;
  };
};

let creditsCache: { value: HeyGenCredits; fetchedAt: number } | null = null;
const CREDITS_CACHE_MS = 30000;

export async function getHeyGenCredits(opts: { force?: boolean } = {}): Promise<HeyGenCredits> {
  installListener();
  if (!opts.force && creditsCache && Date.now() - creditsCache.fetchedAt < CREDITS_CACHE_MS) {
    return creditsCache.value;
  }
  if (typeof window === 'undefined') {
    return { ok: false, error: 'sem window' };
  }
  return new Promise((resolve) => {
    const requestId = `cred_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const handler = (ev: MessageEvent) => {
      if (ev.data?.source !== 'darkolab-ext') return;
      if (ev.data?.requestId !== requestId) return;
      if (ev.data?.type === 'HG_CREDITS_RESULT') {
        window.removeEventListener('message', handler);
        const v = ev.data as HeyGenCredits;
        creditsCache = { value: v, fetchedAt: Date.now() };
        resolve(v);
      }
    };
    window.addEventListener('message', handler);
    window.postMessage(
      { source: 'darkolab', type: 'HG_GET_CREDITS', requestId },
      '*',
    );
    // Timeout 20s
    setTimeout(() => {
      window.removeEventListener('message', handler);
      resolve({ ok: false, error: 'timeout 20s' });
    }, 20000);
  });
}

/** Heuristica simples de deteccao de lingua — usa Web Speech API se
 *  disponivel (Chrome desktop). Retorna ISO code ou null. */
export async function detectAudioLanguage(file: File): Promise<{ lang: 'pt' | 'en' | 'other' | 'unknown'; confidence: number }> {
  // Web Speech API funciona pra audio reproduzido em tempo real, nao file blob direto.
  // Pra detect rapido, fazemos fallback heuristico via filename + duracao.
  // Se quiser detect real, precisa de servico externo (whisper.cpp wasm/server).
  const name = file.name.toLowerCase();
  if (/\b(en|english|eng)\b/.test(name)) return { lang: 'en', confidence: 0.5 };
  if (/\b(pt|portuguese|portugues|br|brasil)\b/.test(name)) return { lang: 'pt', confidence: 0.5 };
  return { lang: 'unknown', confidence: 0 };
}

/** Clona voz no HeyGen via extension. Extrai audio se for video. */
export async function cloneVoiceViaExtension(
  file: File,
  opts: CloneVoiceOptions = {},
): Promise<CloneVoiceResult> {
  installListener();
  if (typeof window === 'undefined') {
    return { ok: false, error: 'Sem window — bridge so funciona client-side.' };
  }

  const isVideo = (file.type || '').startsWith('video/') ||
    /\.(mp4|mov|webm|mkv)$/i.test(file.name);
  const displayName = (opts.displayName || filenameToDisplayName(file)).slice(0, 50);

  let audioBlob: Blob = file;
  let mimeType = file.type || 'audio/wav';
  let filename = file.name;

  // Extrai audio se for video — reduz upload e HeyGen aceita audio puro
  if (isVideo) {
    opts.onProgress?.('extract_audio', 2, 'Extraindo audio do video...');
    try {
      const { extractAudio } = await import('./ffmpeg-worker');
      audioBlob = await extractAudio(file);
      mimeType = 'audio/wav';
      filename = file.name.replace(/\.(mp4|mov|webm|mkv)$/i, '.wav');
    } catch (e) {
      return { ok: false, error: 'Falha ao extrair audio do video: ' + (e as Error)?.message };
    }
  }

  // Truncate pra acelerar — clone so precisa de 30-90s pra ficar bom
  const trimSec = opts.trimToSeconds ?? 90;
  if (trimSec && trimSec > 0) {
    try {
      opts.onProgress?.('trim', 3, `Cortando audio em ${trimSec}s pra acelerar...`);
      const trimmed = await trimAudioToSeconds(audioBlob, trimSec);
      if (trimmed) {
        audioBlob = trimmed;
        mimeType = 'audio/wav';
        if (!/\.wav$/i.test(filename)) filename = filename.replace(/\.[^.]+$/, '.wav') || 'voice.wav';
      }
    } catch (e) {
      console.warn('[DARKO LAB clone] trim falhou, segue com audio original:', e);
    }
  }

  opts.onProgress?.('encode', 4, 'Codificando audio...');
  const audioBase64 = await blobToBase64(audioBlob);

  // SEM TIMEOUT no DARKO LAB side — extension faz seu proprio timeout 6min
  return new Promise((resolve) => {
    const requestId = `clone_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const handler = (ev: MessageEvent) => {
      if (ev.data?.source !== 'darkolab-ext') return;
      if (ev.data?.requestId !== requestId) return;
      if (ev.data?.type === 'HG_CLONE_VOICE_PROGRESS') {
        opts.onProgress?.(String(ev.data.stage || ''), Number(ev.data.percent) || undefined, String(ev.data.message || ''));
        return;
      }
      if (ev.data?.type === 'HG_CLONE_VOICE_RESULT') {
        window.removeEventListener('message', handler);
        if (ev.data.ok && ev.data.voiceId) {
          resolve({ ok: true, voiceId: String(ev.data.voiceId), voiceName: String(ev.data.voiceName || displayName) });
        } else {
          resolve({ ok: false, error: String(ev.data.error || 'Erro desconhecido') });
        }
      }
    };
    window.addEventListener('message', handler);
    window.postMessage(
      {
        source: 'darkolab',
        type: 'HG_CLONE_VOICE',
        requestId,
        payload: {
          audioBase64,
          filename,
          displayName,
          mimeType,
          removeBackgroundNoise: opts.removeBackgroundNoise ?? true,
          removeBackgroundMusic: opts.removeBackgroundMusic ?? true,
          language: opts.language ?? null,
          model: opts.model ?? 'V3',
        },
      },
      '*',
    );
  });
}

/* ============================ DRIVE DOWNLOAD ============================
 * Baixa MP4 de Drive via extension (cookies sessao Google). Usado pelo
 * pipeline VA pra pegar o video do AD original e extrair audio. */

/** Lista arquivos dentro de uma pasta Drive via extension (cookies sessao).
 *  Usado pra auto-resolver fileId quando o doc so referencia o filename
 *  do AD (ex 'AD10G1VN-PRPB06.mp4') sem URL — lista a pasta CRIATIVOS
 *  do briefing + match por nome. */
export async function listDriveFolderViaExtension(folderId: string): Promise<{
  ok: true;
  files: Array<{ fileId: string; name: string; isFolder: boolean }>;
} | { ok: false; error: string; files: [] }> {
  installListener();
  if (typeof window === 'undefined') return { ok: false, error: 'sem window', files: [] };
  return new Promise((resolve) => {
    const requestId = `lf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const handler = (ev: MessageEvent) => {
      if (ev.data?.source !== 'darkolab-ext') return;
      if (ev.data?.requestId !== requestId) return;
      if (ev.data?.type === 'HG_DRIVE_LIST_FOLDER_RESULT') {
        window.removeEventListener('message', handler);
        if (ev.data.ok) {
          resolve({ ok: true, files: Array.isArray(ev.data.files) ? ev.data.files : [] });
        } else {
          resolve({ ok: false, error: String(ev.data.error || 'list failed'), files: [] });
        }
      }
    };
    window.addEventListener('message', handler);
    window.postMessage({ source: 'darkolab', type: 'HG_DRIVE_LIST_FOLDER', requestId, folderId }, '*');
    setTimeout(() => {
      window.removeEventListener('message', handler);
      resolve({ ok: false, error: 'timeout 30s list folder', files: [] });
    }, 30000);
  });
}

export async function downloadDriveFileViaExtension(fileId: string): Promise<{
  ok: true;
  bytes: Uint8Array;
  size: number;
} | { ok: false; error: string }> {
  installListener();
  if (typeof window === 'undefined') return { ok: false, error: 'sem window' };
  return new Promise((resolve) => {
    const requestId = `dl_drive_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const handler = (ev: MessageEvent) => {
      if (ev.data?.source !== 'darkolab-ext') return;
      if (ev.data?.requestId !== requestId) return;
      if (ev.data?.type === 'HG_DRIVE_DOWNLOAD_RESULT') {
        window.removeEventListener('message', handler);
        if (!ev.data.ok) {
          resolve({ ok: false, error: String(ev.data.error || 'download falhou') });
          return;
        }
        try {
          const binary = atob(String(ev.data.base64 || ''));
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
          resolve({ ok: true, bytes, size: bytes.length });
        } catch (e) {
          resolve({ ok: false, error: 'decode base64: ' + (e as Error)?.message });
        }
      }
    };
    window.addEventListener('message', handler);
    window.postMessage({ source: 'darkolab', type: 'HG_DOWNLOAD_DRIVE', requestId, fileId }, '*');
    // Timeout 10min — video grande pode demorar
    setTimeout(() => {
      window.removeEventListener('message', handler);
      resolve({ ok: false, error: 'timeout 10min download Drive' });
    }, 600000);
  });
}

/**
 * Cancela uma job em andamento (best-effort — extension pode estar com a
 * geracao no HeyGen ja em progresso e nao da pra abortar).
 */
export function cancelAvatarJob(requestId: string) {
  const p = pending.get(requestId);
  if (p) {
    pending.delete(requestId);
    p.reject(new Error('Cancelado pelo usuario.'));
  }
  if (typeof window !== 'undefined') {
    window.postMessage(
      { source: 'darkolab', type: 'HG_CANCEL', requestId },
      '*',
    );
  }
}

/* ===================== Audio helper ===================== */

/**
 * Le um arquivo de audio e retorna base64 (sem prefixo data:).
 * Usado pelo modo audio do HeyGen Auto Avatar.
 */
export async function audioFileToBase64(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(i, i + CHUNK)),
    );
  }
  return btoa(binary);
}

/* ===================== Copy splitter ===================== */

/**
 * Divide a copy em partes inteligente — busca equilibrio "sweet spot".
 *
 * REGRA #1 ABSOLUTA: JAMAIS CORTA UMA FRASE NO MEIO. Sentenca e sagrada.
 *   Mesmo que isso signifique uma parte ficar acima do "max" sugerido,
 *   PREFERIMOS preservar a sentenca inteira. Tempos sao guias, nao limites
 *   rigidos.
 *
 * Sweet spot (so guias):
 *   - TARGET: ~20s por parte (ideal pra dinamica de avatar HeyGen)
 *   - MIN: 10s (evita parts picadas)
 *   - MAX: 35s (evita avatar entrar em "reverse" / aparencia repetitiva)
 *
 * Algoritmo:
 *   1. Quebra por paragrafos (\n\n)
 *   2. Pra cada paragrafo:
 *      - Cabe em <= MAX → vira 1 parte intacta
 *      - > MAX → divide so em boundary de SENTENCA (.!?), nunca no meio.
 *        Calcula N = ceil(dur/TARGET) e tenta dividir em N chunks
 *        equilibrados, sempre fechando em ponto/exclamacao/interrogacao.
 *        Se uma unica sentenca > MAX, ela vira 1 parte sozinha (nao corta).
 *      - < MIN → marca pra merge pos-processo
 *   3. Pos-processo: parts < MIN mescladas com adjacente quando possivel,
 *      preferindo a anterior. Se nao da pra mesclar sem estourar muito,
 *      deixa curta mesmo — preserva a fala intacta.
 *
 * Premissa: avatar HeyGen fala a ~150 wpm (2.5 wps).
 */
export function splitCopyIntoParts(
  copy: string,
  opts: {
    targetSec?: number;
    minSec?: number;
    maxSec?: number;
    wpm?: number;
  } = {},
): string[] {
  const target = opts.targetSec ?? 20;
  const min = opts.minSec ?? 10;
  const max = opts.maxSec ?? 35;
  const wpm = opts.wpm ?? 150;

  const wordsToSec = (text: string) => (countWords(text) / wpm) * 60;

  const paragraphs = copy
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  const parts: string[] = [];

  for (const para of paragraphs) {
    const dur = wordsToSec(para);

    if (dur <= max) {
      // Cabe inteiro — vira 1 parte (mesmo se < min; pos-processo trata)
      parts.push(para);
      continue;
    }

    // Paragrafo longo — divide em N chunks balanceados, SEMPRE em
    // boundary de sentenca. Nunca corta fala.
    const numChunks = Math.max(2, Math.ceil(dur / target));
    const chunkTarget = dur / numChunks;

    const sentences = splitSentences(para);

    // Caso patologico: paragrafo inteiro e UMA frase sem pontuacao final.
    // Nao da pra dividir respeitando boundary — vira 1 parte gigante.
    // Preferimos isso a cortar fala.
    if (sentences.length === 1) {
      parts.push(para);
      continue;
    }

    const chunks: string[] = [];
    let buf = '';
    for (const s of sentences) {
      const candidate = buf ? buf + ' ' + s : s;
      const candidateDur = wordsToSec(candidate);
      const bufDur = buf ? wordsToSec(buf) : 0;

      // Se buf vazio, sempre adiciona (independe de tamanho)
      if (!buf) {
        buf = s;
        continue;
      }

      // Decide: continuar acumulando OU fechar chunk e comecar novo?
      // Fecha quando:
      //   - Adicionar essa sentenca passa MUITO acima do chunkTarget
      //     (>1.3x), OU
      //   - O buf atual ja esta acima do chunkTarget e a sentenca nao
      //     e tao curta que justifica continuar
      const tooFar = candidateDur > chunkTarget * 1.3;
      const bufAtTarget = bufDur >= chunkTarget * 0.85;

      if (tooFar || bufAtTarget) {
        chunks.push(buf);
        buf = s;
      } else {
        buf = candidate;
      }
    }
    if (buf) chunks.push(buf);

    parts.push(...chunks);
  }

  // Pos-processo: parts < min mescladas com adjacente.
  // Estrategia: tenta mesclar com a ANTERIOR primeiro (mantem fluxo),
  // depois com a proxima. Se nao da pra mesclar sem estourar max, deixa
  // curta mesmo — preserva a fala intacta.
  const merged: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    const dur = wordsToSec(p);

    if (dur >= min) {
      merged.push(p);
      continue;
    }

    // Parte curta — tenta merge com a anterior
    if (merged.length > 0) {
      const candidate = merged[merged.length - 1] + ' ' + p;
      if (wordsToSec(candidate) <= max) {
        merged[merged.length - 1] = candidate;
        continue;
      }
    }

    // Tenta merge com a proxima (lookahead)
    if (i + 1 < parts.length) {
      const candidate = p + ' ' + parts[i + 1];
      if (wordsToSec(candidate) <= max) {
        parts[i + 1] = candidate;
        continue;
      }
    }

    // Nao da pra mesclar sem estourar max — fica curta mesmo.
    // Preferivel a cortar fala.
    merged.push(p);
  }

  return merged;
}

function countWords(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

function splitSentences(s: string): string[] {
  // Quebra em pontuacao final (. ! ?) seguida de espaco ou fim
  const out: string[] = [];
  const re = /[^.!?]+[.!?]+/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    out.push(m[0].trim());
    last = m.index + m[0].length;
  }
  const tail = s.slice(last).trim();
  if (tail) out.push(tail);
  return out.filter((x) => x.length > 0);
}
