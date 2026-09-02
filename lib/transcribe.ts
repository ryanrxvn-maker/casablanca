import { getUserKey } from '@/lib/user-keys';
import type { Word } from '@/lib/decupagem-matcher';

/**
 * Transcricao word-level compartilhada (Decupagem match + audit).
 *
 * Provider 'auto' tenta AssemblyAI primeiro (timestamps forced-aligned +
 * confidence por palavra) e cai pro Groq Whisper. `vocab` enviesa o
 * reconhecimento de marcas/nomes (word_boost no AAI, prompt no Whisper) — a
 * AUDITORIA chama SEM vocab de proposito, pra a verificacao nao herdar o vies
 * da geracao (e' assim que palavra-fantasma cai).
 */

const AAI_BASE = 'https://api.assemblyai.com/v2';
const GROQ_BASE = 'https://api.groq.com/openai/v1';

export type TranscribeProvider = 'auto' | 'groq' | 'assemblyai';

export type TranscribeResult = {
  words: Word[];
  provider: string;
  errors: string[];
  /** idioma detectado pelo Whisper (ISO-639-1) quando o Groq devolve; ausente no AAI/erro */
  detectedLanguage?: string;
};

export async function transcribeAudio(
  audio: File,
  opts: {
    vocab?: string[];
    provider?: TranscribeProvider;
    /** ISO 639-1 ('pt' default) ou 'auto' pro Whisper detectar sozinho. */
    language?: string;
  } = {},
): Promise<TranscribeResult> {
  const vocab = opts.vocab ?? [];
  const language = opts.language ?? 'pt';
  const requested = opts.provider ?? 'auto';
  const order: Array<'assemblyai' | 'groq'> =
    requested === 'groq' ? ['groq', 'assemblyai'] : ['assemblyai', 'groq'];

  let words: Word[] = [];
  let provider = '';
  let detectedLanguage: string | undefined;
  const errors: string[] = [];

  for (const p of order) {
    if (words.length > 0) break;
    try {
      if (p === 'assemblyai') {
        words = await transcribeViaAssemblyAI(audio, vocab, language);
      } else {
        words = await transcribeViaGroq(audio, vocab, language);
        if (words.length > 0 && lastGroqLanguage) detectedLanguage = lastGroqLanguage;
      }
      if (words.length > 0) provider = p;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`${p}: ${msg}`);
      console.warn(`[transcribe] ${p} falhou:`, msg);
    }
  }

  return { words, provider, errors, ...(detectedLanguage ? { detectedLanguage } : {}) };
}

/** idioma da ÚLTIMA resposta do Groq (aditivo: a assinatura de transcribeViaGroq não muda) */
let lastGroqLanguage: string | undefined;

async function transcribeViaGroq(
  audio: File,
  vocab: string[],
  language = 'pt',
): Promise<Word[]> {
  lastGroqLanguage = undefined;
  const keyResult = await getUserKey('groq');
  if ('response' in keyResult) throw new Error('Groq key ausente.');
  const apiKey = keyResult.key;

  const fd = new FormData();
  fd.append('file', audio, audio.name || 'audio.opus');
  fd.append('model', 'whisper-large-v3');
  fd.append('response_format', 'verbose_json');
  fd.append('timestamp_granularities[]', 'word');
  // temperatura 0 = decodificação gulosa determinística. O default do
  // Whisper escala a temperatura quando "acha que travou" e é aí que nascem
  // as viajadas (palavra inventada em trecho difícil). Preferimos o vão —
  // a auditoria recupera vão; palavra errada ninguém detecta.
  fd.append('temperature', '0');
  // 'auto' = Whisper detecta o idioma sozinho (omite o parâmetro)
  if (language !== 'auto') fd.append('language', language);
  if (vocab.length > 0) {
    fd.append('prompt', `Termos do roteiro: ${vocab.join(', ')}.`);
  }

  const res = await fetch(`${GROQ_BASE}/audio/transcriptions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: fd,
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Groq ${res.status}: ${t.slice(0, 200)}`);
  }
  const json = (await res.json().catch(() => null)) as {
    words?: Array<{ word: string; start: number; end: number }>;
    language?: string;
  } | null;
  if (!json?.words) throw new Error('Groq retornou sem palavras.');
  if (typeof json.language === 'string' && json.language) {
    lastGroqLanguage = groqLanguageToIso(json.language);
  }

  return json.words.map((w) => ({
    text: w.word,
    start: Math.round(w.start * 1000),
    end: Math.round(w.end * 1000),
  }));
}

async function transcribeViaAssemblyAI(
  audio: File,
  vocab: string[],
  language = 'pt',
): Promise<Word[]> {
  const keyResult = await getUserKey('assemblyai');
  if ('response' in keyResult) throw new Error('AAI key ausente.');
  const apiKey = keyResult.key;

  const audioBytes = new Uint8Array(await audio.arrayBuffer());
  const uploadRes = await fetch(`${AAI_BASE}/upload`, {
    method: 'POST',
    headers: {
      authorization: apiKey,
      'content-type': 'application/octet-stream',
    },
    body: audioBytes,
  });
  if (!uploadRes.ok) throw new Error(`AAI upload ${uploadRes.status}`);
  const { upload_url } = (await uploadRes.json()) as { upload_url: string };

  const trRes = await fetch(`${AAI_BASE}/transcript`, {
    method: 'POST',
    headers: { authorization: apiKey, 'content-type': 'application/json' },
    body: JSON.stringify({
      audio_url: upload_url,
      ...(language === 'auto'
        ? { language_detection: true }
        : { language_code: language }),
      punctuate: true,
      format_text: true,
      // ATENCAO: `disfluencies` NAO e' suportado em pt pela AssemblyAI — manda-lo
      // fazia a chamada FALHAR ("not available in this language") e o tool caía
      // pro Groq (timestamps inferidos, piores). Sem ele, o AAI funciona e
      // entrega timestamps forced-aligned (bem melhores p/ corte sem vazamento).
      ...(vocab.length > 0
        ? { word_boost: vocab, boost_param: 'default' }
        : {}),
    }),
  });
  if (!trRes.ok) throw new Error(`AAI transcript ${trRes.status}`);
  const { id } = (await trRes.json()) as { id: string };

  const deadline = Date.now() + 4 * 60 * 1000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2500));
    const poll = await fetch(`${AAI_BASE}/transcript/${id}`, {
      headers: { authorization: apiKey },
    }).catch(() => null);
    if (!poll || !poll.ok) continue; // blip transitório (rede/5xx) → tenta de novo até o deadline
    const body = (await poll.json().catch(() => null)) as {
      status: string;
      words?: Array<{ text: string; start: number; end: number; confidence: number }>;
      error?: string;
    } | null;
    if (!body) continue; // resposta não-JSON (ex.: 502 HTML da AAI) → tenta de novo
    if (body.status === 'completed') {
      return (body.words ?? []).map((w) => ({
        text: w.text,
        start: w.start,
        end: w.end,
        confidence: w.confidence,
      }));
    }
    if (body.status === 'error') throw new Error(body.error ?? 'AAI error');
  }
  throw new Error('AAI timeout');
}

/** O Groq devolve o nome em inglês ('portuguese'); o app fala ISO-639-1. */
const GROQ_LANG_NAMES: Record<string, string> = {
  portuguese: 'pt', english: 'en', spanish: 'es', french: 'fr', german: 'de', italian: 'it',
  polish: 'pl', czech: 'cs', dutch: 'nl', russian: 'ru', turkish: 'tr', japanese: 'ja',
  korean: 'ko', chinese: 'zh', arabic: 'ar', hindi: 'hi', indonesian: 'id', vietnamese: 'vi',
  romanian: 'ro', hungarian: 'hu', swedish: 'sv', norwegian: 'no', danish: 'da', finnish: 'fi',
  greek: 'el', hebrew: 'he', ukrainian: 'uk', thai: 'th', malay: 'ms', catalan: 'ca',
  bulgarian: 'bg', croatian: 'hr', slovak: 'sk', tagalog: 'tl', urdu: 'ur', persian: 'fa',
};
function groqLanguageToIso(name: string): string {
  const n = name.trim().toLowerCase();
  if (/^[a-z]{2}$/.test(n)) return n;
  return GROQ_LANG_NAMES[n] ?? n.slice(0, 2);
}
