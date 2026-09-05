'use client';

import { useEffect, useMemo, useState } from 'react';
import { UNLOCKABLE_TOOLS } from '@/lib/tool-unlocks';

/**
 * /admin — O painel do dono. ÚNICO dashboard (o /admin/dashboard redireciona
 * pra cá).
 *
 * • Stats ao vivo (poll 15s): online agora, totais, pagantes (Stripe),
 *   liberados na mão, MRR.
 * • Financeiro: arrecadado por período (hoje / 7 dias / mês / total) +
 *   pagamentos com comprovante.
 * • Usuários: filtros pagante×liberado×free×beta-pro×online×inativos,
 *   busca, ordenação; ações com confirmação em 2 ETAPAS (modal) pra
 *   rebaixar plano e deletar.
 * • BETA PRO: ferramentas admin-only liberadas POR CONTA sem dar admin.
 * • Métricas de comportamento (ferramentas mais usadas, origem) contam SÓ
 *   clientes — uso da conta admin fica de fora (filtrado na API).
 *
 * Tema: 100% tokens (bg/line/text/lime/violet/cyan/amber via CSS vars) —
 * legível no escuro E no claro, sem hex fixo.
 */

type AdminUser = {
  id: string;
  email: string | null;
  name: string | null;
  is_admin: boolean;
  is_active: boolean;
  must_change_password: boolean;
  created_at: string;
  last_seen_at: string | null;
  last_ip: string | null;
  last_tool: string | null;
  last_tool_at: string | null;
  tier?: string | null;
  phone?: string | null;
  phone_verified?: boolean | null;
  subscription_status?: string | null;
  subscription_plan?: string | null;
  current_period_end?: string | null;
  traffic_source?: string | null;
  plan: 'premium' | 'free';
  access: 'paid' | 'granted' | 'pending' | 'anomaly' | 'free';
  tool_unlocks: string[];
  static_unlocks: string[];
  receipt_url: string | null;
  last_payment_at: string | null;
};

type Payment = {
  id: number;
  email: string | null;
  amount: number;
  currency: string;
  plan: string | null;
  billing: string | null;
  status: string;
  receipt_url: string | null;
  created_at: string | null;
};

type Dash = {
  totals: { users: number; online: number; paying: number; mrr: number };
  toolRanking: Array<{ tool: string; count: number }>;
  trafficSources: Array<{ source: string; count: number }>;
  payments: Payment[];
  revenueTotal: number;
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
  'auto-cortes': 'Auto Cortes',
  'auto-broll': 'Auto B-roll',
  'heygen-auto': 'Hey Auto',
  'clickup-pilot': 'Pilot',
  'remover-elementos': 'Remover Legenda',
  'separador-audio': 'Separador de Áudio',
  'ltx-video': 'LTX Video',
  fakepass: 'FakePrint',
  'caixinha-pergunta': 'Caixinha de Pergunta',
  lipsync: 'Lipsync',
  historico: 'Histórico',
};
const toolLabel = (s: string | null) => (s ? (TOOL_LABELS[s] ?? s) : null);

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

function timeAgo(iso: string | null): string | null {
  if (!iso) return null;
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 0) return null;
  if (s < 60) return 'agora';
  if (s < 3600) return `há ${Math.floor(s / 60)} min`;
  if (s < 86400) return `há ${Math.floor(s / 3600)} h`;
  if (s < 7 * 86400) return `há ${Math.floor(s / 86400)} d`;
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

function brl(centavos: number): string {
  return (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/* Acesso → cor por TOKEN (adapta no modo claro sozinho). */
type Accent = 'lime' | 'cyan' | 'violet' | 'amber' | 'neutral' | 'danger';
const ACCENT_VAR: Record<Accent, string> = {
  lime: 'var(--lime)',
  cyan: 'var(--cyan)',
  violet: 'var(--violet)',
  amber: 'var(--amber)',
  neutral: 'var(--text-dim)',
  danger: '220 68 80',
};
const accent = (a: Accent, alpha?: number) =>
  alpha == null ? `rgb(${ACCENT_VAR[a]})` : `rgb(${ACCENT_VAR[a]} / ${alpha})`;

const ACCESS_META: Record<
  AdminUser['access'],
  { label: string; accent: Accent }
> = {
  paid: { label: 'PREMIUM · PAGO', accent: 'lime' },
  granted: { label: 'PREMIUM · LIBERADO', accent: 'cyan' },
  // Renovação falhou → acesso SUSPENSO até o pagamento entrar (assinatura
  // continua viva no Stripe; o cliente resolve na tela de assinatura).
  pending: { label: 'PAGAMENTO PENDENTE', accent: 'amber' },
  anomaly: { label: 'PREMIUM · SEM ORIGEM', accent: 'danger' },
  free: { label: 'FREE', accent: 'neutral' },
};

type FilterKey =
  | 'all'
  | 'online'
  | 'paid'
  | 'pending'
  | 'granted'
  | 'free'
  | 'beta'
  | 'inactive'
  | 'anomaly';

type Period = 'today' | 'week' | 'month' | 'all';
const PERIOD_LABEL: Record<Period, string> = {
  today: 'Hoje',
  week: '7 dias',
  month: 'Este mês',
  all: 'Total',
};

function periodStart(p: Period): number {
  const now = new Date();
  if (p === 'today') return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (p === 'week') return Date.now() - 7 * 24 * 60 * 60 * 1000;
  if (p === 'month') return new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  return 0;
}

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
  const [period, setPeriod] = useState<Period>('month');

  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);
  const flash = (kind: 'ok' | 'err', msg: string, ms = 3500) => {
    setToast({ kind, msg });
    setTimeout(() => setToast(null), ms);
  };

  // ─── Data ───
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
      /* métrica secundária */
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

  // ─── Stats ───
  const stats = useMemo(() => {
    const list = users ?? [];
    return {
      total: list.length,
      online: list.filter(isOnline).length,
      paid: list.filter((u) => u.access === 'paid').length,
      granted: list.filter((u) => u.access === 'granted').length,
      pending: list.filter((u) => u.access === 'pending').length,
      anomaly: list.filter((u) => u.access === 'anomaly').length,
      free: list.filter((u) => u.plan === 'free').length,
      beta: list.filter((u) => betaProTools(u).length > 0).length,
      inactive: list.filter((u) => !u.is_active).length,
    };
  }, [users]);

  // ─── Financeiro (período) ───
  // Linhas 'refunded'/'disputed' são pagamentos DEVOLVIDOS: aparecem na
  // tabela (marcadas), mas ficam FORA do arrecadado — o número grande é
  // sempre líquido. (O reembolso conta no período do pagamento original.)
  const finance = useMemo(() => {
    const start = periodStart(period);
    const inPeriod = (dash?.payments ?? []).filter((p) =>
      p.created_at ? new Date(p.created_at).getTime() >= start : false,
    );
    const isPaid = (p: Payment) => p.status === 'paid' || p.status === 'succeeded';
    const isRefund = (p: Payment) => p.status === 'refunded' || p.status === 'disputed';
    const paid = inPeriod.filter(isPaid);
    const refunded = inPeriod.filter(isRefund);
    const total = paid.reduce((s, p) => s + (p.amount || 0), 0);
    const refundTotal = refunded.reduce((s, p) => s + (p.amount || 0), 0);

    // Série diária (últimos 30 dias, independente do período dos chips).
    const DAYS = 30;
    const dayKey = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const byDay = new Map<string, { paid: number; refunded: number }>();
    const today = new Date();
    const days: Array<{ key: string; label: string; paid: number; refunded: number }> = [];
    for (let i = DAYS - 1; i >= 0; i--) {
      const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
      const key = dayKey(d);
      byDay.set(key, { paid: 0, refunded: 0 });
      days.push({
        key,
        label: d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }),
        paid: 0,
        refunded: 0,
      });
    }
    for (const p of dash?.payments ?? []) {
      if (!p.created_at) continue;
      const key = dayKey(new Date(p.created_at));
      const slot = byDay.get(key);
      if (!slot) continue;
      if (isPaid(p)) slot.paid += p.amount || 0;
      else if (isRefund(p)) slot.refunded += p.amount || 0;
    }
    for (const d of days) {
      const slot = byDay.get(d.key)!;
      d.paid = slot.paid;
      d.refunded = slot.refunded;
    }

    return {
      list: inPeriod,
      total,
      count: paid.length,
      avg: paid.length ? Math.round(total / paid.length) : 0,
      refundTotal,
      refundCount: refunded.length,
      days,
      dayMax: Math.max(...days.map((d) => Math.max(d.paid, d.refunded)), 1),
    };
  }, [dash, period]);

  // ─── Filtro + busca + ordenação ───
  const visible = useMemo(() => {
    let list = users ?? [];
    switch (filter) {
      case 'online': list = list.filter(isOnline); break;
      case 'paid': list = list.filter((u) => u.access === 'paid'); break;
      case 'granted': list = list.filter((u) => u.access === 'granted'); break;
      case 'free': list = list.filter((u) => u.plan === 'free'); break;
      case 'beta': list = list.filter((u) => betaProTools(u).length > 0); break;
      case 'inactive': list = list.filter((u) => !u.is_active); break;
      case 'pending': list = list.filter((u) => u.access === 'pending'); break;
      case 'anomaly': list = list.filter((u) => u.access === 'anomaly'); break;
    }
    const query = q.trim().toLowerCase();
    if (query) {
      list = list.filter(
        (u) =>
          (u.name ?? '').toLowerCase().includes(query) ||
          (u.email ?? '').toLowerCase().includes(query) ||
          (u.last_ip ?? '').toLowerCase().includes(query) ||
          (toolLabel(u.last_tool) ?? '').toLowerCase().includes(query),
      );
    }
    const byDate = (v: string | null | undefined) => (v ? new Date(v).getTime() : 0);
    list = [...list];
    if (sort === 'recent') list.sort((a, b) => byDate(b.created_at) - byDate(a.created_at));
    else if (sort === 'seen') list.sort((a, b) => byDate(b.last_seen_at) - byDate(a.last_seen_at));
    else list.sort((a, b) => (a.name ?? a.email ?? '').localeCompare(b.name ?? b.email ?? '', 'pt-BR'));
    return list;
  }, [users, filter, q, sort]);

  // ─── Ações ───
  const [busyId, setBusyId] = useState<string | null>(null);

  /** Confirmação em 2 ETAPAS — nada destrutivo acontece em 1 clique. */
  const [confirmBox, setConfirmBox] = useState<{
    title: string;
    body: React.ReactNode;
    confirmLabel: string;
    accent: Accent;
    run: () => Promise<void>;
    running?: boolean;
  } | null>(null);

  async function doSetPlan(u: AdminUser, plan: 'free' | 'premium') {
    setBusyId(u.id);
    try {
      const res = await fetch('/api/admin/set-tier', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId: u.id, tier: plan === 'premium' ? 'basic' : 'free' }),
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

  function changePlan(u: AdminUser, plan: 'free' | 'premium') {
    if (u.plan === plan) return;
    if (plan === 'premium') {
      // Liberar é seguro e reversível — direto.
      void doSetPlan(u, 'premium');
      return;
    }
    // Rebaixar pra FREE → SEMPRE 2 etapas.
    setConfirmBox({
      title: 'Rebaixar pra FREE?',
      accent: 'danger',
      confirmLabel: 'Sim, rebaixar pra FREE',
      body:
        u.access === 'paid' ? (
          <>
            <span className="font-bold text-text">{u.email || u.name}</span> é{' '}
            <span className="font-bold" style={{ color: accent('lime') }}>
              PAGANTE (Stripe)
            </span>
            . Rebaixar corta o acesso Premium agora, mas{' '}
            <span className="font-bold text-text">não cancela a assinatura no Stripe</span> — ele
            pode continuar sendo cobrado.
          </>
        ) : (
          <>
            <span className="font-bold text-text">{u.email || u.name}</span> vai perder o acesso
            Premium que você liberou. Dá pra liberar de novo depois.
          </>
        ),
      run: () => doSetPlan(u, 'free'),
    });
  }

  async function doToggle(u: AdminUser, action: 'activate' | 'deactivate' | 'delete') {
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

  function askDelete(u: AdminUser) {
    setConfirmBox({
      title: 'Deletar usuário?',
      accent: 'danger',
      confirmLabel: 'Sim, deletar de vez',
      body: (
        <>
          <span className="font-bold text-text">{u.email || u.name}</span> será removido{' '}
          <span className="font-bold text-text">permanentemente</span> — conta, acesso e histórico.
          Essa ação não tem volta.
        </>
      ),
      run: () => doToggle(u, 'delete'),
    });
  }

  const [resetModal, setResetModal] = useState<{ email: string; password: string } | null>(null);

  function askResetPassword(u: AdminUser) {
    setConfirmBox({
      title: 'Gerar nova senha provisória?',
      accent: 'amber',
      confirmLabel: 'Gerar senha',
      body: (
        <>
          <span className="font-bold text-text">{u.email}</span> será forçado a trocar a senha no
          próximo login. A senha atual dele deixa de valer.
        </>
      ),
      run: async () => {
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
      },
    });
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

  // ─── BETA PRO ───
  const [betaModal, setBetaModal] = useState<{
    user: AdminUser;
    sel: Set<string>;
    saving: boolean;
  } | null>(null);

  async function saveBetaModal() {
    if (!betaModal) return;
    setBetaModal({ ...betaModal, saving: true });
    try {
      const res = await fetch('/api/admin/set-tool-unlocks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId: betaModal.user.id, tools: Array.from(betaModal.sel) }),
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
          ? `Beta Pro: ${betaModal.sel.size} ferramenta${betaModal.sel.size > 1 ? 's' : ''} pra ${betaModal.user.email}.`
          : `Beta Pro removido de ${betaModal.user.email}.`,
      );
      setBetaModal(null);
      await load(true);
    } catch (e) {
      flash('err', (e as Error).message || 'Erro inesperado.');
      setBetaModal((m) => (m ? { ...m, saving: false } : m));
    }
  }

  // ─── Detalhe expandido ───
  const [expanded, setExpanded] = useState<string | null>(null);

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

  const chips: Array<{ key: FilterKey; label: string; count: number; accent: Accent; hide?: boolean }> = [
    { key: 'all', label: 'Todos', count: stats.total, accent: 'neutral' },
    { key: 'online', label: 'Online', count: stats.online, accent: 'lime' },
    { key: 'paid', label: 'Pagantes', count: stats.paid, accent: 'lime' },
    { key: 'granted', label: 'Liberados', count: stats.granted, accent: 'cyan' },
    { key: 'free', label: 'Free', count: stats.free, accent: 'neutral' },
    { key: 'beta', label: 'Beta Pro', count: stats.beta, accent: 'violet' },
    { key: 'inactive', label: 'Inativos', count: stats.inactive, accent: 'danger' },
    { key: 'pending', label: 'Pgto pendente', count: stats.pending, accent: 'amber', hide: stats.pending === 0 },
    { key: 'anomaly', label: 'Anomalia', count: stats.anomaly, accent: 'danger', hide: stats.anomaly === 0 },
  ];

  return (
    <div className="mx-auto w-full max-w-[1240px] px-5 md:px-8">
      {/* ═══════ Header ═══════ */}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="label-tech flex items-center gap-2 text-[10.5px] uppercase tracking-[0.22em] text-text-dim">
            <LiveDot />
            Admin · Central de controle
          </div>
          <h1 className="font-tech mt-2 text-[30px] font-extrabold tracking-[-0.03em] text-text md:text-[38px]">
            Painel admin
          </h1>
          <p className="mt-1 text-[12.5px] text-text-muted">
            {updatedAt
              ? `Atualizado ${updatedAt.toLocaleTimeString('pt-BR')} · automático a cada 15s`
              : 'Carregando…'}
          </p>
        </div>
        <button
          onClick={() => setCreateOpen((v) => !v)}
          className="btn-primary !px-5 !py-2.5 text-[12.5px]"
        >
          {createOpen ? 'Fechar' : 'Criar usuário'}
        </button>
      </header>

      {error ? (
        <div
          key={error}
          role="alert"
          className="error-shake mt-6 rounded-[12px] border border-red-500/40 bg-red-500/10 px-4 py-3 text-xs text-red-300"
        >
          <div>{error}</div>
          {errorDetail ? (
            <div className="mono mt-2 text-[10px] opacity-70">detail: {errorDetail}</div>
          ) : null}
        </div>
      ) : null}

      {/* ═══════ Criar usuário ═══════ */}
      {createOpen ? (
        <section className="fade-in-up mt-6">
          <form
            onSubmit={createUser}
            className="grid gap-3 rounded-[16px] border border-line bg-bg-soft p-4 sm:grid-cols-[1fr_1.2fr_1fr_auto]"
          >
            <input type="text" placeholder="Nome" value={newName} onChange={(e) => setNewName(e.target.value)} required className="input-field" disabled={creating} minLength={2} />
            <input type="email" placeholder="email@exemplo.com" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} required className="input-field" disabled={creating} />
            <input type="text" placeholder="Senha provisória (mín. 8)" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required className="input-field" disabled={creating} minLength={8} />
            <button type="submit" className="btn-primary whitespace-nowrap" disabled={creating || !newEmail || !newPassword || !newName}>
              {creating ? 'Criando…' : 'Criar e ativar'}
            </button>
            <p className="text-[11px] text-text-muted sm:col-span-4">
              Senha provisória — no primeiro login o cliente troca por uma senha pessoal e você não tem mais acesso.
            </p>
          </form>
        </section>
      ) : null}

      {/* ═══════ Stats ═══════ */}
      <section className="mt-7 grid grid-cols-2 gap-3 md:grid-cols-5">
        <StatCard label="Online agora" value={users ? stats.online : '—'} a="lime" live />
        <StatCard label="Usuários" value={users ? stats.total : '—'} a="violet" />
        <StatCard label="Pagantes · Stripe" value={users ? stats.paid : '—'} a="lime" onClick={() => setFilter('paid')} />
        <StatCard label="Liberados por você" value={users ? stats.granted : '—'} a="cyan" onClick={() => setFilter('granted')} />
        <StatCard label="MRR estimado" value={dash ? `R$ ${dash.totals.mrr.toLocaleString('pt-BR')}` : '—'} a="amber" />
      </section>

      {/* ═══════ Financeiro ═══════ */}
      <section className="mt-6">
        <Panel
          title="Financeiro"
          right={
            <div className="flex overflow-hidden rounded-full border border-line">
              {(Object.keys(PERIOD_LABEL) as Period[]).map((p) => (
                <button
                  key={p}
                  onClick={() => setPeriod(p)}
                  className={
                    'font-tech px-3 py-1 text-[10.5px] font-bold uppercase tracking-[0.1em] transition ' +
                    (period === p ? 'text-text' : 'text-text-dim hover:text-text-muted')
                  }
                  style={period === p ? { background: accent('lime', 0.16) } : undefined}
                >
                  {PERIOD_LABEL[p]}
                </button>
              ))}
            </div>
          }
        >
          {dash ? (
            <div className="flex flex-col gap-4">
              <div className="grid gap-4 lg:grid-cols-[250px_1fr]">
                {/* Resumo do período */}
                <div className="flex flex-col justify-center gap-3.5 rounded-[14px] border border-line bg-bg p-4">
                  <div>
                    <div className="label-tech text-[10px] uppercase tracking-[0.16em] text-text-dim">
                      Arrecadado · {PERIOD_LABEL[period]}
                    </div>
                    <div
                      className="font-tech mt-1 text-[28px] font-extrabold tracking-tight"
                      style={{ color: accent('lime'), fontVariantNumeric: 'tabular-nums' }}
                    >
                      {brl(finance.total)}
                    </div>
                    {finance.refundCount > 0 ? (
                      <div className="mt-0.5 text-[11.5px] font-semibold" style={{ color: accent('danger') }}>
                        −{brl(finance.refundTotal)} reembolsado ({finance.refundCount})
                      </div>
                    ) : null}
                  </div>
                  <div className="flex gap-6">
                    <div>
                      <div className="label-tech text-[10px] uppercase tracking-[0.14em] text-text-dim">Pagamentos</div>
                      <div className="font-tech mt-0.5 text-[17px] font-bold text-text">{finance.count}</div>
                    </div>
                    <div>
                      <div className="label-tech text-[10px] uppercase tracking-[0.14em] text-text-dim">Ticket médio</div>
                      <div className="font-tech mt-0.5 text-[17px] font-bold text-text" style={{ fontVariantNumeric: 'tabular-nums' }}>
                        {finance.count ? brl(finance.avg) : '—'}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Receita diária — últimos 30 dias */}
                <div className="rounded-[14px] border border-line bg-bg p-4">
                  <div className="label-tech mb-3 flex items-center justify-between text-[10px] uppercase tracking-[0.16em] text-text-dim">
                    <span>Receita por dia · últimos 30 dias</span>
                    <span className="flex items-center gap-3 normal-case tracking-normal">
                      <span className="flex items-center gap-1">
                        <span className="h-1.5 w-1.5 rounded-full" style={{ background: accent('lime', 0.85) }} />
                        pago
                      </span>
                      {finance.days.some((d) => d.refunded > 0) ? (
                        <span className="flex items-center gap-1">
                          <span className="h-1.5 w-1.5 rounded-full" style={{ background: accent('danger', 0.8) }} />
                          reembolso
                        </span>
                      ) : null}
                    </span>
                  </div>
                  <div className="flex h-[92px] items-end gap-[3px]">
                    {finance.days.map((d) => {
                      const hPaid = d.paid ? Math.max((d.paid / finance.dayMax) * 100, 6) : 0;
                      const hRef = d.refunded ? Math.max((d.refunded / finance.dayMax) * 100, 6) : 0;
                      return (
                        <div
                          key={d.key}
                          className="group relative flex h-full flex-1 flex-col items-stretch justify-end gap-[2px]"
                          title={`${d.label} · pago ${brl(d.paid)}${d.refunded ? ` · reembolso ${brl(d.refunded)}` : ''}`}
                        >
                          {hRef > 0 ? (
                            <div className="w-full rounded-[2px]" style={{ height: `${hRef}%`, background: accent('danger', 0.7) }} />
                          ) : null}
                          {hPaid > 0 ? (
                            <div className="w-full rounded-[2px]" style={{ height: `${hPaid}%`, background: accent('lime', 0.8) }} />
                          ) : (
                            <div className="w-full rounded-[2px] bg-line/60" style={{ height: 2 }} />
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <div className="mt-1.5 flex justify-between text-[9.5px] text-text-dim">
                    <span>{finance.days[0]?.label}</span>
                    <span>{finance.days[Math.floor(finance.days.length / 2)]?.label}</span>
                    <span>hoje</span>
                  </div>
                </div>
              </div>

              {/* Pagamentos do período */}
              {finance.list.length ? (
                <div className="max-h-[250px] overflow-y-auto rounded-[14px] border border-line bg-bg">
                  <table className="w-full text-left text-[12.5px]">
                    <thead className="sticky top-0 bg-bg">
                      <tr className="label-tech text-[9.5px] uppercase tracking-[0.14em] text-text-dim">
                        <th className="px-3 py-2.5 font-bold">Cliente</th>
                        <th className="px-3 py-2.5 font-bold">Plano</th>
                        <th className="px-3 py-2.5 font-bold">Valor</th>
                        <th className="px-3 py-2.5 font-bold">Status</th>
                        <th className="px-3 py-2.5 font-bold">Data</th>
                        <th className="px-3 py-2.5 font-bold">Comprovante</th>
                      </tr>
                    </thead>
                    <tbody>
                      {finance.list.map((p) => {
                        const refunded = p.status === 'refunded' || p.status === 'disputed';
                        return (
                          <tr key={p.id} className="border-t border-line/60 transition hover:bg-line/15">
                            <td className="max-w-[220px] truncate px-3 py-2 text-text">{p.email || '—'}</td>
                            <td className="px-3 py-2 text-text-muted">
                              {p.plan === 'basic' ? 'Premium' : (p.plan ?? '—')}
                              {p.billing ? (p.billing === 'annual' ? ' · anual' : ' · mensal') : ''}
                            </td>
                            <td
                              className={'px-3 py-2 font-bold ' + (refunded ? 'line-through opacity-60' : '')}
                              style={{ color: refunded ? 'rgb(var(--text-muted))' : accent('lime'), fontVariantNumeric: 'tabular-nums' }}
                            >
                              {brl(p.amount)}
                            </td>
                            <td className="px-3 py-2">
                              {refunded ? (
                                <Badge a="danger">{p.status === 'disputed' ? 'Chargeback' : 'Reembolsado'}</Badge>
                              ) : (
                                <Badge a="lime">Pago</Badge>
                              )}
                            </td>
                            <td className="whitespace-nowrap px-3 py-2 text-text-muted">
                              {p.created_at ? new Date(p.created_at).toLocaleDateString('pt-BR') : '—'}
                            </td>
                            <td className="px-3 py-2">
                              {p.receipt_url ? (
                                <a
                                  href={p.receipt_url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1 font-semibold underline-offset-2 hover:underline"
                                  style={{ color: accent('violet') }}
                                >
                                  <IconReceipt /> abrir
                                </a>
                              ) : (
                                <span className="text-text-dim">—</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="flex items-center justify-center rounded-[14px] border border-dashed border-line py-6 text-[12.5px] text-text-dim">
                  Nenhum pagamento em “{PERIOD_LABEL[period]}”.
                </div>
              )}
            </div>
          ) : (
            <div className="h-40 animate-pulse rounded-[12px] bg-line/30" />
          )}
        </Panel>
      </section>

      {/* ═══════ Usuários + lateral ═══════ */}
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[1fr_296px]">
        <section>
          {/* Filtros */}
          <div className="flex flex-wrap items-center gap-1.5">
            {chips
              .filter((c) => !c.hide)
              .map((c) => {
                const active = filter === c.key;
                return (
                  <button
                    key={c.key}
                    onClick={() => setFilter(c.key)}
                    className={
                      'font-tech rounded-full border px-3 py-1.5 text-[10.5px] font-bold uppercase tracking-[0.08em] transition ' +
                      (active ? '' : 'border-line text-text-dim hover:border-line-strong hover:text-text-muted')
                    }
                    style={
                      active
                        ? {
                            borderColor: accent(c.accent, 0.55),
                            background: accent(c.accent, 0.13),
                            color: c.accent === 'neutral' ? 'rgb(var(--text))' : accent(c.accent),
                          }
                        : undefined
                    }
                  >
                    {c.key === 'online' ? <LiveDot className="mr-1.5 inline-block align-middle" /> : null}
                    {c.label}
                    <span className="ml-1.5 opacity-60">{c.count}</span>
                  </button>
                );
              })}
          </div>

          {/* Busca + ordenação */}
          <div className="mt-3 flex gap-2">
            <div className="relative flex-1">
              <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-text-dim">
                <IconSearch />
              </span>
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Buscar por nome, email, IP ou ferramenta…"
                className="input-field w-full !pl-10"
              />
            </div>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as typeof sort)}
              className="font-tech rounded-[12px] border border-line bg-bg-soft px-3 text-[11px] font-bold uppercase tracking-[0.08em] text-text-muted"
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
                return (
                  <div
                    key={u.id}
                    className={'rounded-[14px] border bg-bg-soft transition ' + (u.is_active ? 'border-line' : 'border-line opacity-55')}
                    style={online ? { borderColor: accent('lime', 0.35) } : undefined}
                  >
                    <div className="flex flex-wrap items-center gap-3 p-3">
                      {/* Identidade (clica → detalhes) */}
                      <button
                        onClick={() => setExpanded(isOpen ? null : u.id)}
                        className="flex min-w-0 flex-1 items-center gap-3 text-left"
                        title={isOpen ? 'Fechar detalhes' : 'Ver detalhes'}
                      >
                        <span
                          className="font-tech relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full border text-[13px] font-extrabold uppercase"
                          style={{
                            color: accent(meta.accent),
                            borderColor: accent(meta.accent, 0.4),
                            background: accent(meta.accent, 0.1),
                          }}
                        >
                          {(u.name || u.email || '?').slice(0, 1)}
                          {online ? (
                            <span
                              className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-bg-soft"
                              style={{ background: accent('lime') }}
                            />
                          ) : null}
                        </span>
                        <span className="min-w-0">
                          <span className="flex flex-wrap items-center gap-1.5">
                            <span className="truncate text-[13.5px] font-bold text-text">{u.name || '(sem nome)'}</span>
                            <Badge a={meta.accent}>{meta.label}</Badge>
                            {beta.length > 0 ? (
                              <Badge a="violet" title={beta.map((p) => CATALOG_LABEL.get(p) ?? p).join(' · ')}>
                                <IconBolt /> BETA PRO {beta.length}
                              </Badge>
                            ) : null}
                            {!u.is_active ? <Badge a="danger">INATIVO</Badge> : null}
                            {u.must_change_password ? <Badge a="amber">SENHA PROVISÓRIA</Badge> : null}
                          </span>
                          <span className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-text-muted">
                            <span className="mono truncate">{u.email || '(sem email)'}</span>
                            {usingNow && tLabel ? (
                              <span className="whitespace-nowrap">
                                usando <span className="font-semibold" style={{ color: accent('lime') }}>{tLabel}</span>
                              </span>
                            ) : tLabel ? (
                              <span className="whitespace-nowrap text-text-dim">{tLabel}</span>
                            ) : null}
                            {u.last_seen_at ? (
                              <span className="whitespace-nowrap text-text-dim">visto {timeAgo(u.last_seen_at)}</span>
                            ) : null}
                            {u.last_ip ? <span className="mono whitespace-nowrap text-text-dim">{u.last_ip}</span> : null}
                          </span>
                        </span>
                      </button>

                      {/* Ações */}
                      <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                        {u.access === 'paid' && u.receipt_url ? (
                          <a
                            href={u.receipt_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-tech inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.08em] transition hover:opacity-80"
                            style={{ borderColor: accent('lime', 0.45), color: accent('lime') }}
                            title={`Comprovante Stripe${u.last_payment_at ? ` · ${new Date(u.last_payment_at).toLocaleDateString('pt-BR')}` : ''}`}
                          >
                            <IconReceipt /> Comprovante
                          </a>
                        ) : null}
                        <div className="font-tech flex overflow-hidden rounded-full border border-line">
                          {(['free', 'premium'] as const).map((p) => (
                            <button
                              key={p}
                              onClick={() => changePlan(u, p)}
                              disabled={busyId === u.id || u.plan === p}
                              className={
                                'px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.08em] transition disabled:cursor-default ' +
                                (u.plan === p ? '' : 'text-text-dim hover:text-text-muted')
                              }
                              style={
                                u.plan === p
                                  ? {
                                      background: accent(u.plan === 'premium' ? (u.access === 'paid' ? 'lime' : 'cyan') : 'neutral', 0.16),
                                      color: p === 'premium' ? accent(u.access === 'paid' ? 'lime' : 'cyan') : 'rgb(var(--text))',
                                    }
                                  : undefined
                              }
                              title={p === 'premium' ? 'Liberar Premium na mão (não expira)' : 'Rebaixar pra Free (pede confirmação)'}
                            >
                              {p === 'free' ? 'Free' : 'Premium'}
                            </button>
                          ))}
                        </div>
                        <IconBtn a="violet" onClick={() => setBetaModal({ user: u, sel: new Set(u.tool_unlocks.filter((p) => CATALOG_PATHS.has(p))), saving: false })} disabled={busyId === u.id} title="Beta Pro — liberar ferramentas internas só pra esta conta" solid={beta.length > 0}>
                          <IconBolt /> Beta Pro
                        </IconBtn>
                        <IconBtn a="amber" onClick={() => askResetPassword(u)} disabled={busyId === u.id} title="Gerar nova senha provisória">
                          <IconKey /> Senha
                        </IconBtn>
                        <IconBtn a="neutral" onClick={() => doToggle(u, u.is_active ? 'deactivate' : 'activate')} disabled={busyId === u.id} title={u.is_active ? 'Desativar (reversível)' : 'Reativar'}>
                          {u.is_active ? 'Desativar' : 'Ativar'}
                        </IconBtn>
                        <IconBtn a="danger" onClick={() => askDelete(u)} disabled={busyId === u.id} title="Deletar (pede confirmação)">
                          <IconTrash />
                        </IconBtn>
                      </div>
                    </div>

                    {/* Detalhes */}
                    {isOpen ? (
                      <div className="fade-in-up border-t border-line/70 px-4 py-3">
                        <div className="flex flex-wrap gap-x-6 gap-y-1.5 text-[12px] text-text-muted">
                          <span>
                            Cadastro: <span className="text-text">{new Date(u.created_at).toLocaleDateString('pt-BR')}</span>
                          </span>
                          {u.traffic_source ? (
                            <span>
                              Origem: <span className="text-text">{u.traffic_source}</span>
                            </span>
                          ) : null}
                          {u.phone ? (
                            <span>
                              Tel: <span className="mono text-text">{u.phone}</span>
                              {u.phone_verified ? ' ✓' : ' (não verificado)'}
                            </span>
                          ) : null}
                          {u.subscription_status ? (
                            <span>
                              Stripe: <span className="mono text-text">{u.subscription_status}</span>
                            </span>
                          ) : null}
                          {u.current_period_end ? (
                            <span>
                              Acesso pago até: <span className="text-text">{new Date(u.current_period_end).toLocaleDateString('pt-BR')}</span>
                            </span>
                          ) : null}
                          {u.last_payment_at ? (
                            <span>
                              Último pagamento: <span className="text-text">{new Date(u.last_payment_at).toLocaleDateString('pt-BR')}</span>
                            </span>
                          ) : null}
                        </div>

                        {beta.length > 0 ? (
                          <div className="mt-2.5 flex flex-wrap items-center gap-1.5 text-[11px]">
                            <span className="label-tech uppercase tracking-[0.14em] text-text-dim">Beta Pro:</span>
                            {beta.map((p) => (
                              <Badge key={p} a="violet">
                                {CATALOG_LABEL.get(p) ?? p}
                                {u.static_unlocks.includes(p) && !u.tool_unlocks.includes(p) ? ' · fixo' : ''}
                              </Badge>
                            ))}
                          </div>
                        ) : null}

                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          {u.access === 'granted' ? (
                            <span className="text-[12px]" style={{ color: accent('cyan') }}>
                              Premium liberado por você (não expira, não passa pelo Stripe).
                            </span>
                          ) : u.access === 'anomaly' ? (
                            <span className="text-[12px] text-red-300">
                              Premium sem comprovante e sem concessão sua — use “Sincronizar c/ Stripe”.
                            </span>
                          ) : null}
                          <button
                            onClick={() => reconcile(u)}
                            disabled={busyId === u.id}
                            className="font-tech ml-auto rounded-full border px-3 py-1 text-[10.5px] font-bold uppercase tracking-[0.08em] transition hover:opacity-80 disabled:opacity-40"
                            style={{ borderColor: accent('cyan', 0.5), color: accent('cyan') }}
                            title="Lê o estado REAL do Stripe e aplica o plano pago (conserta 'pagou e continuou free')"
                          >
                            Sincronizar c/ Stripe
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })
            ) : loading && !users ? (
              <div className="rounded-[14px] border border-line bg-bg-soft p-8 text-center text-xs text-text-muted">Carregando usuários…</div>
            ) : (
              <div className="rounded-[14px] border border-line bg-bg-soft p-8 text-center text-xs text-text-muted">
                {q || filter !== 'all' ? 'Nenhum usuário bate com esse filtro.' : 'Nenhum usuário ainda.'}
              </div>
            )}
          </div>
        </section>

        {/* ═══════ Lateral ═══════ */}
        <aside className="flex flex-col gap-4">
          <Panel title="Distribuição" compact>
            {users ? (
              <>
                <div className="flex h-3.5 w-full overflow-hidden rounded-full border border-line">
                  {(
                    [
                      ['lime', stats.paid],
                      ['cyan', stats.granted],
                      ['danger', stats.anomaly],
                      ['neutral', stats.free],
                    ] as Array<[Accent, number]>
                  ).map(([a, n], i) =>
                    n > 0 ? (
                      <div key={i} style={{ width: `${(n / Math.max(stats.total, 1)) * 100}%`, background: accent(a, a === 'neutral' ? 0.45 : 0.8) }} />
                    ) : null,
                  )}
                </div>
                <ul className="mt-3 flex flex-col gap-1.5 text-[12px]">
                  <LegendRow a="lime" label="Premium pagante" n={stats.paid} />
                  <LegendRow a="cyan" label="Premium liberado" n={stats.granted} />
                  {stats.anomaly > 0 ? <LegendRow a="danger" label="Sem origem" n={stats.anomaly} /> : null}
                  <LegendRow a="neutral" label="Free" n={stats.free} />
                  <LegendRow a="violet" label="Beta Pro" n={stats.beta} />
                </ul>
              </>
            ) : (
              <div className="h-16 animate-pulse rounded-[10px] bg-line/30" />
            )}
          </Panel>

          <Panel title="Ferramentas mais usadas" hint="30 dias · só clientes" compact>
            {dash ? (
              dash.toolRanking.length ? (
                <ul className="flex flex-col gap-2">
                  {dash.toolRanking.slice(0, 8).map((t, i) => {
                    const max = dash.toolRanking[0]?.count ?? 1;
                    return (
                      <li key={t.tool} className="flex items-center gap-2">
                        <span className="w-4 shrink-0 text-right text-[10px] font-bold text-text-dim">{i + 1}</span>
                        <span className="w-[44%] truncate text-[12px] text-text">{toolLabel(t.tool)}</span>
                        <span className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-line/50">
                          <span
                            className="absolute inset-y-0 left-0 rounded-full"
                            style={{ width: `${Math.max((t.count / max) * 100, 5)}%`, background: accent('violet', 0.75) }}
                          />
                        </span>
                        <span className="w-8 shrink-0 text-right text-[11px] font-bold text-text-muted">{t.count}</span>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <div className="py-3 text-center text-[12px] text-text-dim">Sem uso registrado.</div>
              )
            ) : (
              <div className="h-24 animate-pulse rounded-[10px] bg-line/30" />
            )}
          </Panel>

          <Panel title="Por onde chegaram" hint="só clientes" compact>
            {dash ? (
              dash.trafficSources.length ? (
                <ul className="flex flex-col gap-2">
                  {dash.trafficSources.slice(0, 6).map((s) => {
                    const max = dash.trafficSources[0]?.count ?? 1;
                    return (
                      <li key={s.source} className="flex items-center gap-2">
                        <span className="w-[44%] truncate text-[12px] text-text">{s.source}</span>
                        <span className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-line/50">
                          <span
                            className="absolute inset-y-0 left-0 rounded-full"
                            style={{ width: `${Math.max((s.count / max) * 100, 5)}%`, background: accent('cyan', 0.75) }}
                          />
                        </span>
                        <span className="w-8 shrink-0 text-right text-[11px] font-bold text-text-muted">{s.count}</span>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <div className="py-3 text-center text-[12px] text-text-dim">Sem dados de origem.</div>
              )
            ) : (
              <div className="h-20 animate-pulse rounded-[10px] bg-line/30" />
            )}
          </Panel>

          <Panel title="Online agora" compact>
            {users ? (
              stats.online > 0 ? (
                <ul className="flex flex-col gap-2">
                  {(users ?? [])
                    .filter(isOnline)
                    .slice(0, 10)
                    .map((u) => (
                      <li key={u.id} className="flex items-center gap-2 text-[12px]">
                        <LiveDot />
                        <span className="truncate text-text">{u.name || u.email}</span>
                        {isUsingTool(u) && u.last_tool ? (
                          <span className="ml-auto shrink-0 text-[11px]" style={{ color: accent('lime') }}>
                            {toolLabel(u.last_tool)}
                          </span>
                        ) : null}
                      </li>
                    ))}
                </ul>
              ) : (
                <div className="py-3 text-center text-[12px] text-text-dim">Ninguém online no momento.</div>
              )
            ) : (
              <div className="h-16 animate-pulse rounded-[10px] bg-line/30" />
            )}
          </Panel>
        </aside>
      </div>

      <div className="h-16" />

      {/* ═══════ Toast ═══════ */}
      {toast ? (
        <div
          role="status"
          className="toast-pop font-tech fixed bottom-6 left-1/2 z-50 max-w-[90vw] -translate-x-1/2 rounded-full border bg-bg-elev px-5 py-2.5 text-xs font-semibold uppercase tracking-[0.12em] shadow-2xl"
          style={
            toast.kind === 'ok'
              ? { borderColor: accent('lime', 0.5), color: accent('lime') }
              : { borderColor: accent('danger', 0.5), color: accent('danger') }
          }
        >
          {toast.msg}
        </div>
      ) : null}

      {/* ═══════ Modal de CONFIRMAÇÃO (2ª etapa) ═══════ */}
      {confirmBox ? (
        <Modal onClose={() => (confirmBox.running ? null : setConfirmBox(null))} accent={confirmBox.accent}>
          <div className="label-tech text-[10.5px] uppercase tracking-[0.2em]" style={{ color: accent(confirmBox.accent) }}>
            Confirmação
          </div>
          <h3 className="font-tech mt-2 text-[20px] font-extrabold tracking-tight text-text">{confirmBox.title}</h3>
          <p className="mt-2 text-[13px] leading-relaxed text-text-muted">{confirmBox.body}</p>
          <div className="mt-5 flex items-center justify-end gap-2">
            <button
              onClick={() => setConfirmBox(null)}
              disabled={confirmBox.running}
              className="rounded-full border border-line bg-bg px-5 py-2 text-[12.5px] font-bold text-text transition hover:bg-bg-soft"
            >
              Cancelar
            </button>
            <button
              onClick={async () => {
                setConfirmBox((c) => (c ? { ...c, running: true } : c));
                try {
                  await confirmBox.run();
                } finally {
                  setConfirmBox(null);
                }
              }}
              disabled={confirmBox.running}
              className="rounded-full border px-5 py-2 text-[12.5px] font-bold transition hover:opacity-85 disabled:opacity-50"
              style={{
                borderColor: accent(confirmBox.accent, 0.55),
                background: accent(confirmBox.accent, 0.14),
                color: accent(confirmBox.accent),
              }}
            >
              {confirmBox.running ? 'Executando…' : confirmBox.confirmLabel}
            </button>
          </div>
        </Modal>
      ) : null}

      {/* ═══════ Modal BETA PRO ═══════ */}
      {betaModal ? (
        <Modal onClose={() => (betaModal.saving ? null : setBetaModal(null))} accent="violet" wide>
          <div className="label-tech flex items-center gap-1.5 text-[10.5px] uppercase tracking-[0.2em]" style={{ color: accent('violet') }}>
            <IconBolt /> Beta Pro
          </div>
          <h3 className="font-tech mt-2 text-[20px] font-extrabold tracking-tight text-text">Ferramentas internas liberadas</h3>
          <p className="mt-1.5 text-[12.5px] leading-relaxed text-text-muted">
            Pra <span className="font-semibold text-text">{betaModal.user.email}</span> — libera só o que estiver marcado. A conta{' '}
            <span className="font-semibold text-text">não vira admin</span> e continua {betaModal.user.plan === 'premium' ? 'Premium' : 'Free'}.
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
                    (on ? '' : 'border-line hover:border-line-strong') +
                    (fixed ? ' cursor-not-allowed opacity-75' : '')
                  }
                  style={on ? { borderColor: accent('violet', 0.5), background: accent('violet', 0.08) } : undefined}
                >
                  <span
                    className="mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px] border text-[11px] font-bold"
                    style={
                      on
                        ? { borderColor: accent('violet'), background: accent('violet'), color: 'rgb(var(--bg))' }
                        : { borderColor: 'rgb(var(--line-strong))', color: 'transparent' }
                    }
                  >
                    ✓
                  </span>
                  <span className="min-w-0">
                    <span className="flex items-center gap-2 text-[13px] font-bold text-text">
                      {t.label}
                      {fixed ? (
                        <span
                          className="font-tech rounded-full border border-line px-1.5 py-0.5 text-[8.5px] font-bold uppercase tracking-[0.1em] text-text-dim"
                          title="Fixo por email no código/env — não dá pra remover pelo painel"
                        >
                          Fixo
                        </span>
                      ) : null}
                    </span>
                    <span className="mt-0.5 block text-[11.5px] leading-snug text-text-muted">{t.desc}</span>
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
                className="rounded-full border border-line bg-bg px-5 py-2 text-[12.5px] font-bold text-text transition hover:bg-bg-soft"
              >
                Cancelar
              </button>
              <button
                onClick={saveBetaModal}
                disabled={betaModal.saving}
                className="rounded-full border px-5 py-2 text-[12.5px] font-bold transition hover:opacity-85 disabled:opacity-50"
                style={{ borderColor: accent('violet', 0.55), background: accent('violet', 0.14), color: accent('violet') }}
              >
                {betaModal.saving ? 'Salvando…' : 'Salvar desbloqueios'}
              </button>
            </div>
          </div>
        </Modal>
      ) : null}

      {/* ═══════ Modal senha provisória ═══════ */}
      {resetModal ? (
        <Modal onClose={() => setResetModal(null)} accent="amber">
          <div className="label-tech text-[10.5px] uppercase tracking-[0.2em]" style={{ color: accent('amber') }}>
            Senha provisória
          </div>
          <h3 className="font-tech mt-2 text-[20px] font-extrabold tracking-tight text-text">Nova senha gerada</h3>
          <p className="mt-1 text-[12.5px] text-text-muted">
            Pra <span className="font-medium text-text">{resetModal.email}</span>
          </p>
          <div className="mt-4 rounded-[14px] border border-line bg-bg p-4">
            <div className="label-tech text-[10px] uppercase tracking-[0.18em] text-text-dim">Senha</div>
            <div className="mono mt-1 select-all text-center text-[24px] font-bold tracking-[0.06em]" style={{ color: accent('amber') }}>
              {resetModal.password}
            </div>
          </div>
          <p className="mt-3 text-[12px] leading-relaxed text-text-muted">
            O usuário será forçado a trocar no próximo login. Copie agora — depois de fechar, essa senha não pode ser recuperada.
          </p>
          <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
            <button
              onClick={() => {
                navigator.clipboard.writeText(resetModal.password);
                flash('ok', 'Senha copiada.', 2500);
              }}
              className="rounded-full border px-5 py-2 text-[12.5px] font-bold transition hover:opacity-85"
              style={{ borderColor: accent('amber', 0.5), background: accent('amber', 0.12), color: accent('amber') }}
            >
              Copiar senha
            </button>
            <button
              onClick={() => setResetModal(null)}
              className="rounded-full border border-line bg-bg px-5 py-2 text-[12.5px] font-bold text-text transition hover:bg-bg-soft"
            >
              Fechar
            </button>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

/* ───────────────────── Subcomponentes ───────────────────── */

function LiveDot({ className = '' }: { className?: string }) {
  return (
    <span className={'relative flex h-1.5 w-1.5 shrink-0 ' + className}>
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-50" style={{ background: accent('lime') }} />
      <span className="relative inline-flex h-1.5 w-1.5 rounded-full" style={{ background: accent('lime') }} />
    </span>
  );
}

function StatCard({
  label,
  value,
  a,
  live,
  onClick,
}: {
  label: string;
  value: string | number;
  a: Accent;
  live?: boolean;
  onClick?: () => void;
}) {
  const Comp = onClick ? 'button' : 'div';
  return (
    <Comp
      onClick={onClick}
      className={
        'relative overflow-hidden rounded-[16px] border border-line bg-bg-soft p-4 text-left transition ' +
        (onClick ? 'cursor-pointer hover:-translate-y-[1px] hover:border-line-strong' : '')
      }
    >
      <span aria-hidden className="absolute inset-x-0 top-0 h-[2px]" style={{ background: accent(a, 0.55) }} />
      <div className="label-tech flex items-center gap-2 text-[10px] uppercase tracking-[0.14em] text-text-dim">
        {live ? <LiveDot /> : null}
        {label}
      </div>
      <div className="font-tech mt-1.5 text-[26px] font-extrabold tracking-[-0.02em] text-text">{value}</div>
    </Comp>
  );
}

function Panel({
  title,
  hint,
  right,
  compact,
  children,
}: {
  title: string;
  hint?: string;
  right?: React.ReactNode;
  compact?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={'rounded-[16px] border border-line bg-bg-soft ' + (compact ? 'p-4' : 'p-4 md:p-5')}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="label-tech text-[11px] font-bold uppercase tracking-[0.18em] text-text-muted">
          {title}
          {hint ? <span className="ml-2 font-normal normal-case tracking-normal text-text-dim">{hint}</span> : null}
        </h2>
        {right}
      </div>
      {children}
    </div>
  );
}

function Badge({ a, title, children }: { a: Accent; title?: string; children: React.ReactNode }) {
  return (
    <span
      className="font-tech inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.1em]"
      style={{ color: accent(a === 'neutral' ? 'neutral' : a), borderColor: accent(a, 0.45), background: accent(a, 0.09) }}
      title={title}
    >
      {children}
    </span>
  );
}

function IconBtn({
  a,
  onClick,
  disabled,
  title,
  solid,
  children,
}: {
  a: Accent;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  solid?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="font-tech inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.08em] transition hover:opacity-80 disabled:opacity-40"
      style={
        a === 'neutral'
          ? { borderColor: 'rgb(var(--line-strong))', color: 'rgb(var(--text-muted))' }
          : {
              borderColor: accent(a, 0.45),
              color: accent(a),
              background: solid ? accent(a, 0.12) : undefined,
            }
      }
    >
      {children}
    </button>
  );
}

function LegendRow({ a, label, n }: { a: Accent; label: string; n: number }) {
  return (
    <li className="flex items-center gap-2">
      <span className="inline-block h-2 w-2 rounded-full" style={{ background: accent(a, a === 'neutral' ? 0.5 : 0.85) }} />
      <span className="text-text-muted">{label}</span>
      <span className="ml-auto font-bold text-text">{n}</span>
    </li>
  );
}

function Modal({
  onClose,
  accent: a,
  wide,
  children,
}: {
  onClose: () => void;
  accent: Accent;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        className={'dropdown-pop relative w-full overflow-hidden rounded-[20px] border bg-bg-elev p-6 ' + (wide ? 'max-w-lg' : 'max-w-md')}
        onClick={(e) => e.stopPropagation()}
        style={{
          borderColor: accent(a, 0.4),
          boxShadow: '0 32px 64px -20px rgba(0,0,0,0.55), inset 0 1px 0 rgb(var(--line) / 0.6)',
        }}
      >
        {children}
      </div>
    </div>
  );
}

/* ───────────────────── Ícones (SVG, herdam a cor) ───────────────────── */

function IconSearch() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

function IconBolt() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
      <path d="M13 2 4.5 13.5H11L9.5 22 19 10.5h-6.5L13 2Z" />
    </svg>
  );
}

function IconReceipt() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 3h14v18l-2.5-1.5L14 21l-2-1.5L10 21l-2.5-1.5L5 21V3Z" />
      <path d="M9 8h6M9 12h6" />
    </svg>
  );
}

function IconKey() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="15" r="4.5" />
      <path d="m11.5 11.5 8-8M16 7l3 3" />
    </svg>
  );
}

function IconTrash() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 11v6M14 11v6" />
    </svg>
  );
}
