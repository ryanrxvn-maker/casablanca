/**
 * /api/tools/remove-subtitle/health — diagnóstico admin do motor vmake.
 *
 * Diz se o Access-Token está válido, se o proxy de IP fixo está configurado
 * e o estado da fila serial. Útil pra saber na hora se o VMAKE_ACCESS_TOKEN
 * caiu (precisa renovar pelo browser logado).
 *
 * Admin-only.
 */

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/app/api/admin/_helpers';
import { checkHealth, isVmakeConfigured } from '@/lib/vmake-api';
import { vmakeQueueStats } from '@/lib/vmake-queue';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function GET() {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const configured = isVmakeConfigured();
  const proxyConfigured = Boolean(process.env.VMAKE_PROXY_URL);
  const gidConfigured = Boolean(process.env.VMAKE_GID);

  if (!configured) {
    return NextResponse.json({
      ok: false,
      configured: false,
      proxyConfigured,
      gidConfigured,
      reason: 'config_missing',
      hint: 'Defina VMAKE_ACCESS_TOKEN (localStorage vmake-auth-store.data.state.accessToken do browser logado) e VMAKE_GID (track-store.gid).',
      queue: vmakeQueueStats(),
    });
  }

  const health = await checkHealth();
  return NextResponse.json({
    ok: health.ok,
    configured: true,
    proxyConfigured,
    gidConfigured,
    reason: health.reason ?? null,
    hint: health.ok
      ? proxyConfigured
        ? 'Tudo certo. vmake acessível e proxy de IP fixo ativo.'
        : 'vmake acessível. ATENÇÃO: sem VMAKE_PROXY_URL — em produção (Vercel) configure um proxy de IP fixo pra evitar bloqueio.'
      : 'vmake indisponível ou Access-Token expirado — renove o VMAKE_ACCESS_TOKEN pelo browser logado.',
    queue: vmakeQueueStats(),
  });
}
