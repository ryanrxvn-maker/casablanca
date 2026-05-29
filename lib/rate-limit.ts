/**
 * Rate limit em memória (janela deslizante), por instância serverless.
 * Best-effort: adiciona fricção real contra abuso/enumeração/spam em
 * endpoints públicos, sem depender de infra externa (Redis etc.).
 *
 * Uso:
 *   if (!rateLimit(`diagnose:${clientIp(req)}`, 8, 60_000)) return 429;
 */

type Bucket = number[]; // timestamps (ms)
const buckets: Map<string, Bucket> = ((globalThis as Record<string, unknown>)
  .__ae_rate_buckets ||= new Map()) as Map<string, Bucket>;

/** true = permitido; false = estourou o limite. */
export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const arr = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (arr.length >= limit) {
    buckets.set(key, arr);
    return false;
  }
  arr.push(now);
  buckets.set(key, arr);
  // Limpeza leve: evita crescimento infinito do Map.
  if (buckets.size > 5000) {
    for (const [k, v] of buckets) {
      if (v.every((t) => now - t >= windowMs)) buckets.delete(k);
    }
  }
  return true;
}

export function clientIp(req: Request): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    'unknown'
  );
}
