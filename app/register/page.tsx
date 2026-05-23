'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { AuthShell } from '@/components/AuthShell';
import { createClient } from '@/lib/supabase/client';

/**
 * /register — cadastro público pro tier 'free'.
 *
 * Novos signups recebem tier='free' automaticamente (forçado pelo trigger
 * profiles_protect_tier no banco). Após confirmar o email, podem logar e
 * usar Decupagem (limitado a áudio). Pra acesso completo, precisam ser
 * promovidos pra 'beta' pelo admin.
 */
export default function RegisterPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
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
      const { data, error: signUpErr } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { name: name.trim() || null },
          emailRedirectTo:
            typeof window !== 'undefined'
              ? `${window.location.origin}/auth/callback`
              : undefined,
        },
      });
      if (signUpErr) {
        setError(signUpErr.message);
        return;
      }

      // Garante o profile (compatibilidade — trigger SQL deve criar, mas
      // alguns projetos não têm o handle_new_user, fazemos aqui também)
      if (data.user?.id) {
        try {
          await supabase.from('profiles').upsert({
            id: data.user.id,
            name: name.trim() || null,
          });
        } catch {
          /* ignora — RLS pode bloquear, mas se trigger SQL criar, ok */
        }
      }

      setDone(true);
    } catch (e) {
      setError((e as Error).message ?? 'Falha ao criar conta.');
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return (
      <AuthShell
        title="Conta criada"
        subtitle="Confirme o email pra entrar."
        footer={
          <Link href="/login" className="text-violet hover:text-white">
            Ir pro login →
          </Link>
        }
      >
        <div className="rounded-[12px] border border-violet/40 bg-violet/10 px-4 py-3 text-sm text-violet">
          <p className="font-semibold">Enviamos um link de confirmação.</p>
          <p className="mt-1 text-text-muted">
            Clica no link do email pra ativar a conta. Depois é só fazer login.
          </p>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Criar conta"
      subtitle="Liga a fila e vai dormir."
      footer={
        <span className="text-text-muted">
          Já tem conta?{' '}
          <Link href="/login" className="text-violet hover:text-white">
            Entrar
          </Link>
        </span>
      }
    >
      <form onSubmit={handleSignup} className="flex flex-col gap-4">
        <div>
          <label className="label-field" htmlFor="name">
            Nome
          </label>
          <input
            id="name"
            type="text"
            className="input-field"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Como te chamamos"
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

        <div>
          <label className="label-field" htmlFor="confirm">
            Confirmar senha
          </label>
          <input
            id="confirm"
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

        <button type="submit" className="btn-primary" disabled={loading}>
          {loading ? <span className="loading-dots">Criando</span> : 'Criar conta'}
        </button>

        <p className="mt-2 text-[11.5px] leading-relaxed text-text-muted">
          A conta grátis libera a Decupagem de áudio. Pra acessar o resto, fale com o time.
        </p>
      </form>
    </AuthShell>
  );
}
