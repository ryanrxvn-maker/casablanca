import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

/**
 * POST /api/auth/forgot-password
 *  Body: { email: string }
 *  Resp: { ok: boolean, error?: string }
 *
 * Dispara o flow de recovery do Supabase: manda um código de 6 dígitos
 * por email (via `signInWithOtp` com tipo recovery — Supabase devolve
 * tanto magic link quanto código, dependendo do template). O user
 * digita o código em /reset-password e define uma senha nova.
 *
 * Importante: usa NEXT_PUBLIC_SITE_URL canônico no emailRedirectTo
 * (não window.origin) — evita link apontando pra preview deployment.
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

    const supabase = createClient(url, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // resetPasswordForEmail dispara o flow recovery — o template de
    // email "Reset Password" no Supabase Dashboard deve ter `{{ .Token }}`
    // pra mandar o código de 6 dígitos (além do link).
    const { error } = await supabase.auth.resetPasswordForEmail(cleanEmail, {
      redirectTo: siteUrl ? `${siteUrl}/reset-password` : undefined,
    });

    if (error) {
      // Não vazamos se o user existe ou não — sempre dizemos "se existir,
      // mandamos código" pra evitar enumeração. Mas log no server.
      console.warn('[forgot-password]', error.message);
    }

    // Sempre responde ok — UX consistente independente de existir ou não
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[forgot-password]', e);
    return NextResponse.json(
      { ok: false, error: 'Erro interno' },
      { status: 500 },
    );
  }
}
