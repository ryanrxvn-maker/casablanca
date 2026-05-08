'use client';

import { useEffect, useState } from 'react';
import { Heartbeat } from '@/components/Heartbeat';
import { Header } from '@/components/Header';
import { ToolShell } from '@/components/ToolShell';

/**
 * /admin — painel do dono. So mostra USUARIOS (is_admin=false).
 *
 * Capacidades:
 *  - Criar usuario (com senha provisoria; cliente troca no 1o login)
 *  - Ativar / Desativar
 *  - Ver online + IP + ferramenta atual
 *  - Deletar
 *
 * Nao mostra: senha (Supabase nao expoe), API keys (RLS bloqueia),
 *   contas admin (filtro is_admin=false).
 *
 * Status online: last_seen_at < 60s.
 */

type AdminUser = {
  id: string;
  email: string | null;
  name: string | null;
  is_admin: boolean;
  is_active: boolean;
  must_change_password: boolean;
  activated_at: string | null;
  created_at: string;
  last_seen_at: string | null;
  last_ip: string | null;
  last_tool: string | null;
  last_tool_at: string | null;
};

const TOOL_LABELS: Record<string, string> = {
  decupagem: 'Decupagem',
  camuflagem: 'Camuflagem',
  compressor: 'Compressor',
  'audio-split': 'Audio Split',
  acelerador: 'Acelerador',
  normalizador: 'Normalizador',
  'take-splitter': 'Separar Takes',
  calculadora: 'Calculadora',
  'auto-broll': 'Auto B-Roll',
  'troca-produto': 'Troca de Produto',
  'remover-elementos': 'Remover Legenda',
  'decupagem-copy': 'Decupagem por Copy',
};

function isOnline(u: AdminUser): boolean {
  if (!u.last_seen_at) return false;
  const ageSec = (Date.now() - new Date(u.last_seen_at).getTime()) / 1000;
  return ageSec <= 60;
}

function isUsingTool(u: AdminUser): boolean {
  if (!u.last_tool_at) return false;
  const ageSec = (Date.now() - new Date(u.last_tool_at).getTime()) / 1000;
  return ageSec <= 90;
}

export default function AdminPage() {
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [createMsg, setCreateMsg] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    setErrorDetail(null);
    try {
      const res = await fetch('/api/admin/list-users');
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || 'Falha ao listar.');
        setErrorDetail(json.detail || null);
        return;
      }
      setUsers(json.users ?? []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // poll a cada 15s pra atualizar status online
    const id = setInterval(load, 15_000);
    return () => clearInterval(id);
  }, []);

  async function createUser(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setCreateMsg(null);
    setError(null);
    setErrorDetail(null);
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
      if (!res.ok) {
        setError(json.error || 'Falha ao criar.');
        setErrorDetail(json.detail || null);
        return;
      }
      setCreateMsg(
        `Usuario ${newEmail} criado. Senha provisoria — ele vai ter que trocar no primeiro login.`,
      );
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
        !window.confirm(
          'Deletar permanentemente este usuario? Acao irreversivel.',
        )
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
      if (!res.ok) {
        setError(json.error || 'Falha.');
        setErrorDetail(json.detail || null);
        return;
      }
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="flex min-h-screen flex-col">
      <Heartbeat />
      <Header />
      <main className="container-app flex-1 py-10">
        <ToolShell
          title="Painel admin"
          description="Voce ve seus clientes, status em tempo real, IPs, ferramenta sendo usada. Nao tem acesso a senhas nem chaves de IA deles."
        >
          <div className="flex flex-col gap-8">
            {error ? (
              <div
                key={error}
                role="alert"
                className="error-shake rounded-[12px] border border-red-500/40 bg-red-500/10 px-4 py-3 text-xs text-red-300 shadow-[0_0_22px_-8px_rgba(248,113,113,0.6)]"
              >
                <div>{error}</div>
                {errorDetail ? (
                  <div className="mono mt-2 text-[10px] text-red-300/70">
                    detail: {errorDetail}
                  </div>
                ) : null}
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
                  placeholder="Senha provisoria (mín. 8)"
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
                Senha provisoria. No primeiro login o cliente troca por uma
                senha pessoal — voce nao tem mais acesso depois disso.
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
                  {loading ? 'Atualizando...' : 'Atualizar'}
                </button>
              </div>

              {users && users.length > 0 ? (
                <ul className="grid gap-2">
                  {users.map((u) => {
                    const online = isOnline(u);
                    const usingTool = isUsingTool(u);
                    const toolLabel =
                      u.last_tool && TOOL_LABELS[u.last_tool]
                        ? TOOL_LABELS[u.last_tool]
                        : u.last_tool;
                    return (
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
                              {u.is_active ? (
                                <span className="mono rounded-full bg-lime/10 px-2 py-0.5 text-[9px] uppercase tracking-widest text-lime">
                                  ATIVO
                                </span>
                              ) : (
                                <span className="mono rounded-full bg-red-500/10 px-2 py-0.5 text-[9px] uppercase tracking-widest text-red-300">
                                  INATIVO
                                </span>
                              )}
                              {online ? (
                                <span className="mono inline-flex items-center gap-1 rounded-full border border-lime/60 bg-lime/10 px-2 py-0.5 text-[9px] uppercase tracking-widest text-lime">
                                  <span className="relative flex h-1.5 w-1.5">
                                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-lime opacity-60" />
                                    <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-lime" />
                                  </span>
                                  ONLINE
                                </span>
                              ) : (
                                <span className="mono rounded-full bg-bg-soft/40 px-2 py-0.5 text-[9px] uppercase tracking-widest text-text-dim">
                                  offline
                                </span>
                              )}
                              {u.must_change_password ? (
                                <span className="mono rounded-full bg-yellow-500/10 px-2 py-0.5 text-[9px] uppercase tracking-widest text-yellow-300">
                                  SENHA PROVISORIA
                                </span>
                              ) : null}
                            </div>
                            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-text-muted">
                              {usingTool && toolLabel ? (
                                <span>
                                  Usando agora:{' '}
                                  <span className="text-lime">
                                    {toolLabel}
                                  </span>
                                </span>
                              ) : u.last_tool && toolLabel ? (
                                <span>
                                  Ultima ferramenta:{' '}
                                  <span className="text-text-muted">
                                    {toolLabel}
                                  </span>
                                </span>
                              ) : null}
                              {u.last_ip ? (
                                <span>
                                  IP:{' '}
                                  <span className="mono text-text-muted">
                                    {u.last_ip}
                                  </span>
                                </span>
                              ) : null}
                              {u.last_seen_at ? (
                                <span>
                                  Visto:{' '}
                                  <span className="mono text-text-muted">
                                    {new Date(u.last_seen_at).toLocaleString(
                                      'pt-BR',
                                    )}
                                  </span>
                                </span>
                              ) : null}
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
                            <button
                              onClick={() => toggleAction(u.id, 'delete')}
                              className="rounded-[12px] border border-red-500/40 px-2 py-1 text-xs text-red-300 transition hover:bg-red-500/10 active:scale-[0.96]"
                            >
                              Deletar
                            </button>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              ) : loading ? (
                <div className="rounded-[12px] border border-line bg-bg p-6 text-center text-xs text-text-muted">
                  Carregando...
                </div>
              ) : (
                <div className="rounded-[12px] border border-line bg-bg p-6 text-center text-xs text-text-muted">
                  Nenhum usuario criado ainda. Use o formulario acima.
                </div>
              )}
            </section>
          </div>
        </ToolShell>
      </main>
    </div>
  );
}
