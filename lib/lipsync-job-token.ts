/**
 * lib/lipsync-job-token.ts — token de job ASSINADO (HMAC), stateless.
 *
 * POR QUÊ: no modo assíncrono, o POST /api/tools/lipsync só SUBMETE o job e
 * volta na hora; o cliente acompanha o render chamando GET /status. Mas o
 * /status precisa saber QUAL conta do pool segura o job (pra pollar o motor) +
 * o animate_id. Em serverless (Vercel) cada request pode cair numa instância
 * diferente, então NÃO dá pra guardar isso em memória.
 *
 * Solução sem banco: empacotar {label da conta, animate_id, user_id, ts} num
 * token ASSINADO com HMAC-SHA256 (segredo só do servidor). O cliente recebe o
 * token opaco e o devolve no /status; o servidor verifica a assinatura, decodifica
 * e pollar. Sem assinatura válida → rejeitado. TTL curto limita replay.
 *
 * Nada sensível vaza: o "label" é genérico ("c1"/"conta1") e o animate_id é um
 * uuid interno do motor — sem o segredo do servidor o token não pode ser forjado
 * nem lido com garantia de integridade.
 */

import crypto from 'node:crypto';

type JobPayload = {
  l: string; // account label (pool)
  a: string; // animate_id (motor)
  u: string; // user_id (dono do job)
  t: number; // emitido em (epoch ms)
};

export type LipsyncJob = { label: string; animateId: string; userId: string };

/** Janela máxima de validade do token (anti-replay). Um render cabe folgado. */
const MAX_AGE_MS = 30 * 60 * 1000; // 30 min

/**
 * Segredo de assinatura. Prioriza um segredo dedicado; cai pro SERVICE_ROLE
 * (sempre presente server-side) pra nunca ficar sem segredo em produção. Os
 * dois NUNCA vão pro cliente.
 */
function secret(): string {
  const s =
    process.env.LIPSYNC_JOB_SECRET?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    process.env.DREAMFACE_USER_ID?.trim();
  if (!s) {
    // Em dev sem nenhum segredo: usa um fixo (só afeta ambiente local).
    return 'autoedit-lipsync-dev-secret';
  }
  return s;
}

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

function hmac(body: string): string {
  return b64url(crypto.createHmac('sha256', secret()).update(body).digest());
}

/** Assina um job → token opaco `body.mac`. */
export function signLipsyncJob(job: LipsyncJob): string {
  const payload: JobPayload = { l: job.label, a: job.animateId, u: job.userId, t: Date.now() };
  const body = b64url(Buffer.from(JSON.stringify(payload)));
  return `${body}.${hmac(body)}`;
}

/**
 * Verifica + decodifica um token. Retorna null se: formato inválido, assinatura
 * não bate (timing-safe) ou TTL expirado. Quem chamar trata null como "job
 * inválido/expirado" (400).
 */
export function verifyLipsyncJob(token: string | null | undefined): LipsyncJob | null {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const dot = token.indexOf('.');
  const body = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  if (!body || !mac) return null;

  const expected = hmac(body);
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  let payload: JobPayload;
  try {
    payload = JSON.parse(fromB64url(body).toString('utf8')) as JobPayload;
  } catch {
    return null;
  }
  if (!payload || !payload.l || !payload.a || !payload.u || !Number.isFinite(payload.t)) return null;
  if (Date.now() - payload.t > MAX_AGE_MS) return null;

  return { label: payload.l, animateId: payload.a, userId: payload.u };
}
