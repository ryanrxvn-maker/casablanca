'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { AuthShell } from '@/components/AuthShell';
import { createClient } from '@/lib/supabase/client';
import { isDisposableEmail } from '@/lib/disposable-email';

/** Campo de senha com olhinho — mesmo comportamento do /login. */
function PasswordField({
  id,
  label,
  value,
  onChange,
  placeholder,
  show,
  onToggle,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  show: boolean;
  onToggle: () => void;
}) {
  return (
    <div>
      <label className="label-field" htmlFor={id}>
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type={show ? 'text' : 'password'}
          required
          minLength={6}
          className="input-field !pr-11"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
        />
        <button
          type="button"
          onClick={onToggle}
          aria-label={show ? 'Ocultar senha' : 'Mostrar senha'}
          title={show ? 'Ocultar senha' : 'Mostrar senha'}
          className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1.5 text-text-dim transition-colors hover:text-white"
        >
          {show ? (
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
              <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
              <path d="M14.12 14.12A3 3 0 1 1 9.88 9.88" />
              <path d="M1 1l22 22" />
            </svg>
          ) : (
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          )}
        </button>
      </div>
    </div>
  );
}

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
  // Olhinho por campo — quem confere a senha que digitou erra menos, e erro
  // de senha aqui só aparece depois, na hora de entrar.
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Email já cadastrado: em vez de mandar pra tela de código (email que nunca
  // vem), mostra os caminhos de saída — entrar ou recuperar a senha.
  const [alreadyExists, setAlreadyExists] = useState(false);

  /**
   * Valida o endereço de verdade — o `type="email"` do browser aceita coisa
   * que nenhum servidor de email entrega. Caso real em produção: alguém
   * copiou o endereço MASCARADO ("gu***@gmail.com") de uma tela de
   * recuperação e se cadastrou com ele. O Supabase aceitou, o Resend mandou,
   * deu hard bounce e o endereço entrou na lista de supressão — a partir daí
   * NENHUM email chega, e a conta fica presa pra sempre.
   */
  function isRealEmail(v: string): boolean {
    if (/[*\s(),<>[\]\\;:"]/.test(v)) return false; // mascarado ou colado torto
    if (v.includes('..') || v.startsWith('.') || v.endsWith('.')) return false;
    const [local, domain, ...rest] = v.split('@');
    if (rest.length || !local || !domain) return false;
    if (!/^[a-z0-9._%+-]+$/.test(local)) return false;
    return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain);
  }

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
    setAlreadyExists(false);
    // Email SEMPRE normalizado (igual ao /login). Sem isso, " Fulano@Gmail.com "
    // vira uma conta diferente da que o usuário tenta confirmar depois.
    const cleanEmail = email.trim().toLowerCase();
    if (!isRealEmail(cleanEmail)) {
      setError(
        'Esse email não parece válido. Digite o endereço completo, sem asteriscos nem espaços (ex: voce@gmail.com).',
      );
      return;
    }
    // Descartável (mailinator/tempmail/etc): quem barra de verdade é o trigger
    // no banco (migration 030) — o cadastro vai do browser direto pro Supabase,
    // então checagem só aqui não impede ninguém. Este check existe pra pessoa
    // ver o motivo claro em vez do erro genérico do banco.
    if (isDisposableEmail(cleanEmail)) {
      setError(
        'Não aceitamos email temporário/descartável. Use seu email de verdade (Gmail, Outlook, o da sua empresa) — é pra lá que vai o código de confirmação e o acesso.',
      );
      return;
    }
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
    if (!agreed) {
      setError('Você precisa aceitar os Termos de Uso e a Política pra continuar.');
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
        email: cleanEmail,
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

      // ── Email JÁ CADASTRADO ──────────────────────────────────────────
      // Com anti-enumeração ligada (padrão do Supabase), cadastrar um email
      // que já existe devolve SUCESSO falso: um user fake, sem identities.
      // Sem tratar isso, mandávamos a pessoa pra tela de código esperar um
      // email que nunca ia sair — o "não chega em canto nenhum" relatado.
      if (data.user && (data.user.identities?.length ?? 0) === 0) {
        // Duas situações MUITO diferentes escondidas atrás do mesmo retorno:
        //   • conta pendente → o signUp acima JÁ reenviou o código; a pessoa
        //     só precisa da tela pra digitar (caso do cliente que reclamou).
        //   • conta confirmada → nada foi enviado; tem que usar outro email
        //     ou entrar com esse.
        // Quem sabe a diferença é o /api/auth/diagnose — que só responde pra
        // quem PROVA posse da conta, por isso a senha vai junto (anti-
        // enumeração; sem ela o endpoint diria a qualquer um se o email tem
        // cadastro aqui). Re-cadastro de conta pendente atualiza a senha no
        // Supabase, então a que a pessoa acabou de digitar é a válida.
        let pendente = false;
        try {
          const res = await fetch('/api/auth/diagnose', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ email: cleanEmail, password }),
          });
          const diag = (await res.json()) as { reason?: string };
          pendente = diag?.reason === 'unconfirmed';
        } catch {
          /* diagnóstico indisponível → trata como conta existente */
        }
        if (pendente) {
          router.replace(
            `/verify?email=${encodeURIComponent(cleanEmail)}&reenviado=1`,
          );
          return;
        }
        setAlreadyExists(true);
        setError(
          'Esse email já tem conta no Auto Edit. Use outro email — ou entre com esse.',
        );
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

      // Guarda nome/telefone pra gravar no profile DEPOIS da confirmação
      // (na /verify, quando já existe sessão).
      try {
        sessionStorage.setItem(
          'casablanca:pending-signup',
          JSON.stringify({ name: name.trim() || null, phone: phoneNorm }),
        );
      } catch {
        /* sessionStorage indisponível — segue */
      }

      // SMS opcional: NEXT_PUBLIC_SMS_REQUIRED=1 reativa o flow SMS.
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

      // Vai IMEDIATAMENTE pra tela de confirmação por código (email).
      // cleanEmail (não o cru): a /verify precisa mandar pro verifyOtp
      // EXATAMENTE o endereço com que a conta foi criada.
      router.replace(`/verify?email=${encodeURIComponent(cleanEmail)}`);
    } catch (e) {
      setError((e as Error).message ?? 'Falha ao criar conta.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell
      title="Criar conta grátis"
      subtitle="Sem cartão. Sobe o primeiro bruto em minutos."
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

        <PasswordField
          id="password"
          label="Senha"
          value={password}
          onChange={setPassword}
          placeholder="Mínimo 6 caracteres"
          show={showPassword}
          onToggle={() => setShowPassword((v) => !v)}
        />

        <PasswordField
          id="confirm"
          label="Confirmar senha"
          value={confirm}
          onChange={setConfirm}
          placeholder="Repete a senha"
          show={showConfirm}
          onToggle={() => setShowConfirm((v) => !v)}
        />


        <label className="flex items-start gap-2.5 text-[12.5px] leading-snug text-text-muted">
          <input
            type="checkbox"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 accent-violet"
          />
          <span>
            Li e concordo com os{' '}
            <Link href="/termos" target="_blank" className="text-violet hover:text-white">
              Termos de Uso
            </Link>{' '}
            e a{' '}
            <Link href="/politica" target="_blank" className="text-violet hover:text-white">
              Política de Assinatura e Cancelamento
            </Link>
            .
          </span>
        </label>

        {error ? (
          <div
            key={error}
            role="alert"
            className="error-shake rounded-[12px] border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300"
          >
            {error}
            {alreadyExists ? (
              <div className="mt-2 flex flex-wrap gap-3 text-[12px] font-semibold">
                <Link
                  href={`/login?email=${encodeURIComponent(email.trim().toLowerCase())}`}
                  className="text-violet hover:text-white"
                >
                  Entrar
                </Link>
                <Link
                  href={`/forgot-password?email=${encodeURIComponent(email.trim().toLowerCase())}`}
                  className="text-violet hover:text-white"
                >
                  Esqueci a senha
                </Link>
              </div>
            ) : null}
          </div>
        ) : null}

        <button type="submit" className="btn-primary" disabled={loading || !agreed}>
          {loading ? <span className="loading-dots">Criando</span> : 'Criar conta'}
        </button>
      </form>
    </AuthShell>
  );
}
