/**
 * Re-tenta uma função assíncrona com backoff exponencial + jitter.
 *
 * Pensado pra chamadas de rede transitórias (Supabase auth.getUser / select em
 * profiles) que falham por blip de rede, cold-start ou latência do refresh de
 * token e voltam na 2ª/3ª tentativa. Sem isso, a 1ª falha "grudava" a UI no
 * default free até o usuário dar F5 (selo FREE + ferramentas trancadas).
 *
 * IMPORTANTE: `fn` precisa LANÇAR no erro pra ser re-tentada. APIs que devolvem
 * `{ data, error }` (ex.: supabase-js) não lançam sozinhas — cheque `error` e
 * dê throw dentro do `fn`.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: {
    tries?: number;
    baseMs?: number;
    onRetry?: (err: unknown, attempt: number) => void;
  } = {},
): Promise<T> {
  const tries = opts.tries ?? 3;
  const baseMs = opts.baseMs ?? 300;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt >= tries) break;
      opts.onRetry?.(err, attempt);
      const delay = baseMs * 2 ** (attempt - 1) + Math.floor(Math.random() * 120);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}
