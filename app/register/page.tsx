'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AuthShell } from '@/components/AuthShell';
import { createClient } from '@/lib/supabase/client';

export default function RegisterPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function handleSignUp(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { name },
        emailRedirectTo: `${process.env.NEXT_PUBLIC_SITE_URL ?? window.location.origin}/auth/callback`,
      },
    });
    setLoading(false);

    if (error) {
      setError(error.message);
      return;
    }

    // Se e-mail de confirmação está desativado, Supabase retorna user + session e podemos entrar direto
    if (data.session) {
      router.replace('/tools');
      router.refresh();
    } else {
      setSuccess(true);
    }
  }

  async function handleGoogle() {
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

  if (success) {
    return (
      <AuthShell title="Verifique seu e-mail">
        <p className="text-sm text-text-muted">
          Enviamos um link de confirmação para <b className="text-white">{email}</b>.
          Clique nele para ativar sua conta.
        </p>
        <Link href="/login" className="btn-secondary mt-6 w-full">
          Voltar para o login
        </Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Criar conta"
      subtitle="Comece a usar as ferramentas em minutos"
      footer={
        <>
          Já tem conta?{' '}
          <Link href="/login" className="text-lime hover:underline">
            Entrar
          </Link>
        </>
      }
    >
      <form onSubmit={handleSignUp} className="flex flex-col gap-4">
        <div>
          <label className="label-field" htmlFor="name">
            Nome
          </label>
          <input
            id="name"
            type="text"
            required
            className="input-field"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Seu nome"
          />
        </div>
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
            minLength={6}
            className="input-field"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Mínimo 6 caracteres"
          />
        </div>

        {error && (
          <div className="rounded-[12px] border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">
            {error}
          </div>
        )}

        <button type="submit" className="btn-primary" disabled={loading}>
          {loading ? 'Criando...' : 'Criar conta'}
        </button>

        <div className="relative my-2 flex items-center">
          <div className="flex-1 border-t border-line" />
          <span className="px-3 text-xs uppercase tracking-widest text-text-dim">
            ou
          </span>
          <div className="flex-1 border-t border-line" />
        </div>

        <button type="button" onClick={handleGoogle} className="btn-secondary">
          Continuar com Google
        </button>
      </form>
    </AuthShell>
  );
}
