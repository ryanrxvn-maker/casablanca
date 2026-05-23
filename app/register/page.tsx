'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { AuthShell } from '@/components/AuthShell';
import { createClient } from '@/lib/supabase/client';

/**
 * /register — cadastro público pro tier 'free'.
 *
 * Após signup: usuário recebe link de confirmação por email + é
 * redirecionado pra /verify-phone (envia código SMS pro telefone).
 */
export default function RegisterPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function normalizePhone(raw: string): string {
    // Tira tudo que não é dígito, deixa só BR (+55) por padrão se não
    // tiver código de país.
    const digits = raw.replace(/\D/g, '');
    if (!digits) return '';
    if (digits.startsWith('55')) return '+' + digits;
    if (digits.length >= 10 && digits.length <= 11) return '+55' + digits;
    return '+' + digits;
  }

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    // SMS opcional: telefone só é OBRIGATÓRIO se SMS_REQUIRED estiver ativo.
    // Caso contrário, aceita qualquer string (incluindo vazia).
    const smsRequired = process.env.NEXT_PUBLIC_SMS_REQUIRED === '1';
    const phoneNorm = phone ? normalizePhone(phone) : '';
    if (smsRequired && (!phoneNorm || phoneNorm.length < 12)) {
      setError('Telefone inválido. Use o formato (xx) 9xxxx-xxxx.');
      return;
    }
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
      // Prefere NEXT_PUBLIC_SITE_URL (canônico) — evita link apontando
      // pra preview deployment se o user testou em URL diferente. Cai
      // pra origin atual se a env var não estiver setada.
      const siteUrl =
        process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '') ||
        (typeof window !== 'undefined' ? window.location.origin : '');
      const { data, error: signUpErr } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { name: name.trim() || null, phone: phoneNorm },
          // /auth/callback aceita tanto code (PKCE) quanto token_hash —
          // funciona com qualquer template de email que o user
          // configurar no Supabase Dashboard.
          emailRedirectTo: siteUrl ? `${siteUrl}/auth/callback` : undefined,
        },
      });
      if (signUpErr) {
        setError(signUpErr.message);
        return;
      }

      // Cria profile com phone (server-side ou client)
      if (data.user?.id) {
        try {
          await supabase.from('profiles').upsert({
            id: data.user.id,
            name: name.trim() || null,
            phone: phoneNorm,
          });
        } catch {
          /* ignora; pode haver trigger SQL */
        }
      }

      // SMS opcional: NEXT_PUBLIC_SMS_REQUIRED=1 reativa o flow SMS.
      // Por padrão, signup vai direto pra /tools sem código por SMS
      // (até Twilio estar configurado).
      const smsRequired = process.env.NEXT_PUBLIC_SMS_REQUIRED === '1';

      if (smsRequired && data.user?.id) {
        try {
          await fetch('/api/auth/sms/send-code', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ phone: phoneNorm }),
          });
        } catch {}
        router.replace(`/verify-phone?phone=${encodeURIComponent(phoneNorm)}`);
        return;
      }

      // Sem SMS: vai direto pras ferramentas
      router.replace('/tools');
      router.refresh();
    } catch (e) {
      setError((e as Error).message ?? 'Falha ao criar conta.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell
      title="Criar conta grátis"
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
          <label className="label-field" htmlFor="phone">
            Telefone <span className="text-text-muted">(opcional)</span>
          </label>
          <input
            id="phone"
            type="tel"
            className="input-field"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="(11) 98765-4321"
          />
          <p className="mt-1.5 text-[11px] text-text-muted">
            Pra suporte por WhatsApp se precisar.
          </p>
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
      </form>
    </AuthShell>
  );
}
