/**
 * Ponte única com a Claude API (SDK oficial `@anthropic-ai/sdk`).
 *
 * Por que existe: as rotas do app falavam com a Anthropic por `fetch` cru
 * (ex.: app/api/auto-broll/route.ts). Isso funciona pra texto solto, mas o
 * AUTO CORTES precisa de STRUCTURED OUTPUT (JSON schema), streaming interno
 * (senão a função da Vercel estoura o timeout HTTP antes do modelo terminar)
 * e um mapa de erros que vira mensagem PT-BR acionável pro cliente.
 *
 * Decisões (ver docs/auto-cortes/ARQUITETURA.md §3.3):
 *  - Modelo padrão `claude-opus-5` (env AUTO_CORTES_MODEL sobrescreve).
 *  - Thinking ADAPTATIVO: no Opus 5 pensar é o padrão, então o parâmetro
 *    `thinking` é OMITIDO de propósito (mandar `{type:'adaptive'}` daria no
 *    mesmo; omitir mantém o corpo menor e vale pra qualquer modelo da família).
 *  - `output_config: { effort, format: { type: 'json_schema', schema } }` —
 *    o SDK 0.120 aceita JSON schema CRU aqui (interface `BetaJSONOutputFormat`),
 *    então NÃO precisamos de Zod nem de `zodOutputFormat`. Os schemas de
 *    lib/auto-cortes/prompts.ts entram direto, sem duplicar regra.
 *  - Streaming interno via `client.beta.messages.stream(...).finalMessage()`.
 *  - `fallbacks: 'default'` + beta `server-side-fallback-2026-07-01`: se a
 *    classificação de segurança recusar, a própria API re-roda num modelo
 *    irmão em vez de devolver a recusa. Se a conta/rota não aceitar o beta,
 *    a chamada é refeita UMA vez sem ele (degradação, não falha).
 *  - Retries são NOSSOS (cliente criado com `maxRetries: 0`) pra podermos
 *    honrar `retry-after` e devolver `retryAfterSec` pro navegador.
 */

import Anthropic from '@anthropic-ai/sdk';

/** Erro já traduzido pro cliente (status HTTP + dicas de UI). */
export class LlmError extends Error {
  readonly status: number;
  /** true = a chave de IA de texto é o problema → abrir /configuracoes/api. */
  readonly showConfig?: boolean;
  /** segundos que o cliente deve esperar antes de tentar de novo (429). */
  readonly retryAfterSec?: number;
  /** true = o PEDIDO era grande demais pro modelo/limite; encolher e repetir resolve. */
  readonly tooLarge?: boolean;

  constructor(
    message: string,
    opts: { status: number; showConfig?: boolean; retryAfterSec?: number; tooLarge?: boolean; cause?: unknown },
  ) {
    super(message);
    this.name = 'LlmError';
    this.status = opts.status;
    if (opts.showConfig) this.showConfig = true;
    if (typeof opts.retryAfterSec === 'number') this.retryAfterSec = opts.retryAfterSec;
    if (opts.tooLarge) this.tooLarge = true;
    if (opts.cause !== undefined) (this as { cause?: unknown }).cause = opts.cause;
  }
}

export type LlmEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export const DEFAULT_LLM_MODEL = 'claude-opus-5';

/** Beta que libera `fallbacks: 'default'` (roteamento por categoria de recusa). */
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

export function llmModel(): string {
  const m = (process.env.AUTO_CORTES_MODEL ?? '').trim();
  return m || DEFAULT_LLM_MODEL;
}

/**
 * Cliente com retry do SDK DESLIGADO (quem re-tenta é `structuredMessage`,
 * que precisa enxergar o `retry-after` pra repassar ao navegador) e timeout
 * abaixo do teto de 300 s da função da Vercel.
 */
export function createAnthropicClient(apiKey: string): Anthropic {
  return new Anthropic({ apiKey, maxRetries: 0, timeout: 280_000 });
}

// ───────────────────────────────────────────────────────────────────────────

const MAX_RATE_LIMIT_RETRIES = 3;
const MAX_TRANSIENT_RETRIES = 2;
const MAX_PARSE_RETRIES = 1;
const MAX_TOKENS_RETRIES = 1;
/** Teto de espera por retry-after (o cliente re-tenta por conta própria). */
const RETRY_AFTER_CAP_SEC = 30;

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new LlmError('Cancelado por você.', { status: 499 }));
      return;
    }
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(t);
      reject(new LlmError('Cancelado por você.', { status: 499 }));
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** `retry-after` em segundos (aceita número; data HTTP é rara e cai no default). */
export function parseRetryAfter(headers: Headers | undefined, fallbackSec: number): number {
  const raw = headers?.get?.('retry-after');
  if (!raw) return fallbackSec;
  const n = Number(raw);
  if (Number.isFinite(n) && n >= 0) return Math.min(RETRY_AFTER_CAP_SEC, Math.max(1, Math.ceil(n)));
  const when = Date.parse(raw);
  if (Number.isFinite(when)) {
    const sec = Math.ceil((when - Date.now()) / 1000);
    if (sec > 0) return Math.min(RETRY_AFTER_CAP_SEC, sec);
  }
  return fallbackSec;
}

function isAbort(err: unknown): boolean {
  if (err instanceof Anthropic.APIUserAbortError) return true;
  if (err instanceof LlmError) return err.status === 499;
  const name = err instanceof Error ? err.name : '';
  return name === 'AbortError';
}

/** Um 400 que reclama do beta/`fallbacks` → dá pra repetir sem eles. */
function isFallbackRejection(err: unknown): boolean {
  if (!(err instanceof Anthropic.BadRequestError)) return false;
  const msg = String(err.message ?? '').toLowerCase();
  return (
    msg.includes('fallback') ||
    msg.includes('server-side-fallback') ||
    (msg.includes('beta') && msg.includes('not') && msg.includes('allow'))
  );
}

function textOf(message: { content: Array<{ type: string; text?: string }> }): string {
  return message.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text ?? '')
    .join('')
    .trim();
}

/** Remove cerca ```json ... ``` (raro com structured output, mas barato de tratar). */
function stripFence(raw: string): string {
  const m = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  return (m ? m[1] : raw).trim();
}

export type StructuredMessageArgs = {
  client: Anthropic;
  /** default: `llmModel()`. */
  model?: string;
  system: string;
  user: string;
  /** JSON schema (o mesmo objeto de prompts.ts — não duplicar regra). */
  schema: Record<string, unknown>;
  effort?: LlmEffort;
  maxTokens: number;
  signal?: AbortSignal;
};

export type StructuredMessageResult<T> = {
  data: T;
  usage: { inputTokens: number; outputTokens: number };
  model: string;
};

/**
 * Uma chamada ao Claude com saída obrigatoriamente no formato do `schema`.
 *
 * Nunca lança erro cru: tudo vira `LlmError` com texto PT-BR.
 */
export async function structuredMessage<T>(
  args: StructuredMessageArgs,
): Promise<StructuredMessageResult<T>> {
  const model = args.model ?? llmModel();
  const schema = args.schema as unknown as { [k: string]: unknown };

  let maxTokens = Math.max(1024, Math.round(args.maxTokens));
  let rateLimitRetries = 0;
  let transientRetries = 0;
  let parseRetries = 0;
  let maxTokensRetries = 0;
  let useFallbacks = true;
  /** setado quando a 1ª resposta não era JSON: entra como correção no 2º turno. */
  let badOutput: string | null = null;

  for (;;) {
    if (args.signal?.aborted) throw new LlmError('Cancelado por você.', { status: 499 });

    const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content: args.user }];
    if (badOutput !== null) {
      messages.push({ role: 'assistant', content: badOutput });
      messages.push({
        role: 'user',
        content:
          'A resposta anterior nao era um JSON valido para o schema pedido. Responda de novo APENAS com o objeto JSON, sem texto fora dele e sem cercas de codigo.',
      });
    }

    let message: Anthropic.Beta.BetaMessage;
    try {
      const body: Anthropic.Beta.Messages.MessageCreateParamsStreaming = {
        model,
        max_tokens: maxTokens,
        system: args.system,
        messages,
        // Thinking adaptativo: omitido de proposito (padrao no Opus 5).
        output_config: {
          ...(args.effort ? { effort: args.effort } : {}),
          format: { type: 'json_schema', schema },
        },
        stream: true,
        ...(useFallbacks ? { betas: [FALLBACK_BETA], fallbacks: 'default' as const } : {}),
      };
      message = await args.client.beta.messages
        .stream(body, args.signal ? { signal: args.signal } : undefined)
        .finalMessage();
    } catch (err) {
      if (isAbort(err)) throw new LlmError('Cancelado por você.', { status: 499 });

      // Beta de fallback recusado pela conta/rota → repete uma vez sem ele.
      if (useFallbacks && isFallbackRejection(err)) {
        console.warn('[llm] fallbacks: default recusado pela API — repetindo sem o beta.', err);
        useFallbacks = false;
        continue;
      }

      if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
        throw new LlmError(
          'Sua chave de IA de texto não foi aceita. Confira a chave Anthropic (Claude) em /configuracoes/api e tente de novo.',
          { status: 401, showConfig: true, cause: err },
        );
      }

      if (err instanceof Anthropic.RateLimitError) {
        const waitSec = parseRetryAfter(err.headers, 5 * (rateLimitRetries + 1));
        if (rateLimitRetries < MAX_RATE_LIMIT_RETRIES) {
          rateLimitRetries++;
          await sleep(waitSec * 1000, args.signal);
          continue;
        }
        throw new LlmError(
          'A IA de texto está com muitas chamadas na sua conta agora. Aguarde alguns instantes e clique em Retomar.',
          { status: 429, retryAfterSec: waitSec, cause: err },
        );
      }

      const status = err instanceof Anthropic.APIError ? Number(err.status ?? 0) : 0;
      const transient = err instanceof Anthropic.APIConnectionError || status >= 500 || status === 408;
      if (transient) {
        if (transientRetries < MAX_TRANSIENT_RETRIES) {
          transientRetries++;
          await sleep(600 * 2 ** (transientRetries - 1), args.signal);
          continue;
        }
        throw new LlmError(
          'A IA de texto não respondeu agora (instabilidade do serviço). Tente de novo em instantes — o que já ficou pronto está salvo.',
          { status: 502, cause: err },
        );
      }

      if (err instanceof Anthropic.BadRequestError) {
        console.error('[llm] 400 da Anthropic', err);
        throw new LlmError(
          'A IA de texto recusou o pedido por formato. Se o problema continuar, refaça a análise com um trecho menor.',
          { status: 400, cause: err },
        );
      }

      console.error('[llm] erro inesperado', err);
      throw new LlmError('Não consegui falar com a IA de texto agora. Tente de novo em instantes.', {
        status: 502,
        cause: err,
      });
    }

    // Recusa por política: sem `fallbacks` (ou com o chain inteiro recusando).
    if (message.stop_reason === 'refusal') {
      const cat = message.stop_details?.category ?? null;
      throw new LlmError(
        `A IA recusou esse trecho por política de conteúdo${cat ? ` (${cat})` : ''}. Ajuste o trecho ou os "momentos específicos" e tente de novo.`,
        { status: 422 },
      );
    }

    // Estourou o teto de saída: 1 retry com 50% a mais.
    if (message.stop_reason === 'max_tokens' && maxTokensRetries < MAX_TOKENS_RETRIES) {
      maxTokensRetries++;
      maxTokens = Math.round(maxTokens * 1.5);
      badOutput = null;
      continue;
    }

    const raw = textOf(message);
    if (!raw) {
      if (transientRetries < MAX_TRANSIENT_RETRIES) {
        transientRetries++;
        continue;
      }
      throw new LlmError('A IA de texto devolveu uma resposta vazia. Tente de novo.', { status: 502 });
    }

    let data: T;
    try {
      data = JSON.parse(stripFence(raw)) as T;
    } catch (e) {
      if (parseRetries < MAX_PARSE_RETRIES) {
        parseRetries++;
        badOutput = raw.slice(0, 4000);
        continue;
      }
      console.error('[llm] JSON inválido do modelo', e, raw.slice(0, 400));
      throw new LlmError(
        'A IA de texto devolveu uma resposta que eu não consegui ler. Tente de novo — se repetir, refaça a análise.',
        { status: 502, cause: e },
      );
    }

    return {
      data,
      usage: {
        inputTokens: message.usage?.input_tokens ?? 0,
        outputTokens: message.usage?.output_tokens ?? 0,
      },
      model: message.model ?? model,
    };
  }
}
