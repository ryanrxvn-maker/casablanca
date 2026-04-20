'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { AuthShell } from '@/components/AuthShell';
import { createClient } from '@/lib/supabase/client';

/**
 * Verificacao por codigo OTP (6 digitos numericos) enviado por email.
 *
 * Importante: pre-requisito no Supabase Dashboard -> Authentication -> Email
 * Templates "Confirm signup" precisa conter {{ .Token }} no lugar do
 * {{ .ConfirmationURL }} pra que o codigo chegue em vez do link magico.
 */
export default function VerifyClient() {
  const router = useRouter();
  const params = useSearchParams();
  const emailFromQuery = params.get('email') ?? '';
  const [email, setEmail] = useState(emailFromQuery);
  const [digits, setDigits] = useState<string[]>(Array(6).fill(''));
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [resentMsg, setResentMsg] = useState<string | null>(null);
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

  async function handleVerify(e?: React.FormEvent) {
    e?.preventDefault();
    setError(null);
    const token = digits.join('');
    if (!email) {
      setError('Informe seu email.');
      return;
    }
    if (token.length !== 6) {
      setError('Digite o codigo completo de 6 digitos.');
      return;
    }
    setLoading(true);
    const supabase = createClient();
    const { data, error: vErr } = await supabase.auth.verifyOtp({
      email,
      token,
      type: 'email',
    });
    if (vErr) {
      setLoading(false);
      setError(vErr.message);
      return;
    }

    // Sucesso: grava o profile com nome + phone que guardamos no signup.
    try {
      if (data.user) {
        let name: string | undefined;
        let phone: string | undefined;
        try {
          const raw = sessionStorage.getItem('casablanca:pending-signup');
          if (raw) {
            const parsed = JSON.parse(raw) as {
              name?: string;
              phone?: string;
            };
            name = parsed.name;
            phone = parsed.phone;
          }
        } catch {
          // noop
        }
        name = name ?? (data.user.user_metadata?.name as string | undefined);
        phone = phone ?? (data.user.user_metadata?.phone as string | undefined);
        await supabase.from('profiles').upsert({
          id: data.user.id,
          name: name ?? null,
          whatsapp: phone ?? null,
        });
        try {
          sessionStorage.removeItem('casablanca:pending-signup');
        } catch {
          // noop
        }
      }
    } catch {
      // nao bloqueia login se o upsert falhar, usuario conserta depois
    }

    setLoading(false);
    router.replace('/tools');
    router.refresh();
  }

  async function handleResend() {
    setError(null);
    setResentMsg(null);
    if (!email) {
      setError('Informe seu email.');
      return;
    }
    setResending(true);
    const supabase = createClient();
    const { error: rErr } = await supabase.auth.resend({
      type: 'signup',
      email,
    });
    setResending(false);
    if (rErr) {
      setError(rErr.message);
      return;
    }
    setResentMsg('Novo codigo enviado. Verifique seu email.');
  }

  return (
    <AuthShell
      title="Confirme seu email"
      subtitle="Digite o codigo de 6 digitos que enviamos"
      footer={
        <>
          Email errado?{' '}
          <Link href="/register" className="text-lime hover:underline">
            Voltar pro cadastro
          </Link>
        </>
      }
    >
      <form onSubmit={handleVerify} className="flex flex-col gap-4">
        <div>
          <label className="label-field" htmlFor="verify-email">
            Email
          </label>
          <input
            id="verify-email"
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
          <label className="label-field">Codigo</label>
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
                className="mono h-14 w-full rounded-[12px] border border-line-strong bg-bg text-center text-2xl font-bold text-white focus:border-lime focus:outline-none"
                aria-label={'Digito ' + (i + 1)}
              />
            ))}
          </div>
        </div>

        {error && (
          <div className="rounded-[12px] border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">
            {error}
          </div>
        )}
        {resentMsg && (
          <div className="rounded-[12px] border border-lime/40 bg-lime/10 px-3 py-2 text-xs text-lime">
            {resentMsg}
          </div>
        )}

        <button type="submit" className="btn-primary" disabled={loading}>
          {loading ? 'Validando...' : 'Confirmar'}
        </button>

        <button
          type="button"
          onClick={handleResend}
          disabled={resending}
          className="btn-ghost text-xs"
        >
          {resending ? 'Reenviando...' : 'Reenviar codigo'}
        </button>
      </form>
    </AuthShell>
  );
}
