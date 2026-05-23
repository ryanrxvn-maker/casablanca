'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AuthShell } from '@/components/AuthShell';
import { createClient } from '@/lib/supabase/client';

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

type LoginError = {
  message: string;
  reason?: DiagnoseResp['reason'];
  canResend?: boolean;
  ctaHref?: string;
  ctaLabel?: string;
};

function LoginInner() {
  const router = useRouter();
  const params = useSearchParams();
  const betaClosed = params.get('beta') === 'closed';
  const justConfirmed = params.get('confirmed') === '1';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<LoginError | null>(null);
  const [resending, setResending] = useState(false);
  const [resentMsg, setResentMsg] = useState<string | null>(null);

  async function diagnose(emailToCheck: string): Promise<DiagnoseResp | null> {
    try {
      const res = await fetch('/api/auth/diagnose', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: emailToCheck }),
      });
      if (!res.ok) return null;
      return (await res.json()) as DiagnoseResp;
    } catch {
      return null;
    }
  }

  async function handleEmailLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResentMsg(null);

    const cleanEmail = email.trim().toLowerCase();
    const supabase = createClient();

    const { error: signInErr } = await supabase.auth.signInWithPassword({
      email: cleanEmail,
      password,
    });

    if (!signInErr) {
      setLoading(false);
      router.replace('/tools');
      router.refresh();
      return;
    }

    // ── Erro genérico do Supabase — chama nosso diagnóstico server-side
    const diag = await diagnose(cleanEmail);

    if (diag) {
      // Monta erro com CTA específico por motivo
      let cta: { href?: string; label?: string } = {};
      if (diag.reason === 'must_change_password') {
        cta = { href: '/trocar-senha', label: 'Ir trocar senha' };
      } else if (diag.reason === 'not_found') {
        cta = { href: '/register', label: 'Criar conta' };
      } else if (diag.reason === 'banned' || diag.reason === 'revoked') {
        cta = {
          href: 'https://wa.me/5531991262437',
          label: 'Falar no WhatsApp',
        };
      }
      setError({
        message: diag.message,
        reason: diag.reason,
        canResend: diag.canResend,
        ctaHref: cta.href,
        ctaLabel: cta.label,
      });
      setLoading(false);
      return;
    }

    // Fallback: usa msg crua do Supabase
    setError({ message: signInErr.message || 'Não consegui entrar agora.' });
    setLoading(false);
  }

  async function handleResend() {
    setResending(true);
    setResentMsg(null);
    try {
      const res = await fetch('/api/auth/resend-confirm', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) {
        setResentMsg(json.error || 'Falha ao reenviar.');
        return;
      }
      setResentMsg(
        'Email reenviado. Confira a caixa de entrada (e o spam).',
      );
    } finally {
      setResending(false);
    }
  }

  return (
    <AuthShell
      title="Bem-vindo de volta"
      subtitle="Entre pra continuar de onde parou."
      footer={
        <a
          href="/register"
          className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-violet/40 bg-violet/10 px-5 py-3 text-[13px] font-bold text-violet backdrop-blur-md transition-all duration-300 hover:-translate-y-[1px] hover:border-violet/70 hover:bg-violet/20"
        >
          Criar conta grátis
          <span className="transition-transform duration-300 group-hover:translate-x-0.5">→</span>
        </a>
      }
    >
      <form onSubmit={handleEmailLogin} className="flex flex-col gap-4">
        {betaClosed ? (
          <div
            role="status"
            className="fade-in-up flex items-start gap-2 rounded-[12px] border border-violet/40 bg-violet/10 px-3 py-2 text-xs text-violet"
          >
            <span className="mt-0.5 inline-block h-2 w-2 rounded-full bg-violet shadow-[0_0_8px_rgba(167,139,250,0.9)]" />
            <span>
              Os cadastros estão fechados no momento. Entre em contato pra solicitar acesso.
            </span>
          </div>
        ) : null}

        {justConfirmed ? (
          <div
            role="status"
            className="fade-in-up rounded-[12px] border border-lime/40 bg-lime/10 px-3 py-2 text-xs text-lime"
          >
            ✓ Email confirmado. Agora entre com sua senha.
          </div>
        ) : null}

        <div>
          <label className="label-field" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            type="email"
            required
            className="input-field"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="voce@exemplo.com"
          />
        </div>
        <div>
          <label className="label-field" htmlFor="password">
            Senha
          </label>
          <input
            id="password"
            type="password"
            required
            className="input-field"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
          />
        </div>

        {error ? (
          <div
            key={error.message}
            role="alert"
            className={
              'error-shake rounded-[12px] border px-3.5 py-3 text-xs shadow-[0_0_22px_-8px_rgba(248,113,113,0.6)] ' +
              (error.reason === 'unconfirmed'
                ? 'border-yellow-500/40 bg-yellow-500/10 text-yellow-200'
                : 'border-red-500/40 bg-red-500/10 text-red-300')
            }
          >
            <div className="mb-1 flex items-center gap-2">
              <span
                className="text-[10px] font-bold uppercase tracking-[0.18em]"
                style={{ fontFamily: 'var(--font-tech)' }}
              >
                {reasonLabel(error.reason)}
              </span>
            </div>
            <div className="leading-relaxed">{error.message}</div>

            {/* Ações contextuais */}
            <div className="mt-2.5 flex flex-wrap gap-2">
              {error.canResend ? (
                <button
                  type="button"
                  onClick={handleResend}
                  disabled={resending || !email.trim()}
                  className="rounded-full border border-yellow-500/60 bg-yellow-500/15 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.14em] text-yellow-100 transition hover:bg-yellow-500/25 disabled:opacity-50"
                  style={{ fontFamily: 'var(--font-tech)' }}
                >
                  {resending ? 'Reenviando…' : '↻ Reenviar email de confirmação'}
                </button>
              ) : null}
              {error.ctaHref && error.ctaLabel ? (
                <a
                  href={error.ctaHref}
                  className="rounded-full border border-violet/60 bg-violet/15 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.14em] text-violet-100 transition hover:bg-violet/25"
                  style={{ fontFamily: 'var(--font-tech)' }}
                >
                  {error.ctaLabel} →
                </a>
              ) : null}
              {error.reason === 'wrong_password' ? (
                <span
                  className="text-[10.5px] uppercase tracking-widest text-text-muted/70"
                  style={{ fontFamily: 'var(--font-tech)' }}
                >
                  · Esqueceu? Fale com a gente no WhatsApp pra resetar
                </span>
              ) : null}
            </div>
          </div>
        ) : null}

        {resentMsg ? (
          <div
            role="status"
            className="fade-in-up rounded-[12px] border border-lime/40 bg-lime/10 px-3 py-2 text-xs leading-relaxed text-lime"
          >
            {resentMsg}
          </div>
        ) : null}

        <button type="submit" className="btn-primary" disabled={loading}>
          {loading ? <span className="loading-dots">Entrando</span> : 'Entrar'}
        </button>
      </form>
    </AuthShell>
  );
}

function reasonLabel(reason?: DiagnoseResp['reason']): string {
  switch (reason) {
    case 'not_found':
      return 'Email não cadastrado';
    case 'unconfirmed':
      return 'Email não confirmado';
    case 'banned':
      return 'Conta bloqueada';
    case 'revoked':
      return 'Acesso revogado';
    case 'must_change_password':
      return 'Trocar senha provisória';
    case 'wrong_password':
      return 'Senha incorreta';
    default:
      return 'Não consegui entrar';
  }
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginInner />
    </Suspense>
  );
}
