/**
 * GET /api/cli/whoami — health-check + bootstrap do CLI/MCP do AutoEdit.
 *
 * Serve pra:
 *   1. Confirmar que a AUTOEDIT_CLI_KEY do cliente é válida (identidade + tier).
 *   2. Entregar a config PÚBLICA do Supabase (url + anon key — já exposta a
 *      qualquer browser via NEXT_PUBLIC_*) pro CLI conseguir subir arquivos
 *      direto pro Storage via signed upload URL, sem o dono colar nada à mão.
 *
 * Gated por requireTier('free'): com a chave de máquina → vem como admin; um
 * usuário de browser logado também consegue (e os valores são públicos), então
 * não há vazamento.
 */

import { NextResponse } from 'next/server';
import { requireTier } from '@/lib/require-tier';

export const runtime = 'nodejs';
export const maxDuration = 10;

export async function GET() {
  const gate = await requireTier('free');
  if (!gate.ok) return gate.response;

  return NextResponse.json({
    ok: true,
    app: 'autoedit',
    userId: gate.userId,
    email: gate.email,
    tier: gate.tier,
    isAdmin: gate.isAdmin,
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL || null,
    supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || null,
    ts: new Date().toISOString(),
  });
}
