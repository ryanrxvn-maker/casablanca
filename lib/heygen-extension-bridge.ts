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
        },
      },
      '*',
    );
  });
}

/* ============================ DRIVE DOWNLOAD ============================
 * Baixa MP4 de Drive via extension (cookies sessao Google). Usado pelo
 * pipeline VA pra pegar o video do AD original e extrair audio. */

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
