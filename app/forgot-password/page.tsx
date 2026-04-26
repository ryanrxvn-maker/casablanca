'use client';

import { useState } from 'react';
import Link from 'next/link';
import { AuthShell } from '@/components/AuthShell';
import { createClient } from '@/lib/supabase/client';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function handleReset(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL ?? window.location.origin}/auth/callback?next=/tools`,
    });
    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    setSent(true);
  }

  if (sent) {
    return (
      <AuthShell title="Enviado!" subtitle="Verifique sua caixa de entrada">
        <p className="text-sm text-text-muted">
          Se existir uma conta com <b className="text-white">{email}</b>, você
          receberá um link para redefinir a senha.
        </p>
        <Link href="/login" className="btn-secondary mt-6 w-full">
          Voltar para o login
        </Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Recuperar senha"
      subtitle="Enviaremos um link de redefinição para o seu e-mail"
      footer={
        <>
          Lembrou?{' '}
          <Link href="/login" className="text-lime hover:underline">
            Entrar
          </Link>
        </>
      }
    >
      <form onSubmit={handleReset} className="flex flex-col gap-4">
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
        {error && (
          <div
            key={error}
            role="alert"
            className="error-shake rounded-[12px] border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300 shadow-[0_0_22px_-8px_rgba(248,113,113,0.6)]"
          >
            {error}
          </div>
        )}
        <button type="submit" className="btn-primary" disabled={loading}>
          {loading ? 'Enviando...' : 'Enviar link'}
        </button>
      </form>
    </AuthShell>
  );
}
