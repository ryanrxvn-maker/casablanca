'use client';

import { useEffect, useMemo, useState } from 'react';
import { UNLOCKABLE_TOOLS } from '@/lib/tool-unlocks';

/**
 * /admin — central de controle do dono.
 *
 * • Stats ao vivo: online agora, totais, pagantes (Stripe), liberados na mão,
 *   MRR e ferramentas mais usadas (30d).
 * • Filtros: pagante de verdade × liberado por você × free × BETA PRO ×
 *   online × inativos (+ anomalia, se existir).
 * • Planos: só FREE e PREMIUM (Pro morreu; legado pro/beta exibe PREMIUM).
 * • BETA PRO: libera ferramentas admin-only POR CONTA (profiles.tool_unlocks)
 *   sem dar admin — modal com o catálogo de lib/tool-unlocks.ts.
 *
 * Status online: last_seen_at < 60s. Poll: usuários 15s, métricas 60s.
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
  tier?: string | null;
  phone?: string | null;
  phone_verified?: boolean | null;
  legacy_no_phone?: boolean | null;
  subscription_status?: string | null;
  subscription_plan?: string | null;
  current_period_end?: string | null;
  traffic_source?: string | null;
  plan: 'premium' | 'free';
  access: 'paid' | 'granted' | 'anomaly' | 'free';
  tool_unlocks: string[];
  static_unlocks: string[];
};

type Dash = {
  totals: { users: number; online: number; paying: number; mrr: number };
  toolRanking: Array<{ tool: string; count: number }>;
};

type UserDetail = {
  access: string;
  current_period_end: string | null;
  payments: Array<{
    amount: number;
    currency: string;
    plan: string | null;
    billing: string | null;
    status: string;
    receipt_url: string | null;
    created_at: string | null;
  }>;
};

const TOOL_LABELS: Record<string, string> = {
  decupagem: 'Decupagem',
  'decupagem-copy': 'Decupagem Inteligente',
  downloader: 'Downloader',
  camuflagem: 'Camuflagem',
  compressor: 'Compressor',
  'audio-split': 'Dividir Áudios',
  acelerador: 'Mixer de Velocidade',
  normalizador: 'Normalizador',
  calculadora: 'Calculadora',
  'copy-srt': 'Gerador de SRT',
  'auto-broll': 'Auto B-roll',
  'heygen-auto': 'Hey Auto',
  'clickup-pilot': 'ClickUp Pilot',
  'remover-elementos': 'Remover Legenda',
  'separador-audio': 'Separador de Áudio',
  'ltx-video': 'LTX Video',
  fakepass: 'FakePrint',
  'caixinha-pergunta': 'Caixinha de Pergunta',
  lipsync: 'Lipsync',
  historico: 'Histórico',
};
const toolLabel = (s: string | null) =>
  s ? (TOOL_LABELS[s] ?? s) : null;

// Só os paths do catálogo interessam pros badges (as rotas de apoio
// expandidas — /tools/background etc. — não são "ferramentas").
const CATALOG_PATHS = new Set(UNLOCKABLE_TOOLS.map((t) => t.path));
const CATALOG_LABEL = new Map(UNLOCKABLE_TOOLS.map((t) => [t.path, t.label]));

function betaProTools(u: AdminUser): string[] {
  const set = new Set<string>();
  for (const p of u.tool_unlocks) if (CATALOG_PATHS.has(p)) set.add(p);
  for (const p of u.static_unlocks) if (CATALOG_PATHS.has(p)) set.add(p);
  return Array.from(set);
}

function isOnline(u: AdminUser): boolean {
  if (!u.last_seen_at) return false;
  return (Date.now() - new Date(u.last_seen_at).getTime()) / 1000 <= 60;
}

function isUsingTool(u: AdminUser): boolean {
  if (!u.last_tool_at) return false;
  return (Date.now() - new Date(u.last_tool_at).getTime()) / 1000 <= 90;
}

/** "há 3 min" / "há 2 h" / "12/07" — compacto pro meta do card. */
function timeAgo(iso: string | null): string | null {
  if (!iso) return null;
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 0) return null;
  if (s < 60) return 'agora';
  if (s < 3600) return `há ${Math.floor(s / 60)} min`;
  if (s < 86400) return `há ${Math.floor(s / 3600)} h`;
  if (s < 7 * 86400) return `há ${Math.floor(s / 86400)} d`;
  return new Date(iso).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
  });
}

function brl(centavos: number): string {
  return (centavos / 100).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });
}

// ─── Meta visual por origem de acesso ───────────────────────────────────────
const ACCESS_META = {
  paid: {
    label: 'PREMIUM · PAGO',
    color: '#c8e87c',
    bg: 'rgba(200,232,124,0.12)',
    dot: true,
  },
  granted: {
    label: 'PREMIUM · LIBERADO',
    color: '#67e8f9',
    bg: 'rgba(103,232,249,0.12)',
    dot: false,
  },
  anomaly: {
    label: 'PREMIUM · ⚠ SEM ORIGEM',
    color: '#fca5a5',
    bg: 'rgba(244,63,94,0.15)',
    dot: false,
  },
  free: {
    label: 'FREE',
    color: '#8b8b96',
    bg: 'rgba(255,255,255,0.05)',
    dot: false,
  },
} as const;

type FilterKey =
  | 'all'
  | 'online'
  | 'paid'
  | 'granted'
  | 'free'
  | 'beta'
  | 'inactive'
  | 'anomaly';

export default function AdminPage() {
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [dash, setDash] = useState<Dash | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  const [filter, setFilter] = useState<FilterKey>('all');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<'recent' | 'seen' | 'name'>('recent');

  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(
    null,
  );
  const flash = (kind: 'ok' | 'err', msg: string, ms = 3500) => {
    setToast({ kind, msg });
    setTimeout(() => setToast(null), ms);
  };

  // ─── Carregamento + polls ───
  async function load(silent = false) {
    if (!silent) setLoading(true);
    try {
      const res = await fetch('/api/admin/list-users', { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || 'Falha ao listar.');
        setErrorDetail(json.detail || null);
        return;
      }
      setError(null);
      setErrorDetail(null);
      setUsers(json.users ?? []);
      setUpdatedAt(new Date());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      if (!silent) setLoading(false);
    }
  }

  async function loadDash() {
    try {
      const res = await fetch('/api/admin/dashboard', { cache: 'no-store' });
      if (!res.ok) return;
      setDash((await res.json()) as Dash);
    } catch {
      /* métrica secundária — sem drama */
    }
  }

  useEffect(() => {
    load();
    loadDash();
    const a = setInterval(() => load(true), 15_000);
    const b = setInterval(loadDash, 60_000);
    return () => {
      clearInterval(a);
      clearInterval(b);
    };
  }, []);

  // ─── Stats derivadas da própria lista ───
  const stats = useMemo(() => {
    const list = users ?? [];
    const online = list.filter(isOnline).length;
    const paid = list.filter((u) => u.access === 'paid').length;
    const granted = list.filter((u) => u.access === 'granted').length;
    const anomaly = list.filter((u) => u.access === 'anomaly').length;
    const free = list.filter((u) => u.plan === 'free').length;
    const beta = list.filter((u) => betaProTools(u).length > 0).length;
    const inactive = list.filter((u) => !u.is_active).length;
    return { total: list.length, online, paid, granted, anomaly, free, beta, inactive };
  }, [users]);

  // ─── Filtro + busca + ordenação ───
  const visible = useMemo(() => {
    let list = users ?? [];
    switch (filter) {
      case 'online':
        list = list.filter(isOnline);
        break;
      case 'paid':
        list = list.filter((u) => u.access === 'paid');
        break;
      case 'granted':
        list = list.filter((u) => u.access === 'granted');
        break;
      case 'free':
        list = list.filter((u) => u.plan === 'free');
        break;
      case 'beta':
        list = list.filter((u) => betaProTools(u).length > 0);
        break;
      case 'inactive':
        list = list.filter((u) => !u.is_active);
        break;
      case 'anomaly':
        list = list.filter((u) => u.access === 'anomaly');
        break;
    }
    const query = q.trim().toLowerCase();
    if (query) {
      list = list.filter((u) => {
        return (
          (u.name ?? '').toLowerCase().includes(query) ||
          (u.email ?? '').toLowerCase().includes(query) ||
          (u.last_ip ?? '').toLowerCase().includes(query) ||
          (toolLabel(u.last_tool) ?? '').toLowerCase().includes(query)
        );
      });
    }
    const byDate = (v: string | null | undefined) =>
      v ? new Date(v).getTime() : 0;
    list = [...list];
    if (sort === 'recent') list.sort((a, b) => byDate(b.created_at) - byDate(a.created_at));
    else if (sort === 'seen') list.sort((a, b) => byDate(b.last_seen_at) - byDate(a.last_seen_at));
    else list.sort((a, b) => (a.name ?? a.email ?? '').localeCompare(b.name ?? b.email ?? '', 'pt-BR'));
    return list;
  }, [users, filter, q, sort]);

  // ─── Ações ───
  const [busyId, setBusyId] = useState<string | null>(null);

  async function changePlan(u: AdminUser, plan: 'free' | 'premium') {
    if (u.plan === plan) return;
    if (u.access === 'paid' && plan === 'free') {
      if (
        !window.confirm(
          `${u.email || u.name} é PAGANTE (Stripe). Rebaixar pra FREE corta o acesso agora, mas NÃO cancela a assinatura no Stripe.\n\nContinuar?`,
        )
      )
        return;
    }
    setBusyId(u.id);
    try {
      const res = await fetch('/api/admin/set-tier', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          userId: u.id,
          tier: plan === 'premium' ? 'basic' : 'free',
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        flash('err', json.error || json.detail || 'Falha ao trocar plano.');
        return;
      }
      flash(
        'ok',
        plan === 'premium'
          ? `${u.email || u.name} agora é PREMIUM (liberado por você).`
          : `${u.email || u.name} voltou pra FREE.`,
      );
      await load(true);
    } catch (e) {
      flash('err', (e as Error).message || 'Erro inesperado.');
    } finally {
      setBusyId(null);
    }
  }

  async function toggleAction(u: AdminUser, action: 'activate' | 'deactivate' | 'delete') {
    if (action === 'delete') {
      if (
        !window.confirm(
          `Deletar PERMANENTEMENTE ${u.email || u.name}? Ação irreversível.`,
        )
      )
        return;
    }
    setBusyId(u.id);
    try {
      const res = await fetch('/api/admin/toggle-user', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId: u.id, action }),
      });
      const json = await res.json();
      if (!res.ok) {
        flash('err', json.error || 'Falha.');
        return;
      }
      flash(
        'ok',
        action === 'delete'
          ? 'Usuário deletado.'
          : action === 'activate'
            ? 'Conta ativada.'
            : 'Conta desativada.',
      );
      await load(true);
    } catch (e) {
      flash('err', (e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  const [resetModal, setResetModal] = useState<{ email: string; password: string } | null>(null);

  async function resetPassword(u: AdminUser) {
    if (
      !window.confirm(
        `Gerar nova senha provisória pra ${u.email}?\n\nO usuário será forçado a trocar no próximo login.`,
      )
    )
      return;
    setBusyId(u.id);
    try {
      const res = await fetch('/api/admin/reset-password', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId: u.id }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        flash('err', json.error || 'Falha ao gerar senha.');
        return;
      }
      setResetModal({ email: u.email || '', password: json.password });
      await load(true);
    } catch (e) {
      flash('err', (e as Error).message || 'Erro inesperado.');
    } finally {
      setBusyId(null);
    }
  }

  async function reconcile(u: AdminUser) {
    setBusyId(u.id);
    try {
      const res = await fetch('/api/admin/reconcile-billing', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId: u.id }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        flash('err', j.error || 'Falha ao sincronizar com o Stripe.');
        return;
      }
      flash(
        j.applied ? 'ok' : 'err',
        j.applied
          ? `Aplicado: ${String(j.tier).toUpperCase()} — ${j.reason}`
          : `Nada a aplicar: ${j.reason}`,
        5000,
      );
      await load(true);
    } finally {
      setBusyId(null);
    }
  }

  // ─── BETA PRO (modal de desbloqueios) ───
  const [betaModal, setBetaModal] = useState<{
    user: AdminUser;
    sel: Set<string>;
    saving: boolean;
  } | null>(null);

  function openBetaModal(u: AdminUser) {
    setBetaModal({
      user: u,
      sel: new Set(u.tool_unlocks.filter((p) => CATALOG_PATHS.has(p))),
      saving: false,
    });
  }

  async function saveBetaModal() {
    if (!betaModal) return;
    setBetaModal({ ...betaModal, saving: true });
    try {
      const res = await fetch('/api/admin/set-tool-unlocks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          userId: betaModal.user.id,
          tools: Array.from(betaModal.sel),
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        flash('err', json.error || 'Falha ao salvar desbloqueios.', 6000);
        setBetaModal((m) => (m ? { ...m, saving: false } : m));
        return;
      }
      flash(
        'ok',
        betaModal.sel.size
          ? `BETA PRO: ${betaModal.sel.size} ferramenta${betaModal.sel.size > 1 ? 's' : ''} liberada${betaModal.sel.size > 1 ? 's' : ''} pra ${betaModal.user.email}.`
          : `BETA PRO removido de ${betaModal.user.email}.`,
      );
      setBetaModal(null);
      await load(true);
    } catch (e) {
      flash('err', (e as Error).message || 'Erro inesperado.');
      setBetaModal((m) => (m ? { ...m, saving: false } : m));
    }
  }

  // ─── Detalhe expandido (comprovantes) ───
  const [expanded, setExpanded] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, UserDetail | 'loading'>>({});

  async function toggleExpand(u: AdminUser) {
    if (expanded === u.id) {
      setExpanded(null);
      return;
    }
    setExpanded(u.id);
    if (details[u.id] && details[u.id] !== 'loading') return;
    setDetails((d) => ({ ...d, [u.id]: 'loading' }));
    try {
      const res = await fetch(
        `/api/admin/user-search?q=${encodeURIComponent(u.email ?? '')}`,
        { cache: 'no-store' },
      );
      const j = await res.json();
      const found = res.ok
        ? (j.users as Array<UserDetail & { id: string }>).find((x) => x.id === u.id)
        : null;
      setDetails((d) => ({
        ...d,
        [u.id]: found ?? { access: u.access, current_period_end: u.current_period_end ?? null, payments: [] },
      }));
    } catch {
      setDetails((d) => ({
        ...d,
        [u.id]: { access: u.access, current_period_end: u.current_period_end ?? null, payments: [] },
      }));
    }
  }

  // ─── Criar usuário ───
  const [createOpen, setCreateOpen] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);

  async function createUser(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    try {
      const res = await fetch('/api/admin/create-user', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: newEmail, password: newPassword, name: newName }),
      });
      const json = await res.json();
      if (!res.ok) {
        flash('err', json.error || 'Falha ao criar.', 6000);
        return;
      }
      flash('ok', `${newEmail} criado com senha provisória.`);
      setNewEmail('');
      setNewPassword('');
      setNewName('');
      setCreateOpen(false);
      await load(true);
    } catch (e2) {
      flash('err', (e2 as Error).message);
    } finally {
      setCreating(false);
    }
  }

  // ─── Chips de filtro ───
  const chips: Array<{ key: FilterKey; label: string; count: number; hide?: boolean }> = [
    { key: 'all', label: 'Todos', count: stats.total },
    { key: 'online', label: '● Online', count: stats.online },
    { key: 'paid', label: '💳 Pagantes', count: stats.paid },
    { key: 'granted', label: '🎁 Liberados', count: stats.granted },
    { key: 'free', label: 'Free', count: stats.free },
    { key: 'beta', label: '⚡ Beta Pro', count: stats.beta },
    { key: 'inactive', label: 'Inativos', count: stats.inactive },
    { key: 'anomaly', label: '⚠ Anomalia', count: stats.anomaly, hide: stats.anomaly === 0 },
  ];

  return (
    <div className="mx-auto w-full max-w-[1240px] px-5 md:px-8">
      {/* ───────── Header ───────── */}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div
            className="inline-flex items-center gap-2 rounded-full border border-lime/40 bg-lime/10 px-3 py-1 text-[10.5px] font-bold uppercase tracking-[0.2em] text-lime"
            style={{ fontFamily: 'var(--font-tech)' }}
          >
            <span className="inline-block h-1.5 w-1.5 animate-pulse-soft rounded-full bg-lime shadow-[0_0_10px_rgba(200,232,124,0.9)]" />
            ADMIN · CONTROLE
          </div>
          <h1
            className="mt-3 text-[32px] font-extrabold tracking-tight text-white md:text-[40px]"
            style={{ fontFamily: 'var(--font-tech)', letterSpacing: '-0.03em' }}
          >
            Painel admin
          </h1>
          <p className="mt-1 text-[13px] text-text-muted">
            {updatedAt
              ? `Atualizado ${updatedAt.toLocaleTimeString('pt-BR')} · auto a cada 15s`
              : 'Carregando…'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <a
            href="/admin/dashboard"
            className="rounded-full border border-violet/45 bg-violet/10 px-4 py-2 text-[12px] font-bold uppercase tracking-[0.14em] text-violet transition hover:bg-violet/20"
            style={{ fontFamily: 'var(--font-tech)' }}
          >
            Dashboard completo →
          </a>
          <button
            onClick={() => setCreateOpen((v) => !v)}
            className="rounded-full border border-lime/50 bg-lime/10 px-4 py-2 text-[12px] font-bold uppercase tracking-[0.14em] text-lime transition hover:bg-lime/20"
            style={{ fontFamily: 'var(--font-tech)' }}
          >
            {createOpen ? '× Fechar' : '+ Criar usuário'}
          </button>
        </div>
      </header>

      {error ? (
        <div
          key={error}
          role="alert"
          className="error-shake mt-6 rounded-[12px] border border-red-500/40 bg-red-500/10 px-4 py-3 text-xs text-red-300"
        >
          <div>{error}</div>
          {errorDetail ? (
            <div className="mono mt-2 text-[10px] text-red-300/70">detail: {errorDetail}</div>
          ) : null}
        </div>
      ) : null}

      {/* ───────── Criar usuário (colapsável) ───────── */}
      {createOpen ? (
        <section className="fade-in-up mt-6">
          <form
            onSubmit={createUser}
            className="grid gap-3 rounded-[16px] border border-lime/25 bg-bg p-4 sm:grid-cols-[1fr_1.2fr_1fr_auto]"
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
              placeholder="Senha provisória (mín. 8)"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              className="input-field"
              disabled={creating}
              minLength={8}
            />
            <button
              type="submit"
              className="btn-primary whitespace-nowrap"
              disabled={creating || !newEmail || !newPassword || !newName}
            >
              {creating ? 'Criando…' : 'Criar e ativar'}
            </button>
            <p className="text-[11px] text-text-muted sm:col-span-4">
              Senha provisória — no primeiro login o cliente troca por uma senha pessoal e você
              não tem mais acesso.
            </p>
          </form>
        </section>
      ) : null}

      {/* ───────── Stat cards ───────── */}
      <section className="mt-8 grid grid-cols-2 gap-3 md:grid-cols-5">
        <StatCard
          label="Online agora"
          value={users ? stats.online : '—'}
          hue="rgba(200,232,124,0.6)"
          live
        />
        <StatCard label="Usuários" value={users ? stats.total : '—'} hue="rgba(167,139,250,0.6)" />
        <StatCard
          label="Pagantes (Stripe)"
          value={users ? stats.paid : '—'}
          hue="rgba(200,232,124,0.45)"
          onClick={() => setFilter('paid')}
        />
        <StatCard
          label="Liberados por você"
          value={users ? stats.granted : '—'}
          hue="rgba(103,232,249,0.6)"
          onClick={() => setFilter('granted')}
        />
        <StatCard
          label="MRR estimado"
          value={dash ? `R$ ${dash.totals.mrr.toLocaleString('pt-BR')}` : '—'}
          hue="rgba(244,114,182,0.6)"
        />
      </section>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[1fr_300px]">
        {/* ───────── Coluna principal: usuários ───────── */}
        <section>
          {/* Filtros */}
          <div className="flex flex-wrap items-center gap-2">
            {chips
              .filter((c) => !c.hide)
              .map((c) => (
                <button
                  key={c.key}
                  onClick={() => setFilter(c.key)}
                  className={
                    'rounded-full border px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.1em] transition ' +
                    (filter === c.key
                      ? c.key === 'paid'
                        ? 'border-lime/70 bg-lime/15 text-lime'
                        : c.key === 'granted'
                          ? 'border-cyan-300/70 bg-cyan-300/15 text-cyan-300'
                          : c.key === 'beta'
                            ? 'border-violet/70 bg-violet/15 text-violet'
                            : c.key === 'anomaly' || c.key === 'inactive'
                              ? 'border-red-400/70 bg-red-400/15 text-red-300'
                              : 'border-white/70 bg-white/10 text-white'
                      : 'border-line-strong text-text-muted hover:border-white/50 hover:text-white')
                  }
                  style={{ fontFamily: 'var(--font-tech)' }}
                >
                  {c.label}
                  <span className="ml-1.5 opacity-70">{c.count}</span>
                </button>
              ))}
          </div>

          {/* Busca + ordenação */}
          <div className="mt-3 flex gap-2">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar por nome, email, IP ou ferramenta…"
              className="input-field flex-1"
            />
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as typeof sort)}
              className="rounded-[12px] border border-line-strong bg-bg-soft px-3 text-[12px] font-bold uppercase tracking-[0.1em] text-text-muted"
              style={{ fontFamily: 'var(--font-tech)' }}
              title="Ordenar"
            >
              <option value="recent">Recentes</option>
              <option value="seen">Último acesso</option>
              <option value="name">Nome A–Z</option>
            </select>
          </div>

          {/* Lista */}
          <div className="mt-4 flex flex-col gap-2">
            {users && visible.length > 0 ? (
              visible.map((u) => {
                const online = isOnline(u);
                const meta = ACCESS_META[u.access];
                const beta = betaProTools(u);
                const usingNow = isUsingTool(u);
                const tLabel = toolLabel(u.last_tool);
                const isOpen = expanded === u.id;
                const detail = details[u.id];
                return (
                  <div
                    key={u.id}
                    className={
                      'rounded-[14px] border bg-bg transition ' +
                      (online ? 'border-lime/25' : 'border-line') +
                      (u.is_active ? '' : ' opacity-60')
                    }
                  >
                    <div className="flex flex-wrap items-center gap-3 p-3">
                      {/* Identidade */}
                      <button
                        onClick={() => toggleExpand(u)}
                        className="flex min-w-0 flex-1 items-center gap-3 text-left"
                        title={isOpen ? 'Fechar detalhes' : 'Ver detalhes / comprovantes'}
                      >
                        <span
                          className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full border text-[13px] font-extrabold uppercase"
                          style={{
                            fontFamily: 'var(--font-tech)',
                            color: meta.color,
                            borderColor: `${meta.color}55`,
                            background: meta.bg,
                          }}
                        >
                          {(u.name || u.email || '?').slice(0, 1)}
                          {online ? (
                            <span className="absolute -right-0.5 -top-0.5 flex h-2.5 w-2.5">
                              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-lime opacity-60" />
                              <span className="relative inline-flex h-2.5 w-2.5 rounded-full border-2 border-bg bg-lime" />
                            </span>
                          ) : null}
                        </span>
                        <span className="min-w-0">
                          <span className="flex flex-wrap items-center gap-2">
                            <span className="truncate text-[13.5px] font-bold text-white">
                              {u.name || '(sem nome)'}
                            </span>
                            <span
                              className="rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em]"
                              style={{
                                fontFamily: 'var(--font-tech)',
                                color: meta.color,
                                background: meta.bg,
                                border: `1px solid ${meta.color}55`,
                              }}
                            >
                              {meta.label}
                            </span>
                            {beta.length > 0 ? (
                              <span
                                className="rounded-full border border-violet/55 bg-violet/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em] text-violet"
                                style={{ fontFamily: 'var(--font-tech)' }}
                                title={beta.map((p) => CATALOG_LABEL.get(p) ?? p).join(' · ')}
                              >
                                ⚡ BETA PRO · {beta.length}
                              </span>
                            ) : null}
                            {!u.is_active ? (
                              <span
                                className="rounded-full border border-red-400/50 bg-red-500/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em] text-red-300"
                                style={{ fontFamily: 'var(--font-tech)' }}
                              >
                                INATIVO
                              </span>
                            ) : null}
                            {u.must_change_password ? (
                              <span
                                className="rounded-full border border-amber-400/40 bg-amber-500/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em] text-amber-300"
                                style={{ fontFamily: 'var(--font-tech)' }}
                              >
                                SENHA PROVISÓRIA
                              </span>
                            ) : null}
                          </span>
                          <span className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-text-muted">
                            <span className="mono truncate">{u.email || '(sem email)'}</span>
                            {usingNow && tLabel ? (
                              <span className="whitespace-nowrap">
                                usando <span className="font-semibold text-lime">{tLabel}</span>
                              </span>
                            ) : tLabel ? (
                              <span className="whitespace-nowrap text-text-dim">{tLabel}</span>
                            ) : null}
                            {u.last_seen_at ? (
                              <span className="whitespace-nowrap text-text-dim">
                                visto {timeAgo(u.last_seen_at)}
                              </span>
                            ) : null}
                            {u.last_ip ? (
                              <span className="mono whitespace-nowrap text-text-dim">{u.last_ip}</span>
                            ) : null}
                          </span>
                        </span>
                      </button>

                      {/* Ações */}
                      <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                        {/* Plano: FREE | PREMIUM */}
                        <div
                          className="flex overflow-hidden rounded-full border border-line-strong"
                          style={{ fontFamily: 'var(--font-tech)' }}
                        >
                          {(['free', 'premium'] as const).map((p) => (
                            <button
                              key={p}
                              onClick={() => changePlan(u, p)}
                              disabled={busyId === u.id || u.plan === p}
                              className={
                                'px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.1em] transition disabled:cursor-default ' +
                                (u.plan === p
                                  ? p === 'premium'
                                    ? u.access === 'paid'
                                      ? 'bg-lime/20 text-lime'
                                      : 'bg-cyan-300/20 text-cyan-300'
                                    : 'bg-white/15 text-white'
                                  : 'text-text-dim hover:bg-white/5 hover:text-white')
                              }
                              title={
                                p === 'premium'
                                  ? 'Liberar Premium na mão (admin_grant — não expira)'
                                  : 'Voltar pra Free'
                              }
                            >
                              {p === 'free' ? 'FREE' : 'PREMIUM'}
                            </button>
                          ))}
                        </div>
                        <button
                          onClick={() => openBetaModal(u)}
                          disabled={busyId === u.id}
                          className={
                            'rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.1em] transition ' +
                            (beta.length > 0
                              ? 'border-violet/60 bg-violet/10 text-violet hover:bg-violet/20'
                              : 'border-line-strong text-text-dim hover:border-violet/50 hover:text-violet')
                          }
                          style={{ fontFamily: 'var(--font-tech)' }}
                          title="BETA PRO — liberar ferramentas admin-only só pra esta conta"
                        >
                          ⚡ Beta Pro
                        </button>
                        <button
                          onClick={() => resetPassword(u)}
                          disabled={busyId === u.id}
                          className="rounded-full border border-amber-500/40 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.1em] text-amber-300 transition hover:bg-amber-500/10"
                          style={{ fontFamily: 'var(--font-tech)' }}
                          title="Gerar nova senha provisória"
                        >
                          Senha
                        </button>
                        <button
                          onClick={() => toggleAction(u, u.is_active ? 'deactivate' : 'activate')}
                          disabled={busyId === u.id}
                          className="rounded-full border border-line-strong px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.1em] text-text-muted transition hover:border-white/50 hover:text-white"
                          style={{ fontFamily: 'var(--font-tech)' }}
                        >
                          {u.is_active ? 'Desativar' : 'Ativar'}
                        </button>
                        <button
                          onClick={() => toggleAction(u, 'delete')}
                          disabled={busyId === u.id}
                          className="rounded-full border border-red-500/40 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.1em] text-red-300 transition hover:bg-red-500/10"
                          style={{ fontFamily: 'var(--font-tech)' }}
                        >
                          Deletar
                        </button>
                      </div>
                    </div>

                    {/* ─ Detalhe expandido ─ */}
                    {isOpen ? (
                      <div className="fade-in-up border-t border-line/60 px-4 py-3">
                        {detail === 'loading' || !detail ? (
                          <div className="py-2 text-[12px] text-text-dim">Carregando detalhes…</div>
                        ) : (
                          <div className="flex flex-col gap-3">
                            <div className="flex flex-wrap gap-x-6 gap-y-1 text-[12px] text-text-muted">
                              <span>
                                Cadastro:{' '}
                                <span className="text-white">
                                  {new Date(u.created_at).toLocaleDateString('pt-BR')}
                                </span>
                              </span>
                              {u.traffic_source ? (
                                <span>
                                  Origem: <span className="text-white">{u.traffic_source}</span>
                                </span>
                              ) : null}
                              {u.phone ? (
                                <span>
                                  Tel: <span className="mono text-white">{u.phone}</span>
                                  {u.phone_verified ? ' ✓' : ' (não verificado)'}
                                </span>
                              ) : null}
                              {detail.current_period_end ? (
                                <span>
                                  Acesso pago até:{' '}
                                  <span className="text-white">
                                    {new Date(detail.current_period_end).toLocaleDateString('pt-BR')}
                                  </span>
                                </span>
                              ) : null}
                              {u.subscription_status ? (
                                <span>
                                  Status Stripe:{' '}
                                  <span className="mono text-white">{u.subscription_status}</span>
                                </span>
                              ) : null}
                            </div>

                            {beta.length > 0 ? (
                              <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                                <span className="label-tech uppercase tracking-[0.14em] text-text-dim">
                                  Beta Pro:
                                </span>
                                {beta.map((p) => (
                                  <span
                                    key={p}
                                    className="rounded-full border border-violet/40 bg-violet/10 px-2 py-0.5 text-[10px] font-semibold text-violet"
                                  >
                                    {CATALOG_LABEL.get(p) ?? p}
                                    {u.static_unlocks.includes(p) && !u.tool_unlocks.includes(p)
                                      ? ' (fixo)'
                                      : ''}
                                  </span>
                                ))}
                              </div>
                            ) : null}

                            {detail.payments.length > 0 ? (
                              <div>
                                <div className="label-tech mb-1.5 text-[10.5px] uppercase tracking-[0.16em] text-text-dim">
                                  Comprovantes ({detail.payments.length})
                                </div>
                                <ul className="flex flex-col gap-1.5">
                                  {detail.payments.slice(0, 8).map((p, i) => (
                                    <li
                                      key={i}
                                      className="flex items-center justify-between gap-3 text-[12.5px]"
                                    >
                                      <span className="text-text-muted">
                                        <span className="font-bold text-lime">{brl(p.amount)}</span>
                                        {' · '}
                                        {p.plan === 'basic' ? 'premium' : (p.plan ?? '—')}
                                        {p.billing ? (p.billing === 'annual' ? ' · anual' : ' · mensal') : ''}
                                        {p.created_at
                                          ? ` · ${new Date(p.created_at).toLocaleDateString('pt-BR')}`
                                          : ''}
                                      </span>
                                      {p.receipt_url ? (
                                        <a
                                          href={p.receipt_url}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="shrink-0 text-violet underline-offset-2 hover:underline"
                                        >
                                          comprovante →
                                        </a>
                                      ) : (
                                        <span className="text-text-dim">—</span>
                                      )}
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            ) : u.access === 'anomaly' ? (
                              <div className="text-[12px] text-rose-300">
                                ⚠ Premium sem comprovante e sem concessão sua — investigar (ou usar
                                “Sincronizar c/ Stripe”).
                              </div>
                            ) : u.access === 'granted' ? (
                              <div className="text-[12px] text-cyan-300/80">
                                Acesso liberado por você (admin_grant) — não expira e não passa pelo
                                Stripe.
                              </div>
                            ) : (
                              <div className="text-[12px] text-text-dim">Nenhum pagamento registrado.</div>
                            )}

                            <div>
                              <button
                                onClick={() => reconcile(u)}
                                disabled={busyId === u.id}
                                className="rounded-full border border-emerald-400/50 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.1em] text-emerald-300 transition hover:bg-emerald-400/15 disabled:opacity-40"
                                style={{ fontFamily: 'var(--font-tech)' }}
                                title="Lê o estado REAL do Stripe e aplica o plano pago (conserta 'pagou e continuou free')"
                              >
                                Sincronizar c/ Stripe
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    ) : null}
                  </div>
                );
              })
            ) : loading && !users ? (
              <div className="rounded-[14px] border border-line bg-bg p-8 text-center text-xs text-text-muted">
                Carregando usuários…
              </div>
            ) : (
              <div className="rounded-[14px] border border-line bg-bg p-8 text-center text-xs text-text-muted">
                {q || filter !== 'all'
                  ? 'Nenhum usuário bate com esse filtro.'
                  : 'Nenhum usuário ainda.'}
              </div>
            )}
          </div>
        </section>

        {/* ───────── Coluna lateral: métricas ───────── */}
        <aside className="flex flex-col gap-4">
          <SidePanel title="Distribuição">
            {users ? (
              <>
                <div className="flex h-4 w-full overflow-hidden rounded-full border border-line/70">
                  {(
                    [
                      ['paid', stats.paid, '#c8e87c'],
                      ['granted', stats.granted, '#67e8f9'],
                      ['anomaly', stats.anomaly, '#fca5a5'],
                      ['free', stats.free, '#5b5b66'],
                    ] as const
                  ).map(([k, n, color]) =>
                    n > 0 ? (
                      <div
                        key={k}
                        style={{
                          width: `${(n / Math.max(stats.total, 1)) * 100}%`,
                          background: color,
                          boxShadow: `0 0 10px ${color}66`,
                        }}
                        title={`${k}: ${n}`}
                      />
                    ) : null,
                  )}
                </div>
                <ul className="mt-3 flex flex-col gap-1.5 text-[12px]">
                  <LegendRow color="#c8e87c" label="Premium pagante" n={stats.paid} />
                  <LegendRow color="#67e8f9" label="Premium liberado" n={stats.granted} />
                  {stats.anomaly > 0 ? (
                    <LegendRow color="#fca5a5" label="⚠ Sem origem" n={stats.anomaly} />
                  ) : null}
                  <LegendRow color="#5b5b66" label="Free" n={stats.free} />
                  <LegendRow color="#a78bfa" label="⚡ Beta Pro" n={stats.beta} />
                </ul>
              </>
            ) : (
              <div className="h-16 animate-pulse rounded-[10px] bg-white/5" />
            )}
          </SidePanel>

          <SidePanel title="Ferramentas mais usadas · 30d">
            {dash ? (
              dash.toolRanking.length ? (
                <ul className="flex flex-col gap-2">
                  {dash.toolRanking.slice(0, 8).map((t, i) => {
                    const max = dash.toolRanking[0]?.count ?? 1;
                    return (
                      <li key={t.tool} className="flex items-center gap-2">
                        <span className="w-4 text-right text-[10px] font-bold text-text-dim">
                          {i + 1}
                        </span>
                        <span className="w-[45%] truncate text-[12px] text-white">
                          {toolLabel(t.tool)}
                        </span>
                        <span className="relative h-2 flex-1 overflow-hidden rounded-full bg-black/40">
                          <span
                            className="absolute inset-y-0 left-0 rounded-full"
                            style={{
                              width: `${Math.max((t.count / max) * 100, 5)}%`,
                              background: 'rgba(192,132,252,0.85)',
                              boxShadow: '0 0 8px rgba(192,132,252,0.7)',
                            }}
                          />
                        </span>
                        <span className="w-8 text-right text-[11px] font-bold text-text-muted">
                          {t.count}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <div className="py-3 text-center text-[12px] text-text-dim">Sem uso registrado.</div>
              )
            ) : (
              <div className="h-24 animate-pulse rounded-[10px] bg-white/5" />
            )}
          </SidePanel>

          <SidePanel title="Online agora">
            {users ? (
              stats.online > 0 ? (
                <ul className="flex flex-col gap-2">
                  {(users ?? [])
                    .filter(isOnline)
                    .slice(0, 10)
                    .map((u) => (
                      <li key={u.id} className="flex items-center gap-2 text-[12px]">
                        <span className="relative flex h-1.5 w-1.5 shrink-0">
                          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-lime opacity-60" />
                          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-lime" />
                        </span>
                        <span className="truncate text-white">{u.name || u.email}</span>
                        {isUsingTool(u) && u.last_tool ? (
                          <span className="ml-auto shrink-0 text-[11px] text-lime">
                            {toolLabel(u.last_tool)}
                          </span>
                        ) : null}
                      </li>
                    ))}
                </ul>
              ) : (
                <div className="py-3 text-center text-[12px] text-text-dim">
                  Ninguém online no momento.
                </div>
              )
            ) : (
              <div className="h-16 animate-pulse rounded-[10px] bg-white/5" />
            )}
          </SidePanel>
        </aside>
      </div>

      <div className="h-16" />

      {/* ───────── Toast ───────── */}
      {toast ? (
        <div
          role="status"
          className={
            'toast-pop fixed bottom-6 left-1/2 z-50 max-w-[90vw] -translate-x-1/2 rounded-full border px-5 py-2.5 text-xs font-semibold uppercase tracking-[0.14em] shadow-2xl backdrop-blur-xl ' +
            (toast.kind === 'ok'
              ? 'border-lime/50 bg-bg/85 text-lime shadow-[0_0_28px_-8px_rgba(200,232,124,0.6)]'
              : 'border-red-500/50 bg-bg/85 text-red-300 shadow-[0_0_28px_-8px_rgba(248,113,113,0.6)]')
          }
          style={{ fontFamily: 'var(--font-tech)' }}
        >
          {toast.msg}
        </div>
      ) : null}

      {/* ───────── Modal BETA PRO ───────── */}
      {betaModal ? (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
          onClick={() => (betaModal.saving ? null : setBetaModal(null))}
        >
          <div
            className="dropdown-pop relative w-full max-w-lg overflow-hidden rounded-[20px] border border-violet/45 bg-bg-soft p-6"
            onClick={(e) => e.stopPropagation()}
            style={{
              boxShadow:
                '0 32px 64px -20px rgba(0,0,0,0.95), 0 0 60px -12px rgba(167,139,250,0.4), inset 0 1px 0 rgba(255,255,255,0.06)',
            }}
          >
            <div
              className="inline-flex items-center gap-2 rounded-full border border-violet/45 bg-violet/10 px-3 py-1 text-[10.5px] font-bold uppercase tracking-[0.2em] text-violet"
              style={{ fontFamily: 'var(--font-tech)' }}
            >
              <span className="inline-block h-1.5 w-1.5 animate-pulse-soft rounded-full bg-violet" />
              ⚡ BETA PRO
            </div>
            <h3
              className="mt-3 text-[20px] font-extrabold tracking-tight text-white"
              style={{ fontFamily: 'var(--font-tech)' }}
            >
              Ferramentas internas liberadas
            </h3>
            <p className="mt-1 text-[12.5px] leading-relaxed text-text-muted">
              Pra <span className="font-medium text-white">{betaModal.user.email}</span> — libera
              SÓ as ferramentas marcadas. A conta{' '}
              <span className="font-semibold text-white">não vira admin</span> e continua no plano
              atual ({betaModal.user.plan === 'premium' ? 'Premium' : 'Free'}).
            </p>

            <div className="mt-4 flex max-h-[46vh] flex-col gap-1.5 overflow-y-auto pr-1">
              {UNLOCKABLE_TOOLS.map((t) => {
                const fixed = betaModal.user.static_unlocks.includes(t.path);
                const on = fixed || betaModal.sel.has(t.path);
                return (
                  <button
                    key={t.path}
                    disabled={fixed || betaModal.saving}
                    onClick={() => {
                      const sel = new Set(betaModal.sel);
                      if (sel.has(t.path)) sel.delete(t.path);
                      else sel.add(t.path);
                      setBetaModal({ ...betaModal, sel });
                    }}
                    className={
                      'flex items-start gap-3 rounded-[12px] border p-3 text-left transition ' +
                      (on
                        ? 'border-violet/55 bg-violet/10'
                        : 'border-line hover:border-line-strong hover:bg-white/[0.03]') +
                      (fixed ? ' cursor-not-allowed opacity-80' : '')
                    }
                  >
                    <span
                      className={
                        'mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px] border text-[11px] font-bold ' +
                        (on
                          ? 'border-violet bg-violet text-black'
                          : 'border-line-strong text-transparent')
                      }
                    >
                      ✓
                    </span>
                    <span className="min-w-0">
                      <span className="flex items-center gap-2 text-[13px] font-bold text-white">
                        {t.label}
                        {fixed ? (
                          <span
                            className="rounded-full border border-line-strong px-1.5 py-0.5 text-[8.5px] font-bold uppercase tracking-[0.1em] text-text-dim"
                            style={{ fontFamily: 'var(--font-tech)' }}
                            title="Desbloqueio fixo por email no código/env — não dá pra remover pelo painel"
                          >
                            FIXO
                          </span>
                        ) : null}
                      </span>
                      <span className="mt-0.5 block text-[11.5px] leading-snug text-text-muted">
                        {t.desc}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="mt-5 flex items-center justify-between gap-2">
              <span className="text-[11px] text-text-dim">
                {betaModal.sel.size} selecionada{betaModal.sel.size === 1 ? '' : 's'}
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => setBetaModal(null)}
                  disabled={betaModal.saving}
                  className="rounded-full border border-line-strong bg-bg-soft px-5 py-2 text-[12.5px] font-bold text-white transition hover:bg-bg"
                >
                  Cancelar
                </button>
                <button
                  onClick={saveBetaModal}
                  disabled={betaModal.saving}
                  className="rounded-full border border-violet/55 bg-violet/15 px-5 py-2 text-[12.5px] font-bold text-violet transition hover:bg-violet/25 disabled:opacity-50"
                >
                  {betaModal.saving ? 'Salvando…' : 'Salvar desbloqueios'}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* ───────── Modal senha provisória ───────── */}
      {resetModal ? (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
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
              <div
                className="text-[10px] font-bold uppercase tracking-[0.18em] text-text-muted"
                style={{ fontFamily: 'var(--font-tech)' }}
              >
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
              O usuário será forçado a trocar a senha no próximo login. Copie agora — depois que
              fechar, essa senha não pode ser recuperada.
            </p>

            <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
              <button
                onClick={() => {
                  navigator.clipboard.writeText(resetModal.password);
                  flash('ok', 'Senha copiada.', 2500);
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

/* ───────────────────── Subcomponentes ───────────────────── */

function StatCard({
  label,
  value,
  hue,
  live,
  onClick,
}: {
  label: string;
  value: string | number;
  hue: string;
  live?: boolean;
  onClick?: () => void;
}) {
  const Comp = onClick ? 'button' : 'div';
  return (
    <Comp
      onClick={onClick}
      className={
        'relative overflow-hidden rounded-[16px] border p-4 text-left transition ' +
        (onClick ? 'hover:-translate-y-[1px] cursor-pointer' : '')
      }
      style={{
        borderColor: hue.replace('0.6', '0.35').replace('0.45', '0.3'),
        background:
          'linear-gradient(180deg, rgba(255,255,255,0.03), rgba(0,0,0,0.25)), linear-gradient(180deg, rgb(var(--bg-softer)), var(--card-deep))',
        boxShadow: `0 0 26px -14px ${hue}`,
      }}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -right-5 -top-5 h-16 w-16 rounded-full opacity-40 blur-2xl"
        style={{ background: hue }}
      />
      <div
        className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.14em] text-text-muted"
        style={{ fontFamily: 'var(--font-tech)' }}
      >
        {live ? (
          <span className="inline-block h-1.5 w-1.5 animate-pulse-soft rounded-full bg-lime shadow-[0_0_8px_rgba(200,232,124,0.95)]" />
        ) : null}
        {label}
      </div>
      <div
        className="mt-1.5 text-[26px] font-extrabold tracking-tight text-white"
        style={{ fontFamily: 'var(--font-tech)', letterSpacing: '-0.02em' }}
      >
        {value}
      </div>
    </Comp>
  );
}

function SidePanel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      className="rounded-[16px] border border-line/70 p-4"
      style={{
        background:
          'linear-gradient(180deg, rgba(255,255,255,0.02), rgba(0,0,0,0.18)), linear-gradient(180deg, #131318, var(--card-deep))',
      }}
    >
      <h2
        className="mb-3 text-[11px] font-bold uppercase tracking-[0.18em] text-text-muted"
        style={{ fontFamily: 'var(--font-tech)' }}
      >
        {title}
      </h2>
      {children}
    </div>
  );
}

function LegendRow({ color, label, n }: { color: string; label: string; n: number }) {
  return (
    <li className="flex items-center gap-2">
      <span
        className="inline-block h-2 w-2 rounded-full"
        style={{ background: color, boxShadow: `0 0 6px ${color}88` }}
      />
      <span className="text-text-muted">{label}</span>
      <span className="ml-auto font-bold text-white">{n}</span>
    </li>
  );
}
