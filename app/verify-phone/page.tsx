'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AuthShell } from '@/components/AuthShell';

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

  return (
    <AuthShell
      title="Confirme o telefone"
      subtitle={phone ? `Mandamos um código pra ${mask(phone)}.` : 'Mandamos um código por SMS.'}
      footer={
        <span className="text-text-muted">
          Errou o número?{' '}
          <a href="/register" className="text-violet hover:text-white">
            Voltar
          </a>
        </span>
      }
    >
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
