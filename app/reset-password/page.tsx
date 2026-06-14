'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { AuthShell } from '@/components/AuthShell';
import { createClient } from '@/lib/supabase/client';

/**
 * /reset-password — digite o código de 6 dígitos que chegou por email
 * e a nova senha. Valida o código (type: 'recovery') → atualiza senha
 * via updateUser → redireciona pra /tools.
 */
function ResetPasswordInner() {
  const router = useRouter();
  const params = useSearchParams();
  const emailFromQuery = params.get('email') ?? '';

  const [email, setEmail] = useState(emailFromQuery);
  const [digits, setDigits] = useState<string[]>(Array(6).fill(''));
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  // recoveryMode = o usuário chegou clicando no LINK do email (sessão de
  // recovery já estabelecida pelo Supabase). Nesse caso NÃO precisa digitar
  // código — é só criar a senha nova. Garante que o reset funciona TANTO pelo
  // link (template padrão) QUANTO pelo código de 6 dígitos (template custom).
  const [recoveryMode, setRecoveryMode] = useState(false);
  const refs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    refs.current[0]?.focus();
  }, []);

  useEffect(() => {
    const supabase = createClient();
    // Backup síncrono: se a URL traz o token do link, já entra em recoveryMode
    // (cobre corrida com o processamento async da sessão).
    if (
      typeof window !== 'undefined' &&
      /type=recovery|access_token=|[?&]code=/.test(
        window.location.hash + window.location.search,
      )
    ) {
      setRecoveryMode(true);
    }
    // Evento oficial do Supabase ao detectar o link de recovery na URL.
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') setRecoveryMode(true);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  function setDigit(idx: number, v: string) {
    const clean = v.replace(/\D/g, '').slice(0, 1);
    setDigits((prev) => {
      const next = [...prev];
      next[idx] = clean;
      return next;
    });
    if (clean && idx < 5) refs.current[idx + 1]?.focus();
  }

  function onKey(idx: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace' && !digits[idx] && idx > 0) {
      refs.current[idx - 1]?.focus();
    }
  }

  function onPaste(e: React.ClipboardEvent<HTMLInputElement>) {
    const text = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (text.length < 2) return;
    e.preventDefault();
    const arr = Array(6).fill('');
    for (let i = 0; i < text.length; i++) arr[i] = text[i];
    setDigits(arr);
    refs.current[Math.min(text.length, 5)]?.focus();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);

    const token = digits.join('');
    // No modo link (recoveryMode) a sessão já existe — não exige email/código.
    if (!recoveryMode) {
      if (!email.trim()) {
        setError('Informe seu email.');
        return;
      }
      if (token.length !== 6) {
        setError('Digite o código completo de 6 dígitos.');
        return;
      }
    }
    if (password.length < 6) {
      setError('A senha precisa ter ao menos 6 caracteres.');
      return;
    }
    if (password !== confirm) {
      setError('As senhas não coincidem.');
      return;
    }

    setLoading(true);
    try {
      const supabase = createClient();

      // 1) Se veio pelo CÓDIGO, valida o OTP de recovery (estabelece sessão).
      //    Se veio pelo LINK, a sessão de recovery já está ativa — pula direto.
      if (!recoveryMode) {
        const { error: vErr } = await supabase.auth.verifyOtp({
          email: email.trim().toLowerCase(),
          token,
          type: 'recovery',
        });

        if (vErr) {
          setError(
            /invalid|expired/i.test(vErr.message)
              ? 'Código inválido ou expirado. Peça um novo abaixo.'
              : vErr.message,
          );
          return;
        }
      }

      // 2) Atualiza a senha com a sessão de recovery (do código ou do link).
      const { error: uErr } = await supabase.auth.updateUser({
        password,
      });

      if (uErr) {
        setError(
          /Auth session missing|session/i.test(uErr.message)
            ? 'Link expirado ou já usado. Peça um novo email abaixo.'
            : uErr.message,
        );
        return;
      }

      setInfo('Senha redefinida. Entrando…');
      setTimeout(() => {
        router.replace('/tools');
        router.refresh();
      }, 600);
    } catch (e) {
      setError((e as Error)?.message ?? 'Falha ao redefinir senha.');
    } finally {
      setLoading(false);
    }
  }

  async function handleResend() {
    setError(null);
    setInfo(null);
    if (!email.trim()) {
      setError('Informe seu email.');
      return;
    }
    setResending(true);
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) {
        setError(json.error || 'Falha ao reenviar.');
        return;
      }
      setInfo('Novo código enviado. Confira o email.');
    } finally {
      setResending(false);
    }
  }

  return (
    <AuthShell
      title="Redefinir senha"
      subtitle={
        recoveryMode
          ? 'Escolha uma senha nova pra sua conta.'
          : 'Digite o código que chegou no email e escolha uma senha nova.'
      }
      footer={
        <span className="text-text-muted">
          Mudou de ideia?{' '}
          <Link href="/login" className="text-violet hover:text-white">
            Voltar pro login
          </Link>
        </span>
      }
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {recoveryMode ? (
          <div
            role="status"
            className="rounded-[12px] border border-lime/40 bg-lime/10 px-3 py-2 text-xs text-lime"
          >
            ✓ Link verificado. Agora é só criar a sua senha nova abaixo.
          </div>
        ) : null}

        {!recoveryMode && (
        <div>
          <label className="label-field" htmlFor="reset-email">
            Email
          </label>
          <input
            id="reset-email"
            type="email"
            required
            className="input-field"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="voce@exemplo.com"
            readOnly={!!emailFromQuery}
          />
        </div>
        )}

        {!recoveryMode && (
        <div>
          <label className="label-field">Código de 6 dígitos</label>
          <div className="flex justify-between gap-2">
            {digits.map((d, i) => (
              <input
                key={i}
                ref={(el) => {
                  refs.current[i] = el;
                }}
                value={d}
                onChange={(e) => setDigit(i, e.target.value)}
                onKeyDown={(e) => onKey(i, e)}
                onPaste={onPaste}
                inputMode="numeric"
                maxLength={1}
                className={
                  'mono h-14 w-full rounded-[12px] border bg-bg text-center text-2xl font-bold transition-all duration-200 focus:scale-[1.04] focus:border-violet focus:outline-none focus:shadow-[0_0_22px_-6px_rgba(167,139,250,0.65),0_0_0_3px_rgba(167,139,250,0.18)] ' +
                  (d
                    ? 'border-violet/60 text-violet'
                    : 'border-line-strong text-white')
                }
                aria-label={'Dígito ' + (i + 1)}
              />
            ))}
          </div>
        </div>
        )}

        <div>
          <label className="label-field" htmlFor="new-password">
            Senha nova
          </label>
          <input
            id="new-password"
            type="password"
            required
            minLength={6}
            className="input-field"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Mínimo 6 caracteres"
          />
        </div>

        <div>
          <label className="label-field" htmlFor="confirm-password">
            Confirmar senha
          </label>
          <input
            id="confirm-password"
            type="password"
            required
            minLength={6}
            className="input-field"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="Repete a senha"
          />
        </div>

        {error ? (
          <div
            key={error}
            role="alert"
            className="error-shake rounded-[12px] border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300"
          >
            {error}
          </div>
        ) : null}
        {info ? (
          <div
            role="status"
            className="rounded-[12px] border border-lime/40 bg-lime/10 px-3 py-2 text-xs text-lime"
          >
            {info}
          </div>
        ) : null}

        <button type="submit" className="btn-primary" disabled={loading}>
          {loading ? (
            <span className="loading-dots">Redefinindo</span>
          ) : (
            'Redefinir senha e entrar'
          )}
        </button>

        {!recoveryMode && (
          <button
            type="button"
            onClick={handleResend}
            disabled={resending}
            className="btn-ghost text-xs"
          >
            {resending ? 'Reenviando…' : 'Não chegou? Reenviar código'}
          </button>
        )}
      </form>
    </AuthShell>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordInner />
    </Suspense>
  );
}
