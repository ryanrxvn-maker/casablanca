'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Header } from '@/components/Header';
import { ToolShell } from '@/components/ToolShell';
import { createClient } from '@/lib/supabase/client';
import { ClickUpPilotStatusSection } from '@/components/ClickUpPilotStatusSection';

/**
 * /configuracoes — Configuracoes de login.
 *
 * Substitui a antiga /perfil. Nao edita nome, foto nem bio — so
 * informacoes da conta: email, senha, sessoes, deletar conta.
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
      flash(
        'ok',
        'Confirme o novo email pelo link enviado. Ele só entra em vigor depois da confirmação.',
      );
      setNewEmail('');
    } finally {
      setEmailBusy(false);
    }
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    if (newPassword.length < 6) {
      flash('err', 'Nova senha precisa ter ao menos 6 caracteres.');
      return;
    }
    if (newPassword !== newPasswordConfirm) {
      flash('err', 'As senhas novas não coincidem.');
      return;
    }
    setPassBusy(true);
    try {
      const supabase = createClient();
      // Valida a senha atual reautenticando.
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
      flash('ok', 'Senha alterada com sucesso.');
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
      'Tem CERTEZA que quer deletar sua conta? Todos os dados vinculados serão perdidos e a ação é irreversível.',
    );
    if (!confirmed) return;
    const typed = window.prompt(
      'Digite "DELETAR" (maiúsculas) para confirmar:',
    );
    if (typed !== 'DELETAR') return;
    setDeleteBusy(true);
    try {
      // Nao temos endpoint admin pra deletar a conta de fato sem service role.
      // Alternativa: sign out + exibir instrucao pra contato de suporte.
      // Quando um endpoint admin estiver disponivel (ex: /api/account/delete
      // com service role), trocar pelo fetch correspondente.
      const supabase = createClient();
      await supabase.auth.signOut();
      flash(
        'ok',
        'Sessão encerrada. Para remover a conta do banco entre em contato com o suporte.',
      );
      setTimeout(() => router.replace('/login'), 2200);
    } finally {
      setDeleteBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen flex-col">
        <Header />
        <main className="container-app flex-1 py-10">
          <div className="rounded-[12px] border border-line bg-bg p-8 text-center text-sm text-text-muted">
            Carregando...
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="container-app flex-1 py-10">
        <ToolShell
          title="Configurações"
          description="Configurações de login da sua conta. Alterações aqui afetam acesso, email e segurança."
        >
          <div className="flex flex-col gap-8">
            <section>
              <h2 className="label-field !mb-3">Chaves de IA (BYOK)</h2>
              <a
                href="/configuracoes/api"
                className="block rounded-[12px] border border-lime/30 bg-lime/5 p-4 transition-all duration-300 hover:-translate-y-[1px] hover:border-lime/60 hover:bg-lime/10"
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-lime">
                      Configurar API Keys →
                    </div>
                    <div className="mt-0.5 text-[11px] text-text-muted">
                      Anthropic, AssemblyAI, ElevenLabs. Ferramentas de IA
                      gastam credito da SUA conta nessas APIs.
                    </div>
                  </div>
                  <span className="mono text-[10px] uppercase tracking-widest text-lime">
                    BYOK
                  </span>
                </div>
              </a>
            </section>

            {/* ------ Email ------ */}
            <section>
              <h2 className="label-field !mb-3">Email da conta</h2>
              <div className="mb-3 rounded-[12px] border border-line bg-bg px-4 py-3 text-sm text-text-muted">
                Email atual:{' '}
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
                  {emailBusy ? 'Enviando...' : 'Trocar email'}
                </button>
              </form>
              <p className="mt-2 text-[11px] text-text-muted">
                Você receberá um link de confirmação no novo email. A troca só
                entra em vigor após a confirmação.
              </p>
            </section>

            {/* ------ Senha ------ */}
            <section className="border-t border-line pt-6">
              <h2 className="label-field !mb-3">Alterar senha</h2>
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
                    placeholder="Nova senha (mín. 6)"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="input-field"
                    autoComplete="new-password"
                    required
                    minLength={6}
                  />
                  <input
                    type="password"
                    placeholder="Confirmar nova senha"
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
                    {passBusy ? 'Alterando...' : 'Alterar senha'}
                  </button>
                </div>
              </form>
            </section>

            {/* ------ Sessao ------ */}
            <section className="border-t border-line pt-6">
              <h2 className="label-field !mb-3">Sessão</h2>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-text-muted">
                  Encerra esta sessão e volta para a tela de login.
                </p>
                <button onClick={handleLogout} className="btn-secondary">
                  Sair
                </button>
              </div>
            </section>

            {/* ------ ClickUp Pilot — status filter ------ */}
            <ClickUpPilotStatusSection flash={flash} />

            {/* ------ Zona perigosa ------ */}
            <section className="border-t border-line pt-6">
              <h2 className="label-field !mb-3 text-red-400">Zona perigosa</h2>
              <div className="rounded-[12px] border border-red-500/30 bg-red-500/5 p-4">
                <p className="mb-3 text-sm text-text-muted">
                  Deletar a conta encerra todas as sessões ativas e remove
                  seus dados. A ação é irreversível.
                </p>
                <button
                  onClick={handleDeleteAccount}
                  className="rounded-[12px] border border-red-500/50 px-4 py-2 text-sm font-medium text-red-300 transition hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-40"
                  disabled={deleteBusy}
                >
                  {deleteBusy ? 'Processando...' : 'Deletar conta'}
                </button>
              </div>
            </section>
          </div>
        </ToolShell>
      </main>

      {toast ? (
        <div
          role="status"
          className={
            'toast-pop fixed bottom-6 left-1/2 z-50 max-w-[90vw] -translate-x-1/2 rounded-full border px-5 py-2.5 text-xs font-medium uppercase tracking-widest shadow-2xl backdrop-blur-md ' +
            (toast.kind === 'ok'
              ? 'border-lime/50 bg-bg/80 text-lime shadow-[0_0_28px_-8px_rgba(200,255,0,0.6)]'
              : 'border-red-500/50 bg-bg/80 text-red-300 shadow-[0_0_28px_-8px_rgba(248,113,113,0.6)]')
          }
        >
          {toast.msg}
        </div>
      ) : null}
    </div>
  );
}
