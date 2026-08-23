import { NextResponse } from 'next/server';
import { requireToolAccess } from '@/lib/require-tier';
import { getUserKey } from '@/lib/user-keys';
import { createAnthropicClient, LlmError, structuredMessage, llmModel } from '@/lib/llm/anthropic';
import { GROQ_LIMITS, GROQ_MODEL_PREFERENCE, groqModelOverride, groqStructuredMessage, resolveGroqModels } from '@/lib/llm/groq';
import {
  sanitizeHeadline,
  MAP_SCHEMA,
  MAP_SYSTEM,
  REDUCE_SCHEMA,
  REDUCE_SYSTEM,
  buildMapUser,
  buildReduceUser,
  formatSentencesForModel,
} from '@/lib/auto-cortes/prompts';
import { resolveCandidates, sanitizeClipPlan } from '@/lib/auto-cortes/analyze';
import { CLIP_LENGTH_RANGE_SEC, GENRE_LABEL, LIMITS } from '@/lib/auto-cortes/types';
import type {
  AnalyzeErrorResponse,
  AnalyzeInfo,
  AnalyzeMapResponse,
  AnalyzeReduceResponse,
  AnalyzeSettings,
  ClipLengthPreset,
  Genre,
  MapResult,
  ReduceResult,
  ResolvedCandidate,
  Sentence,
} from '@/lib/auto-cortes/types';

/**
 * POST /api/auto-cortes/analyze — a inteligência do AUTO CORTES.
 *
 * UMA chamada ao Claude por requisição (`op:'map'` de 1 janela ou `op:'reduce'`),
 * porque a função da Vercel tem teto de 300 s e um podcast de 2 h tem ~10
 * janelas. Quem orquestra (concorrência, retry por janela, progresso) é o
 * navegador — lib/auto-cortes/analyze-client.ts.
 *
 * Nenhum byte de vídeo passa por aqui: só texto de transcrição.
 *
 * PROVEDOR (decisão do dono, 23.08.2026: "não pode gastar nada"):
 *   - padrão = Groq (free tier) com a MESMA chave que o cliente já usa pra
 *     transcrição → custo zero pra todo mundo;
 *   - `AUTO_CORTES_PROVIDER=anthropic` liga o Claude (chave BYOK `anthropic`),
 *     e `auto` usa o Claude só quando o cliente tem a chave, senão Groq.
 */

type Provider = 'groq' | 'anthropic';

function providerPolicy(): 'groq' | 'anthropic' | 'auto' {
  const v = (process.env.AUTO_CORTES_PROVIDER ?? '').trim().toLowerCase();
  return v === 'anthropic' || v === 'auto' ? v : 'groq';
}

/** Escolhe o provedor e pega a chave certa. Nunca gasta Claude sem o dono ligar. */
async function pickProvider(): Promise<
  { provider: Provider; apiKey: string } | { response: Response }
> {
  const policy = providerPolicy();
  if (policy !== 'groq') {
    const a = await getUserKey('anthropic');
    if (!('response' in a)) return { provider: 'anthropic', apiKey: a.key };
    if (policy === 'anthropic') return a;
  }
  const g = await getUserKey('groq');
  if ('response' in g) return g;
  return { provider: 'groq', apiKey: g.key };
}

async function infoFor(provider: Provider, apiKey: string): Promise<AnalyzeInfo> {
  if (provider === 'anthropic') {
    return {
      provider,
      model: llmModel(),
      free: false,
      windowSec: LIMITS.analyzeWindowSec,
      windowOverlapSec: LIMITS.analyzeWindowOverlapSec,
      mapConcurrency: LIMITS.analyzeMapConcurrency,
      maxClips: LIMITS.maxClips,
      reduceMaxCandidates: MAX_CANDIDATES,
    };
  }
  return {
    provider,
    model: groqModelOverride() ?? (await resolveGroqModels(apiKey))[0] ?? GROQ_MODEL_PREFERENCE[0],
    free: true,
    windowSec: GROQ_LIMITS.analyzeWindowSec,
    windowOverlapSec: GROQ_LIMITS.analyzeWindowOverlapSec,
    mapConcurrency: GROQ_LIMITS.analyzeMapConcurrency,
    maxClips: GROQ_LIMITS.reduceMaxClips,
    reduceMaxCandidates: GROQ_LIMITS.reduceMaxCandidates,
  };
}

export const runtime = 'nodejs';
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

// Tetos defensivos (o cliente já respeita, mas a rota é pública pra quem tem cookie).
const MAX_SENTENCES_PER_WINDOW = 400;
const MAX_CANDIDATES = 400;
const MAX_SENTENCE_CHARS = 1200;
const MAX_FOCUS_CHARS = 500;
const MAX_NAME_CHARS = 200;

const MAP_MAX_TOKENS = 6000;
const REDUCE_MAX_TOKENS = 16000;

/**
 * Corpo CRU. Não dá pra tipar como `Partial<AnalyzeMapRequest & AnalyzeReduceRequest>`
 * (a interseção de dois `op` literais diferentes vira `never`): a união é
 * reconstruída pelas funções `read*` abaixo, que são a validação de verdade.
 */
type RawBody = {
  op?: unknown;
  windowIdx?: unknown;
  windowTotal?: unknown;
  sentences?: unknown;
  candidates?: unknown;
  settings?: unknown;
  source?: unknown;
  count?: unknown;
};

function fail(body: AnalyzeErrorResponse, status: number) {
  return NextResponse.json(body, { status });
}

/** Converte uma resposta de gate (tier/chave) no formato `AnalyzeErrorResponse`. */
async function gateError(res: Response): Promise<NextResponse> {
  let error = 'Não consegui liberar essa ferramenta agora.';
  let showConfig = false;
  try {
    const j = (await res.clone().json()) as { error?: string; missingKey?: string };
    if (typeof j?.error === 'string' && j.error.trim()) error = j.error;
    if (j?.missingKey) showConfig = true;
  } catch {
    /* corpo não-JSON: fica a mensagem padrão */
  }
  // Chave ausente (400 com missingKey) e chave corrompida (500) mandam o
  // cliente pra /configuracoes/api — nos dois casos o banner de chave resolve.
  if (!showConfig && /configuracoes/i.test(error)) showConfig = true;
  return fail(showConfig ? { error, showConfig: true } : { error }, res.status);
}

// ───────────────────────────────────────────────────────────────────────────
// Validação defensiva do corpo
// ───────────────────────────────────────────────────────────────────────────

const LENGTHS = Object.keys(CLIP_LENGTH_RANGE_SEC) as ClipLengthPreset[];
const GENRES = Object.keys(GENRE_LABEL) as Genre[];

function readSettings(raw: unknown): AnalyzeSettings {
  const s = (raw ?? {}) as Partial<AnalyzeSettings>;
  const length = LENGTHS.includes(s.length as ClipLengthPreset) ? (s.length as ClipLengthPreset) : 'auto';
  const genre = GENRES.includes(s.genre as Genre) ? (s.genre as Genre) : 'auto';
  const language = String(s.language ?? 'auto').slice(0, 20) || 'auto';
  const focusPrompt = String(s.focusPrompt ?? '').slice(0, MAX_FOCUS_CHARS);
  const count = s.count ?? 'auto';
  return { length, genre, language, focusPrompt, count };
}

function readSource(raw: unknown): { name: string; durationSec: number } {
  const s = (raw ?? {}) as { name?: unknown; durationSec?: unknown };
  const name = String(s.name ?? 'vídeo').slice(0, MAX_NAME_CHARS) || 'vídeo';
  const d = Number(s.durationSec);
  const durationSec = Number.isFinite(d) && d > 0 ? Math.min(LIMITS.maxDurationSec, d) : 0;
  return { name, durationSec };
}

/** `null` = inválido (a mensagem de erro é responsabilidade do chamador). */
function readSentences(raw: unknown): Sentence[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  if (raw.length > MAX_SENTENCES_PER_WINDOW) return null;
  const out: Sentence[] = [];
  for (const item of raw) {
    const s = item as Partial<Sentence>;
    const id = String(s?.id ?? '');
    if (!/^S\d{4,6}$/.test(id)) return null;
    const startMs = Number(s?.startMs);
    const endMs = Number(s?.endMs);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null;
    out.push({
      id,
      startMs: Math.max(0, startMs),
      endMs: Math.max(0, endMs),
      text: String(s?.text ?? '').slice(0, MAX_SENTENCE_CHARS),
      wordFrom: Number(s?.wordFrom) || 0,
      wordTo: Number(s?.wordTo) || 0,
    });
  }
  return out;
}

function readCandidates(raw: unknown): ResolvedCandidate[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  if (raw.length > MAX_CANDIDATES) return null;
  const out: ResolvedCandidate[] = [];
  for (const item of raw) {
    const c = item as Partial<ResolvedCandidate>;
    if (!c || typeof c.id !== 'string' || !c.id) return null;
    out.push({
      id: c.id.slice(0, 40),
      startId: String(c.startId ?? ''),
      endId: String(c.endId ?? ''),
      hookId: String(c.hookId ?? ''),
      topic: String(c.topic ?? '').slice(0, 200),
      why: String(c.why ?? '').slice(0, 400),
      kind: (c.kind ?? 'outro') as ResolvedCandidate['kind'],
      scores: {
        hook: Number(c.scores?.hook) || 0,
        value: Number(c.scores?.value) || 0,
        emotion: Number(c.scores?.emotion) || 0,
        completeness: Number(c.scores?.completeness) || 0,
        shareability: Number(c.scores?.shareability) || 0,
      },
      startMs: Number(c.startMs) || 0,
      endMs: Number(c.endMs) || 0,
      durationSec: Number(c.durationSec) || 0,
      firstSentence: String(c.firstSentence ?? '').slice(0, 200),
      lastSentence: String(c.lastSentence ?? '').slice(0, 200),
    });
  }
  return out;
}

// ───────────────────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  try {
    const gate = await requireToolAccess('/tools/auto-cortes', 'basic');
    if (!gate.ok) return gateError(gate.response);

    const picked = await pickProvider();
    if ('response' in picked) return gateError(picked.response);
    const info = await infoFor(picked.provider, picked.apiKey);

    let body: RawBody;
    try {
      body = (await req.json()) as RawBody;
    } catch {
      return fail({ error: 'Não consegui ler o pedido de análise. Recarregue a página e tente de novo.' }, 400);
    }

    const op = body?.op;
    if (op !== 'map' && op !== 'reduce' && op !== 'titles') {
      return fail({ error: 'Pedido de análise inválido (etapa desconhecida).' }, 400);
    }

    const settings = readSettings(body.settings);
    const source = readSource(body.source);
    const signal = req.signal;
    const client = picked.provider === 'anthropic' ? createAnthropicClient(picked.apiKey) : null;

    /** Uma chamada estruturada no provedor escolhido (mesma forma de resposta). */
    // Fila de modelos REAIS da conta (o catálogo do Groq muda; nada fixo aqui).
    const groqModels = client ? [] : await resolveGroqModels(picked.apiKey, signal);

    if (op === 'titles') return await responderTitulos(body, picked, client, signal);

    const ask = <T,>(a: {
      system: string;
      user: string;
      schema: Record<string, unknown>;
      effort: 'medium' | 'high';
      maxTokens: number;
    }) =>
      client
        ? structuredMessage<T>({ client, ...a, signal })
        : groqStructuredMessage<T>({
            apiKey: picked.apiKey,
            models: groqModels,
            ...a,
            maxTokens: a.effort === 'high' ? GROQ_LIMITS.reduceMaxTokens : GROQ_LIMITS.mapMaxTokens,
            signal,
          });

    if (op === 'map') {
      const sentences = readSentences(body.sentences);
      if (!sentences) {
        return fail(
          { error: `Trecho de transcrição inválido ou grande demais (máximo ${MAX_SENTENCES_PER_WINDOW} frases por janela).` },
          400,
        );
      }
      const windowIdx = Math.max(0, Math.floor(Number(body.windowIdx) || 0));
      const windowTotal = Math.max(1, Math.floor(Number(body.windowTotal) || 1));

      const user = buildMapUser({
        windowIdx,
        windowTotal,
        windowText: formatSentencesForModel(sentences),
        genre: settings.genre,
        length: settings.length,
        focusPrompt: settings.focusPrompt,
        language: settings.language,
        sourceName: source.name,
      });

      const res = await ask<MapResult>({
        system: MAP_SYSTEM,
        user,
        schema: MAP_SCHEMA as unknown as Record<string, unknown>,
        effort: 'medium',
        maxTokens: MAP_MAX_TOKENS,
      });

      const payload: AnalyzeMapResponse = {
        op: 'map',
        windowIdx,
        candidates: resolveCandidates(windowIdx, res.data, sentences, settings.length),
        model: res.model,
        usage: res.usage,
      };
      return NextResponse.json(payload);
    }

    // op === 'reduce'
    const candidates = readCandidates(body.candidates);
    if (!candidates) {
      return fail(
        { error: `Lista de trechos inválida ou grande demais (máximo ${MAX_CANDIDATES} candidatos).` },
        400,
      );
    }
    const count = Math.max(
      1,
      Math.min(info.maxClips, Math.floor(Number(body.count) || LIMITS.minClips)),
    );
    // Free tier: só os melhores candidatos cabem no teto por minuto do modelo.
    const shortlist =
      candidates.length > info.reduceMaxCandidates
        ? [...candidates]
            .sort((a, b) => scoreSumOf(b) - scoreSumOf(a))
            .slice(0, info.reduceMaxCandidates)
            .sort((a, b) => a.startMs - b.startMs)
        : candidates;

    // O teto por minuto do free tier conta entrada + saída: pedido recusado por
    // tamanho é ENCOLHIDO (menos candidatos) em vez de virar erro pro cliente.
    let pool = shortlist;
    let res: Awaited<ReturnType<typeof ask<ReduceResult>>>;
    for (let tentativa = 0; ; tentativa++) {
      try {
        res = await ask<ReduceResult>({
          system: REDUCE_SYSTEM,
          user: buildReduceUser({
            candidates: pool,
            count: Math.min(count, pool.length),
            genre: settings.genre,
            length: settings.length,
            focusPrompt: settings.focusPrompt,
            language: settings.language,
            sourceName: source.name,
            sourceDurationSec: source.durationSec,
          }),
          schema: REDUCE_SCHEMA as unknown as Record<string, unknown>,
          effort: 'high',
          maxTokens: REDUCE_MAX_TOKENS,
        });
        break;
      } catch (e) {
        const menor = Math.max(6, Math.floor(pool.length / 2));
        if (e instanceof LlmError && e.tooLarge && tentativa < 3 && menor < pool.length) {
          console.warn(`[auto-cortes] reduce grande demais com ${pool.length} candidatos — tentando ${menor}`);
          pool = pool.slice(0, menor);
          continue;
        }
        throw e;
      }
    }

    const known = new Set(pool.map((c) => c.id));
    const seen = new Set<string>();
    const clips = (Array.isArray(res.data?.clips) ? res.data.clips : [])
      .filter((c) => {
        const id = String(c?.candidateId ?? '');
        if (!known.has(id) || seen.has(id)) return false;
        seen.add(id);
        return true;
      })
      .slice(0, count)
      .map((c) => sanitizeClipPlan(c));

    const payload: AnalyzeReduceResponse = {
      op: 'reduce',
      clips,
      model: res.model,
      usage: res.usage,
    };
    return NextResponse.json(payload);
  } catch (e) {
    if (e instanceof LlmError) {
      const body: AnalyzeErrorResponse = { error: e.message };
      if (e.showConfig) body.showConfig = true;
      if (typeof e.retryAfterSec === 'number') body.retryAfterSec = e.retryAfterSec;
      // 499 (cancelado pelo cliente) não tem resposta pra entregar; devolve 400 mudo.
      return fail(body, e.status === 499 ? 400 : e.status);
    }
    console.error('[auto-cortes analyze]', e);
    return fail({ error: 'Erro inesperado na análise. Tente de novo em instantes.' }, 500);
  }
}

const TITLES_SYSTEM = `Você é redator de cortes virais. Recebe trechos JÁ ESCOLHIDOS de um vídeo (a fala transcrita de cada um) e escreve, para cada trecho, um título de post e uma headline pra queimar no vídeo.

REGRAS DURAS
- Use SOMENTE o que foi dito no trecho. Não invente fato, número, nome nem promessa.
- A transcrição é fala real e pode ter erro de reconhecimento; conserte a gramática ao escrever, mas não mude o sentido.
- headline: no máximo 8 palavras, no máximo 2 linhas de leitura, SEM ponto final, sem emoji, sem aspas, sem hashtag. Tem que ser entendida em 1 segundo com o som desligado e criar tensão que só o vídeo resolve. Prefira número concreto, contraste, ordem direta ou pergunta.
- title: até 70 caracteres, específico, sem clickbait vazio. O padrão que performa é "<setup específico>: <payoff>".
- headline e title falam do MESMO fato central do trecho.
- Nunca use a pergunta do entrevistador como título: o título é a resposta.
- Escreva no MESMO idioma da fala.
- Devolva um item para cada índice recebido, sem pular nenhum.`;

function readTitleItems(raw: unknown): Array<{ i: number; durationSec: number; atual: string; fala: string }> | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 40) return null;
  const out: Array<{ i: number; durationSec: number; atual: string; fala: string }> = [];
  for (const it of raw as Array<Record<string, unknown>>) {
    const i = Number(it?.i);
    const fala = String(it?.fala ?? '').slice(0, 1200);
    if (!Number.isInteger(i) || i < 0 || i > 60 || fala.length < 20) continue;
    out.push({
      i,
      durationSec: Math.max(1, Math.min(600, Math.round(Number(it?.durationSec) || 0))),
      atual: String(it?.atual ?? '').slice(0, 120),
      fala,
    });
  }
  return out.length > 0 ? out : null;
}

const TITLES_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['titles'],
  properties: {
    titles: {
      type: 'array',
      maxItems: 40,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['i', 'title', 'headline'],
        properties: {
          i: { type: 'integer', minimum: 0, maximum: 60 },
          title: { type: 'string', maxLength: 90 },
          headline: { type: 'string', maxLength: 70 },
        },
      },
    },
  },
} as const;

/**
 * op:'titles' — reescreve título/headline dos cortes que o CURADOR LOCAL já
 * escolheu. É a única chamada de IA que sobrou no fluxo, e é pequena: só o
 * texto falado dos cortes (~1,5 mil tokens no vídeo inteiro).
 */
async function responderTitulos(
  body: RawBody & { items?: unknown; language?: unknown },
  picked: { provider: Provider; apiKey: string },
  client: ReturnType<typeof createAnthropicClient> | null,
  signal: AbortSignal,
) {
  const items = readTitleItems(body.items);
  if (!items) return fail({ error: 'Lista de cortes inválida pro polimento de títulos.' }, 400);
  const language = String(body.language ?? 'pt').slice(0, 12);

  const user = [
    `Idioma da fala: ${language}. São ${items.length} trechos.`,
    '',
    ...items.map(
      (it) =>
        `#${it.i} (${it.durationSec}s) — headline atual: "${it.atual}"\nfala: ${it.fala}`,
    ),
  ].join('\n\n');

  const res = client
    ? await structuredMessage<{ titles: Array<{ i: number; title: string; headline: string }> }>({
        client,
        system: TITLES_SYSTEM,
        user,
        schema: TITLES_SCHEMA as unknown as Record<string, unknown>,
        effort: 'medium',
        maxTokens: 4000,
        signal,
      })
    : await groqStructuredMessage<{ titles: Array<{ i: number; title: string; headline: string }> }>({
        apiKey: picked.apiKey,
        models: await resolveGroqModels(picked.apiKey, signal),
        system: TITLES_SYSTEM,
        user,
        schema: TITLES_SCHEMA as unknown as Record<string, unknown>,
        effort: 'medium',
        maxTokens: 2500,
        signal,
      });

  const titles = (res.data?.titles ?? [])
    .filter((t) => Number.isInteger(t?.i))
    .map((t) => ({
      i: Number(t.i),
      title: sanitizeTitleText(t.title),
      headline: sanitizeHeadline(String(t.headline ?? '')),
    }))
    .filter((t) => t.title.length >= 8 && t.headline.length >= 4);

  return NextResponse.json({ op: 'titles', titles, model: res.model, usage: res.usage });
}

function sanitizeTitleText(raw: unknown): string {
  return String(raw ?? '')
    .replace(/[#"“”*`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 90);
}

function scoreSumOf(c: ResolvedCandidate): number {
  const s = c.scores;
  return (s?.hook ?? 0) + (s?.value ?? 0) + (s?.emotion ?? 0) + (s?.completeness ?? 0) + (s?.shareability ?? 0);
}

/** GET = qual IA vai rodar pra este cliente e os limites que o navegador deve respeitar. */
export async function GET() {
  try {
    const gate = await requireToolAccess('/tools/auto-cortes', 'basic');
    if (!gate.ok) return gateError(gate.response);
    const picked = await pickProvider();
    if ('response' in picked) return gateError(picked.response);
    return NextResponse.json(await infoFor(picked.provider, picked.apiKey));
  } catch (e) {
    console.error('[auto-cortes analyze GET]', e);
    return fail({ error: 'Não consegui consultar a IA agora. Tente de novo em instantes.' }, 500);
  }
}
