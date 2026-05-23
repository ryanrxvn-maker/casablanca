import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

/**
 * POST /api/auth/sms/send-code
 *  Body: { phone: string }
 *
 * Gera um código de 6 dígitos e:
 *   1. Salva em phone_otp_codes (via service role)
 *   2. Envia SMS via Twilio se TWILIO_* env existirem; senão loga no
 *      console (modo dev — admin vê o código no log do servidor)
 *
 * Sempre devolve 200 (mesmo com erro de provider) pra não vazar info de
 * conta. Rate-limit simples: máx 1 código a cada 30s por phone.
 */

export const runtime = 'nodejs';
export const maxDuration = 15;

function genCode(): string {
  // 6 dígitos, primeiro nunca é 0 pra ficar visível em SMS
  let s = String(Math.floor(1 + Math.random() * 9));
  for (let i = 0; i < 5; i++) s += String(Math.floor(Math.random() * 10));
  return s;
}

async function sendTwilio(phone: string, body: string): Promise<boolean> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;
  if (!sid || !token || !from) return false;

  const url = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`;
  const params = new URLSearchParams({ To: phone, From: from, Body: body });
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(sid + ':' + token).toString('base64'),
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });
  if (!res.ok) {
    console.error('[twilio] send failed', res.status, await res.text());
    return false;
  }
  return true;
}

export async function POST(req: Request) {
  try {
    const { phone } = (await req.json()) as { phone?: string };
    if (!phone || phone.length < 8) {
      return NextResponse.json({ ok: true });
    }

    // Resolve profile do usuário logado (ou do recém-criado pelo signup)
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { getAll: () => cookies().getAll(), setAll: () => {} } },
    );
    const { data: u } = await supabase.auth.getUser();
    const uid = u.user?.id;
    if (!uid) {
      return NextResponse.json({ ok: true });
    }

    const admin = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { cookies: { getAll: () => [], setAll: () => {} } },
    );

    // Rate-limit: último código enviado < 30s?
    const { data: recent } = await admin
      .from('phone_otp_codes')
      .select('created_at')
      .eq('profile_id', uid)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (
      recent?.created_at &&
      Date.now() - new Date(recent.created_at as string).getTime() < 30_000
    ) {
      return NextResponse.json({
        ok: true,
        throttled: true,
        message: 'Aguarde 30s pra pedir outro código.',
      });
    }

    const code = genCode();
    await admin.from('phone_otp_codes').insert({
      profile_id: uid,
      phone,
      code,
    });

    // Atualiza phone no profile (pra refletir o que foi inserido)
    await admin.from('profiles').update({ phone }).eq('id', uid);

    const body = `Auto Edit · Seu código: ${code}. Vale por 10 min.`;
    const sent = await sendTwilio(phone, body);
    if (!sent) {
      // Dev mode: loga no servidor pra você ver
      console.log('[sms-otp] (dev) phone=' + phone + ' code=' + code);
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[sms/send-code]', e);
    return NextResponse.json({ ok: true });
  }
}
