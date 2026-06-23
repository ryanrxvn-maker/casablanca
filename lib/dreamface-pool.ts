/**
 * lib/dreamface-pool.ts — POOL de contas DreamFace com distribuição inteligente.
 *
 * POR QUÊ: com 1 cookie só, todo o lipsync do app passa por 1 conta — se ela
 * cai (cookie expira) ou enche, tudo trava. Com VÁRIAS contas, o sistema:
 *   - DISTRIBUI a carga (escolhe a conta menos ocupada / menos usada);
 *   - PARALELIZA (cada conta roda em paralelo → N contas = N lipsyncs ao mesmo
 *     tempo, mantendo o "ritmo humano" por conta);
 *   - FAZ FAILOVER (se uma conta dá erro de auth/rede, tenta a PRÓXIMA conta
 *     automaticamente, sem o usuário perceber);
 *   - ISOLA conta morta (erro de auth → cooldown: sai do rodízio por uns
 *     minutos, as outras seguem atendendo).
 *
 * FONTE DAS CONTAS (env, sem DB — secrets ficam na Vercel, lugar seguro):
 *   DREAMFACE_ACCOUNTS = JSON array, ex.:
 *     [{"label":"c1","accountId":"...","userId":"...","cookie":"...","proxyUrl":"http://user:pass@ip:port"},
 *      {"label":"c2","accountId":"...","userId":"...","cookie":"...","proxyUrl":"..."}]
 *   Campos por conta: accountId+userId (obrigatórios), cookie, token, proxyUrl,
 *   appVersion, templateId (opcionais — herdam os defaults/env globais).
 *
 * COMPAT: se DREAMFACE_ACCOUNTS não existir, monta UMA conta com os envs
 * clássicos (DREAMFACE_ACCOUNT_ID/USER_ID/COOKIE/...) — nada quebra.
 *
 * Estado é em-memória (por instância serverless). Pra distribuição/ritmo isso
 * basta; o failover e o cooldown também valem por-instância. Pra estado forte
 * cross-instância dá pra plugar Supabase depois — a interface não muda.
 */

import {
  DreamFaceError,
  cleanCookie,
  checkHealth,
  type DreamFaceConfig,
} from './dreamface-api';

export type DreamFaceAccount = {
  label: string;
  config: DreamFaceConfig;
};

type AccountState = {
  inFlight: number;
  totalRuns: number;
  failStreak: number;
  cooldownUntil: number; // epoch ms; > now ⇒ fora do rodízio (auth caiu)
  lastUsedAt: number;
  lastStartAt: number;
};

// ───────────────────────── knobs (env) ─────────────────────────
const MAX_PER_ACCOUNT = (() => {
  const n = Number(process.env.DREAMFACE_MAX_PER_ACCOUNT ?? process.env.DREAMFACE_CONCURRENCY);
  return Number.isFinite(n) && n >= 1 && n <= 5 ? Math.floor(n) : 2;
})();
const MIN_GAP_MS = (() => {
  const n = Number(process.env.DREAMFACE_MIN_GAP_MS);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 800;
})();
const COOLDOWN_MS = (() => {
  const n = Number(process.env.DREAMFACE_COOLDOWN_MS);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 5 * 60 * 1000;
})();
/** Quanto o SERVIDOR espera por uma vaga quando TODAS as contas saudáveis estão
 *  ocupadas. Curto de propósito: a função serverless não fica idle/cara — quem
 *  segura a "fila" longa é o cliente (re-tenta o POST sem re-subir nada). Soma
 *  com a geração (≤~210s) tem de caber no maxDuration (300s) com folga. */
const MAX_WAIT_MS = (() => {
  const n = Number(process.env.DREAMFACE_MAX_WAIT_MS);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 20_000;
})();
const POLL_MS = 400;
/** Auto-cura: acima disso, um slot "ocupado" é considerado órfão (o detentor
 *  morreu — função serverless congelada/timeout) e é liberado, pra a conta
 *  nunca travar pra sempre. Bem acima do teto real de uma geração (~3-4min). */
const STALE_MS = (() => {
  const n = Number(process.env.DREAMFACE_STALE_MS);
  return Number.isFinite(n) && n >= 60_000 ? Math.floor(n) : 6 * 60 * 1000;
})();

// ───────────────────────── carga das contas ─────────────────────────
let _accounts: DreamFaceAccount[] | null = null;
const _state = new Map<string, AccountState>();

function defAppVersion(): string {
  return process.env.DREAMFACE_APP_VERSION?.trim() || '4.7.1';
}
function defTemplateId(): string {
  return process.env.DREAMFACE_TEMPLATE_ID?.trim() || '6606889f54e4e700070db4b1';
}
function globalProxy(): string | undefined {
  return process.env.DREAMFACE_PROXY_URL?.trim() || undefined;
}

function loadAccounts(): DreamFaceAccount[] {
  if (_accounts) return _accounts;
  const list: DreamFaceAccount[] = [];
  const seen = new Set<string>();
  const usedLabels = new Set<string>(); // o state do pool é keyed por label → único

  const raw = process.env.DREAMFACE_ACCOUNTS?.trim();
  if (raw) {
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      console.error('[dreamface-pool] DREAMFACE_ACCOUNTS não é JSON válido — ignorando:', e instanceof Error ? e.message : e);
    }
    if (Array.isArray(parsed)) {
      parsed.forEach((item, i) => {
        const a = item as Record<string, unknown>;
        const accountId = typeof a?.accountId === 'string' ? a.accountId.trim() : '';
        const userId = typeof a?.userId === 'string' ? a.userId.trim() : '';
        if (!accountId || !userId) {
          console.error(`[dreamface-pool] conta #${i + 1} sem accountId/userId — ignorada.`);
          return;
        }
        const proxyUrl = typeof a.proxyUrl === 'string' && a.proxyUrl.trim() ? a.proxyUrl.trim() : globalProxy();
        // Dedupe por conta+IP: a MESMA conta saindo por proxies diferentes é um
        // arranjo válido (distribui sem trocar de conta) — não descartar.
        const dedupeKey = `${accountId}|${proxyUrl || ''}`;
        if (seen.has(dedupeKey)) return;
        seen.add(dedupeKey);
        let label = typeof a.label === 'string' && a.label.trim() ? a.label.trim() : `conta${i + 1}`;
        if (usedLabels.has(label)) {
          let k = 2;
          while (usedLabels.has(`${label}#${k}`)) k++;
          label = `${label}#${k}`;
        }
        usedLabels.add(label);
        list.push({
          label,
          config: {
            accountId,
            userId,
            appVersion: typeof a.appVersion === 'string' && a.appVersion.trim() ? a.appVersion.trim() : defAppVersion(),
            templateId: typeof a.templateId === 'string' && a.templateId.trim() ? a.templateId.trim() : defTemplateId(),
            cookie: cleanCookie(typeof a.cookie === 'string' ? a.cookie : undefined),
            token: typeof a.token === 'string' && a.token.trim() ? a.token.trim() : undefined,
            proxyUrl,
          },
        });
      });
    }
  }

  // Fallback compat: 1 conta dos envs clássicos.
  if (!list.length) {
    const accountId = process.env.DREAMFACE_ACCOUNT_ID?.trim();
    const userId = process.env.DREAMFACE_USER_ID?.trim();
    if (accountId && userId) {
      list.push({
        label: 'default',
        config: {
          accountId,
          userId,
          appVersion: defAppVersion(),
          templateId: defTemplateId(),
          cookie: cleanCookie(process.env.DREAMFACE_COOKIE),
          token: process.env.DREAMFACE_TOKEN?.trim() || undefined,
          proxyUrl: globalProxy(),
        },
      });
    }
  }

  _accounts = list;
  return list;
}

function state(label: string): AccountState {
  let s = _state.get(label);
  if (!s) {
    s = { inFlight: 0, totalRuns: 0, failStreak: 0, cooldownUntil: 0, lastUsedAt: 0, lastStartAt: 0 };
    _state.set(label, s);
  }
  return s;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Erro server-side de rede (vale failover/retry, não é erro de input). */
function isNetworkish(e: unknown): boolean {
  const m = (e instanceof Error ? e.message : String(e)).toLowerCase();
  return (
    m.includes('fetch failed') ||
    m.includes('failed to fetch') ||
    m.includes('network') ||
    m.includes('econnreset') ||
    m.includes('econnrefused') ||
    m.includes('etimedout') ||
    m.includes('timeout') ||
    m.includes('socket') ||
    m.includes('eai_again') ||
    m.includes('und_err')
  );
}

// ───────────────────────── seleção / vaga ─────────────────────────

/**
 * Reserva a MELHOR conta disponível (não excluída, fora de cooldown, com vaga):
 * menos ocupada → menos usada recentemente (LRU) → menos runs totais. Já
 * incrementa inFlight e aplica o anti-rajada (gap mínimo entre inícios) antes
 * de devolver. Retorna null se não há conta elegível, ou se todas as elegíveis
 * ficaram ocupadas além do MAX_WAIT.
 */
async function acquire(exclude: Set<string>): Promise<DreamFaceAccount | null> {
  const start = Date.now();
  for (;;) {
    const now = Date.now();
    const all = loadAccounts();

    // AUTO-CURA: libera slots órfãos (detentor morreu / função congelada) —
    // se a conta está "ocupada" há mais que STALE_MS, zera o inFlight pra ela
    // não ficar travada como cheia pra sempre.
    for (const a of all) {
      const s = state(a.label);
      if (s.inFlight > 0 && s.lastStartAt > 0 && now - s.lastStartAt > STALE_MS) {
        s.inFlight = 0;
      }
    }

    const eligible = all.filter((a) => !exclude.has(a.label) && state(a.label).cooldownUntil <= now);
    if (!eligible.length) return null; // nada saudável pra tentar

    const free = eligible.filter((a) => state(a.label).inFlight < MAX_PER_ACCOUNT);
    if (free.length) {
      free.sort((a, b) => {
        const sa = state(a.label);
        const sb = state(b.label);
        return sa.inFlight - sb.inFlight || sa.lastUsedAt - sb.lastUsedAt || sa.totalRuns - sb.totalRuns;
      });
      const chosen = free[0];
      const s = state(chosen.label);
      s.inFlight += 1; // RESERVA o slot (síncrono, antes de qualquer await)
      s.lastUsedAt = Date.now();
      // RESERVA também o horário de início JUNTO com o slot — assim dois
      // acquires concorrentes na MESMA conta ficam espaçados de fato (o 2º vê
      // o lastStartAt já avançado pelo 1º antes de qualquer await).
      const tNow = Date.now();
      const startAt = Math.max(tNow, s.lastStartAt + MIN_GAP_MS) + Math.floor(Math.random() * 250);
      s.lastStartAt = startAt;
      const wait = startAt - tNow;
      if (wait > 0) await sleep(wait);
      return chosen;
    }

    // Todas as elegíveis ocupadas → espera uma vaga (até o teto).
    if (now - start > MAX_WAIT_MS) return null;
    await sleep(POLL_MS);
  }
}

// ───────────────────────── API pública ─────────────────────────

export function hasAccounts(): boolean {
  return loadAccounts().length > 0;
}

export function accountCount(): number {
  return loadAccounts().length;
}

/**
 * Config de uma conta pelo label — pra o /status pollar o MESMO motor que
 * recebeu o submit (o label vem assinado no token do job). Retorna null se a
 * conta sumiu do pool (env mudou entre o submit e o poll — raríssimo); o caller
 * trata como "ainda gerando" e o cliente re-tenta.
 */
export function getAccountConfigByLabel(label: string): DreamFaceConfig | null {
  const a = loadAccounts().find((x) => x.label === label);
  return a ? a.config : null;
}

/**
 * Roda `fn` na MELHOR conta do pool, com FAILOVER automático: se a conta
 * escolhida der erro de auth (cookie morto) ou rede, marca-a em cooldown e
 * tenta a próxima conta saudável. Erro de INPUT (no_face/generation_failed)
 * NÃO troca de conta (o problema é o material, não a conta).
 */
export async function runWithDreamFaceAccount<T>(
  fn: (config: DreamFaceConfig, label: string) => Promise<T>,
): Promise<T> {
  if (!loadAccounts().length) {
    throw new DreamFaceError('config_missing', 'Nenhuma conta DreamFace configurada.');
  }
  const tried = new Set<string>();
  let lastErr: unknown = null;

  for (;;) {
    const account = await acquire(tried);
    if (!account) break;
    const s = state(account.label);
    try {
      const r = await fn(account.config, account.label);
      s.failStreak = 0;
      s.cooldownUntil = 0;
      s.totalRuns += 1;
      return r;
    } catch (e) {
      lastErr = e;
      const isAuth = e instanceof DreamFaceError && e.code === 'auth';
      // afterSubmit = o job JÁ rodou nesta conta; re-rodar em outra geraria 2x.
      const afterSubmit = e instanceof DreamFaceError && e.afterSubmit === true;
      s.failStreak += 1;
      if (isAuth) s.cooldownUntil = Date.now() + COOLDOWN_MS; // tira a conta morta do rodízio
      tried.add(account.label);
      // Failover SÓ em falha transitória ANTES do submit. Pós-submit (afterSubmit)
      // não troca de conta — o usuário re-tenta no botão se precisar.
      const transient = (isAuth || isNetworkish(e)) && !afterSubmit;
      if (!transient) throw e;
      // segue o loop → próxima conta saudável
    } finally {
      s.inFlight -= 1;
    }
  }

  if (lastErr) throw lastErr;
  throw new DreamFaceError('busy', 'Todas as contas estão ocupadas agora. Tenta de novo em instantes.');
}

/** Snapshot barato (sem rede) do pool — pra health/debug. */
export function poolStats(): {
  accounts: number;
  perAccountMax: number;
  details: Array<{ label: string; inFlight: number; totalRuns: number; failStreak: number; cooldown: boolean }>;
} {
  const now = Date.now();
  return {
    accounts: loadAccounts().length,
    perAccountMax: MAX_PER_ACCOUNT,
    details: loadAccounts().map((a) => {
      const s = state(a.label);
      return {
        label: a.label,
        inFlight: s.inFlight,
        totalRuns: s.totalRuns,
        failStreak: s.failStreak,
        cooldown: s.cooldownUntil > now,
      };
    }),
  };
}

/**
 * Health REAL de cada conta (chama avatar/list de cada uma). Atualiza o
 * cooldown: conta que falha auth sai do rodízio; conta que volta é reativada.
 * NUNCA expõe cookie/IDs — só label + ok + motivo.
 */
export async function checkPoolHealth(): Promise<{
  accounts: number;
  healthy: number;
  details: Array<{ label: string; ok: boolean; reason?: string; inFlight: number; totalRuns: number; cooldown: boolean }>;
}> {
  const all = loadAccounts();
  const details = await Promise.all(
    all.map(async (a) => {
      const s = state(a.label);
      const h = await checkHealth(a.config);
      if (!h.ok && (h.reason === 'auth' || h.reason === 'config_missing')) {
        s.cooldownUntil = Date.now() + COOLDOWN_MS;
      } else if (h.ok) {
        s.cooldownUntil = 0;
        s.failStreak = 0;
      }
      return {
        label: a.label,
        ok: h.ok,
        reason: h.reason,
        inFlight: s.inFlight,
        totalRuns: s.totalRuns,
        cooldown: s.cooldownUntil > Date.now(),
      };
    }),
  );
  return { accounts: all.length, healthy: details.filter((d) => d.ok).length, details };
}
