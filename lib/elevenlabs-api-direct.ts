/**
 * ElevenLabs direto pela SESSAO do user (via extensao).
 *
 * Espelho do [[heygen-api-direct]]: nenhuma chamada daqui usa chave de API.
 * Tudo passa pelo proxy do content script da aba do elevenlabs.io, entao a
 * geracao consome o plano que o user JA paga — nunca credito de API avulso.
 *
 * Endpoints (confirmados na sessao real, 15.08.2026):
 *   GET  /v1/voices                        - biblioteca de vozes da conta
 *   GET  /v1/models                        - modelos + limite de caracteres
 *   GET  /v1/user/subscription             - consumo/limite de caracteres
 *   GET  /v1/voices/{id}/orb/thumbnail     - thumb (o "orb" colorido da voz)
 *   POST /v1/text-to-speech/{id}           - gera o audio
 *
 * O host NAO e fixo: a conta do user pode ser regional (api.us.elevenlabs.io
 * no caso dele). Por isso mandamos caminho relativo e a extensao resolve o
 * host que ela OBSERVOU na sessao.
 */

import { elevenApiFetch } from './elevenlabs-extension-bridge';

/* ═════════════════════════════ Tipos ═════════════════════════════ */

export type ElevenVoice = {
  id: string;
  name: string;
  /** 'cloned' | 'professional' | 'generated' | 'premade' | outro */
  category: string;
  /** Voz do PROPRIO user (clonada/profissional/gerada) — vai pro topo. */
  mine: boolean;
  gender: string | null;
  accent: string | null;
  language: string | null;
  description: string | null;
  /** MP3 curto de amostra que o ElevenLabs serve publico (sem auth). */
  previewUrl: string | null;
};

export type ElevenModel = {
  id: string;
  name: string;
  /** Teto de caracteres por request pra ESTA conta. */
  maxChars: number;
  languages: string[];
  description: string | null;
};

export type ElevenVoiceSettings = {
  /** 0..1 — no v3 e discreto (0 / 0.5 / 1). */
  stability: number;
  /** 0..1 */
  similarity_boost: number;
  /** 0..1 — exagero de estilo. Custa latencia. */
  style: number;
  use_speaker_boost: boolean;
  /** 0.7..1.2 — velocidade da fala. */
  speed: number;
};

export type ElevenSubscription = {
  ok: boolean;
  tier: string | null;
  characterCount: number;
  characterLimit: number;
  /** Quanto ainda da pra gerar. */
  remaining: number;
  nextResetUnix: number | null;
  error?: string;
};

/** O mesmo setup que o user ja usa hoje no app (multilingual v2, estabilidade
 *  0.5) — os defaults saem iguais ao que ele ouve la, entao ligar o modo
 *  Eleven no Pilot nao muda o som do que ele ja aprovou. */
export const DEFAULT_MODEL_ID = 'eleven_multilingual_v2';

export const DEFAULT_VOICE_SETTINGS: ElevenVoiceSettings = {
  stability: 0.5,
  similarity_boost: 0.75,
  style: 0,
  use_speaker_boost: true,
  speed: 1,
};

/** Teto de caracteres por request quando /v1/models nao responde. Conservador
 *  de proposito: chunk a mais so custa uma emenda, chunk a menos = request
 *  recusada no meio de um disparo. */
const FALLBACK_MAX_CHARS: Record<string, number> = {
  eleven_v3: 3000,
  eleven_multilingual_v2: 9000,
  eleven_multilingual_v1: 9000,
  eleven_english_sts_v2: 9000,
  eleven_turbo_v2_5: 39000,
  eleven_turbo_v2: 29000,
  eleven_flash_v2_5: 39000,
  eleven_flash_v2: 29000,
};
const FALLBACK_MAX_CHARS_DEFAULT = 5000;

/* ═════════════════════════════ Helpers ═════════════════════════════ */

/** Mensagem de erro legivel a partir do corpo que o ElevenLabs devolveu.
 *  O shape varia (detail string, detail.message, detail[].msg) — sem isso o
 *  user via "[object Object]" na tela. */
function elevenError(r: { status: number; body: any }): string {
  const b = r?.body ?? {};
  if (b._needsSession) return String(b.message);
  const d = b.detail ?? b.error ?? b.message;
  let txt = '';
  if (typeof d === 'string') txt = d;
  else if (d && typeof d === 'object') {
    txt = String(d.message || d.msg || d.detail || '');
    if (!txt && Array.isArray(d)) txt = d.map((x: any) => x?.msg || x?.message).filter(Boolean).join('; ');
  }
  if (!txt && Array.isArray(b.detail)) {
    txt = b.detail.map((x: any) => x?.msg || x?.message).filter(Boolean).join('; ');
  }
  if (!txt) txt = String(b._text || b.message || '').slice(0, 200);

  // Traduz os casos que o user REALMENTE encontra.
  if (r.status === 401 || r.status === 403 || /unauthor|invalid.*(token|key)/i.test(txt)) {
    return 'A sessão do ElevenLabs expirou. Faça login de novo em elevenlabs.io, dê F5 na aba e tente outra vez.';
  }
  if (r.status === 429 || /rate.?limit|too many/i.test(txt)) {
    return 'O ElevenLabs pediu pra desacelerar (limite de requisições). Vou tentar de novo em instantes.';
  }
  if (/quota|character.?limit|exceed/i.test(txt)) {
    return 'Os caracteres do seu plano ElevenLabs acabaram. Renove/aumente o plano pra continuar gerando.';
  }
  return txt || `ElevenLabs respondeu ${r.status}.`;
}

/** Erro que vale a pena tentar de novo (rede, 5xx, rate limit). */
function isTransient(status: number, msg: string): boolean {
  if (status === 0 || status === 429) return true;
  if (status >= 500) return true;
  return /desacelerar|rede|network|timeout|não respondeu/i.test(msg);
}

async function jsonGet(path: string, timeoutMs = 45000): Promise<any> {
  const r = await elevenApiFetch({ url: path, method: 'GET' }, { timeoutMs });
  if (!r.ok) throw new Error(elevenError(r));
  return r.body;
}

/* ═════════════════════════════ Vozes ═════════════════════════════ */

let _voicesCache: { at: number; voices: ElevenVoice[] } | null = null;
const VOICES_CACHE_MS = 5 * 60 * 1000;

function parseVoice(v: any): ElevenVoice | null {
  const id = v?.voice_id || v?.id;
  if (!id) return null;
  const labels = v?.labels || {};
  const category = String(v?.category || 'premade');
  return {
    id: String(id),
    name: String(v?.name || v?.display_name || id),
    category,
    // "minhas" = tudo que nao e catalogo publico. E o que o user quer no topo:
    // as vozes que ELE clonou/comprou pra usar nos anuncios.
    mine: category !== 'premade',
    gender: labels.gender ?? null,
    accent: labels.accent ?? null,
    language: labels.language ?? v?.fine_tuning?.language ?? null,
    description: v?.description ?? labels.description ?? null,
    previewUrl: v?.preview_url ?? null,
  };
}

/**
 * Lista as vozes da CONTA ATIVA — o mesmo que o user ve em elevenlabs.io.
 * As dele (clonadas/profissionais) vem primeiro.
 *
 * Cache de 5min. So cacheia quando achou algo: lista vazia pode ser "sem
 * sessao" e cachear isso esconderia a extensao que conectar depois (mesma
 * decisao de [[listStockVoices]] no HeyGen).
 */
export async function listMyElevenVoices(
  opts: { force?: boolean } = {},
): Promise<{ ok: boolean; voices: ElevenVoice[]; error?: string }> {
  if (!opts.force && _voicesCache && Date.now() - _voicesCache.at < VOICES_CACHE_MS) {
    return { ok: true, voices: _voicesCache.voices };
  }
  try {
    const body = await jsonGet('/v1/voices?page_size=200');
    const arr: any[] = body?.voices || body?.data?.voices || [];
    const seen = new Set<string>();
    const out: ElevenVoice[] = [];
    for (const v of arr) {
      const row = parseVoice(v);
      if (!row || seen.has(row.id)) continue;
      seen.add(row.id);
      out.push(row);
    }
    // Minhas primeiro; dentro de cada grupo, alfabetico.
    out.sort((a, b) => (a.mine === b.mine ? a.name.localeCompare(b.name, 'pt-BR') : a.mine ? -1 : 1));
    if (out.length > 0) _voicesCache = { at: Date.now(), voices: out };
    return { ok: true, voices: out };
  } catch (e) {
    return { ok: false, voices: _voicesCache?.voices || [], error: (e as Error)?.message };
  }
}

/** Limpa o cache — usado pelo botao "recarregar vozes" do picker. */
export function clearElevenVoicesCache(): void {
  _voicesCache = null;
}

/* ═════════════════════════════ Modelos ═════════════════════════════ */

let _modelsCache: { at: number; models: ElevenModel[] } | null = null;

export async function listElevenModels(): Promise<ElevenModel[]> {
  if (_modelsCache && Date.now() - _modelsCache.at < 30 * 60 * 1000) return _modelsCache.models;
  try {
    const body = await jsonGet('/v1/models');
    const arr: any[] = Array.isArray(body) ? body : body?.models || [];
    const out: ElevenModel[] = [];
    for (const m of arr) {
      const id = m?.model_id;
      if (!id || m?.can_do_text_to_speech === false) continue;
      const max =
        Number(m?.max_characters_request_subscribed_user) ||
        Number(m?.max_characters_request_free_user) ||
        FALLBACK_MAX_CHARS[id] ||
        FALLBACK_MAX_CHARS_DEFAULT;
      out.push({
        id: String(id),
        name: String(m?.name || id),
        maxChars: max,
        languages: Array.isArray(m?.languages)
          ? m.languages.map((l: any) => String(l?.language_id || l?.name || '')).filter(Boolean)
          : [],
        description: m?.description ?? null,
      });
    }
    if (out.length > 0) _modelsCache = { at: Date.now(), models: out };
    return out;
  } catch {
    return _modelsCache?.models || [];
  }
}

/** Teto de caracteres por request pro modelo escolhido. */
export async function maxCharsFor(modelId: string): Promise<number> {
  const models = await listElevenModels();
  const hit = models.find((m) => m.id === modelId);
  if (hit?.maxChars) return hit.maxChars;
  return FALLBACK_MAX_CHARS[modelId] ?? FALLBACK_MAX_CHARS_DEFAULT;
}

/* ═══════════════════════════ Assinatura ═══════════════════════════ */

export async function getElevenSubscription(): Promise<ElevenSubscription> {
  try {
    const b = await jsonGet('/v1/user/subscription', 30000);
    const used = Number(b?.character_count ?? 0);
    const limit = Number(b?.character_limit ?? 0);
    return {
      ok: true,
      tier: b?.tier ?? null,
      characterCount: used,
      characterLimit: limit,
      remaining: Math.max(0, limit - used),
      nextResetUnix: b?.next_character_count_reset_unix ?? null,
    };
  } catch (e) {
    return {
      ok: false,
      tier: null,
      characterCount: 0,
      characterLimit: 0,
      remaining: 0,
      nextResetUnix: null,
      error: (e as Error)?.message,
    };
  }
}

/* ═══════════════════════════ Thumb da voz ═══════════════════════════ */

const _orbCache = new Map<string, string>();

/**
 * Thumb ("orb") da voz como data URL. Passa pelo proxy porque o endpoint
 * exige a sessao — um <img src> cru voltaria 401 e o picker ficaria sem
 * identidade visual nenhuma.
 */
export async function fetchVoiceOrb(voiceId: string, size = 64): Promise<string | null> {
  const key = `${voiceId}:${size}`;
  const cached = _orbCache.get(key);
  if (cached) return cached;
  try {
    const r = await elevenApiFetch(
      { url: `/v1/voices/${encodeURIComponent(voiceId)}/orb/thumbnail?size=${size}` },
      { timeoutMs: 20000 },
    );
    if (!r.ok || !r.body?._bytesBase64) return null;
    const mime = r.body._contentType || 'image/png';
    const url = `data:${mime};base64,${r.body._bytesBase64}`;
    _orbCache.set(key, url);
    return url;
  } catch {
    return null;
  }
}

/* ═════════════════════════════ TTS ═════════════════════════════ */

function base64ToBlob(b64: string, mime: string): Blob {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

export type TtsChunkParams = {
  text: string;
  voiceId: string;
  modelId: string;
  settings: ElevenVoiceSettings;
  /** Contexto pro modelo manter a prosodia entre pedacos emendados. */
  previousText?: string;
  nextText?: string;
  /** Mantem a entonacao consistente entre requests do MESMO disparo. */
  previousRequestIds?: string[];
  languageCode?: string | null;
};

export type TtsChunkResult = {
  blob: Blob;
  /** Devolvido pelo ElevenLabs — encadeia o proximo pedaco. */
  requestId: string | null;
  chars: number;
};

/**
 * UM request de TTS. Nao chunka — quem chunka e [[generateElevenSpeech]].
 *
 * `output_format=mp3_44100_128` e o formato que o app do user usa e que todo
 * plano aceita (os PCM/192k exigem tier alto e falhariam calado no meio do
 * disparo).
 */
export async function ttsChunk(p: TtsChunkParams): Promise<TtsChunkResult> {
  const payload: Record<string, unknown> = {
    text: p.text,
    model_id: p.modelId,
    voice_settings: {
      stability: p.settings.stability,
      similarity_boost: p.settings.similarity_boost,
      style: p.settings.style,
      use_speaker_boost: p.settings.use_speaker_boost,
      speed: p.settings.speed,
    },
  };
  if (p.previousText) payload.previous_text = p.previousText;
  if (p.nextText) payload.next_text = p.nextText;
  if (p.previousRequestIds?.length) {
    // O ElevenLabs aceita ate 3 — mandar mais devolve 422.
    payload.previous_request_ids = p.previousRequestIds.slice(-3);
  }
  if (p.languageCode) payload.language_code = p.languageCode;

  const url =
    `/v1/text-to-speech/${encodeURIComponent(p.voiceId)}` +
    `?output_format=mp3_44100_128&allow_unauthenticated=0`;

  let last = '';
  for (let attempt = 1; attempt <= 3; attempt++) {
    const r = await elevenApiFetch(
      {
        url,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
        bodyText: JSON.stringify(payload),
      },
      { timeoutMs: 300000 },
    );

    if (r.ok && r.body?._bytesBase64) {
      const mime = r.body._contentType?.includes('audio') ? r.body._contentType : 'audio/mpeg';
      return {
        blob: base64ToBlob(r.body._bytesBase64, mime),
        requestId: r.body?._requestId ?? null,
        chars: p.text.length,
      };
    }

    // 200 sem audio = contrato mudou. Vale falhar alto: gerar em silencio um
    // arquivo vazio e pior que avisar.
    if (r.ok) {
      const keys = Object.keys(r.body ?? {}).join(',') || '(vazio)';
      throw new Error(
        `O ElevenLabs respondeu OK mas sem áudio (ct=${r.body?._contentType || '?'}, campos=${keys}).`,
      );
    }

    last = elevenError(r);
    if (!isTransient(r.status, last) || attempt === 3) break;
    const espera = 1500 * attempt;
    console.warn(`[elevenlabs] tentativa ${attempt}/3 falhou (${last}) — retry em ${espera}ms`);
    await new Promise((res) => setTimeout(res, espera));
  }
  throw new Error(last || 'Falha ao gerar o áudio no ElevenLabs.');
}

/* ══════════════════════ Quebra de texto longo ══════════════════════ */

/**
 * Quebra a copy em pedacos que cabem no modelo SEM CORTAR FRASE.
 * Mesma regra sagrada do [[splitCopyIntoParts]]: frase e indivisivel — se uma
 * unica frase estourar o teto, ela vai sozinha e inteira (o ElevenLabs
 * aguenta; cortar no meio estragaria a entonacao e o sentido).
 */
export function splitTextForTts(text: string, maxChars: number): string[] {
  const limpo = (text || '').trim();
  if (!limpo) return [];
  if (limpo.length <= maxChars) return [limpo];

  // Paragrafo e a melhor emenda possivel (silencio natural na fala).
  const paragrafos = limpo
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);

  const pedacos: string[] = [];
  let buf = '';

  const fechar = () => {
    if (buf.trim()) pedacos.push(buf.trim());
    buf = '';
  };

  for (const para of paragrafos) {
    if ((buf ? buf.length + 2 : 0) + para.length <= maxChars) {
      buf = buf ? `${buf}\n\n${para}` : para;
      continue;
    }
    fechar();
    if (para.length <= maxChars) {
      buf = para;
      continue;
    }
    // Paragrafo maior que o teto — desce pra frase.
    for (const frase of splitSentencas(para)) {
      if ((buf ? buf.length + 1 : 0) + frase.length <= maxChars) {
        buf = buf ? `${buf} ${frase}` : frase;
      } else {
        fechar();
        buf = frase; // frase sozinha, mesmo que passe do teto — nunca corta
      }
    }
    fechar();
  }
  fechar();
  return pedacos;
}

function splitSentencas(s: string): string[] {
  const out: string[] = [];
  const re = /[^.!?…]+[.!?…]+["'”’)\]]*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    out.push(m[0].trim());
    last = m.index + m[0].length;
  }
  const tail = s.slice(last).trim();
  if (tail) out.push(tail);
  return out.filter(Boolean);
}

/* ══════════════════════ Geracao completa ══════════════════════ */

export type GenerateSpeechParams = {
  text: string;
  voiceId: string;
  modelId?: string;
  settings?: Partial<ElevenVoiceSettings>;
  languageCode?: string | null;
  onProgress?: (feito: number, total: number, etapa: string) => void;
  isCancelled?: () => boolean;
};

export type GenerateSpeechResult = {
  blob: Blob;
  chars: number;
  chunks: number;
};

/**
 * Gera a fala inteira de um texto — chunkando quando passa do teto do modelo
 * e emendando os pedacos num MP3 so.
 *
 * A emenda usa ffmpeg (concat demuxer, -c copy): sem re-encode, sem perda,
 * sem gap audivel. E os pedacos vao com previous_text/next_text +
 * previous_request_ids pro modelo NAO trocar de entonacao no meio da copy —
 * que e o defeito classico de quem so cola dois audios gerados solto.
 */
export async function generateElevenSpeech(
  p: GenerateSpeechParams,
): Promise<GenerateSpeechResult> {
  const modelId = p.modelId || DEFAULT_MODEL_ID;
  const settings: ElevenVoiceSettings = { ...DEFAULT_VOICE_SETTINGS, ...(p.settings || {}) };
  const texto = (p.text || '').trim();
  if (!texto) throw new Error('Texto vazio — nada pra gerar.');

  const teto = await maxCharsFor(modelId);
  const pedacos = splitTextForTts(texto, teto);
  if (pedacos.length === 0) throw new Error('Texto vazio — nada pra gerar.');

  const blobs: Blob[] = [];
  const requestIds: string[] = [];
  let chars = 0;

  for (let i = 0; i < pedacos.length; i++) {
    if (p.isCancelled?.()) throw new Error('Cancelado pelo usuário.');
    p.onProgress?.(i, pedacos.length, pedacos.length > 1 ? `Gerando trecho ${i + 1}/${pedacos.length}…` : 'Gerando áudio…');
    const res = await ttsChunk({
      text: pedacos[i],
      voiceId: p.voiceId,
      modelId,
      settings,
      // Contexto = as pontas dos vizinhos (o modelo so precisa do embalo).
      previousText: i > 0 ? pedacos[i - 1].slice(-600) : undefined,
      nextText: i < pedacos.length - 1 ? pedacos[i + 1].slice(0, 600) : undefined,
      previousRequestIds: requestIds,
      languageCode: p.languageCode ?? null,
    });
    blobs.push(res.blob);
    if (res.requestId) requestIds.push(res.requestId);
    chars += res.chars;
  }

  p.onProgress?.(pedacos.length, pedacos.length, 'Áudio pronto.');

  if (blobs.length === 1) return { blob: blobs[0], chars, chunks: 1 };

  const { concatDecupChunks } = await import('./ffmpeg-worker');
  const { runFfmpegExclusive } = await import('./ffmpeg-serial');
  const juntos = await runFfmpegExclusive(() => concatDecupChunks(blobs, 'mp3'));
  return { blob: juntos, chars, chunks: blobs.length };
}

/**
 * Emenda audios ja gerados num MP3 so (hook + body, na ordem recebida).
 *
 * E ESTA funcao que faz o body ser gerado UMA vez e servir pros N hooks:
 * cada entrega final e "hook N + o MESMO body", montada aqui, sem uma
 * geracao a mais no ElevenLabs. Sem isso, 3 hooks custariam 3 corpos.
 */
export async function concatElevenAudios(parts: Blob[]): Promise<Blob> {
  if (parts.length === 0) throw new Error('Nada pra juntar.');
  if (parts.length === 1) return parts[0];
  const { concatDecupChunks } = await import('./ffmpeg-worker');
  const { runFfmpegExclusive } = await import('./ffmpeg-serial');
  return runFfmpegExclusive(() => concatDecupChunks(parts, 'mp3'));
}
