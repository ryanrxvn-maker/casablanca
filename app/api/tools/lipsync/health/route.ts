/**
 * /api/tools/lipsync/health — diagnóstico admin do motor DreamFace.
 *
 * Diz se o cookie/sessão estão válidos, se o proxy de IP fixo está
 * configurado e o estado da fila serial. Útil pra saber na hora se o
 * DREAMFACE_COOKIE caiu (precisa renovar).
 *
 * Admin-only.
 */

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/app/api/admin/_helpers';
import { checkHealth, isDreamFaceConfigured } from '@/lib/dreamface-api';
import { queueStats } from '@/lib/dreamface-queue';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function GET() {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const configured = isDreamFaceConfigured();
  const proxyConfigured = Boolean(process.env.DREAMFACE_PROXY_URL);

  if (!configured) {
    return NextResponse.json({
      ok: false,
      configured: false,
      proxyConfigured,
      reason: 'config_missing',
      hint: 'Defina DREAMFACE_COOKIE, DREAMFACE_ACCOUNT_ID e DREAMFACE_USER_ID.',
      queue: queueStats(),
    });
  }

  const health = await checkHealth();
  return NextResponse.json({
    ok: health.ok,
    configured: true,
    proxyConfigured,
    reason: health.reason ?? null,
    hint: health.ok
      ? proxyConfigured
        ? 'Tudo certo. DreamFace acessível (auth por account_id/user_id) e proxy de IP fixo ativo.'
        : 'DreamFace acessível. ATENÇÃO: sem DREAMFACE_PROXY_URL — em produção (Vercel) configure um proxy de IP fixo pra evitar bloqueio.'
      : 'DreamFace indisponível, IDs (account/user) errados, ou IP bloqueado (use DREAMFACE_PROXY_URL).',
    queue: queueStats(),
  });
}
