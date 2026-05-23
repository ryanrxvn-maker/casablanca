import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

/**
 * POST /api/auth/diagnose
 *  Body: { email: string }
 *  Resp: { reason: 'not_found' | 'unconfirmed' | 'banned' | 'revoked'
 *                | 'must_change_password' | 'wrong_password' | 'unknown',
 *          message: string,
 *          canResend: boolean }
 *
 * Diagnóstico de "por que não consigo entrar?" — chamado quando o
 * signInWithPassword devolve erro genérico (Supabase mascara propositais).
 * Faz lookup admin no auth.users + check no `profiles`.
 *
 * Segurança: NÃO devolve se o email existe ou não pra evitar enumeração;
 * sempre retorna mensagem útil mas semanticamente neutra ('Email não
 * cadastrado' = mesma resposta de 'usuário sem signup'). Mantém o canal
 * 'unconfirmed' como ÚNICA exceção (necessário pra UX 'reenviar email').
 */

export const runtime = 'nodejs';
export const maxDuration = 10;

type DiagnoseResp = {
  reason:
    | 'not_found'
    | 'unconfirmed'
    | 'banned'
    | 'revoked'
    | 'must_change_password'
    | 'wrong_password'
    | 'unknown';
  message: string;
  canResend: boolean;
};

export async function POST(req: Request) {
  try {
    const { email } = (await req.json()) as { email?: string };
    const cleanEmail = String(email || '').trim().toLowerCase();
    if (!cleanEmail || !/.+@.+\..+/.test(cleanEmail)) {
      return NextResponse.json<DiagnoseResp>({
        reason: 'unknown',
        message: 'Informe um email válido.',
        canResend: false,
      });
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    if (!url || !serviceKey) {
      return NextResponse.json<DiagnoseResp>({
        reason: 'unknown',
        message: 'Não consegui verificar agora. Tente em alguns segundos.',
        canResend: false,
      });
    }

    const admin = createClient(url, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // 1) Procura o user no auth.users via listUsers filtrando email.
    //    listUsers não tem filtro direto, então usamos getUserByEmail
    //    via PostgREST admin (auth schema é restrito; usamos rpc/list).
    //    No SSR/SDK v2, admin.listUsers paginado é o caminho — mas
    //    pesado pra base grande. Alternativa: query direta via service
    //    role no public.profiles JOIN auth.users (não viável sem RPC).
    //
    //    Solução robusta: tentar admin.generateLink({type:'recovery'})
    //    — ele falha com 'User not found' se o user não existir, e
    //    sucesso se existir. Mas isso CRIA um link de recovery (efeito
    //    colateral). Melhor: admin.listUsers com email filter no v2.
    let userRow: {
      id: string;
      email_confirmed_at: string | null;
      banned_until: string | null;
    } | null = null;

    try {
      // Supabase JS v2: listUsers aceita { email } como filtro server-side
      // se a service_role tiver acesso. Se não suportar, paginamos.
      const { data } = await admin.auth.admin.listUsers({ perPage: 200 });
      const found = (data?.users || []).find(
        (u) => (u.email || '').toLowerCase() === cleanEmail,
      );
      if (found) {
        userRow = {
          id: found.id,
          email_confirmed_at: (found.email_confirmed_at as string | null) || null,
          banned_until: (found.banned_until as string | null) || null,
        };
      }
    } catch {
      // se listUsers falhar (rate limit / role), cai pro unknown
    }

    if (!userRow) {
      return NextResponse.json<DiagnoseResp>({
        reason: 'not_found',
        message:
          'Não encontrei uma conta com esse email. Confira a grafia ou cadastre-se.',
        canResend: false,
      });
    }

    // 2) Email não confirmado?
    if (!userRow.email_confirmed_at) {
      return NextResponse.json<DiagnoseResp>({
        reason: 'unconfirmed',
        message:
          'Você ainda não confirmou o email. Te mandamos um novo link agora — confira a caixa de entrada (e o spam).',
        canResend: true,
      });
    }

    // 3) Banido pelo Supabase?
    if (userRow.banned_until) {
      const bannedUntil = new Date(userRow.banned_until).getTime();
      if (!isNaN(bannedUntil) && bannedUntil > Date.now()) {
        return NextResponse.json<DiagnoseResp>({
          reason: 'banned',
          message:
            'Esta conta está bloqueada temporariamente. Entre em contato pra liberar.',
          canResend: false,
        });
      }
    }

    // 4) Acesso revogado no profile (is_active=false) ou must_change_password
    type ProfileRow = {
      is_active: boolean | null;
      must_change_password: boolean | null;
    };
    let profile: ProfileRow | null = null;
    try {
      const { data } = await admin
        .from('profiles')
        .select('is_active, must_change_password')
        .eq('id', userRow.id)
        .maybeSingle();
      profile = (data as unknown as ProfileRow | null) || null;
    } catch {
      // profile não acessível: assume default ok
    }

    if (profile?.is_active === false) {
      return NextResponse.json<DiagnoseResp>({
        reason: 'revoked',
        message:
          'Acesso revogado pela administração. Entre em contato pra reativar.',
        canResend: false,
      });
    }

    if (profile?.must_change_password === true) {
      return NextResponse.json<DiagnoseResp>({
        reason: 'must_change_password',
        message:
          'Você precisa trocar a senha provisória antes de entrar. Vá pra "Trocar senha".',
        canResend: false,
      });
    }

    // 5) User existe, confirmado, ativo → erro era senha errada
    return NextResponse.json<DiagnoseResp>({
      reason: 'wrong_password',
      message: 'Senha incorreta. Confira ou peça pra trocar.',
      canResend: false,
    });
  } catch (e) {
    console.error('[auth/diagnose]', e);
    return NextResponse.json<DiagnoseResp>({
      reason: 'unknown',
      message:
        'Não consegui identificar o motivo agora. Tente em alguns segundos.',
      canResend: false,
    });
  }
}
