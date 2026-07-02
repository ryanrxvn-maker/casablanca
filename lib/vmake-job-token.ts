/**
 * lib/vmake-job-token.ts — token de job ASSINADO (HMAC) pro Removedor de Legenda.
 *
 * POR QUÊ: o POST /api/tools/remove-subtitle devolve um `record_id` (id gerado
 * pelo vmake) que o cliente usa depois pra pollar /status e baixar /download.
 * O `record_id` cru NÃO é amarrado ao usuário — então qualquer conta Pro/Admin
 * que conheça o record_id de OUTRA pessoa baixava o vídeo dela (IDOR).
 *
 * Solução sem banco (serverless): em vez do record_id cru, o POST devolve um
 * token opaco que EMBUTE {recordId, userId} assinado com HMAC-SHA256 (segredo só
 * do servidor). O /status e o /download desempacotam, conferem a assinatura e
 * rejeitam se `job.userId !== caller`. O cliente só ECOA esse token (nunca o
 * parseia), então não precisa mudar nada no front.
 *
 * Domain separation ('vmake.v1') garante que um token deste tool não colida com
 * o de lipsync/decupagem mesmo que compartilhem o SERVICE_ROLE como segredo.
 */

import crypto from 'node:crypto';

type JobPayload = {
  r: string; // record_id (vmake)
  u: string; // user_id (dono do job)
  t: number; // emitido em (epoch ms)
};

export type VmakeJob = { recordId: string; userId: string };

/** Janela de validade — remoção de legenda de vídeo longo cabe folgado. */
const MAX_AGE_MS = 6 * 60 * 60 * 1000; // 6h

const AUD = 'vmake.v1.';

function secret(): string {
  const s =
    process.env.VMAKE_JOB_SECRET?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (s) return s;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('VMAKE_JOB_SECRET/SERVICE_ROLE_KEY ausente — recusando assinar/verificar token.');
  }
  return 'autoedit-vmake-dev-secret';
}

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromB64url(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}
function hmac(body: string): string {
  return b64url(crypto.createHmac('sha256', secret()).update(AUD + body).digest());
}

/** Assina um job → token opaco `body.mac`. */
export function signVmakeJob(job: VmakeJob): string {
  const payload: JobPayload = { r: job.recordId, u: job.userId, t: Date.now() };
  const body = b64url(Buffer.from(JSON.stringify(payload)));
  return `${body}.${hmac(body)}`;
}

/**
 * Verifica + decodifica. null = formato inválido, assinatura errada ou TTL
 * expirado. Quem chama trata null como "job inválido/expirado".
 */
export function verifyVmakeJob(token: string | null | undefined): VmakeJob | null {
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
  if (!payload || !payload.r || !payload.u || !Number.isFinite(payload.t)) return null;
  if (Date.now() - payload.t > MAX_AGE_MS) return null;

  return { recordId: payload.r, userId: payload.u };
}
