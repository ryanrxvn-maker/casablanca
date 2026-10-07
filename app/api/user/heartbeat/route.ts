import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { rateLimit } from '@/lib/rate-limit';
import { serviceClient } from '@/app/api/admin/_helpers';
import { isValidDeviceId, isValidFingerprint, parseUserAgent } from '@/lib/access-device';

/**
 * POST /api/user/heartbeat
 * body: { tool?: string }
 *
 * Atualiza last_seen_at, last_ip e (opcional) last_tool/last_tool_at.
 * Cliente envia a cada 25s enquanto navega no app. Admin usa esses
 * campos pra ver quem ta online + qual ferramenta usando.
 *
 * Com `device` no corpo, grava também o HISTÓRICO DE ACESSO (aparelho, IP,
 * cidade) e detecta acesso simultâneo — tudo na função touch_access do
 * banco (migration 037), com a service role. O IP e a cidade vêm dos
 * headers da Vercel, nunca do cliente.
 */

/** Cidade/região/país que a Vercel resolve pelo IP (vazio fora dela). */
function geoFrom(req: Request) {
  const read = (h: string) => {
    const v = req.headers.get(h);
    if (!v) return null;
    try {
      return decodeURIComponent(v).slice(0, 80) || null;
    } catch {
      return v.slice(0, 80) || null;
    }
  };
  return {
    city: read('x-vercel-ip-city'),
    region: read('x-vercel-ip-country-region'),
    country: read('x-vercel-ip-country'),
  };
}

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
      device?: unknown;
      fp?: unknown;
      engaged?: unknown;
      touch?: unknown;
    } = {};
    try {
      body = await req.json();
    } catch {
      // body opcional — nao quebra
    }
    const device = isValidDeviceId(body.device) ? body.device : null;

    // Throttle silencioso. O teto é POR APARELHO (cada um pinga ~3/min, mais
    // os pings de "voltou pra aba") e há um teto geral por conta. Antes era
    // 6/min por conta: com dois aparelhos abertos o histórico perdia pings
    // justamente quando importa (acesso simultâneo). Ao exceder, só pulamos
    // o write e devolvemos ok.
    if (
      !rateLimit(`hb:${user.id}:${device ?? 'legacy'}`, 12, 60_000) ||
      !rateLimit(`hb:${user.id}`, 40, 60_000)
    ) {
      return NextResponse.json({ ok: true, throttled: true });
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
    // causa de colunas/tabelas novas da 022. O histórico de acesso (037) vai
    // em paralelo e é best-effort: sem a migration, só não grava.
    const [{ error }] = await Promise.all([
      supabase.from('profiles').update(patch).eq('id', user.id),
      device ? touchAccess(req, user.id, device, body, ip) : Promise.resolve(),
    ]);

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

async function touchAccess(
  req: Request,
  userId: string,
  device: string,
  body: { fp?: unknown; engaged?: unknown; touch?: unknown },
  ip: string | null,
): Promise<void> {
  try {
    const ua = req.headers.get('user-agent');
    const touch = typeof body.touch === 'number' && body.touch >= 0 && body.touch < 100 ? body.touch : 0;
    const info = parseUserAgent(ua, touch);
    const geo = geoFrom(req);
    const { error } = await serviceClient().rpc('touch_access', {
      p_user: userId,
      p_device: device,
      p_fp: isValidFingerprint(body.fp) ? body.fp : null,
      p_ip: ip,
      p_ua: ua ? ua.slice(0, 400) : null,
      p_browser: info.browser,
      p_os: info.os,
      p_kind: info.kind,
      p_city: geo.city,
      p_region: geo.region,
      p_country: geo.country,
      p_engaged: body.engaged === true,
    });
    if (error && !/touch_access|does not exist|schema cache/i.test(error.message)) {
      console.warn('[heartbeat] touch_access:', error.message);
    }
  } catch {
    /* sem service key ou migration 037 pendente: o heartbeat segue normal */
  }
}
