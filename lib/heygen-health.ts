/**
 * MONITOR DE SAÚDE DO HEYGEN — distingue "a PLATAFORMA está lenta" de
 * "ESTE render morreu".
 *
 * POR QUE EXISTE (fix 2026-08-14, reportado pelo user no disparo AD70GL):
 * o HeyGen teve um dia de instabilidade e passou a levar ~2h por parte. Nosso
 * poll tinha um teto FIXO (15min por vídeo / 30min por batch) e, ao estourar,
 * marcava a parte como 'failed'. A auto-cura então re-disparava a MESMA parte —
 * enquanto o render original continuava vivo no servidor. Resultado: cada parte
 * lenta consumiu DOIS slots da cota diária, a cota acabou, e o disparo saiu
 * incompleto. Falso negativo puro.
 *
 * A regra que este módulo materializa:
 *
 *   Um render que está DEMORANDO não é um render que FALHOU.
 *
 * O que muda: o teto de paciência deixa de ser uma constante e passa a ser
 * função da saúde OBSERVADA da plataforma. Se a conta inteira está lenta, o
 * orçamento estica (até um teto duro); se só ESTE vídeo está preso enquanto os
 * irmãos completam normalmente, aí sim é zumbi e o teto continua curto.
 *
 * As amostras vivem em localStorage porque o sinal precisa sobreviver a F5 e a
 * troca de aba: quem retoma um disparo às 14h precisa saber que às 13h o HeyGen
 * estava levando 40min por vídeo — senão o RETOMAR repete o mesmo erro.
 */

export type HeyGenHealthState = 'ok' | 'slow' | 'degraded';

export type HeyGenHealth = {
  state: HeyGenHealthState;
  /** Mediana das renderizações recentes (ms). 0 = sem amostra. */
  p50Ms: number;
  /** Quantas amostras frescas sustentam o diagnóstico. */
  samples: number;
  /** Há quanto tempo NADA completa nesta conta (ms). Infinity = nunca vi completar. */
  sinceLastCompletionMs: number;
  /** Multiplicador de paciência a aplicar nos tetos do poll. */
  budgetMultiplier: number;
  /** Frase curta em PT-BR pra UI/log. */
  reason: string;
};

const LS_KEY = 'darkolab:heygen-health:v1';

/** Render normal do HeyGen: 2-8min. Acima disso já é fora da curva. */
export const NORMAL_RENDER_MS = 8 * 60 * 1000;
/** Mediana acima disso = plataforma LENTA (não é o nosso vídeo, é o dia). */
const SLOW_P50_MS = 14 * 60 * 1000;
/** Mediana acima disso = instabilidade séria (o caso das 2h do user). */
const DEGRADED_P50_MS = 30 * 60 * 1000;
/** Sem NENHUMA conclusão nesse tempo, com gente esperando = plataforma parada. */
const DEAD_AIR_DEGRADED_MS = 25 * 60 * 1000;
const DEAD_AIR_SLOW_MS = 12 * 60 * 1000;
/** Amostra mais velha que isso não descreve mais o "agora". */
const SAMPLE_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_SAMPLES = 24;

type Persisted = {
  /** Durações (ms) de renders que COMPLETARAM, com o instante em que completaram. */
  samples: Array<{ at: number; ms: number }>;
  /** Última vez que QUALQUER vídeo desta conta completou. */
  lastCompletionAt: number;
};

let mem: Persisted = { samples: [], lastCompletionAt: 0 };
let loaded = false;

/** Espera reportada pelos polls VIVOS agora (não persiste — é estado do momento). */
const waiters = new Map<string, { count: number; oldestStuckMs: number; at: number }>();
/** Sinal de espera mais velho que isso virou lixo (poll morreu sem limpar). */
const WAITER_TTL_MS = 90 * 1000;

function load(): Persisted {
  if (loaded) return mem;
  loaded = true;
  if (typeof window === 'undefined') return mem;
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Persisted;
      if (p && Array.isArray(p.samples)) {
        mem = { samples: p.samples.slice(-MAX_SAMPLES), lastCompletionAt: Number(p.lastCompletionAt) || 0 };
      }
    }
  } catch { /* storage bloqueado/corrompido → começa zerado, sem quebrar nada */ }
  return mem;
}

function save() {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(LS_KEY, JSON.stringify(mem));
  } catch { /* quota de storage cheia → o monitor segue só em memória */ }
}

/**
 * Registra que um render COMPLETOU e quanto tempo levou (do submit/1ª vez que
 * o vimos pendente até o completed). É a única fonte de verdade do "quanto o
 * HeyGen está levando HOJE".
 */
export function noteRenderCompleted(elapsedMs: number) {
  const p = load();
  const now = Date.now();
  // Descarta lixo: elapsed negativo/absurdo (relógio do SO mudou, id reciclado).
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0 || elapsedMs > 12 * 60 * 60 * 1000) {
    p.lastCompletionAt = now;
    save();
    return;
  }
  p.samples.push({ at: now, ms: elapsedMs });
  if (p.samples.length > MAX_SAMPLES) p.samples = p.samples.slice(-MAX_SAMPLES);
  p.lastCompletionAt = now;
  save();
}

/**
 * Um poll vivo declara quantos vídeos ESTÁ esperando e há quanto tempo o mais
 * antigo espera. Serve pro diagnóstico de "ninguém completa e tem gente na
 * fila" — que é instabilidade mesmo sem nenhuma amostra histórica.
 */
export function noteWaiting(pollId: string, count: number, oldestStuckMs: number) {
  if (count <= 0) { waiters.delete(pollId); return; }
  waiters.set(pollId, { count, oldestStuckMs, at: Date.now() });
}

export function clearWaiting(pollId: string) {
  waiters.delete(pollId);
}

function liveWaiting(): { count: number; oldestStuckMs: number } {
  const now = Date.now();
  let count = 0;
  let oldest = 0;
  for (const [id, w] of waiters) {
    if (now - w.at > WAITER_TTL_MS) { waiters.delete(id); continue; }
    count += w.count;
    if (w.oldestStuckMs > oldest) oldest = w.oldestStuckMs;
  }
  return { count, oldestStuckMs: oldest };
}

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

/** Diagnóstico atual da plataforma. Barato — pode chamar a cada tick do poll. */
export function getHeyGenHealth(): HeyGenHealth {
  const p = load();
  const now = Date.now();
  const fresh = p.samples.filter((s) => now - s.at <= SAMPLE_TTL_MS);
  const p50 = median(fresh.map((s) => s.ms));
  const sinceLast = p.lastCompletionAt > 0 ? now - p.lastCompletionAt : Infinity;
  const { count: waitingCount, oldestStuckMs } = liveWaiting();

  const mk = (state: HeyGenHealthState, reason: string): HeyGenHealth => ({
    state,
    p50Ms: p50,
    samples: fresh.length,
    sinceLastCompletionMs: sinceLast,
    budgetMultiplier: state === 'degraded' ? 10 : state === 'slow' ? 4 : 1,
    reason,
  });

  const min = (ms: number) => Math.round(ms / 60000);

  // 1) Mediana recente absurda = o dia está ruim, ponto.
  if (fresh.length >= 2 && p50 >= DEGRADED_P50_MS) {
    return mk('degraded', `HeyGen instável: as últimas renderizações levaram ~${min(p50)}min (normal é 2-8min)`);
  }
  // 2) Fila parada: tem vídeo esperando muito e NADA completou na conta.
  if (waitingCount > 0 && oldestStuckMs > NORMAL_RENDER_MS && sinceLast > DEAD_AIR_DEGRADED_MS) {
    const dead = sinceLast === Infinity ? oldestStuckMs : sinceLast;
    return mk('degraded', `HeyGen travado: ${waitingCount} render(s) na fila e nada concluiu há ~${min(dead)}min`);
  }
  if (fresh.length >= 2 && p50 >= SLOW_P50_MS) {
    return mk('slow', `HeyGen lento hoje: mediana de ~${min(p50)}min por render`);
  }
  if (waitingCount >= 2 && oldestStuckMs > NORMAL_RENDER_MS && sinceLast > DEAD_AIR_SLOW_MS) {
    return mk('slow', `HeyGen lento: ${waitingCount} render(s) passando de ${min(oldestStuckMs)}min`);
  }
  return mk('ok', 'HeyGen respondendo no tempo normal');
}

/**
 * ORÇAMENTO DE PACIÊNCIA de UM render — o coração do fix.
 *
 * Pura de propósito (nenhum I/O, nenhum relógio): é a regra que decide se um
 * vídeo pendente há X minutos é "zumbi" (desistir) ou "a plataforma está lenta"
 * (esperar mais). Errar pra um lado trava a fila; errar pro outro re-dispara
 * render vivo e queima cota diária em dobro — foi o que aconteceu no AD70GL.
 *
 * A discriminação decisiva é `majorityDone`: se a MAIORIA dos irmãos do mesmo
 * batch já terminou, quem sobrou é anomalia isolada e o teto fica curto (3x o
 * irmão mais lento). Se quase ninguém terminou, o problema não é o vídeo — é o
 * dia — e o teto estica pelo multiplicador de saúde.
 */
export function computePatienceBudget(args: {
  /** Teto por vídeo numa plataforma saudável (ms). */
  baseBudgetMs: number;
  /** Teto duro — nem a pior instabilidade passa disso (ms). */
  hardCapMs: number;
  /** Total de vídeos acompanhados neste batch. */
  total: number;
  /** Quantos já completaram. */
  completedCount: number;
  /** Quantos ainda esperam (pending/unknown). */
  waitingCount: number;
  /** Maior tempo de conclusão observado entre os irmãos deste batch (ms, 0 = nenhum). */
  peerMaxMs: number;
  /** Multiplicador vindo de getHeyGenHealth(). */
  healthMultiplier: number;
}): number {
  const { baseBudgetMs, hardCapMs, total, completedCount, waitingCount, peerMaxMs, healthMultiplier } = args;
  const majorityDone = completedCount >= 2 && completedCount >= Math.ceil(total * 0.6);
  let budget: number;
  if (majorityDone && peerMaxMs > 0) {
    // Os irmãos terminaram: existe régua local do "quanto o HeyGen leva AGORA".
    budget = Math.max(baseBudgetMs, peerMaxMs * 3);
  } else {
    // Batch parado por inteiro já é evidência de plataforma, mesmo sem histórico.
    const batchWide = waitingCount >= 2 ? 4 : 1;
    budget = baseBudgetMs * Math.max(healthMultiplier, batchWide);
  }
  return Math.min(budget, hardCapMs);
}

/* ═══ POLÍTICA DE RE-DISPARO ══════════════════════════════════════════════ */

export type RedispatchAction = 'redispatch' | 'wait' | 'rescue';

/**
 * A decisão, isolada do I/O: dado o estado FRESCO de um render, re-disparar,
 * esperar ou resgatar?
 *
 * Vive aqui (e não junto do fetch) porque é a regra que protege a cota diária, e
 * regra que protege dinheiro merece teste. O único caminho pro 'redispatch' é
 * prova de que não existe render vivo: falhou de verdade, nunca disparou, ou
 * sumiu do histórico sem cópia pronta.
 */
export function decideRedispatch(args: {
  hasVideoId: boolean;
  /** Status FRESCO do HeyGen (não o do último poll, que pode estar velho). */
  status?: 'completed' | 'pending' | 'failed' | 'stalled' | 'unknown' | null;
  hasVideoUrl?: boolean;
  /** Vídeo pronto encontrado no histórico pelo título (resgate do 'unknown'). */
  foundByTitle?: boolean;
}): RedispatchAction {
  if (!args.hasVideoId) return 'redispatch';        // nunca chegou a disparar
  if (args.status === 'completed' && args.hasVideoUrl) return 'rescue';
  if (args.status === 'failed') return 'redispatch'; // o HeyGen recusou de fato
  // 'pending' e 'stalled' são a MESMA coisa pro bolso: pode haver render vivo.
  if (args.status === 'pending' || args.status === 'stalled') return 'wait';
  // 'unknown'/'completed sem url': só gasta cota se nem por título aparecer.
  if (args.foundByTitle) return 'rescue';
  return 'redispatch';
}

/** Só pra teste/diagnóstico — zera o histórico. */
export function resetHeyGenHealth() {
  mem = { samples: [], lastCompletionAt: 0 };
  waiters.clear();
  loaded = true;
  save();
}
