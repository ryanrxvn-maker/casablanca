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
