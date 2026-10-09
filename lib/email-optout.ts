/**
 * Link de "não quero mais receber" (09.10): assinado por conta (HMAC), então
 * só quem recebeu o e-mail consegue sair — e sem login. A preferência fica no
 * app_metadata da conta (Supabase Auth), sem tabela nova.
 *
 * Servidor apenas (node:crypto). Testado em lib/email.test.ts.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

/** Conta do "Enviar teste pra mim": o link do rodapé funciona, mas não descadastra ninguém. */
export const TEST_OPTOUT_ID = 'teste';

function secret(): string | null {
  return process.env.EMAIL_OPTOUT_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || null;
}

export function optoutToken(userId: string, key: string | null = secret()): string | null {
  if (!key || !userId) return null;
  return createHmac('sha256', key).update(`email-optout:${userId}`).digest('base64url').slice(0, 32);
}

export function verifyOptout(userId: unknown, token: unknown, key: string | null = secret()): boolean {
  if (typeof userId !== 'string' || typeof token !== 'string' || !userId || token.length !== 32) return false;
  const want = optoutToken(userId, key);
  if (!want) return false;
  const a = Buffer.from(want);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function optoutUrl(site: string, userId: string, key: string | null = secret()): string {
  const t = optoutToken(userId, key) ?? '';
  return `${site}/api/email/sair?u=${encodeURIComponent(userId)}&t=${encodeURIComponent(t)}`;
}
