import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { timingSafeEqual } from 'crypto';
import { rateLimit } from '@/lib/rate-limit';

/**
 * POST /api/auth/sms/verify-code
 *  Body: { code: string }
 *
 * Confere o código mais recente do usuário logado. Marca o profile
 * como phone_verified=true e atualiza phone_verified_at. Consome o
 * código (consumed_at).
 */

export const runtime = 'nodejs';
export const maxDuration = 10;

const MAX_ATTEMPTS = 5;

export async function POST(req: Request) {
  try {
    const { code } = (await req.json()) as { code?: string };
    const cleaned = String(code || '').replace(/\D/g, '');
    if (cleaned.length !== 6) {
      return NextResponse.json(
        { ok: false, error: 'Código deve ter 6 dígitos.' },
        { status: 400 },
      );
    }

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { getAll: () => cookies().getAll(), setAll: () => {} } },
    );
    const { data: u } = await supabase.auth.getUser();
    const uid = u.user?.id;
    if (!uid) {
      return NextResponse.json(
        { ok: false, error: 'Não autenticado.' },
        { status: 401 },
      );
    }

    // Teto por usuário: no máx 12 tentativas de verificação por hora,
    // independente de quantos códigos foram pedidos. Fecha a janela de
    // brute-force "pede código novo → tenta mais 5".
    if (!rateLimit('otp-verify:' + uid, 12, 3_600_000)) {
      return NextResponse.json(
        { ok: false, error: 'Muitas tentativas. Tente novamente mais tarde.' },
        { status: 429 },
      );
    }

    const admin = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { cookies: { getAll: () => [], setAll: () => {} } },
    );

    const { data: otp } = await admin
      .from('phone_otp_codes')
      .select('id, code, expires_at, attempts, consumed_at, phone')
      .eq('profile_id', uid)
      .is('consumed_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!otp) {
      return NextResponse.json(
        { ok: false, error: 'Nenhum código ativo. Peça um novo.' },
        { status: 400 },
      );
    }
    if (new Date(otp.expires_at as string).getTime() < Date.now()) {
      return NextResponse.json(
        { ok: false, error: 'Código expirado. Peça um novo.' },
        { status: 400 },
      );
    }
    if ((otp.attempts as number) >= MAX_ATTEMPTS) {
      return NextResponse.json(
        { ok: false, error: 'Muitas tentativas. Peça um novo código.' },
        { status: 429 },
      );
    }

    // Comparação em TEMPO CONSTANTE (anti-timing). Buffers de tamanhos
    // diferentes nunca batem — guarda o tamanho antes do timingSafeEqual.
    const aBuf = Buffer.from(cleaned);
    const bBuf = Buffer.from(String(otp.code ?? ''));
    const codeMatches = aBuf.length === bBuf.length && timingSafeEqual(aBuf, bBuf);
    if (!codeMatches) {
      await admin
        .from('phone_otp_codes')
        .update({ attempts: (otp.attempts as number) + 1 })
        .eq('id', otp.id as string);
      return NextResponse.json(
        { ok: false, error: 'Código incorreto.' },
        { status: 400 },
      );
    }

    // Consumir + marcar verificado
    await admin
      .from('phone_otp_codes')
      .update({ consumed_at: new Date().toISOString() })
      .eq('id', otp.id as string);
    await admin
      .from('profiles')
      .update({
        phone_verified: true,
        phone_verified_at: new Date().toISOString(),
        phone: otp.phone as string,
      })
      .eq('id', uid);

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[sms/verify-code]', e);
    return NextResponse.json(
      { ok: false, error: 'Erro interno' },
      { status: 500 },
    );
  }
}
