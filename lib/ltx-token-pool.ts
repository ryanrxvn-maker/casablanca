/**
 * Pool de até 10 contas HF pra LTX-Video 2.3 — rotação ILIMITADA na prática.
 * SERVER-ONLY (estado em memória do processo).
 *
 * Por que existe: ZeroGPU dá quota POR CONTA (~150s de H200 reservados por
 * chamada; free ~5min/dia, PRO ~25min/dia). Com várias contas a gente
 * rotaciona e, na prática, fica ilimitado pro uso normal.
 *
 * Anti-ban (importante — HF remove tokens vazados e pune abuso):
 *  1. Só tokens READ (o usuário gera; a gente nunca cria conta).
 *  2. RESPEITA o "Try again in HH:MM:SS" que o próprio HF devolve —
 *     marca a conta em cooldown e NÃO bate de novo nela até liberar.
 *     (martelar uma conta sem quota é o que parece abuso.)
 *  3. Espalha a carga: escolhe sempre a conta MENOS usada recentemente
 *     (LRU) em vez de queimar a primeira — padrão de uso natural.
 *  4. Jitter aleatório curto ao trocar de conta (não dispara em rajada).
 *  5. Concorrência 1 por request (chamadas sequenciais).
 *
 * Honestidade (mesmo espírito do limite da Camuflagem): isso é
 * pooling de quota. Respeitando 1-5 o risco de ban é baixo, mas não é
 * "garantido pra sempre" — é decisão informada do dono das contas.
 */

const MAX_TOKENS = 10;

export type TokenState = {
  /** índice estável (ordem do env) */
  i: number;
  /** sufixo mascarado p/ UI/logs — NUNCA o token inteiro */
  mask: string;
  /** epoch ms até quando a conta está em cooldown (0 = livre) */
  cooldownUntil: number;
  /** epoch ms do último uso (LRU) */
  lastUsed: number;
  fails: number;
  ok: number;
};

let TOKENS: string[] | null = null;
let STATE: TokenState[] = [];

function load(): void {
  if (TOKENS) return;
  const raw =
    process.env.HF_TOKENS ||
    process.env.HF_TOKEN ||
    process.env.HUGGINGFACE_TOKEN ||
    '';
  const list = Array.from(
    new Set(
      raw
        .split(/[,\s]+/)
        .map((t) => t.trim())
        .filter((t) => /^hf_[A-Za-z0-9]{8,}$/.test(t)),
    ),
  ).slice(0, MAX_TOKENS);

  TOKENS = list;
  STATE = list.map((t, i) => ({
    i,
    mask: `hf_…${t.slice(-4)}`,
    cooldownUntil: 0,
    lastUsed: 0,
    fails: 0,
    ok: 0,
  }));
}

export function poolSize(): number {
  load();
  return TOKENS!.length;
}

/** "Try again in 23:25:04" / "in 142s" -> segundos. Fallback 1h. */
export function parseRetrySeconds(msg: string): number {
  const hms = msg.match(/try again in\s+(\d+):(\d{2}):(\d{2})/i);
  if (hms) return +hms[1] * 3600 + +hms[2] * 60 + +hms[3];
  const secs = msg.match(/try again in\s+(\d+)\s*s/i);
  if (secs) return +secs[1];
  const mins = msg.match(/try again in\s+(\d+)\s*m/i);
  if (mins) return +mins[1] * 60;
  return 3600;
}

/**
 * Próxima conta a tentar. Escolhe a LIVRE menos usada recentemente (LRU).
 * Se todas em cooldown, retorna `null` + quando a primeira libera.
 */
export function nextToken():
  | { token: string; state: TokenState }
  | { token: null; soonestMs: number } {
  load();
  if (TOKENS!.length === 0) return { token: null, soonestMs: 0 };
  const now = Date.now();

  const free = STATE.filter((s) => s.cooldownUntil <= now);
  if (free.length > 0) {
    free.sort((a, b) => a.lastUsed - b.lastUsed || a.i - b.i);
    const st = free[0];
    return { token: TOKENS![st.i], state: st };
  }
  const soonest = STATE.reduce(
    (m, s) => Math.min(m, s.cooldownUntil),
    Number.MAX_SAFE_INTEGER,
  );
  return { token: null, soonestMs: Math.max(0, soonest - now) };
}

export function markUsed(st: TokenState): void {
  st.lastUsed = Date.now();
}

export function markQuota(st: TokenState, retrySec: number): void {
  // +30s de folga pra não bater exatamente no limite (anti-ban).
  st.cooldownUntil = Date.now() + (retrySec + 30) * 1000;
  st.fails++;
}

/** Erro transitório do worker — cooldown curto, volta pro rodízio logo. */
export function markRuntime(st: TokenState): void {
  st.cooldownUntil = Date.now() + 45_000;
  st.fails++;
}

export function markOk(st: TokenState): void {
  st.ok++;
  st.cooldownUntil = 0;
}

/** Jitter anti-rajada entre trocas de conta. */
export function jitter(): Promise<void> {
  return new Promise((r) => setTimeout(r, 250 + Math.random() * 650));
}

/** Snapshot mascarado pra status (sem segredos). */
export function poolStatus(): {
  total: number;
  available: number;
  accounts: Array<{
    mask: string;
    state: 'livre' | 'cooldown';
    secondsLeft: number;
    ok: number;
    fails: number;
  }>;
} {
  load();
  const now = Date.now();
  const accounts = STATE.map((s) => {
    const left = Math.max(0, Math.ceil((s.cooldownUntil - now) / 1000));
    return {
      mask: s.mask,
      state: (left > 0 ? 'cooldown' : 'livre') as 'livre' | 'cooldown',
      secondsLeft: left,
      ok: s.ok,
      fails: s.fails,
    };
  });
  return {
    total: STATE.length,
    available: accounts.filter((a) => a.state === 'livre').length,
    accounts,
  };
}
