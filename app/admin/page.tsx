'use client';

import { useEffect, useState } from 'react';
import { Header } from '@/components/Header';
import { ToolShell } from '@/components/ToolShell';

/**
 * /admin — painel de administracao do beta fechado.
 * Acesso bloqueado pelo middleware se !is_admin (redirect /tools).
 */

type AdminUser = {
  id: string;
  email: string | null;
  name: string | null;
  is_admin: boolean;
  is_active: boolean;
  activated_at: string | null;
  created_at: string;
};

export default function AdminPage() {
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Form de criar usuario
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [createMsg, setCreateMsg] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/list-users');
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Falha ao listar.');
      setUsers(json.users ?? []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function createUser(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setCreateMsg(null);
    setError(null);
    try {
      const res = await fetch('/api/admin/create-user', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: newEmail,
          password: newPassword,
          name: newName,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Falha ao criar.');
      setCreateMsg(`Usuario ${newEmail} criado e ativo.`);
      setNewEmail('');
      setNewPassword('');
      setNewName('');
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCreating(false);
    }
  }

  async function toggleAction(userId: string, action: string) {
    if (action === 'delete') {
      if (
        !window.confirm('Deletar permanentemente este usuario? Acao irreversivel.')
      )
        return;
    }
    try {
      const res = await fetch('/api/admin/toggle-user', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId, action }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Falha.');
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="container-app flex-1 py-10">
        <ToolShell
          title="Painel admin"
          description="Gerencia o acesso a beta fechada. Cria, ativa, desativa e remove usuarios. So voce ve essa pagina."
        >
          <div className="flex flex-col gap-8">
            {error ? (
              <div
                key={error}
                role="alert"
                className="error-shake rounded-[12px] border border-red-500/40 bg-red-500/10 px-4 py-3 text-xs text-red-300 shadow-[0_0_22px_-8px_rgba(248,113,113,0.6)]"
              >
                {error}
              </div>
            ) : null}

            {/* ----- Criar novo usuario ----- */}
            <section>
              <h2 className="label-field !mb-3">Criar usuario</h2>
              <form
                onSubmit={createUser}
                className="grid gap-3 rounded-[12px] border border-line bg-bg p-4 sm:grid-cols-3"
              >
                <input
                  type="text"
                  placeholder="Nome"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  required
                  className="input-field"
                  disabled={creating}
                  minLength={2}
                />
                <input
                  type="email"
                  placeholder="email@exemplo.com"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  required
                  className="input-field"
                  disabled={creating}
                />
                <input
                  type="text"
                  placeholder="Senha (mín. 8)"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                  className="input-field"
                  disabled={creating}
                  minLength={8}
                />
                <div className="sm:col-span-3">
                  <button
                    type="submit"
                    className="btn-primary"
                    disabled={
                      creating || !newEmail || !newPassword || !newName
                    }
                  >
                    {creating ? 'Criando...' : 'Criar e ativar usuario'}
                  </button>
                </div>
              </form>
              {createMsg ? (
                <div
                  role="status"
                  className="fade-in-up mt-2 rounded-[12px] border border-lime/40 bg-lime/10 px-3 py-2 text-xs text-lime"
                >
                  {createMsg}
                </div>
              ) : null}
              <p className="mt-2 text-[11px] text-text-muted">
                Email + senha geradas por voce. Usuario consegue logar
                imediatamente. Voce pode trocar a senha pelo banco se
                necessario.
              </p>
            </section>

            {/* ----- Lista de usuarios ----- */}
            <section className="border-t border-line pt-6">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="label-field !mb-0">
                  Usuarios{' '}
                  <span className="mono ml-2 text-lime">
                    {users?.length ?? 0}
                  </span>
                </h2>
                <button
                  onClick={load}
                  className="btn-ghost text-xs"
                  disabled={loading}
                >
                  {loading ? 'Carregando...' : 'Atualizar'}
                </button>
              </div>

              {users && users.length > 0 ? (
                <ul className="grid gap-2">
                  {users.map((u) => (
                    <li
                      key={u.id}
                      className="rounded-[12px] border border-line bg-bg p-3"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm text-white">
                              {u.name || '(sem nome)'}
                            </span>
                            <span className="mono text-xs text-text-muted">
                              {u.email || '(sem email)'}
                            </span>
                            {u.is_admin ? (
                              <span className="mono rounded-full border border-lime/60 px-2 py-0.5 text-[9px] uppercase tracking-widest text-lime">
                                ADMIN
                              </span>
                            ) : null}
                            {u.is_active ? (
                              <span className="mono rounded-full bg-lime/10 px-2 py-0.5 text-[9px] uppercase tracking-widest text-lime">
                                ATIVO
                              </span>
                            ) : (
                              <span className="mono rounded-full bg-red-500/10 px-2 py-0.5 text-[9px] uppercase tracking-widest text-red-300">
                                INATIVO
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {u.is_active ? (
                            <button
                              onClick={() => toggleAction(u.id, 'deactivate')}
                              className="btn-ghost !py-1 !px-2 text-xs"
                            >
                              Desativar
                            </button>
                          ) : (
                            <button
                              onClick={() => toggleAction(u.id, 'activate')}
                              className="btn-ghost !py-1 !px-2 text-xs"
                            >
                              Ativar
                            </button>
                          )}
                          {u.is_admin ? (
                            <button
                              onClick={() => toggleAction(u.id, 'demote')}
                              className="btn-ghost !py-1 !px-2 text-xs"
                            >
                              Remover admin
                            </button>
                          ) : (
                            <button
                              onClick={() => toggleAction(u.id, 'promote')}
                              className="btn-ghost !py-1 !px-2 text-xs"
                            >
                              Promover admin
                            </button>
                          )}
                          <button
                            onClick={() => toggleAction(u.id, 'delete')}
                            className="rounded-[12px] border border-red-500/40 px-2 py-1 text-xs text-red-300 transition hover:bg-red-500/10 active:scale-[0.96]"
                          >
                            Deletar
                          </button>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : loading ? (
                <div className="rounded-[12px] border border-line bg-bg p-6 text-center text-xs text-text-muted">
                  Carregando...
                </div>
              ) : (
                <div className="rounded-[12px] border border-line bg-bg p-6 text-center text-xs text-text-muted">
                  Nenhum usuario.
                </div>
              )}
            </section>
          </div>
        </ToolShell>
      </main>
    </div>
  );
}
