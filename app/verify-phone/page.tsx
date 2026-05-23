'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { AuthShell } from '@/components/AuthShell';
import { createClient } from '@/lib/supabase/client';

function VerifyPhoneInner() {
  const router = useRouter();
  const params = useSearchParams();
  const phone = params.get('phone') || '';
  const [code, setCode] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [resendCooldown, setResendCooldown] = useState(30);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = setTimeout(() => setResendCooldown((v) => v - 1), 1000);
    return () => clearTimeout(t);
  }, [resendCooldown]);

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setVerifying(true);
    try {
      const res = await fetch('/api/auth/sms/verify-code', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) {
        setError(json.error || 'Não foi possível confirmar.');
        return;
      }
      setInfo('Telefone confirmado!');
      setTimeout(() => router.replace('/tools'), 800);
    } finally {
      setVerifying(false);
    }
  }

  async function resend() {
    setResending(true);
    setError(null);
    setInfo(null);
    try {
      const res = await fetch('/api/auth/sms/send-code', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ phone }),
      });
      const json = (await res.json()) as { throttled?: boolean; message?: string };
      if (json.throttled) {
        setError(json.message || 'Aguarde antes de pedir outro.');
      } else {
        setInfo('Código reenviado. Confere o SMS.');
        setResendCooldown(30);
      }
    } finally {
      setResending(false);
    }
  }

  const mask = (raw: string) => {
    // Mostra só os últimos 4 dígitos
    const d = raw.replace(/\D/g, '');
    if (d.length < 4) return raw;
    return '••• ••' + d.slice(-4);
  };

  async function handleLogout() {
    try {
      const supabase = createClient();
      await supabase.auth.signOut();
    } catch {}
    router.replace('/login');
    router.refresh();
  }

  return (
    <AuthShell
      title="Confirme o telefone"
      subtitle={phone ? `Mandamos um código pra ${mask(phone)}.` : 'Mandamos um código por SMS.'}
      footer={
        <div className="flex flex-col gap-2 text-text-muted">
          <span>
            Errou o número?{' '}
            <Link href="/register" className="text-violet hover:text-white">
              Voltar pro cadastro
            </Link>
          </span>
          <span className="text-[11px]">
            Faço isso depois —{' '}
            <button
              type="button"
              onClick={handleLogout}
              className="text-violet hover:text-white underline"
            >
              sair e voltar pro login
            </button>
          </span>
        </div>
      }
    >
      {/* Barra de fuga: home + voltar + sair — usuário NUNCA fica trancado */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Link
          href="/"
          className="mono inline-flex items-center gap-1.5 rounded-full border border-line-strong px-3 py-1.5 text-[10.5px] uppercase tracking-widest text-text-muted transition hover:border-violet hover:text-violet"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
            <polyline points="9 22 9 12 15 12 15 22" />
          </svg>
          Início
        </Link>
        <button
          type="button"
          onClick={() => router.back()}
          className="mono inline-flex items-center gap-1.5 rounded-full border border-line-strong px-3 py-1.5 text-[10.5px] uppercase tracking-widest text-text-muted transition hover:border-violet hover:text-violet"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M19 12H5" />
            <polyline points="12 19 5 12 12 5" />
          </svg>
          Voltar
        </button>
        <button
          type="button"
          onClick={handleLogout}
          className="mono ml-auto inline-flex items-center gap-1.5 rounded-full border border-red-500/40 bg-red-500/5 px-3 py-1.5 text-[10.5px] uppercase tracking-widest text-red-300 transition hover:bg-red-500/15"
        >
          Sair
        </button>
      </div>

      <form onSubmit={verify} className="flex flex-col gap-4">
        <div>
          <label className="label-field" htmlFor="code">
            Código de 6 dígitos
          </label>
          <input
            id="code"
            type="tel"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            required
            className="input-field text-center"
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '22px',
              letterSpacing: '0.4em',
            }}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="••••••"
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
            className="rounded-[12px] border border-violet/40 bg-violet/10 px-3 py-2 text-xs text-violet"
          >
            {info}
          </div>
        ) : null}

        <button
          type="submit"
          className="btn-primary"
          disabled={verifying || code.length !== 6}
        >
          {verifying ? <span className="loading-dots">Verificando</span> : 'Confirmar'}
        </button>

        <button
          type="button"
          onClick={resend}
          disabled={resending || resendCooldown > 0}
          className="btn-secondary"
        >
          {resending
            ? 'Reenviando…'
            : resendCooldown > 0
              ? `Reenviar em ${resendCooldown}s`
              : 'Reenviar código'}
        </button>
      </form>
    </AuthShell>
  );
}

export default function VerifyPhonePage() {
  return (
    <Suspense fallback={null}>
      <VerifyPhoneInner />
    </Suspense>
  );
}
