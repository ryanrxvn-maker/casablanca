import { NextResponse } from 'next/server';
import { jsonError, requireAdmin, serviceClient } from '../_helpers';
import { applyToolChange, fixedBypassEmails, type ToolChange } from '@/lib/maintenance';
import { loadToolsConfig, saveToolsConfig } from '@/lib/maintenance-store';
import { toolName } from '@/lib/tool-catalog';

/**
 * /api/admin/tools-status — painel "Ferramentas" do /admin.
 *
 * GET   estado completo (manutenção por ferramenta, contas liberadas,
 *       histórico das últimas mudanças) + de onde veio (storage/padrão).
 * POST  { change, rev } aplica UMA mudança:
 *         { kind: 'set', path, maintenance, message?, until? }
 *         { kind: 'all', paths, maintenance, message?, until? }
 *         { kind: 'bypass', emails }
 *       `rev` é a versão que o painel estava vendo: se outro admin salvou no
 *       meio, responde 409 com o estado novo (ninguém atropela ninguém).
 *
 * A regra é a MESMA do middleware (lib/maintenance.ts); grava no Storage
 * privado (lib/maintenance-store.ts), sem migration.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 15;

const NO_STORE = { 'Cache-Control': 'no-store' };

async function adminName(userId: string): Promise<string> {
  try {
    const { data } = await serviceClient().from('profiles').select('name, email').eq('id', userId).maybeSingle();
    const row = (data ?? null) as { name?: string | null; email?: string | null } | null;
    const first = row?.name?.trim().split(/\s+/)[0];
    return first || row?.email || 'admin';
  } catch {
    return 'admin';
  }
}

export async function GET() {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  const loaded = await loadToolsConfig({ fresh: true });
  return NextResponse.json(
    { cfg: loaded.cfg, source: loaded.source, error: loaded.error ?? null, fixedBypass: fixedBypassEmails(), now: new Date().toISOString() },
    { headers: NO_STORE },
  );
}

export async function POST(req: Request) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  try {
    const body = (await req.json().catch(() => ({}))) as { change?: ToolChange; rev?: unknown };
    const change = body.change;
    if (!change || typeof change !== 'object' || !['set', 'all', 'bypass'].includes((change as { kind?: string }).kind ?? '')) {
      return jsonError('Mudança inválida.', 400);
    }
    const loaded = await loadToolsConfig({ fresh: true });
    // Sem ler o estado atual com certeza, gravar seria escrever às cegas.
    if (loaded.source !== 'storage' && loaded.source !== 'default') {
      return jsonError('Não consegui ler o estado atual das ferramentas agora. Tente de novo em alguns segundos.', 503, loaded.error);
    }
    if (typeof body.rev === 'number' && body.rev !== loaded.cfg.rev) {
      return NextResponse.json(
        { error: 'Outra pessoa mudou as ferramentas agora há pouco. A lista foi atualizada: confira e faça de novo.', cfg: loaded.cfg, conflict: true },
        { status: 409, headers: NO_STORE },
      );
    }
    const by = await adminName(guard.userId);
    const result = applyToolChange(loaded.cfg, change, by, toolName);
    if (!result.ok) return jsonError(result.error, 400);
    if (result.changed) await saveToolsConfig(result.cfg);
    return NextResponse.json({ ok: true, cfg: result.cfg, summary: result.summary, changed: result.changed }, { headers: NO_STORE });
  } catch (e) {
    return jsonError('Não deu pra salvar a mudança.', 500, e instanceof Error ? e.message : String(e));
  }
}
