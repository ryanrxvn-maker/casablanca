'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { AuthShell } from '@/components/AuthShell';

/**
 * /forgot-password — esqueci a senha.
 *
 * 1. User digita o email
 * 2. Dispara /api/auth/forgot-password → Supabase manda código por email
 * 3. Redireciona pra /reset-password?email=... onde digita código + senha nova
 */
export default function ForgotPasswordPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const clean = email.trim().toLowerCase();
    if (!/.+@.+\..+/.test(clean)) {
      setError('Informe um email válido.');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: clean }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) {
        setError(json.error || 'Não consegui enviar o código.');
        return;
      }
      router.replace(`/reset-password?email=${encodeURIComponent(clean)}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell
      title="Esqueci a senha"
      subtitle="Te mandamos um código por email pra você criar uma senha nova."
      footer={
        <span className="text-text-muted">
          Lembrou?{' '}
          <Link href="/login" className="text-violet hover:text-white">
            Voltar pro login
          </Link>
        </span>
      }
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div>
          <label className="label-field" htmlFor="email">
            Email do cadastro
          </label>
          <input
            id="email"
            type="email"
            required
            autoFocus
            className="input-field"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="voce@exemplo.com"
          />
          <p className="mt-1.5 text-[11px] text-text-muted">
            Confere se é o mesmo email do cadastro. O código chega em até 1 min.
          </p>
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

        <button type="submit" className="btn-primary" disabled={loading}>
          {loading ? <span className="loading-dots">Enviando</span> : 'Enviar código'}
        </button>
      </form>
    </AuthShell>
  );
}
