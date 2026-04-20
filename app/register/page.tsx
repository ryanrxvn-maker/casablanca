'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AuthShell } from '@/components/AuthShell';
import { GoogleButton } from '@/components/GoogleButton';
import { createClient } from '@/lib/supabase/client';

function normalizePhone(input: string): string {
  const digits = input.replace(/\D+/g, '');
  if (!digits) return '';
  if (input.trim().startsWith('+')) return '+' + digits;
  return digits;
}

export default function RegisterPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSignUp(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    if (!name.trim()) {
      setError('Informe seu nome.');
      setLoading(false);
      return;
    }
    if (!phone.trim()) {
      setError('Informe seu telefone.');
      setLoading(false);
      return;
    }

    const supabase = createClient();
    const normalizedPhone = normalizePhone(phone);

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { name, phone: normalizedPhone },
        emailRedirectTo: `${
          process.env.NEXT_PUBLIC_SITE_URL ?? window.location.origin
        }/auth/callback`,
      },
    });
    setLoading(false);

    if (error) {
      setError(error.message);
      return;
    }

    // Se o email confirmation esta desligado no projeto Supabase, ja retorna
    // session. Nesse caso faz o perfil agora e segue pras ferramentas.
    if (data.session && data.user) {
      try {
        await supabase
          .from('profiles')
          .upsert({
            id: data.user.id,
            name: name.trim(),
            whatsapp: normalizedPhone,
          });
      } catch {
        // noop: o trigger pode ter criado o row; update rola no onboarding.
      }
      router.replace('/tools');
      router.refresh();
      return;
    }

    // Caso padrao: Supabase enviou email com codigo OTP. Salvamos nome+phone
    // no sessionStorage para o /verify gravar no profile apos a confirmacao.
    try {
      sessionStorage.setItem(
        'casablanca:pending-signup',
        JSON.stringify({ name: name.trim(), phone: normalizedPhone, email }),
      );
    } catch {
      // noop
    }
    router.push('/verify?email=' + encodeURIComponent(email));
  }

  async function handleGoogle() {
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${
          process.env.NEXT_PUBLIC_SITE_URL ?? window.location.origin
        }/auth/callback`,
      },
    });
    if (error) setError(error.message);
  }

  return (
    <AuthShell
      title="Criar conta"
      subtitle="Comece a usar as ferramentas em minutos"
      footer={
        <>
          Ja tem conta?{' '}
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
          <label className="label-field" htmlFor="phone">
            Telefone / WhatsApp
          </label>
          <input
            id="phone"
            type="tel"
            required
            className="input-field"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+55 11 9 9999-9999"
            autoComplete="tel"
          />
          <p className="mt-1 text-[11px] text-text-muted">
            Usamos para o botao de WhatsApp no seu portfolio publico.
          </p>
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
            autoComplete="email"
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
            placeholder="Minimo 6 caracteres"
            autoComplete="new-password"
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

        <GoogleButton
          onClick={handleGoogle}
          label="Cadastrar com Google"
          disabled={loading}
        />
        <p className="text-center text-[11px] text-text-muted">
          Conta automatica. Sem codigo de confirmacao.
        </p>
      </form>
    </AuthShell>
  );
}
