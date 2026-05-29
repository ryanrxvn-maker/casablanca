'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { ClickUpPilotStatusSection } from '@/components/ClickUpPilotStatusSection';

/**
 * /configuracoes — Conta.
 *
 * Layout reorganizado em duas colunas:
 *  - Esquerda  → indice sticky (ancoras pra cada secao)
 *  - Direita   → cards individuais com fade-in-up escalonado
 *
 * Copy minima, sem termos tecnicos. Estados de loading usam .loading-dots.
 */
export default function ConfiguracoesPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [email, setEmail] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newPasswordConfirm, setNewPasswordConfirm] = useState('');
  const [emailBusy, setEmailBusy] = useState(false);
  const [passBusy, setPassBusy] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [toast, setToast] = useState<
    { kind: 'ok' | 'err'; msg: string } | null
  >(null);

  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const { data } = await supabase.auth.getUser();
      if (!data.user) {
        router.replace('/login');
        return;
      }
      setEmail(data.user.email ?? '');
      const { data: prof } = await supabase
        .from('profiles')
        .select('is_admin')
        .eq('id', data.user.id)
        .maybeSingle();
      setIsAdmin((prof as { is_admin?: boolean } | null)?.is_admin === true);
      setLoading(false);
    })();
  }, [router]);

  function flash(kind: 'ok' | 'err', msg: string) {
    setToast({ kind, msg });
    setTimeout(() => setToast((c) => (c?.msg === msg ? null : c)), 3200);
  }

  async function handleChangeEmail(e: React.FormEvent) {
    e.preventDefault();
    if (!newEmail.trim() || newEmail === email) return;
    setEmailBusy(true);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.updateUser({ email: newEmail });
      if (error) {
        flash('err', error.message);
        return;
      }
      flash('ok', 'Confirme o link no novo email.');
      setNewEmail('');
    } finally {
      setEmailBusy(false);
    }
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    if (newPassword.length < 6) {
      flash('err', 'Mínimo 6 caracteres.');
      return;
    }
    if (newPassword !== newPasswordConfirm) {
      flash('err', 'As senhas não coincidem.');
      return;
    }
    setPassBusy(true);
    try {
      const supabase = createClient();
      const { error: signErr } = await supabase.auth.signInWithPassword({
        email,
        password: currentPassword,
      });
      if (signErr) {
        flash('err', 'Senha atual incorreta.');
        return;
      }
      const { error } = await supabase.auth.updateUser({
        password: newPassword,
      });
      if (error) {
        flash('err', error.message);
        return;
      }
      flash('ok', 'Senha alterada.');
      setCurrentPassword('');
      setNewPassword('');
      setNewPasswordConfirm('');
    } finally {
      setPassBusy(false);
    }
  }

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.replace('/login');
    router.refresh();
  }

  async function handleDeleteAccount() {
    const confirmed = window.confirm(
      'Tem certeza? A ação é irreversível.',
    );
    if (!confirmed) return;
    const typed = window.prompt('Digite "DELETAR" pra confirmar:');
    if (typed !== 'DELETAR') return;
    setDeleteBusy(true);
    try {
      const supabase = createClient();
      await supabase.auth.signOut();
      flash('ok', 'Sessão encerrada. Fale com o suporte pra remover do banco.');
      setTimeout(() => router.replace('/login'), 2200);
    } finally {
      setDeleteBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-[1000px] px-5 md:px-8">
        <div className="rounded-[16px] border border-line bg-bg-soft/60 p-8 text-center text-sm text-text-muted">
          <span className="loading-dots">Carregando</span>
        </div>
      </div>
    );
  }

  const sections = [
    { id: 'assinatura', label: 'Assinatura' },
    { id: 'apis', label: 'Chaves IA' },
    { id: 'magnific', label: 'Magnific' },
    { id: 'email', label: 'Email' },
    { id: 'senha', label: 'Senha' },
    { id: 'sessao', label: 'Sessão' },
    { id: 'clickup', label: 'ClickUp' },
    { id: 'zona-perigo', label: 'Zona de perigo' },
  ];

  return (
    <div className="mx-auto w-full max-w-[1000px] px-5 md:px-8">
      <main>
        <div className="animate-fade-in-up mb-10">
          <div
            className="mb-3 inline-flex items-center gap-2 rounded-full border border-line bg-bg-soft/60 px-3 py-1 text-[10.5px] font-semibold uppercase tracking-[0.20em] text-text-muted"
            style={{ fontFamily: 'var(--font-tech)' }}
          >
            <span className="inline-block h-1.5 w-1.5 animate-pulse-soft rounded-full bg-violet" />
            CONTA
          </div>
          <h1 className="section-title">Configurações</h1>
          <p className="mt-2 text-sm text-text-muted">
            Email, senha e acesso.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-[200px_1fr]">
          {/* Sidebar interna sticky */}
          <aside className="hidden lg:block">
            <nav
              className="sticky top-24 flex flex-col gap-1 rounded-[14px] border border-line bg-bg-soft/50 p-3 backdrop-blur-md"
              style={{ fontFamily: 'var(--font-tech)' }}
            >
              {sections.map((s) => (
                <a
                  key={s.id}
                  href={`#${s.id}`}
                  className="flex items-center justify-between rounded-[10px] px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-text-muted transition hover:bg-bg hover:text-white"
                >
                  <span>{s.label}</span>
                  <span className="text-text-dim transition group-hover:text-violet">·</span>
                </a>
              ))}
            </nav>
          </aside>

          <div className="flex flex-col gap-5">
            {/* Dashboard (cérebro) — só admin */}
            {isAdmin ? (
              <section className="fade-in-up" style={{ animationDelay: '20ms' }}>
                <a href="/admin/dashboard" className="brain-btn group relative block overflow-hidden rounded-[20px] p-[1.5px]">
                  <span aria-hidden className="brain-btn-border" />
                  <span className="relative flex items-center justify-between gap-4 rounded-[19px] bg-[#0c0c11] px-6 py-6">
                    <span className="flex items-center gap-4">
                      <span className="brain-btn-icon relative flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl">
                        <svg width="30" height="30" viewBox="0 0 120 120" fill="none">
                          <path d="M60 18c-10-8-26-6-30 6-10 2-16 12-12 22-6 6-5 18 3 22-1 10 8 18 18 16 5 6 16 6 21 0 10 2 19-6 18-16 8-4 9-16 3-22 4-10-2-20-12-22-4-12-20-14-30-6z" stroke="#d8b4fe" strokeWidth="3" fill="rgba(168,85,247,0.12)" />
                          <path d="M60 22v76M44 30c8 6 8 18 0 24s-8 18 0 24M76 30c-8 6-8 18 0 24s8 18 0 24" stroke="rgba(216,180,254,0.6)" strokeWidth="2" fill="none" />
                        </svg>
                      </span>
                      <span>
                        <span className="mb-1 inline-flex items-center gap-2">
                          <span className="rounded-full border border-lime/50 bg-lime/10 px-2 py-0 text-[9px] font-bold uppercase tracking-[0.18em] text-lime" style={{ fontFamily: 'var(--font-tech)' }}>
                            CÉREBRO
                          </span>
                        </span>
                        <span className="block text-[18px] font-bold tracking-tight text-white" style={{ fontFamily: 'var(--font-tech)' }}>
                          Dashboard
                        </span>
                        <span className="mt-1 block text-[13px] text-text-muted">
                          Online agora, acessos, origem, planos e ferramentas — tudo num lugar.
                        </span>
                      </span>
                    </span>
                    <span className="flex h-10 w-10 items-center justify-center rounded-full border border-violet/40 text-violet transition group-hover:border-violet group-hover:bg-violet/10">
                      →
                    </span>
                  </span>
                </a>
                <style jsx>{`
                  .brain-btn-border {
                    position: absolute;
                    inset: 0;
                    border-radius: 20px;
                    background: conic-gradient(from var(--a, 0deg), rgba(168,85,247,0.9), rgba(103,232,249,0.6), rgba(200,255,0,0.6), rgba(168,85,247,0.9));
                    animation: brain-btn-spin 5s linear infinite;
                  }
                  .brain-btn {
                    box-shadow: 0 18px 40px -18px rgba(168,85,247,0.7);
                    transition: transform 0.35s cubic-bezier(0.22,1,0.36,1);
                  }
                  .brain-btn:hover {
                    transform: translateY(-2px);
                  }
                  .brain-btn-icon {
                    background: radial-gradient(circle at 50% 40%, rgba(168,85,247,0.35), rgba(0,0,0,0.4));
                    border: 1px solid rgba(168,85,247,0.5);
                    box-shadow: 0 0 22px -4px rgba(168,85,247,0.8);
                    transition: transform 0.4s cubic-bezier(0.34,1.56,0.64,1);
                  }
                  .brain-btn:hover .brain-btn-icon {
                    transform: scale(1.08) rotate(-4deg);
                  }
                  @keyframes brain-btn-spin {
                    to { --a: 360deg; }
                  }
                `}</style>
              </section>
            ) : null}

            {/* Assinatura */}
            <section id="assinatura" className="fade-in-up" style={{ animationDelay: '30ms' }}>
              <div className="card-tool block p-5 md:p-6">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <div className="mb-1 flex items-center gap-2">
                      <span className="pill-lime text-[9px]">PLANO</span>
                    </div>
                    <div
                      className="text-[17px] font-bold tracking-tight text-white"
                      style={{ fontFamily: 'var(--font-tech)' }}
                    >
                      Assinatura
                    </div>
                    <div className="mt-1 text-[13px] text-text-muted">
                      Gerencie seu plano, atualize o cartão, baixe recibos ou
                      cancele quando quiser. Ao cancelar, o acesso continua até
                      o fim do período já pago.
                    </div>
                  </div>
                  <a
                    href="/configuracoes/assinatura"
                    className="btn-ghost shrink-0 whitespace-nowrap"
                  >
                    Gerenciar
                  </a>
                </div>
              </div>
            </section>

            {/* Chaves IA */}
            <section id="apis" className="fade-in-up" style={{ animationDelay: '40ms' }}>
              <a
                href="/configuracoes/api"
                className="card-tool block p-5 md:p-6"
              >
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <div className="mb-1 flex items-center gap-2">
                      <span className="pill-lime text-[9px]">BYOK</span>
                    </div>
                    <div
                      className="text-[17px] font-bold tracking-tight text-white"
                      style={{ fontFamily: 'var(--font-tech)' }}
                    >
                      Chaves de IA
                    </div>
                    <div className="mt-1 text-[13px] text-text-muted">
                      Conecte suas chaves. O crédito sai da sua conta.
                    </div>
                  </div>
                  <span className="flex h-9 w-9 items-center justify-center rounded-full border border-line-strong text-text-dim transition group-hover:border-lime group-hover:text-lime">
                    →
                  </span>
                </div>
              </a>
            </section>

            {/* Magnific */}
            <section id="magnific" className="fade-in-up" style={{ animationDelay: '60ms' }}>
              <a
                href="/configuracoes/magnific"
                className="card-tool block p-5 md:p-6"
              >
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <div className="mb-1 flex items-center gap-2">
                      <span className="pill-lime text-[9px]">B-ROLL v2</span>
                    </div>
                    <div
                      className="text-[17px] font-bold tracking-tight text-white"
                      style={{ fontFamily: 'var(--font-tech)' }}
                    >
                      Magnific (Freepik)
                    </div>
                    <div className="mt-1 text-[13px] text-text-muted">
                      Conecte sua sessão Magnific.com pra disparar B-rolls direto daqui.
                    </div>
                  </div>
                  <span className="flex h-9 w-9 items-center justify-center rounded-full border border-line-strong text-text-dim transition group-hover:border-lime group-hover:text-lime">
                    →
                  </span>
                </div>
              </a>
            </section>

            {/* Email */}
            <SectionCard id="email" label="Email" delay={80}>
              <div className="mb-3 rounded-[12px] border border-line bg-bg/60 px-4 py-3 text-sm">
                <span className="text-text-muted">Atual: </span>
                <span className="font-medium text-white">{email}</span>
              </div>
              <form
                onSubmit={handleChangeEmail}
                className="flex flex-col gap-3 sm:flex-row"
              >
                <input
                  type="email"
                  placeholder="novo@exemplo.com"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  className="input-field flex-1"
                  required
                />
                <button
                  type="submit"
                  className="btn-primary"
                  disabled={emailBusy || !newEmail.trim()}
                >
                  {emailBusy ? <span className="loading-dots">Enviando</span> : 'Trocar'}
                </button>
              </form>
              <p className="mt-2 text-[11px] text-text-muted">
                Você precisa confirmar no novo email.
              </p>
            </SectionCard>

            {/* Senha */}
            <SectionCard id="senha" label="Senha" delay={120}>
              <form
                onSubmit={handleChangePassword}
                className="flex flex-col gap-3"
              >
                <input
                  type="password"
                  placeholder="Senha atual"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  className="input-field"
                  autoComplete="current-password"
                  required
                />
                <div className="grid gap-3 sm:grid-cols-2">
                  <input
                    type="password"
                    placeholder="Nova"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="input-field"
                    autoComplete="new-password"
                    required
                    minLength={6}
                  />
                  <input
                    type="password"
                    placeholder="Confirmar"
                    value={newPasswordConfirm}
                    onChange={(e) => setNewPasswordConfirm(e.target.value)}
                    className="input-field"
                    autoComplete="new-password"
                    required
                    minLength={6}
                  />
                </div>
                <div>
                  <button
                    type="submit"
                    className="btn-primary"
                    disabled={
                      passBusy ||
                      !currentPassword ||
                      !newPassword ||
                      !newPasswordConfirm
                    }
                  >
                    {passBusy ? <span className="loading-dots">Alterando</span> : 'Alterar'}
                  </button>
                </div>
              </form>
            </SectionCard>

            {/* Sessao */}
            <SectionCard id="sessao" label="Sessão" delay={160}>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-text-muted">Sair desta conta.</p>
                <button onClick={handleLogout} className="btn-secondary">
                  Sair
                </button>
              </div>
            </SectionCard>

            {/* ClickUp Pilot */}
            <section id="clickup" className="fade-in-up" style={{ animationDelay: '200ms' }}>
              <ClickUpPilotStatusSection flash={flash} />
            </section>

            {/* Zona perigo */}
            <section
              id="zona-perigo"
              className="fade-in-up"
              style={{ animationDelay: '240ms' }}
            >
              <div className="rounded-[16px] border border-red-500/25 bg-red-500/5 p-5 md:p-6">
                <div className="mb-2 inline-flex items-center gap-2 text-[10.5px] font-semibold uppercase tracking-[0.20em] text-red-400" style={{ fontFamily: 'var(--font-tech)' }}>
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-red-400 shadow-[0_0_8px_rgba(248,113,113,0.7)]" />
                  ZONA DE PERIGO
                </div>
                <p className="text-sm text-text-muted">
                  Apaga sua conta. Sem volta.
                </p>
                <button
                  onClick={handleDeleteAccount}
                  className="mt-4 rounded-[12px] border border-red-500/50 px-4 py-2 text-sm font-medium text-red-300 transition hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-40"
                  disabled={deleteBusy}
                >
                  {deleteBusy ? <span className="loading-dots">Processando</span> : 'Deletar conta'}
                </button>
              </div>
            </section>
          </div>
        </div>
      </main>

      {toast ? (
        <div
          role="status"
          className={
            'toast-pop fixed bottom-6 left-1/2 z-50 max-w-[90vw] -translate-x-1/2 rounded-full border px-5 py-2.5 text-xs font-semibold uppercase tracking-[0.16em] shadow-2xl backdrop-blur-xl ' +
            (toast.kind === 'ok'
              ? 'border-violet/50 bg-bg/85 text-violet shadow-[0_0_28px_-8px_rgba(167,139,250,0.6)]'
              : 'border-red-500/50 bg-bg/85 text-red-300 shadow-[0_0_28px_-8px_rgba(248,113,113,0.6)]')
          }
          style={{ fontFamily: 'var(--font-tech)' }}
        >
          {toast.msg}
        </div>
      ) : null}
    </div>
  );
}

function SectionCard({
  id,
  label,
  delay,
  children,
}: {
  id: string;
  label: string;
  delay: number;
  children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      className="card-tool fade-in-up p-5 md:p-6"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div
        className="mb-4 inline-flex items-center gap-2 text-[10.5px] font-semibold uppercase tracking-[0.20em] text-text-muted"
        style={{ fontFamily: 'var(--font-tech)' }}
      >
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-violet shadow-[0_0_8px_rgba(167,139,250,0.7)]" />
        {label}
      </div>
      {children}
    </section>
  );
}
