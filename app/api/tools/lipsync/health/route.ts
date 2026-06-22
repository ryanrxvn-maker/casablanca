/**
 * /api/tools/lipsync/health — diagnóstico admin do POOL de contas DreamFace.
 *
 * Diz quantas contas existem, quantas estão SAUDÁVEIS (cookie válido) e o
 * estado de cada uma (label + ok + motivo + carga), sem NUNCA expor cookie/IDs.
 * Útil pra saber na hora se alguma conta caiu e precisa renovar o cookie.
 *
 * Admin-only.
 */

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/app/api/admin/_helpers';
import { checkPoolHealth, poolStats, hasAccounts } from '@/lib/dreamface-pool';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function GET() {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const proxyConfigured = Boolean(process.env.DREAMFACE_PROXY_URL);

  if (!hasAccounts()) {
    return NextResponse.json({
      ok: false,
      configured: false,
      accounts: 0,
      proxyConfigured,
      reason: 'config_missing',
      hint:
        'Nenhuma conta. Defina DREAMFACE_ACCOUNTS (JSON array) — ex.: ' +
        '[{"label":"c1","accountId":"...","userId":"...","cookie":"...","proxyUrl":"..."}] — ' +
        'ou os envs únicos DREAMFACE_ACCOUNT_ID/USER_ID/COOKIE.',
      pool: poolStats(),
    });
  }

  const health = await checkPoolHealth();
  return NextResponse.json({
    ok: health.healthy > 0,
    configured: true,
    accounts: health.accounts,
    healthy: health.healthy,
    proxyConfigured,
    hint:
      health.healthy === 0
        ? 'TODAS as contas estão fora (cookie expirado ou IP bloqueado). Renove os cookies em DREAMFACE_ACCOUNTS.'
        : health.healthy < health.accounts
          ? `${health.healthy}/${health.accounts} contas OK — as demais caíram (cookie/IP). Renove pra recuperar a capacidade total.`
          : `Todas as ${health.accounts} conta(s) OK. Distribuição inteligente + failover ativos.`,
    // label + ok + motivo + carga (SEM cookie/IDs).
    accountsDetail: health.details,
    pool: poolStats(),
  });
}
