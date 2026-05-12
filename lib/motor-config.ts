/**
 * Motor de avatar (III/IV/V) — config global por task e estimativa
 * de creditos REAIS HeyGen (descoberto via /v1/payment/product, 12/05/2026):
 *
 *   Avatar V/IV: 1 minuto = 20 creditos
 *   Avatar III:  0 creditos (unlimited_regular no plano Creator+)
 *
 * Modos:
 *  - 'global': UM motor pra todos os takes (default III)
 *  - 'percent': distribui aleatoriamente respeitando porcentagens
 *  - 'individual': cada take/avatar tem seu motor (definido no slot)
 */

export type Motor = 'III' | 'IV' | 'V';

export const MOTORS: Motor[] = ['III', 'IV', 'V'];

/** Custo em creditos por MINUTO de video gerado (HeyGen oficial).
 *  Avatar III roda em unlimited_regular slots (separado do credit pack). */
export const CREDIT_COST_PER_MIN: Record<Motor, number> = {
  III: 0,   // gratuito (consome priority slot, nao credit)
  IV: 20,   // 1 min = 20 creditos
  V: 20,    // 1 min = 20 creditos (mesmo custo)
};

/** @deprecated mantido pra retrocompatibilidade. Calcula custo por take
 *  assumindo duracao default de 30s (0.5 min). Use estimateCost() com
 *  averageTakeSeconds pra valores precisos. */
export const CREDIT_COST: Record<Motor, number> = {
  III: 0,
  IV: 10,  // 30s × 20/min = 10
  V: 10,
};

/** Duracao media estimada por take (segundos) — usado quando user nao
 *  informa duracao real. 30s eh tipico em videos curtos do user. */
export const DEFAULT_TAKE_SECONDS = 30;

export type MotorModeGlobal = { kind: 'global'; motor: Motor };
export type MotorModePercent = { kind: 'percent'; percent: Record<Motor, number> };
export type MotorModeIndividual = { kind: 'individual'; perSlot: Record<string, Motor> };

export type MotorConfig = MotorModeGlobal | MotorModePercent | MotorModeIndividual;

export function defaultMotorConfig(): MotorConfig {
  return { kind: 'global', motor: 'III' };
}

/** Valida % soma 100. Retorna config saneada (normaliza pra somar 100). */
export function sanitizePercent(percent: Partial<Record<Motor, number>>): Record<Motor, number> {
  const v: Record<Motor, number> = {
    III: Math.max(0, percent.III ?? 0),
    IV: Math.max(0, percent.IV ?? 0),
    V: Math.max(0, percent.V ?? 0),
  };
  const total = v.III + v.IV + v.V;
  if (total === 0) return { III: 100, IV: 0, V: 0 };
  // Normaliza pra 100
  return {
    III: Math.round((v.III / total) * 100),
    IV: Math.round((v.IV / total) * 100),
    V: Math.round((v.V / total) * 100),
  };
}

/**
 * Calcula o motor de cada take baseado no config + indices.
 *
 * Pro modo 'percent': distribui respeitando NUMERO inteiro de takes
 * (sem cortar take no meio). Ex: 10 takes com 60/40 → 6 III + 4 IV.
 * Embaralha a ordem (seed deterministico baseado em taskId) pra
 * mesma task sempre dar mesma distribuicao.
 */
export function resolveMotors(
  config: MotorConfig,
  takeCount: number,
  opts: { slotIds?: string[]; seed?: string } = {},
): Motor[] {
  if (takeCount <= 0) return [];
  if (config.kind === 'global') {
    return Array.from({ length: takeCount }, () => config.motor);
  }
  if (config.kind === 'individual') {
    if (!opts.slotIds) {
      // Sem slot ids, fallback pra III
      return Array.from({ length: takeCount }, () => 'III' as Motor);
    }
    return opts.slotIds.map((id) => config.perSlot[id] || 'III');
  }
  // PERCENT mode
  const pct = sanitizePercent(config.percent);
  // Calcula quantos takes por motor (round NUM TAKE inteiro)
  const counts: Record<Motor, number> = {
    III: Math.round((pct.III / 100) * takeCount),
    IV: Math.round((pct.IV / 100) * takeCount),
    V: Math.round((pct.V / 100) * takeCount),
  };
  // Ajusta diferenca arredondamento — se total nao bate, ajusta no III
  let total = counts.III + counts.IV + counts.V;
  while (total > takeCount) {
    if (counts.III > 0) counts.III--;
    else if (counts.IV > 0) counts.IV--;
    else counts.V--;
    total--;
  }
  while (total < takeCount) {
    counts.III++;
    total++;
  }
  // Constroi array com a quantidade certa de cada motor
  const out: Motor[] = [
    ...Array(counts.III).fill('III' as Motor),
    ...Array(counts.IV).fill('IV' as Motor),
    ...Array(counts.V).fill('V' as Motor),
  ];
  // Shuffle deterministico (Fisher-Yates com seed)
  return shuffleSeeded(out, opts.seed || 'default');
}

/** Calcula custo total em creditos baseado em duracoes por take.
 *  motors[i] = motor do take i. takeSeconds[i] = duracao do take i (default 30s).
 *  Custo = sum(duration_min_i × CREDIT_COST_PER_MIN[motor_i]) */
export function calculateCost(
  motors: Motor[],
  takeSeconds?: number[],
): { total: number; byMotor: Record<Motor, number>; minutesByMotor: Record<Motor, number> } {
  const byMotor: Record<Motor, number> = { III: 0, IV: 0, V: 0 };
  const minutesByMotor: Record<Motor, number> = { III: 0, IV: 0, V: 0 };
  for (let i = 0; i < motors.length; i++) {
    const m = motors[i];
    const sec = takeSeconds?.[i] ?? DEFAULT_TAKE_SECONDS;
    const min = sec / 60;
    byMotor[m]++;
    minutesByMotor[m] += min;
  }
  // Round pra cima pq HeyGen cobra por minuto iniciado (assumindo)
  const total =
    Math.ceil(minutesByMotor.III * CREDIT_COST_PER_MIN.III) +
    Math.ceil(minutesByMotor.IV * CREDIT_COST_PER_MIN.IV) +
    Math.ceil(minutesByMotor.V * CREDIT_COST_PER_MIN.V);
  return { total, byMotor, minutesByMotor };
}

/** Estimativa de custo a partir do config + numero de takes.
 *  Aceita takeSeconds ou averageTakeSeconds (uniforme pra todos os takes). */
export function estimateCost(
  config: MotorConfig,
  takeCount: number,
  opts: { slotIds?: string[]; takeSeconds?: number[]; averageTakeSeconds?: number } = {},
): { total: number; byMotor: Record<Motor, number>; minutesByMotor: Record<Motor, number> } {
  const motors = resolveMotors(config, takeCount, { slotIds: opts.slotIds, seed: 'preview' });
  const takeSeconds = opts.takeSeconds
    ?? (opts.averageTakeSeconds != null
        ? Array(takeCount).fill(opts.averageTakeSeconds)
        : undefined);
  return calculateCost(motors, takeSeconds);
}

/** Shuffle Fisher-Yates deterministico (hash da seed → PRNG). */
function shuffleSeeded<T>(arr: T[], seed: string): T[] {
  const out = arr.slice();
  let s = 0;
  for (let i = 0; i < seed.length; i++) s = (s * 31 + seed.charCodeAt(i)) >>> 0;
  // mulberry32 PRNG
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
