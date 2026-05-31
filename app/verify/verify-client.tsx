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
  // Cooldown do reenvio (Supabase limita o intervalo). Começa contando se o
  // usuário chegou do cadastro (um código acabou de ser enviado).
  const [cooldown, setCooldown] = useState<number>(() =>
    params.get('email') ? 60 : 0,
  );
  const refs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    refs.current[0]?.focus();
  }, []);

  // Contador regressivo do reenvio.
  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

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
    // 'signup' = token do email "Confirm signup". Se a conta já existia e
    // o código veio de um reenvio de confirmação, 'signup' também resolve.
    const { data, error: vErr } = await supabase.auth.verifyOtp({
      email,
      token,
      type: 'signup',
    });
    if (vErr) {
      setLoading(false);
      setError(traduzErro(vErr.message));
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
    if (cooldown > 0 || resending) return;
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
      const msg = rErr.message || '';
      const sec = msg.match(/after (\d+)\s*seconds?/i);
      if (sec) {
        setCooldown(parseInt(sec[1], 10));
        setError(`Aguarde ${sec[1]}s pra reenviar o código.`);
      } else {
        setError(traduzErro(msg));
      }
      return;
    }
    setCooldown(60);
    setResentMsg('Novo código enviado. Confira seu email (e o spam).');
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
                className={
                  'mono h-14 w-full rounded-[12px] border bg-bg text-center text-2xl font-bold transition-all duration-200 focus:scale-[1.04] focus:border-lime focus:outline-none focus:shadow-[0_0_22px_-6px_rgba(200,232,124,0.65),0_0_0_3px_rgba(200,232,124,0.18)] ' +
                  (d
                    ? 'border-lime/60 text-lime'
                    : 'border-line-strong text-white')
                }
                aria-label={'Digito ' + (i + 1)}
              />
            ))}
          </div>
        </div>

        {error && (
          <div
            key={error}
            role="alert"
            className="error-shake rounded-[12px] border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300 shadow-[0_0_22px_-8px_rgba(248,113,113,0.6)]"
          >
            {error}
          </div>
        )}
        {resentMsg && (
          <div
            key={resentMsg}
            role="status"
            className="fade-in-up flex items-center gap-2 rounded-[12px] border border-lime/40 bg-lime/10 px-3 py-2 text-xs text-lime shadow-[0_0_22px_-8px_rgba(200,232,124,0.5)]"
          >
            <span className="relative flex h-2 w-2 shrink-0">
              <span className="absolute inline-flex h-full w-full animate-pulse-soft rounded-full bg-lime opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-lime shadow-[0_0_8px_rgba(200,232,124,0.9)]" />
            </span>
            {resentMsg}
          </div>
        )}

        <button type="submit" className="btn-primary" disabled={loading}>
          {loading ? 'Validando...' : 'Confirmar'}
        </button>

        <button
          type="button"
          onClick={handleResend}
          disabled={resending || cooldown > 0}
          className="btn-ghost text-xs"
        >
          {resending
            ? 'Reenviando...'
            : cooldown > 0
              ? `Reenviar em ${cooldown}s`
              : 'Reenviar código'}
        </button>
      </form>
    </AuthShell>
  );
}

/** Traduz mensagens de erro do Supabase pra PT-BR amigável. */
function traduzErro(msg: string): string {
  const m = (msg || '').toLowerCase();
  if (m.includes('expired'))
    return 'Código expirado. Clique em "Reenviar código" pra receber um novo.';
  if (m.includes('invalid') || m.includes('incorrect') || m.includes('token'))
    return 'Código inválido. Confira os 6 dígitos e tente de novo.';
  if (m.includes('seconds') || m.includes('rate'))
    return 'Muitas tentativas. Aguarde um instante e tente de novo.';
  if (m.includes('not found') || m.includes('no user'))
    return 'Não encontramos uma conta com esse email.';
  return msg || 'Não foi possível validar o código.';
}
