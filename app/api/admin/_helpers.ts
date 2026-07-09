import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { cliMachineIdentity } from '@/lib/cli-auth';
import { requireTier } from '@/lib/require-tier';

/**
 * Helpers compartilhados pelas rotas /api/admin/*.
 *
 * SUPABASE_SERVICE_ROLE_KEY usa privilegios de service_role e
 * BYPASSA RLS + triggers. NUNCA exponha pro client. So pode ser
 * usada aqui no servidor.
 */

export function jsonError(message: string, status = 500, detail?: string) {
  return NextResponse.json(
    detail
      ? { error: message, detail: detail.slice(0, 500) }
      : { error: message },
    { status },
  );
}

/**
 * Garante que o caller é Pro OU Admin (tiers que pagam pelas
 * ferramentas de IA pesada, como Smart Remover). Beta legado também
 * é tratado como Pro.
 *
 * Delega pro requireTier('pro') canônico pra herdar a EXPIRAÇÃO de acesso
 * pago (isPaidExpired) — antes esta função checava só `tier==='pro'`, então
 * um plano ANUAL vencido continuava usando as tools (queimando conta vmake).
 * O retorno é superset-compatível ({ userId, isAdmin } preservados).
 */
export async function requirePro(): Promise<
  { ok: true; userId: string; isAdmin: boolean } | { ok: false; response: NextResponse }
> {
  const gate = await requireTier('pro');
  if (!gate.ok) return gate;
  return { ok: true, userId: gate.userId, isAdmin: gate.isAdmin };
}

/**
 * Garante que o caller eh admin autenticado. Retorna jsonError se nao for.
 * Caso seja, retorna o user_id do admin chamando.
 */
export async function requireAdmin(): Promise<
  { ok: true; userId: string } | { ok: false; response: NextResponse }
> {
  // Auth de máquina (CLI/MCP) → admin. Inerte sem AUTOEDIT_CLI_KEY.
  const machine = cliMachineIdentity();
  if (machine) return { ok: true, userId: machine.userId };

  try {
    const supabase = createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return { ok: false, response: jsonError('Nao autenticado.', 401) };
    }
    const { data: profile, error } = await supabase
      .from('profiles')
      .select('is_admin, is_active')
      .eq('id', user.id)
      .maybeSingle();
    if (error) {
      return { ok: false, response: jsonError('Falha ao validar admin.', 500, error.message) };
    }
    if (!profile?.is_admin) {
      return { ok: false, response: jsonError('Apenas admins.', 403) };
    }
    if (!profile?.is_active) {
      return { ok: false, response: jsonError('Conta admin inativa.', 403) };
    }
    return { ok: true, userId: user.id };
  } catch (e) {
    return {
      ok: false,
      response: jsonError(
        'Erro ao validar admin.',
        500,
        e instanceof Error ? e.message : String(e),
      ),
    };
  }
}

/**
 * Cria client Supabase com service role pra executar acoes que
 * bypassam RLS (criar usuarios, alterar is_admin/is_active, etc).
 */
export function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY nao configurada.');
  }
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
