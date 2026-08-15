/**
 * /api/tools/remove-subtitle/health — diagnóstico admin do POOL de contas
 * do motor de remoção (mesmo pool do lipsync).
 *
 * Diz quantas contas existem, quantas estão SAUDÁVEIS e o estado de cada uma,
 * sem NUNCA expor cookie/IDs. Útil pra saber na hora se alguma conta caiu.
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
        'Nenhuma conta configurada. Defina DREAMFACE_ACCOUNTS (JSON array) ou os envs únicos ' +
        'DREAMFACE_ACCOUNT_ID/USER_ID.',
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
        ? 'TODAS as contas estão fora. Renove os cookies em DREAMFACE_ACCOUNTS.'
        : health.healthy < health.accounts
          ? `${health.healthy}/${health.accounts} contas OK — as demais caíram.`
          : `Todas as ${health.accounts} conta(s) OK.`,
    accountsDetail: health.details,
    pool: poolStats(),
  });
}
