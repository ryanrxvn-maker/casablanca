import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { rateLimit, clientIp } from '@/lib/rate-limit';

/**
 * POST /api/auth/diagnose
 *  Body: { email: string, password: string }
 *  Resp: { reason: 'invalid_credentials' | 'unconfirmed' | 'banned' | 'revoked'
 *                | 'must_change_password' | 'ok' | 'unknown',
 *          message: string,
 *          canResend: boolean }
 *
 * Diagnóstico de "por que não consigo entrar?" — chamado quando o
 * signInWithPassword devolve erro genérico (o Supabase mascara de propósito).
 *
 * ── ANTI-ENUMERAÇÃO (pentest 13.08, achado 3.1) ────────────────────────────
 * A versão antiga respondia pelo EMAIL sozinho, então `not_found` vs
 * `unconfirmed` virava um oráculo: um curl sem credencial nenhuma dizia se um
 * email qualquer tinha conta aqui (munição pra phishing dirigido e credential
 * stuffing). Agora o endpoint só abre o estado da conta pra quem PROVA que é
 * dono dela: a senha vem junto e é verificada de verdade contra o Supabase.
 *
 *   • senha confere  → devolve o motivo real (unconfirmed / revoked /
 *                      must_change_password / ok). Zero perda de UX: no login
 *                      e no cadastro a pessoa SEMPRE acabou de digitar a senha.
 *   • senha não confere, ou email não existe
 *                    → 'invalid_credentials', a MESMA resposta pros dois casos.
 *                      Sem oráculo.
 *
 * Exceção consciente: 'banned'. O GoTrue devolve `user_banned` sem garantir que
 * a senha foi conferida, então em tese ele revela "essa conta existe e está
 * banida". Mantido de propósito — conta banida é bloqueio deliberado nosso e a
 * pessoa precisa saber que tem que falar com o suporte; contas normais seguem
 * indistinguíveis de email inexistente, que é o que importa.
 */

export const runtime = 'nodejs';
export const maxDuration = 10;

type Reason =
  | 'invalid_credentials'
  | 'unconfirmed'
  | 'banned'
  | 'revoked'
  | 'must_change_password'
  | 'ok'
  | 'unknown';

type DiagnoseResp = {
  reason: Reason;
  message: string;
  canResend: boolean;
};

/** Resposta de auth nunca pode ficar em cache (CDN, proxy ou browser). */
function json(body: DiagnoseResp, status = 200) {
  return NextResponse.json<DiagnoseResp>(body, {
    status,
    headers: { 'Cache-Control': 'no-store, private' },
  });
}

/**
 * Resposta única pra "não provou nada": email inexistente e senha errada saem
 * IGUAIS daqui. O texto cobre os dois casos sem confirmar nenhum.
 */
function generic(): DiagnoseResp {
  return {
    reason: 'invalid_credentials',
    message:
      'Email ou senha incorretos. Confira os dados — se ainda não tem conta, é só criar uma.',
    canResend: false,
  };
}

export async function POST(req: Request) {
  // Rate-limit anti-enumeração/brute-force: 8 req/min por IP.
  if (!rateLimit(`diagnose:${clientIp(req)}`, 8, 60_000)) {
    return json(
      {
        reason: 'unknown',
        message: 'Muitas tentativas. Aguarde um minuto e tente de novo.',
        canResend: false,
      },
      429,
    );
  }

  try {
    const { email, password } = (await req.json()) as {
      email?: string;
      password?: string;
    };
    const cleanEmail = String(email || '').trim().toLowerCase();
    const pass = String(password || '');

    if (!cleanEmail || !/.+@.+\..+/.test(cleanEmail)) {
      return json({
        reason: 'unknown',
        message: 'Informe um email válido.',
        canResend: false,
      });
    }

    // Teto POR EMAIL (além do por-IP acima): estrangula tanto a enumeração
    // quanto o brute-force de senha mesmo se o atacante rotacionar IP.
    // Diagnóstico legítimo de 1 usuário cabe folgado em 5/10min.
    if (!rateLimit('diagnose-email:' + cleanEmail, 5, 600_000)) {
      return json(
        {
          reason: 'unknown',
          message: 'Muitas tentativas pra esse email. Aguarde um pouco.',
          canResend: false,
        },
        429,
      );
    }

    // Sem senha não há prova de posse — responde o genérico e para aqui.
    // (Também é o caminho de bundles antigos em cache, que não mandavam senha:
    // degrada a mensagem, nunca vaza.)
    if (!pass) return json(generic());

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    if (!url || !anonKey) {
      return json({
        reason: 'unknown',
        message: 'Não consegui verificar agora. Tente em alguns segundos.',
        canResend: false,
      });
    }

    // ── Prova de posse: confere a senha de verdade ────────────────────────
    const auth = createClient(url, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: signIn, error: signInErr } = await auth.auth.signInWithPassword({
      email: cleanEmail,
      password: pass,
    });

    if (signInErr) {
      const code = String((signInErr as { code?: string }).code || '');
      const msg = (signInErr.message || '').toLowerCase();

      // Senha CORRETA + email pendente: o GoTrue confere a senha antes de
      // checar a confirmação, então esse erro já é prova de posse.
      if (code === 'email_not_confirmed' || msg.includes('not confirmed')) {
        return json({
          reason: 'unconfirmed',
          message:
            'Você ainda não confirmou o email. Te mandamos um novo link agora — confira a caixa de entrada (e o spam).',
          canResend: true,
        });
      }

      if (code === 'user_banned' || msg.includes('banned')) {
        return json({
          reason: 'banned',
          message:
            'Esta conta está bloqueada temporariamente. Entre em contato pra liberar.',
          canResend: false,
        });
      }

      // invalid_credentials, email inexistente, qualquer outra coisa:
      // uma resposta só, sem distinguir os casos.
      return json(generic());
    }

    // ── Senha confere. A partir daqui pode abrir o estado real da conta. ──
    const userId = signIn.user?.id;

    // Encerra JÁ a sessão que acabamos de criar. scope 'local' derruba só
    // este token — 'global' (o default do supabase-js) deslogaria a pessoa
    // de todos os aparelhos dela só por ter pedido um diagnóstico.
    try {
      await auth.auth.signOut({ scope: 'local' });
    } catch {
      /* token órfão expira sozinho; não vale falhar o diagnóstico por isso */
    }

    // Estados que só existem no NOSSO banco (o Supabase Auth não conhece):
    // acesso revogado pelo admin e senha provisória a trocar.
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (userId && serviceKey) {
      try {
        const admin = createClient(url, serviceKey, {
          auth: { autoRefreshToken: false, persistSession: false },
        });
        const { data: profile } = await admin
          .from('profiles')
          .select('is_active, must_change_password')
          .eq('id', userId)
          .maybeSingle<{
            is_active: boolean | null;
            must_change_password: boolean | null;
          }>();

        if (profile?.is_active === false) {
          return json({
            reason: 'revoked',
            message:
              'Acesso revogado pela administração. Entre em contato pra reativar.',
            canResend: false,
          });
        }
        if (profile?.must_change_password === true) {
          return json({
            reason: 'must_change_password',
            message:
              'Você precisa trocar a senha provisória antes de entrar. Vá pra "Trocar senha".',
            canResend: false,
          });
        }
      } catch {
        /* profile inacessível: assume default ok */
      }
    }

    // Credencial boa e nada bloqueando — o login do cliente deve funcionar
    // numa nova tentativa (estado velho de sessão, corrida de cookie etc).
    return json({
      reason: 'ok',
      message: 'Suas credenciais estão certas. Tente entrar de novo.',
      canResend: false,
    });
  } catch (e) {
    console.error('[auth/diagnose]', e);
    return json({
      reason: 'unknown',
      message:
        'Não consegui identificar o motivo agora. Tente em alguns segundos.',
      canResend: false,
    });
  }
}
