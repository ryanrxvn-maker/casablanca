import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { canBypassMaintenance, toSnapshot, type MaintenanceSnapshot } from '@/lib/maintenance';
import { loadToolsConfig } from '@/lib/maintenance-store';
import { catalogTool } from '@/lib/tool-catalog';
import { emailUnlocksPath, pathUnlockedByList } from '@/lib/tool-unlocks';

/**
 * GET /api/tools/status — o que está em manutenção AGORA, pro hub e pro menu
 * lateral desenharem o selo. O bloqueio de verdade é no middleware e nas APIs.
 *
 * Cliente nunca recebe o nome de ferramenta de uso interno: só entra no
 * retrato o que ele enxerga (Free/Premium, ou ferramenta interna liberada
 * pra conta dele). Admin recebe tudo.
 */

// Edge de propósito: é o MESMO ambiente do middleware (que barra as páginas),
// então esta rota respondendo em produção prova que a leitura do Storage
// funciona lá também.
export const runtime = 'edge';
export const dynamic = 'force-dynamic';

export async function GET() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Nao autenticado.' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });

  const [{ cfg }, prof] = await Promise.all([
    loadToolsConfig(),
    supabase.from('profiles').select('is_admin, tool_unlocks').eq('id', user.id).maybeSingle(),
  ]);
  const p = (prof.data ?? null) as { is_admin?: boolean | null; tool_unlocks?: string[] | null } | null;
  const isAdmin = p?.is_admin === true;

  const full = toSnapshot(cfg, isAdmin || canBypassMaintenance(user.email, cfg));
  const tools: MaintenanceSnapshot['tools'] = {};
  for (const [path, info] of Object.entries(full.tools)) {
    const internal = catalogTool(path)?.plan === 'admin' || !catalogTool(path);
    if (!isAdmin && internal && !pathUnlockedByList(p?.tool_unlocks, path) && !emailUnlocksPath(user.email, path)) continue;
    tools[path] = info;
  }
  const snap: MaintenanceSnapshot = { ...full, tools };
  return NextResponse.json(snap, { headers: { 'Cache-Control': 'private, no-store' } });
}
