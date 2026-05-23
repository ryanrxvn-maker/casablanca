'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AuthShell } from '@/components/AuthShell';
import { createClient } from '@/lib/supabase/client';

function LoginInner() {
  const router = useRouter();
  const params = useSearchParams();
  const betaClosed = params.get('beta') === 'closed';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleEmailLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    router.replace('/tools');
    router.refresh();
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
          {loading ? <span className="loading-dots">Entrando</span> : 'Entrar'}
        </button>
      </form>
    </AuthShell>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginInner />
    </Suspense>
  );
}
