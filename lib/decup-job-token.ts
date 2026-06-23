/**
 * lib/decup-job-token.ts — token de job ASSINADO (HMAC), stateless.
 *
 * A decupagem no servidor é assíncrona: POST /start só dispara o job no Modal e
 * volta na hora com um token; o cliente acompanha via GET /status. Em serverless
 * (Vercel) cada request pode cair numa instância diferente, então o estado do
 * job (call_id do Modal + nome do arquivo + tipo de saída + dono) vai EMPACOTADO
 * num token assinado com HMAC-SHA256 (segredo só do servidor). Sem assinatura
 * válida → rejeitado. TTL curto limita replay.
 *
 * Mesmo padrão de lib/lipsync-job-token.ts.
 */

import crypto from 'node:crypto';

type JobPayload = {
  c: string; // modal call_id
  f: string; // nome base do arquivo (pra montar o download)
  k: string; // output kind ('video' | 'audio')
  u: string; // user_id (dono do job)
  t: number; // emitido em (epoch ms)
};

export type DecupJob = { callId: string; fileName: string; outputKind: string; userId: string };

const MAX_AGE_MS = 60 * 60 * 1000; // 1h — vídeo grande pode demorar a decupar

function secret(): string {
  const s =
    process.env.DECUP_JOB_SECRET?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!s) return 'autoedit-decup-dev-secret';
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
export function signDecupJob(job: DecupJob): string {
  const payload: JobPayload = {
    c: job.callId,
    f: job.fileName,
    k: job.outputKind,
    u: job.userId,
    t: Date.now(),
  };
  const body = b64url(Buffer.from(JSON.stringify(payload)));
  return `${body}.${hmac(body)}`;
}

/** Verifica + decodifica. null = formato inválido, assinatura errada ou TTL expirado. */
export function verifyDecupJob(token: string | null | undefined): DecupJob | null {
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
  if (!payload || !payload.c || !payload.u || !Number.isFinite(payload.t)) return null;
  if (Date.now() - payload.t > MAX_AGE_MS) return null;

  return { callId: payload.c, fileName: payload.f || 'video', outputKind: payload.k || 'video', userId: payload.u };
}
