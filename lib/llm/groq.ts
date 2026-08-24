/**
 * Groq (OpenAI-compatible) — provedor GRATUITO da inteligência do AUTO CORTES.
 *
 * Por que existe: o dono não quer que a tool custe nada pra ninguém. O cliente
 * já cadastra a chave Groq pra transcrição (free tier), e a mesma chave serve
 * pros modelos de texto do Groq. O Claude (lib/llm/anthropic.ts) fica como
 * opção quando `AUTO_CORTES_PROVIDER=anthropic` e o cliente tem chave própria.
 *
 * ⚠ NADA DE MODELO FIXO NO CÓDIGO. O catálogo do Groq muda (em 23.08.2026 o
 * `llama-3.3-70b-versatile` sumiu da conta e derrubou o reduce em produção):
 * a lista real vem de `GET /models` com a chave do cliente e a preferência
 * abaixo é só uma ORDEM — o que não existe é pulado.
 *
 * Limites do free tier que moldam o resto: poucos mil tokens por minuto por
 * modelo, e o teto conta ENTRADA + `max_completion_tokens`. Pedido maior que o
 * teto volta 413 — por isso o erro carrega `tooLarge` e quem chamou encolhe o
 * pedido em vez de desistir (ver app/api/auto-cortes/analyze/route.ts).
 *
 * Mesma interface do `structuredMessage` do Claude: nunca lança erro cru —
 * tudo vira `LlmError` com texto PT-BR.
 */

import { LlmError } from './anthropic';

const GROQ_BASE = 'https://api.groq.com/openai/v1';

/** Ordem de preferência. O primeiro que EXISTIR na conta vira o principal. */
export const GROQ_MODEL_PREFERENCE = [
  'openai/gpt-oss-120b',
  'moonshotai/kimi-k2-instruct-0905',
  'moonshotai/kimi-k2-instruct',
  'meta-llama/llama-4-maverick-17b-128e-instruct',
  'openai/gpt-oss-20b',
  'meta-llama/llama-4-scout-17b-16e-instruct',
  'llama-3.3-70b-versatile',
  'llama-3.1-8b-instant',
] as const;

/** Modelos que aceitam `response_format: json_schema` no Groq. */
const JSON_SCHEMA_MODELS = /^(openai\/gpt-oss-|moonshotai\/kimi-k2|meta-llama\/llama-4-)/;

/** Não servem pra texto (áudio/moderação) — nunca entram na escolha. */
const NOT_TEXT = /whisper|tts|guard|prompt-?guard|distil-whisper|playai/i;

export function groqModelOverride(): string | null {
  const m = (process.env.AUTO_CORTES_GROQ_MODEL ?? '').trim();
  return m || null;
}

/** Janelas/concorrência que cabem no free tier (o cliente lê via GET /analyze). */
export const GROQ_LIMITS = {
  analyzeWindowSec: 300,
  analyzeWindowOverlapSec: 60,
  analyzeMapConcurrency: 1,
  /** candidatos mandados pro reduce (os melhores por soma de notas) */
  reduceMaxCandidates: 20,
  /** cortes por reduce — acima disso o pedido não cabe no teto por minuto */
  reduceMaxClips: 12,
  mapMaxTokens: 2000,
  reduceMaxTokens: 3000,
} as const;

// ───────────────────────────────────────────────────────────────────────────
// Catálogo real da conta (cache por processo, 10 min)
// ───────────────────────────────────────────────────────────────────────────

/**
 * Orçamento de tokens do free tier, por (chave, modelo).
 *
 * O Groq devolve em TODA resposta quanto sobrou no minuto
 * (`x-ratelimit-remaining-tokens`) e quando o balde enche de novo
 * (`x-ratelimit-reset-tokens`, ex.: "7.66s" / "2m59.5s"). Guardar isso e
 * ESPERAR antes de mandar o próximo pedido é o que evita o 429 — bater na
 * parede e re-tentar só queima tentativa.
 */
type Budget = { remaining: number; resetAt: number };
const budgets = new Map<string, Budget>();

/** "2m59.56s" / "7.66s" / "1.2" → segundos. */
export function parseGroqDuration(raw: string | null | undefined): number {
  if (!raw) return 0;
  const t = raw.trim();
  const composto = t.match(/^(?:(\d+(?:\.\d+)?)h)?(?:(\d+(?:\.\d+)?)m)?(?:(\d+(?:\.\d+)?)s)?$/i);
  if (composto && (composto[1] || composto[2] || composto[3])) {
    return (
      (parseFloat(composto[1] ?? '0') || 0) * 3600 +
      (parseFloat(composto[2] ?? '0') || 0) * 60 +
      (parseFloat(composto[3] ?? '0') || 0)
    );
  }
  const n = Number(t);
  if (Number.isFinite(n) && n >= 0) return n;
  const when = Date.parse(t);
  if (Number.isFinite(when)) return Math.max(0, (when - Date.now()) / 1000);
  return 0;
}

function budgetKey(apiKey: string, model: string): string {
  return `${apiKey.slice(-6)}:${model}`;
}

function readBudget(apiKey: string, model: string, headers: Headers): void {
  const rem = Number(headers.get('x-ratelimit-remaining-tokens'));
  const reset = parseGroqDuration(headers.get('x-ratelimit-reset-tokens'));
  if (!Number.isFinite(rem)) return;
  budgets.set(budgetKey(apiKey, model), {
    remaining: rem,
    resetAt: Date.now() + Math.max(0, reset) * 1000,
  });
}

/** Segundos a esperar pro pedido caber no que sobrou do minuto. */
function waitForBudget(apiKey: string, model: string, needed: number): number {
  const b = budgets.get(budgetKey(apiKey, model));
  if (!b) return 0;
  const faltaPraEncher = (b.resetAt - Date.now()) / 1000;
  if (faltaPraEncher <= 0) return 0;
  if (b.remaining >= needed) return 0;
  return Math.min(90, Math.ceil(faltaPraEncher) + 1);
}

/** Estimativa grosseira de tokens do pedido (4 chars ≈ 1 token) + saída pedida. */
function estimateTokens(system: string, user: string, maxTokens: number): number {
  return Math.ceil((system.length + user.length) / 4) + maxTokens;
}

type ModelCache = { at: number; ids: string[] };
const MODELS_TTL_MS = 10 * 60 * 1000;
const modelCache = new Map<string, ModelCache>();

function keyTag(apiKey: string): string {
  return apiKey.slice(-6);
}

/** `GET /models` da conta. Falha = lista vazia (a preferência vira o palpite). */
export async function fetchGroqModels(apiKey: string, signal?: AbortSignal): Promise<string[]> {
  const tag = keyTag(apiKey);
  const hit = modelCache.get(tag);
  if (hit && Date.now() - hit.at < MODELS_TTL_MS) return hit.ids;
  try {
    const res = await fetch(`${GROQ_BASE}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal,
    });
    if (!res.ok) return hit?.ids ?? [];
    const j = (await res.json()) as { data?: Array<{ id?: string }> };
    const ids = (j?.data ?? [])
      .map((m) => String(m?.id ?? ''))
      .filter((id) => id && !NOT_TEXT.test(id));
    if (ids.length > 0) modelCache.set(tag, { at: Date.now(), ids });
    return ids;
  } catch {
    return hit?.ids ?? [];
  }
}

/**
 * Fila de modelos a tentar, na ordem: override do env → preferência que EXISTE
 * na conta → qualquer outro modelo de texto da conta.
 */
export async function resolveGroqModels(apiKey: string, signal?: AbortSignal): Promise<string[]> {
  const override = groqModelOverride();
  const available = await fetchGroqModels(apiKey, signal);
  const has = (id: string) => available.length === 0 || available.includes(id);

  const queue: string[] = [];
  const push = (id: string) => {
    if (id && !queue.includes(id)) queue.push(id);
  };

  if (override) push(override);
  for (const id of GROQ_MODEL_PREFERENCE) if (has(id)) push(id);
  // resto da conta como último recurso (catálogo novo que ainda não conhecemos)
  for (const id of available) push(id);
  if (queue.length === 0) push(GROQ_MODEL_PREFERENCE[0]);
  return queue;
}

// ───────────────────────────────────────────────────────────────────────────

export type GroqStructuredArgs = {
  apiKey: string;
  /** fila de modelos (resolveGroqModels); o 1º que responder ganha */
  models: string[];
  system: string;
  user: string;
  schema: Record<string, unknown>;
  maxTokens: number;
  effort?: 'low' | 'medium' | 'high';
  signal?: AbortSignal;
};

export type GroqStructuredResult<T> = {
  data: T;
  usage: { inputTokens: number; outputTokens: number };
  model: string;
};

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new LlmError('Cancelado por você.', { status: 499 }));
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        reject(new LlmError('Cancelado por você.', { status: 499 }));
      },
      { once: true },
    );
  });
}

function stripFence(raw: string): string {
  const m = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const s = (m ? m[1] : raw).trim();
  // alguns modelos põem texto antes/depois — fica com o maior objeto {...}
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  return a >= 0 && b > a ? s.slice(a, b + 1) : s;
}

type ChatResponse = {
  choices?: Array<{ message?: { content?: string | null }; finish_reason?: string }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  model?: string;
  error?: { message?: string; code?: string; type?: string };
};

const NOT_FOUND_MSG = /does not exist|decommissioned|not found|no longer|unsupported model/i;

/**
 * Uma chamada ao Groq com saída no formato do `schema`.
 *
 * Retries: 429 (honra retry-after, máx 3), 5xx/rede (2), JSON inválido (1 com
 * correção), modelo inexistente (próximo da fila), schema recusado (cai pro
 * `json_object` com o schema no texto). 413 vira `LlmError.tooLarge` depois de
 * tentar todos os modelos — quem chamou encolhe o pedido.
 */
export async function groqStructuredMessage<T>(args: GroqStructuredArgs): Promise<GroqStructuredResult<T>> {
  const queue = args.models.length > 0 ? [...args.models] : [GROQ_MODEL_PREFERENCE[0]];
  let mi = 0;
  let model = queue[0];
  let useSchema = JSON_SCHEMA_MODELS.test(model);
  let rateLimitRetries = 0;
  let transientRetries = 0;
  let parseRetries = 0;
  let badOutput: string | null = null;
  let sawTooLarge = false;

  /** Passa pro próximo modelo da fila. false = acabou. */
  const nextModel = (motivo: string): boolean => {
    mi++;
    if (mi >= queue.length) return false;
    model = queue[mi];
    useSchema = JSON_SCHEMA_MODELS.test(model);
    parseRetries = 0;
    badOutput = null;
    console.warn(`[groq] ${motivo} — tentando ${model}`);
    return true;
  };

  const schemaNote =
    '\n\nResponda SOMENTE com um objeto JSON válido (sem texto fora dele, sem cercas de código) ' +
    'que obedeça EXATAMENTE este JSON Schema:\n' +
    JSON.stringify(args.schema);

  for (;;) {
    if (args.signal?.aborted) throw new LlmError('Cancelado por você.', { status: 499 });

    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: args.system + (useSchema ? '' : schemaNote) },
      { role: 'user', content: args.user },
    ];
    if (badOutput !== null) {
      messages.push({ role: 'assistant', content: badOutput });
      messages.push({
        role: 'user',
        content:
          'A resposta anterior não era um JSON válido para o schema pedido. Responda de novo APENAS com o objeto JSON, sem texto fora dele e sem cercas de código.',
      });
    }

    const body: Record<string, unknown> = {
      model,
      messages,
      max_completion_tokens: Math.max(512, Math.round(args.maxTokens)),
      temperature: 0.4,
      response_format: useSchema
        ? { type: 'json_schema', json_schema: { name: 'auto_cortes', schema: args.schema } }
        : { type: 'json_object' },
    };
    if (/^openai\/gpt-oss-/.test(model)) body.reasoning_effort = args.effort ?? 'low';

    // Espera o balde de tokens encher em vez de tomar 429.
    const precisa = estimateTokens(args.system, args.user, Number(body.max_completion_tokens));
    const esperaSec = waitForBudget(args.apiKey, model, precisa);
    if (esperaSec > 0) {
      console.warn(`[groq] orçamento baixo em ${model} — esperando ${esperaSec}s`);
      await sleep(esperaSec * 1000, args.signal);
    }

    let res: Response;
    try {
      res = await fetch(`${GROQ_BASE}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${args.apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: args.signal,
      });
    } catch (e) {
      if (args.signal?.aborted) throw new LlmError('Cancelado por você.', { status: 499 });
      if (transientRetries < 2) {
        transientRetries++;
        await sleep(600 * 2 ** (transientRetries - 1), args.signal);
        continue;
      }
      throw new LlmError('Não consegui falar com o serviço de IA agora. Tente de novo em instantes.', {
        status: 502,
        cause: e,
      });
    }

    readBudget(args.apiKey, model, res.headers);

    if (res.status === 401 || res.status === 403) {
      throw new LlmError(
        'Sua chave de Transcrição (Groq) não foi aceita pela IA de texto. Confira em Configurações → API.',
        { status: 401, showConfig: true },
      );
    }

    if (res.status === 429) {
      // `retry-after` do Groq pode passar de um minuto — respeitar INTEIRO
      // (o clamp de 30 s que existia fazia re-tentar cedo e queimar tentativa).
      const espera = Math.min(
        120,
        Math.ceil(
          parseGroqDuration(res.headers.get('retry-after')) ||
            parseGroqDuration(res.headers.get('x-ratelimit-reset-tokens')) ||
            8 * (rateLimitRetries + 1),
        ),
      );
      if (rateLimitRetries < 5) {
        rateLimitRetries++;
        console.warn(`[groq] 429 em ${model} — esperando ${espera}s (tentativa ${rateLimitRetries}/5)`);
        await sleep(espera * 1000, args.signal);
        continue;
      }
      throw new LlmError('A IA gratuita está no limite por minuto. Espere um pouco e clique em Retomar.', {
        status: 429,
        retryAfterSec: espera,
      });
    }

    const json = (await res.json().catch(() => null)) as ChatResponse | null;
    const errMsg = json?.error?.message ?? '';

    if (res.status === 413 || res.status === 400 || res.status === 404) {
      // modelo sumiu do catálogo → próximo da fila
      if (res.status !== 413 && NOT_FOUND_MSG.test(errMsg)) {
        if (nextModel(`${model} indisponível (${errMsg.slice(0, 80)})`)) continue;
        throw new LlmError('Nenhum modelo de IA gratuito está disponível na sua chave agora.', {
          status: 502,
        });
      }
      // schema recusado → tenta json_object no MESMO modelo
      if (useSchema && /schema|response_format|json/i.test(errMsg)) {
        useSchema = false;
        continue;
      }
      // pedido grande demais → outro modelo pode ter teto maior; senão avisa quem chamou
      if (res.status === 413) {
        sawTooLarge = true;
        if (nextModel(`413 em ${model} (pedido grande demais)`)) continue;
        throw new LlmError(
          'Esse pedido ficou grande demais pra IA gratuita. Vou tentar com menos trechos.',
          { status: 413, tooLarge: true },
        );
      }
      if (nextModel(`400 em ${model} (${errMsg.slice(0, 80)})`)) continue;
      throw new LlmError(`A IA recusou o pedido (${errMsg.slice(0, 140) || res.status}).`, {
        status: 502,
        tooLarge: sawTooLarge || undefined,
      });
    }

    if (!res.ok) {
      if (transientRetries < 2 && res.status >= 500) {
        transientRetries++;
        await sleep(800 * 2 ** (transientRetries - 1), args.signal);
        continue;
      }
      if (nextModel(`${res.status} em ${model}`)) continue;
      throw new LlmError(`O serviço de IA respondeu com erro (${res.status}). Tente de novo.`, {
        status: 502,
      });
    }

    const raw = json?.choices?.[0]?.message?.content ?? '';
    const finish = json?.choices?.[0]?.finish_reason;
    if (!raw.trim()) {
      if (nextModel(`${model} devolveu vazio`)) continue;
      throw new LlmError('A IA devolveu uma resposta vazia. Tente de novo.', { status: 502 });
    }

    let data: T;
    try {
      data = JSON.parse(stripFence(raw)) as T;
    } catch {
      if (finish === 'length') {
        throw new LlmError('A resposta da IA foi cortada por tamanho. Vou tentar com menos trechos.', {
          status: 413,
          tooLarge: true,
        });
      }
      if (parseRetries < 1) {
        parseRetries++;
        badOutput = raw.slice(0, 4000);
        continue;
      }
      if (nextModel(`${model} não devolveu JSON válido`)) continue;
      throw new LlmError('A IA não devolveu o formato esperado. Tente de novo.', { status: 502 });
    }

    return {
      data,
      usage: {
        inputTokens: json?.usage?.prompt_tokens ?? 0,
        outputTokens: json?.usage?.completion_tokens ?? 0,
      },
      model: json?.model ?? model,
    };
  }
}
