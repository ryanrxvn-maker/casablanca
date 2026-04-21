'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AuthShell } from '@/components/AuthShell';
import { GoogleButton } from '@/components/GoogleButton';
import { createClient } from '@/lib/supabase/client';

export default function LoginPage() {
  const router = useRouter();
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

  async function handleGoogleLogin() {
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL ?? window.location.origin}/auth/callback`,
      },
    });
    if (error) setError(error.message);
  }

  return (
    <AuthShell
      title="Entrar"
      subtitle="Acesse sua conta DARKO LAB"
      footer={
        <>
          Ainda não tem conta?{' '}
          <Link href="/register" className="text-lime hover:underline">
            Criar conta
          </Link>
        </>
      }
    >
      <form onSubmit={handleEmailLogin} className="flex flex-col gap-4">
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
          <div className="rounded-[12px] border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">
            {error}
          </div>
        )}

        <button type="submit" className="btn-primary" disabled={loading}>
          {loading ? 'Entrando...' : 'Entrar'}
        </button>

        <div className="relative my-2 flex items-center">
          <div className="flex-1 border-t border-line" />
          <span className="px-3 text-xs uppercase tracking-widest text-text-dim">
            ou
          </span>
          <div className="flex-1 border-t border-line" />
        </div>

        <GoogleButton onClick={handleGoogleLogin} disabled={loading} />

        <div className="text-center">
          <Link
            href="/forgot-password"
            className="text-xs text-text-muted hover:text-white"
          >
            Esqueci minha senha
          </Link>
        </div>
      </form>
    </AuthShell>
  );
}
