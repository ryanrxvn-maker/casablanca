/**
 * Groq (OpenAI-compatible) — provedor GRATUITO da inteligência do AUTO CORTES.
 *
 * Por que existe: o dono não quer que a tool custe nada pra ninguém. O cliente
 * já cadastra a chave Groq pra transcrição (free tier), e a mesma chave serve
 * pros modelos de texto do Groq. O Claude (lib/llm/anthropic.ts) fica como
 * opção quando `AUTO_CORTES_PROVIDER=anthropic` e o cliente tem chave própria.
 *
 * Limites do free tier que moldam o código (2026): ~8k tokens/min no
 * `openai/gpt-oss-120b` e ~12k no `llama-3.3-70b-versatile`; pedido MAIOR que o
 * teto por minuto volta 413 ("Request too large"), pedido que estoura o acumulado
 * volta 429 com `retry-after`. Por isso as janelas do Groq são menores
 * (GROQ_LIMITS) e o fallback troca de modelo no 413.
 *
 * Mesma interface do `structuredMessage` do Claude: nunca lança erro cru —
 * tudo vira `LlmError` com texto PT-BR.
 */

import { LlmError, parseRetryAfter } from './anthropic';

const GROQ_BASE = 'https://api.groq.com/openai/v1';

export const DEFAULT_GROQ_MODEL = 'openai/gpt-oss-120b';
/** usado quando o modelo principal recusa o pedido por tamanho (413) ou por schema */
export const FALLBACK_GROQ_MODEL = 'llama-3.3-70b-versatile';

/** Modelos que aceitam `response_format: json_schema` no Groq. */
const JSON_SCHEMA_MODELS = /^(openai\/gpt-oss-|moonshotai\/kimi-k2|meta-llama\/llama-4-)/;

export function groqModel(): string {
  const m = (process.env.AUTO_CORTES_GROQ_MODEL ?? '').trim();
  return m || DEFAULT_GROQ_MODEL;
}

/** Janelas/concorrência que cabem no free tier (o cliente lê via GET /analyze). */
export const GROQ_LIMITS = {
  analyzeWindowSec: 300,
  analyzeWindowOverlapSec: 60,
  analyzeMapConcurrency: 1,
  /** candidatos mandados pro reduce (os melhores por soma de notas) */
  reduceMaxCandidates: 36,
  /** cortes por reduce — acima disso o pedido não cabe no teto por minuto */
  reduceMaxClips: 15,
  mapMaxTokens: 2500,
  reduceMaxTokens: 4000,
} as const;

export type GroqStructuredArgs = {
  apiKey: string;
  model?: string;
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

/**
 * Uma chamada ao Groq com saída no formato do `schema`.
 * Retries: 429 (honra retry-after, máx 3), 5xx/rede (2), JSON inválido (1 com
 * correção), 413/schema recusado (troca pro modelo de fallback, 1×).
 */
export async function groqStructuredMessage<T>(args: GroqStructuredArgs): Promise<GroqStructuredResult<T>> {
  let model = args.model ?? groqModel();
  let useSchema = JSON_SCHEMA_MODELS.test(model);
  let rateLimitRetries = 0;
  let transientRetries = 0;
  let parseRetries = 0;
  let modelSwaps = 0;
  let badOutput: string | null = null;

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
    if (/^openai\/gpt-oss-/.test(model)) body.reasoning_effort = args.effort ?? 'medium';

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

    if (res.status === 401 || res.status === 403) {
      throw new LlmError(
        'Sua chave de Transcrição (Groq) não foi aceita pela IA de texto. Confira em Configurações → API.',
        { status: 401, showConfig: true },
      );
    }

    if (res.status === 429) {
      if (rateLimitRetries < 3) {
        rateLimitRetries++;
        const waitSec = parseRetryAfter(res.headers, 8 * rateLimitRetries);
        await sleep(waitSec * 1000, args.signal);
        continue;
      }
      throw new LlmError('A IA gratuita está no limite por minuto. Espere um pouco e tente de novo.', {
        status: 429,
        retryAfterSec: parseRetryAfter(res.headers, 30),
      });
    }

    const json = (await res.json().catch(() => null)) as ChatResponse | null;

    // 413 = pedido maior que o teto por minuto do modelo; 400 de schema/modelo
    // inexistente → troca pro modelo de fallback (uma vez).
    if (res.status === 413 || res.status === 400 || res.status === 404) {
      const msg = json?.error?.message ?? '';
      if (modelSwaps === 0 && model !== FALLBACK_GROQ_MODEL) {
        modelSwaps++;
        console.warn(`[groq] ${res.status} em ${model} (${msg.slice(0, 120)}) — trocando pra ${FALLBACK_GROQ_MODEL}`);
        model = FALLBACK_GROQ_MODEL;
        useSchema = JSON_SCHEMA_MODELS.test(model);
        continue;
      }
      if (useSchema && /schema|response_format/i.test(msg)) {
        useSchema = false;
        continue;
      }
      throw new LlmError(
        res.status === 413
          ? 'Esse trecho é grande demais pra IA gratuita. Tente com "Trecho do vídeo" menor ou menos cortes.'
          : `A IA recusou o pedido (${msg.slice(0, 140) || res.status}).`,
        { status: 502 },
      );
    }

    if (!res.ok) {
      if (transientRetries < 2 && res.status >= 500) {
        transientRetries++;
        await sleep(800 * 2 ** (transientRetries - 1), args.signal);
        continue;
      }
      throw new LlmError(`O serviço de IA respondeu com erro (${res.status}). Tente de novo.`, {
        status: 502,
      });
    }

    const raw = json?.choices?.[0]?.message?.content ?? '';
    const finish = json?.choices?.[0]?.finish_reason;
    if (!raw.trim()) {
      throw new LlmError('A IA devolveu uma resposta vazia. Tente de novo.', { status: 502 });
    }

    let data: T;
    try {
      data = JSON.parse(stripFence(raw)) as T;
    } catch {
      if (finish === 'length') {
        throw new LlmError('A resposta da IA foi cortada por tamanho. Tente com menos cortes.', {
          status: 502,
        });
      }
      if (parseRetries < 1) {
        parseRetries++;
        badOutput = raw.slice(0, 4000);
        continue;
      }
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
