import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { rateLimit, clientIp } from '@/lib/rate-limit';

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
    // Fricção por IP: corta rajadas de SMS-pumping antes de tocar no banco.
    // Best-effort (in-memory por instância) — o teto real é o cap diário DB abaixo.
    if (!rateLimit('otp-send-ip:' + clientIp(req), 5, 600_000)) {
      return NextResponse.json({
        ok: true,
        throttled: true,
        message: 'Muitas solicitações. Aguarde alguns minutos.',
      });
    }

    const { phone } = (await req.json()) as { phone?: string };
    if (!phone || phone.length < 8) {
      return NextResponse.json({ ok: true });
    }
    // Normaliza pra E.164 e valida o formato — não dispara SMS (custo) pra
    // número malformado. Retorna 200 mesmo se inválido (não vaza info).
    const normalizedPhone = phone.replace(/[^\d+]/g, '');
    if (!/^\+?[1-9]\d{7,14}$/.test(normalizedPhone)) {
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

    // Cap diário GLOBAL (no banco, independe de instância serverless):
    // máx 10 códigos por usuário em 24h. Barra SMS-pumping/toll-fraud e
    // tira a munição do brute-force (poucos códigos por dia → poucas tentativas).
    const DAILY_MAX = 10;
    const since24h = new Date(Date.now() - 86_400_000).toISOString();
    const { count: sentToday } = await admin
      .from('phone_otp_codes')
      .select('id', { count: 'exact', head: true })
      .eq('profile_id', uid)
      .gte('created_at', since24h);
    if ((sentToday ?? 0) >= DAILY_MAX) {
      return NextResponse.json({
        ok: true,
        throttled: true,
        message: 'Limite diário de códigos atingido. Tente novamente amanhã.',
      });
    }

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
      phone: normalizedPhone,
      code,
    });

    // NÃO grava phone no profile aqui — seria um telefone NÃO verificado.
    // O verify-code persiste o phone no profile só após confirmar o código.

    const body = `Auto Edit · Seu código: ${code}. Vale por 10 min.`;
    const sent = await sendTwilio(normalizedPhone, body);
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
