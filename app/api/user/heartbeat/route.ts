import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * POST /api/user/heartbeat
 * body: { tool?: string }
 *
 * Atualiza last_seen_at, last_ip e (opcional) last_tool/last_tool_at.
 * Cliente envia a cada 20s enquanto navega no app. Admin usa esses
 * campos pra ver quem ta online + qual ferramenta usando.
 */

export const runtime = 'nodejs';
export const maxDuration = 10;

export async function POST(req: Request) {
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Nao autenticado.' }, { status: 401 });
    }

    let body: { tool?: string } = {};
    try {
      body = await req.json();
    } catch {
      // body opcional — nao quebra
    }
    const tool =
      typeof body.tool === 'string' && body.tool.length > 0 && body.tool.length <= 64
        ? body.tool
        : null;

    const ip =
      req.headers.get('x-forwarded-for')?.split(',')[0].trim() ??
      req.headers.get('x-real-ip') ??
      null;

    const now = new Date().toISOString();
    const patch: Record<string, unknown> = {
      last_seen_at: now,
      last_ip: ip,
    };
    if (tool) {
      patch.last_tool = tool;
      patch.last_tool_at = now;
    }

    const { error } = await supabase
      .from('profiles')
      .update(patch)
      .eq('id', user.id);

    if (error) {
      return NextResponse.json(
        { error: 'Falha no heartbeat.', detail: error.message },
        { status: 500 },
      );
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[heartbeat]', e);
    return NextResponse.json(
      { error: 'Erro inesperado.' },
      { status: 500 },
    );
  }
}
