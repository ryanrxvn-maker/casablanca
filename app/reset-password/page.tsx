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
  const refs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    refs.current[0]?.focus();
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
    if (!email.trim()) {
      setError('Informe seu email.');
      return;
    }
    if (token.length !== 6) {
      setError('Digite o código completo de 6 dígitos.');
      return;
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

      // 1) Valida o código de recovery — estabelece sessão temporária
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

      // 2) Atualiza a senha com a sessão recém-estabelecida
      const { error: uErr } = await supabase.auth.updateUser({
        password,
      });

      if (uErr) {
        setError(uErr.message);
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
      subtitle="Digite o código que chegou no email e escolha uma senha nova."
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

        <button
          type="button"
          onClick={handleResend}
          disabled={resending}
          className="btn-ghost text-xs"
        >
          {resending ? 'Reenviando…' : 'Não chegou? Reenviar código'}
        </button>
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
