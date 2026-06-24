'use client';

import { useEffect, useState } from 'react';
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
  tier?: 'free' | 'beta' | 'admin' | null;
  phone?: string | null;
  phone_verified?: boolean | null;
  legacy_no_phone?: boolean | null;
};

const TOOL_LABELS: Record<string, string> = {
  decupagem: 'Decupagem',
  camuflagem: 'Camuflagem',
  compressor: 'Compressor',
  'audio-split': 'Audio Split',
  acelerador: 'Acelerador',
  normalizador: 'Normalizador',
  calculadora: 'Calculadora',
  'auto-broll': 'Auto B-Roll',
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

  const [tierBusy, setTierBusy] = useState<string | null>(null);
  const [tierToast, setTierToast] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);

  async function changeTier(userId: string, newTier: 'free' | 'basic' | 'pro') {
    setTierBusy(userId);
    setTierToast(null);
    try {
      const res = await fetch('/api/admin/set-tier', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId, tier: newTier }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setTierToast({
          kind: 'err',
          msg: json.error || json.detail || 'Falha ao trocar plano.',
        });
        return;
      }
      setTierToast({
        kind: 'ok',
        msg: `Plano atualizado pra ${newTier.toUpperCase()}.`,
      });
      await load();
    } catch (e) {
      setTierToast({
        kind: 'err',
        msg: (e as Error).message || 'Erro inesperado.',
      });
    } finally {
      setTierBusy(null);
      setTimeout(() => setTierToast(null), 3500);
    }
  }

  const [resetModal, setResetModal] = useState<{ email: string; password: string } | null>(null);

  async function resetPassword(userId: string, email: string) {
    if (!window.confirm(`Gerar nova senha provisória pra ${email}?\n\nO usuário será forçado a trocar no próximo login.`)) {
      return;
    }
    try {
      const res = await fetch('/api/admin/reset-password', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setTierToast({
          kind: 'err',
          msg: json.error || 'Falha ao gerar senha.',
        });
        setTimeout(() => setTierToast(null), 3500);
        return;
      }
      setResetModal({ email, password: json.password });
      await load();
    } catch (e) {
      setTierToast({
        kind: 'err',
        msg: (e as Error).message || 'Erro inesperado.',
      });
      setTimeout(() => setTierToast(null), 3500);
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
    <div className="mx-auto w-full max-w-[1100px] px-5 md:px-8">
      <main>
        <ToolShell
          title="Painel admin"
          eyebrow="ADMIN"
          description="Veja seus clientes em tempo real: quem está online, IP atual e ferramenta em uso. Sem acesso a senhas ou chaves."
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
                        className="hover-lift rounded-[12px] border border-line bg-bg p-3"
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
                              {(() => {
                                const tier = u.tier ?? (u.is_active ? 'beta' : 'free');
                                const tierStyles =
                                  tier === 'free'
                                    ? 'bg-text-dim/15 text-text-muted'
                                    : tier === 'beta'
                                      ? 'bg-violet/15 text-violet'
                                      : 'bg-lime/15 text-lime';
                                return (
                                  <span
                                    className={
                                      'label-tech rounded-full px-2 py-0.5 text-[9px] uppercase tracking-widest ' +
                                      tierStyles
                                    }
                                  >
                                    {tier}
                                  </span>
                                );
                              })()}
                              {u.is_active ? (
                                <span className="label-tech rounded-full bg-lime/10 px-2 py-0.5 text-[9px] uppercase tracking-widest text-lime">
                                  ATIVO
                                </span>
                              ) : (
                                <span className="label-tech rounded-full bg-red-500/10 px-2 py-0.5 text-[9px] uppercase tracking-widest text-red-300">
                                  INATIVO
                                </span>
                              )}
                              {u.phone_verified ? (
                                <span
                                  className="label-tech rounded-full bg-emerald-500/10 px-2 py-0.5 text-[9px] uppercase tracking-widest text-emerald-300"
                                  title="Telefone verificado"
                                >
                                  TEL ✓
                                </span>
                              ) : u.phone ? (
                                <span
                                  className="label-tech rounded-full bg-yellow-500/10 px-2 py-0.5 text-[9px] uppercase tracking-widest text-yellow-300"
                                  title="Telefone não verificado"
                                >
                                  TEL ?
                                </span>
                              ) : u.legacy_no_phone ? (
                                <span className="label-tech rounded-full bg-bg-soft/40 px-2 py-0.5 text-[9px] uppercase tracking-widest text-text-dim">
                                  LEGACY
                                </span>
                              ) : null}
                              {online ? (
                                <span className="label-tech inline-flex items-center gap-1 rounded-full border border-lime/60 bg-lime/10 px-2 py-0.5 text-[9px] uppercase tracking-widest text-lime">
                                  <span className="relative flex h-1.5 w-1.5">
                                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-lime opacity-60" />
                                    <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-lime" />
                                  </span>
                                  ONLINE
                                </span>
                              ) : (
                                <span className="label-tech rounded-full bg-bg-soft/40 px-2 py-0.5 text-[9px] uppercase tracking-widest text-text-dim">
                                  offline
                                </span>
                              )}
                              {u.must_change_password ? (
                                <span className="label-tech rounded-full bg-yellow-500/10 px-2 py-0.5 text-[9px] uppercase tracking-widest text-yellow-300">
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
                              {u.phone ? (
                                <span>
                                  Tel:{' '}
                                  <span className="mono text-text-muted">
                                    {u.phone}
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
                          <div className="flex flex-wrap items-center gap-1.5">
                            {/* Dropdown de tier */}
                            <select
                              value={
                                (u.tier === 'beta' ? 'pro' : u.tier) ?? 'free'
                              }
                              onChange={(e) => {
                                const v = e.target.value as 'free' | 'basic' | 'pro';
                                changeTier(u.id, v);
                              }}
                              disabled={tierBusy === u.id}
                              className="rounded-[10px] border border-line-strong bg-bg-soft px-2 py-1 text-[11px] font-bold uppercase tracking-[0.14em] text-white disabled:opacity-50"
                              style={{ fontFamily: 'var(--font-tech)' }}
                              title="Mudar plano"
                            >
                              <option value="free">FREE</option>
                              <option value="basic">BASIC</option>
                              <option value="pro">PRO</option>
                            </select>
                            {/* Botão reset senha (só se must_change_password=true ou sempre) */}
                            <button
                              onClick={() => resetPassword(u.id, u.email || '')}
                              className="rounded-[10px] border border-amber-500/40 px-2 py-1 text-[11px] font-bold uppercase tracking-[0.14em] text-amber-300 transition hover:bg-amber-500/10 active:scale-[0.96]"
                              style={{ fontFamily: 'var(--font-tech)' }}
                              title="Gerar nova senha provisória"
                            >
                              SENHA
                            </button>
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

      {/* Toast — feedback de troca de tier */}
      {tierToast ? (
        <div
          role="status"
          className={
            'toast-pop fixed bottom-6 left-1/2 z-50 max-w-[90vw] -translate-x-1/2 rounded-full border px-5 py-2.5 text-xs font-semibold uppercase tracking-[0.16em] shadow-2xl backdrop-blur-xl ' +
            (tierToast.kind === 'ok'
              ? 'border-violet/50 bg-bg/85 text-violet shadow-[0_0_28px_-8px_rgba(167,139,250,0.6)]'
              : 'border-red-500/50 bg-bg/85 text-red-300 shadow-[0_0_28px_-8px_rgba(248,113,113,0.6)]')
          }
          style={{ fontFamily: 'var(--font-tech)' }}
        >
          {tierToast.msg}
        </div>
      ) : null}

      {/* Modal — senha provisória gerada */}
      {resetModal ? (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
          onClick={() => setResetModal(null)}
        >
          <div
            className="dropdown-pop relative w-full max-w-md overflow-hidden rounded-[20px] border border-amber-500/45 bg-bg-soft p-6"
            onClick={(e) => e.stopPropagation()}
            style={{
              boxShadow:
                '0 32px 64px -20px rgba(0,0,0,0.95), 0 0 60px -12px rgba(251,191,36,0.4), inset 0 1px 0 rgba(255,255,255,0.06)',
            }}
          >
            <div
              className="mb-2 inline-flex items-center gap-2 rounded-full border border-amber-500/45 bg-amber-500/10 px-3 py-1 text-[10.5px] font-bold uppercase tracking-[0.2em] text-amber-300"
              style={{ fontFamily: 'var(--font-tech)' }}
            >
              <span className="inline-block h-1.5 w-1.5 animate-pulse-soft rounded-full bg-amber-400" />
              SENHA PROVISÓRIA
            </div>
            <h3
              className="mt-1 text-[20px] font-extrabold tracking-tight text-white"
              style={{ fontFamily: 'var(--font-tech)' }}
            >
              Nova senha gerada
            </h3>
            <p className="mt-1 text-[12.5px] text-text-muted">
              Pra <span className="font-medium text-white">{resetModal.email}</span>
            </p>

            <div className="mt-4 rounded-[14px] border border-line-strong bg-bg p-4">
              <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-text-muted" style={{ fontFamily: 'var(--font-tech)' }}>
                Senha
              </div>
              <div
                className="mt-1 select-all text-center text-[24px] font-bold tracking-[0.06em] text-amber-300"
                style={{ fontFamily: 'var(--font-mono)' }}
              >
                {resetModal.password}
              </div>
            </div>

            <p className="mt-3 text-[12px] leading-relaxed text-text-muted">
              O usuário será forçado a trocar a senha no próximo login. Copie agora — depois que fechar, essa senha não pode ser recuperada.
            </p>

            <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
              <button
                onClick={() => {
                  navigator.clipboard.writeText(resetModal.password);
                  setTierToast({ kind: 'ok', msg: 'Senha copiada.' });
                  setTimeout(() => setTierToast(null), 2500);
                }}
                className="rounded-full border border-amber-500/45 bg-amber-500/10 px-5 py-2 text-[12.5px] font-bold text-amber-300 transition hover:bg-amber-500/20"
              >
                Copiar senha
              </button>
              <button
                onClick={() => setResetModal(null)}
                className="rounded-full border border-line-strong bg-bg-soft px-5 py-2 text-[12.5px] font-bold text-white transition hover:bg-bg"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
