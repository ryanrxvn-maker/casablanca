import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { rateLimit, clientIp } from '@/lib/rate-limit';

/**
 * POST /api/auth/resend-confirm
 *  Body: { email: string }
 *  Resp: { ok: boolean, error?: string }
 *
 * Reenvia o email de confirmação de signup. Server-side pra controlar
 * o emailRedirectTo (usa NEXT_PUBLIC_SITE_URL canônico em vez de origin
 * do browser).
 */

export const runtime = 'nodejs';
export const maxDuration = 10;

export async function POST(req: Request) {
  try {
    const { email } = (await req.json()) as { email?: string };
    const cleanEmail = String(email || '').trim().toLowerCase();
    if (!cleanEmail || !/.+@.+\..+/.test(cleanEmail)) {
      return NextResponse.json(
        { ok: false, error: 'Email inválido.' },
        { status: 400 },
      );
    }

    // Rate-limit anti email-bomb / cota Supabase: por IP e por email.
    if (
      !rateLimit('resend-ip:' + clientIp(req), 6, 600_000) ||
      !rateLimit('resend-email:' + cleanEmail, 3, 3_600_000)
    ) {
      return NextResponse.json({ ok: true });
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    const siteUrl =
      process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '') ||
      req.headers.get('origin') ||
      '';
    if (!url || !anonKey) {
      return NextResponse.json(
        { ok: false, error: 'Configuração de auth ausente.' },
        { status: 500 },
      );
    }

    // Anon client (a função resend não precisa de service-role)
    const supabase = createClient(url, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { error } = await supabase.auth.resend({
      type: 'signup',
      email: cleanEmail,
      options: {
        emailRedirectTo: siteUrl ? `${siteUrl}/auth/callback` : undefined,
      },
    });

    // NÃO devolve error.message — diferenciava "email não existe" de "já
    // confirmado" (enumeração de conta). Loga no server, responde ok sempre.
    if (error) {
      console.warn('[auth/resend-confirm]', error.message);
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[auth/resend-confirm]', e);
    return NextResponse.json(
      { ok: false, error: 'Erro interno' },
      { status: 500 },
    );
  }
}
