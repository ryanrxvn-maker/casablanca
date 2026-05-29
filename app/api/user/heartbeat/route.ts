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

    let body: {
      tool?: string;
      source?: {
        traffic_source?: string;
        utm_source?: string;
        utm_medium?: string;
        utm_campaign?: string;
      };
    } = {};
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

    // Estado atual: pra logar tool_event só na TROCA de ferramenta e pra
    // gravar a origem só no primeiro toque (first-touch).
    const { data: current } = await supabase
      .from('profiles')
      .select('last_tool, first_touch_at')
      .eq('id', user.id)
      .maybeSingle();
    const prevTool = (current as { last_tool?: string | null } | null)?.last_tool ?? null;
    const hasFirstTouch = !!(current as { first_touch_at?: string | null } | null)
      ?.first_touch_at;

    const now = new Date().toISOString();
    const patch: Record<string, unknown> = {
      last_seen_at: now,
      last_ip: ip,
    };
    if (tool) {
      patch.last_tool = tool;
      patch.last_tool_at = now;
    }

    // Update CORE (colunas que existem desde a 011) — nunca pode falhar por
    // causa de colunas/tabelas novas da 022.
    const { error } = await supabase
      .from('profiles')
      .update(patch)
      .eq('id', user.id);

    // ─── Best-effort (depende da migration 022) — falha aqui é ignorada ───
    // Loga evento só quando a ferramenta MUDA (evita 1 row por ping).
    if (tool && tool !== prevTool) {
      try {
        await supabase.from('tool_events').insert({ user_id: user.id, tool });
      } catch {
        /* tabela ainda não migrada */
      }
    }
    // First-touch: grava origem só uma vez, se ainda não tiver.
    const src = body.source;
    if (!hasFirstTouch && src && typeof src === 'object') {
      const clip = (v: unknown) =>
        typeof v === 'string' && v.length > 0 ? v.slice(0, 120) : null;
      try {
        await supabase
          .from('profiles')
          .update({
            traffic_source: clip(src.traffic_source),
            utm_source: clip(src.utm_source),
            utm_medium: clip(src.utm_medium),
            utm_campaign: clip(src.utm_campaign),
            first_touch_at: now,
          })
          .eq('id', user.id);
      } catch {
        /* colunas ainda não migradas */
      }
    }

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
