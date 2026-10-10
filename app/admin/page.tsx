'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { UNLOCKABLE_TOOLS } from '@/lib/tool-unlocks';
import { BarSeries, RankList } from './_ui/charts';
import { Btn, Dot, I, Modal, Panel, Segmented, Shell, Skeleton, Stat, Tag } from './_ui/kit';
import {
  CANCEL_META,
  CATALOG_PATHS,
  accent,
  betaProTools,
  brl,
  cancelApplies,
  dayLabel,
  fmtDate,
  fmtDateShort,
  fmtDateTime,
  fmtTime,
  isOnline,
  isUsingTool,
  toolLabel,
  type Accent,
  type AdminUser,
  type CancelRow,
  type Dash,
  type Payment,
} from './_ui/model';
import { ProfileSheet, type ProfileTab } from './_ui/ProfileSheet';
import { AnnouncementsStudio } from './_ui/AnnouncementsStudio';
import { AnnIcon } from '@/components/notifications/templates';
import type { AdminAnnouncement } from '@/lib/announcements';
import { ToolsCenter } from './_ui/ToolsCenter';
import { WrenchGlyph } from '@/components/MaintenanceFlash';
import { activeMaintenance, type ToolsConfig } from '@/lib/maintenance';
import { CancelTag, UserRow, type RowActions } from './_ui/UserRow';

/**
 * /admin — O painel do dono. ÚNICO dashboard (o /admin/dashboard redireciona
 * pra cá).
 *
 * • Números ao vivo (lista a cada 15 s, métricas a cada 60 s; pausa com a aba
 *   escondida): online, clientes, pagantes, liberados, MRR, acesso simultâneo.
 * • Financeiro por período com comprovante; crescimento e engajamento.
 * • Clientes: filtros, busca (nome, email, telefone, IP, ferramenta), 40 por
 *   vez. Cada linha abre o PERFIL COMPLETO (contato, plano, pagamentos,
 *   uso, histórico de IPs com aviso de acesso simultâneo).
 * • Ações destrutivas SEMPRE em 2 etapas (janela própria).
 * • Avisos (09.10): botão no topo abre a Central de avisos (aviso pequeno ou
 *   propaganda grande, filtro por Free/Premium/Pagantes/etc., prévia ao vivo).
 * • Cancelamentos (09.10): lista lida do Stripe (agendado / reembolsado /
 *   encerrado), selo na linha do cliente, filtro "Cancelaram" e a ação
 *   "Cancelar e reembolsar" (prévia do valor e da data antes do clique).
 * • Métricas de comportamento contam SÓ clientes (filtrado na API).
 *
 * Desenho: kit em ./_ui (casca dupla, hairline, rótulo em sentença, cor só por
 * token, legível no claro e no escuro). Nada animando em loop.
 */

type FilterKey = 'all' | 'online' | 'paid' | 'pending' | 'granted' | 'free' | 'beta' | 'inactive' | 'anomaly' | 'concurrent' | 'canceled';
type CancelFilter = 'all' | 'scheduled' | 'refunded' | 'ended';
type Period = 'today' | 'week' | 'month' | 'all';
type SortKey = 'recent' | 'seen' | 'name';

const PERIOD_LABEL: Record<Period, string> = { today: 'Hoje', week: '7 dias', month: 'Este mês', all: 'Total' };
const PAGE = 40;

function periodStart(p: Period): number {
  const now = new Date();
  if (p === 'today') return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (p === 'week') return Date.now() - 7 * 86_400_000;
  if (p === 'month') return new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  return 0;
}

const isPaidPay = (p: Payment) => p.status === 'paid' || p.status === 'succeeded';
const isRefundPay = (p: Payment) => p.status === 'refunded' || p.status === 'disputed';

export default function AdminPage() {
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  // Nível da consulta no servidor: fora do 'full' falta dado (plano ou Beta
  // Pro) e o painel AVISA em vez de mostrar zeros que parecem verdade.
  const [schema, setSchema] = useState<'full' | 'mid' | 'basic'>('full');
  const [dash, setDash] = useState<Dash | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const [filter, setFilter] = useState<FilterKey>('all');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<SortKey>('recent');
  const [period, setPeriod] = useState<Period>('month');
  const [limit, setLimit] = useState(PAGE);

  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flash = useCallback((kind: 'ok' | 'err', msg: string, ms = 3800) => {
    setToast({ kind, msg });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), ms);
  }, []);

  // ─── Dados ───
  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/list-users', { cache: 'no-store' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error || 'Falha ao listar os clientes.');
        setErrorDetail(json.detail || null);
        return;
      }
      setError(null);
      setErrorDetail(null);
      setUsers(json.users ?? []);
      setSchema(json.schema === 'mid' || json.schema === 'basic' ? json.schema : 'full');
      setUpdatedAt(new Date());
      setNow(Date.now());
    } catch (e) {
      setError((e as Error).message || 'Falha de conexão.');
    }
  }, []);

  const loadDash = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/dashboard', { cache: 'no-store' });
      if (!res.ok) return;
      setDash((await res.json()) as Dash);
    } catch {
      /* métrica secundária */
    }
  }, []);

  // Cancelamentos — direto do Stripe (o banco não sabe do agendado).
  const [cancels, setCancels] = useState<CancelRow[] | null>(null);
  const [cancelsErr, setCancelsErr] = useState<string | null>(null);
  const [cancelFilter, setCancelFilter] = useState<CancelFilter>('all');
  const loadCancels = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/cancellations', { cache: 'no-store' });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setCancelsErr(j.error || 'Não deu pra ler os cancelamentos no Stripe.');
        return;
      }
      setCancelsErr(null);
      setCancels((j.rows ?? []) as CancelRow[]);
    } catch {
      setCancelsErr('Sem conexão com o Stripe agora.');
    }
  }, []);

  useEffect(() => {
    loadCancels();
    const t = setInterval(() => document.visibilityState === 'visible' && loadCancels(), 120_000);
    return () => clearInterval(t);
  }, [loadCancels]);

  useEffect(() => {
    load();
    loadDash();
    const visible = () => document.visibilityState === 'visible';
    const a = setInterval(() => visible() && load(), 15_000);
    const b = setInterval(() => visible() && loadDash(), 60_000);
    const onVis = () => {
      if (visible()) {
        load();
        loadDash();
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(a);
      clearInterval(b);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [load, loadDash]);

  // ─── Números ───
  const stats = useMemo(() => {
    const list = users ?? [];
    return {
      total: list.length,
      online: list.filter((u) => isOnline(u, now)).length,
      usingTool: list.filter((u) => isOnline(u, now) && isUsingTool(u, now)).length,
      paid: list.filter((u) => u.access === 'paid').length,
      granted: list.filter((u) => u.access === 'granted').length,
      pending: list.filter((u) => u.access === 'pending').length,
      anomaly: list.filter((u) => u.access === 'anomaly').length,
      free: list.filter((u) => u.plan === 'free').length,
      beta: list.filter((u) => betaProTools(u).length > 0).length,
      inactive: list.filter((u) => !u.is_active).length,
      concurrent: list.filter((u) => (u.concurrent_30d ?? 0) > 0).length,
      withPhone: list.filter((u) => !!u.phone).length,
    };
  }, [users, now]);

  const byEmail = useMemo(() => {
    const m = new Map<string, AdminUser>();
    for (const u of users ?? []) if (u.email) m.set(u.email.toLowerCase(), u);
    return m;
  }, [users]);

  // ─── Financeiro do período ───
  // 'refunded'/'disputed' aparecem na tabela (marcados), mas ficam FORA do
  // arrecadado: o número grande é sempre líquido.
  const finance = useMemo(() => {
    const start = periodStart(period);
    const pays = dash?.payments ?? [];
    const inPeriod = pays.filter((p) => (p.created_at ? new Date(p.created_at).getTime() >= start : false));
    const paid = inPeriod.filter(isPaidPay);
    const refunded = inPeriod.filter(isRefundPay);
    const total = paid.reduce((s, p) => s + (p.amount || 0), 0);

    const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' });
    const days: Array<{ key: string; label: string; value: number }> = [];
    const index = new Map<string, { key: string; label: string; value: number }>();
    for (let i = 29; i >= 0; i--) {
      const key = dayFmt.format(new Date(Date.now() - i * 86_400_000));
      if (index.has(key)) continue;
      const d = { key, label: dayLabel(key), value: 0 };
      index.set(key, d);
      days.push(d);
    }
    for (const p of pays) {
      if (!p.created_at || !isPaidPay(p)) continue;
      const d = index.get(dayFmt.format(new Date(p.created_at)));
      if (d) d.value += p.amount || 0;
    }
    return {
      list: inPeriod,
      total,
      count: paid.length,
      avg: paid.length ? Math.round(total / paid.length) : 0,
      refundTotal: refunded.reduce((s, p) => s + (p.amount || 0), 0),
      refundCount: refunded.length,
      days,
    };
  }, [dash, period]);

  // ─── Cancelamentos por conta (a linha mais recente de cada uma) ───
  const cancelByUser = useMemo(() => {
    const m = new Map<string, CancelRow>();
    for (const c of cancels ?? []) if (c.user_id && !m.has(c.user_id)) m.set(c.user_id, c);
    return m;
  }, [cancels]);
  const userById = useMemo(() => {
    const m = new Map<string, AdminUser>();
    for (const u of users ?? []) m.set(u.id, u);
    return m;
  }, [users]);
  const canceledCount = useMemo(
    () => (users ?? []).filter((u) => cancelApplies(cancelByUser.get(u.id), u)).length,
    [users, cancelByUser],
  );
  const cancelRows = useMemo(() => {
    const list = cancels ?? [];
    if (cancelFilter === 'scheduled') return list.filter((c) => c.kind === 'scheduled');
    if (cancelFilter === 'refunded') return list.filter((c) => c.kind === 'refunded' || c.kind === 'refund');
    if (cancelFilter === 'ended') return list.filter((c) => c.kind === 'ended');
    return list;
  }, [cancels, cancelFilter]);

  // ─── Filtro + busca + ordem ───
  const visible = useMemo(() => {
    let list = users ?? [];
    switch (filter) {
      case 'online': list = list.filter((u) => isOnline(u, now)); break;
      case 'paid': list = list.filter((u) => u.access === 'paid'); break;
      case 'granted': list = list.filter((u) => u.access === 'granted'); break;
      case 'free': list = list.filter((u) => u.plan === 'free'); break;
      case 'beta': list = list.filter((u) => betaProTools(u).length > 0); break;
      case 'inactive': list = list.filter((u) => !u.is_active); break;
      case 'pending': list = list.filter((u) => u.access === 'pending'); break;
      case 'anomaly': list = list.filter((u) => u.access === 'anomaly'); break;
      case 'concurrent': list = list.filter((u) => (u.concurrent_30d ?? 0) > 0); break;
      case 'canceled': list = list.filter((u) => cancelApplies(cancelByUser.get(u.id), u)); break;
    }
    const query = q.trim().toLowerCase();
    if (query) {
      const digits = query.replace(/\D/g, '');
      list = list.filter(
        (u) =>
          (u.name ?? '').toLowerCase().includes(query) ||
          (u.email ?? '').toLowerCase().includes(query) ||
          (u.last_ip ?? '').toLowerCase().includes(query) ||
          (toolLabel(u.last_tool) ?? '').toLowerCase().includes(query) ||
          (digits.length >= 4 && (u.phone ?? '').replace(/\D/g, '').includes(digits)),
      );
    }
    const at = (v: string | null | undefined) => (v ? new Date(v).getTime() : 0);
    list = [...list];
    if (sort === 'recent') list.sort((a, b) => at(b.created_at) - at(a.created_at));
    else if (sort === 'seen') list.sort((a, b) => at(b.last_seen_at) - at(a.last_seen_at));
    else list.sort((a, b) => (a.name ?? a.email ?? '').localeCompare(b.name ?? b.email ?? '', 'pt-BR'));
    return list;
  }, [users, filter, q, sort, now, cancelByUser]);

  useEffect(() => setLimit(PAGE), [filter, q, sort]);

  // ─── Ações ───
  const [busyId, setBusyId] = useState<string | null>(null);
  const [profileNonce, setProfileNonce] = useState(0);
  const afterAction = useCallback(async () => {
    await load();
    setProfileNonce((n) => n + 1);
    void loadCancels();
    void loadDash();
  }, [load, loadCancels, loadDash]);

  /** Confirmação em 2 ETAPAS: nada destrutivo acontece em 1 clique. */
  const [confirmBox, setConfirmBox] = useState<{
    title: string;
    body: React.ReactNode;
    confirmLabel: string;
    tone: Accent;
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
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) {
        flash('err', json.error || json.detail || 'Falha ao trocar o plano.');
        return;
      }
      flash('ok', plan === 'premium' ? `${u.email || u.name} agora é Premium (liberado por você).` : `${u.email || u.name} voltou pro Free.`);
      await afterAction();
    } catch (e) {
      flash('err', (e as Error).message || 'Erro inesperado.');
    } finally {
      setBusyId(null);
    }
  }

  function changePlan(u: AdminUser, plan: 'free' | 'premium') {
    if (u.plan === plan) return;
    if (plan === 'premium') {
      void doSetPlan(u, 'premium'); // liberar é seguro e reversível
      return;
    }
    setConfirmBox({
      title: 'Rebaixar pro Free?',
      tone: 'danger',
      confirmLabel: 'Sim, rebaixar pro Free',
      body:
        u.access === 'paid' ? (
          <>
            <b className="text-text">{u.email || u.name}</b> é <b style={{ color: accent('lime') }}>pagante no Stripe</b>. Rebaixar corta o Premium agora, mas{' '}
            <b className="text-text">não cancela a assinatura no Stripe</b>: a pessoa pode continuar sendo cobrada.
          </>
        ) : (
          <>
            <b className="text-text">{u.email || u.name}</b> perde o Premium que você liberou. Dá pra liberar de novo depois.
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
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        flash('err', json.error || 'Falha.');
        return;
      }
      flash('ok', action === 'delete' ? 'Usuário deletado.' : action === 'activate' ? 'Conta reativada.' : 'Conta desativada.');
      if (action === 'delete') setProfile((p) => (p?.id === u.id ? null : p));
      await afterAction();
    } catch (e) {
      flash('err', (e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  function toggleActive(u: AdminUser) {
    if (!u.is_active) {
      void doToggle(u, 'activate');
      return;
    }
    setConfirmBox({
      title: 'Desativar a conta?',
      tone: 'amber',
      confirmLabel: 'Desativar',
      body: (
        <>
          <b className="text-text">{u.email || u.name}</b> perde o acesso ao app na hora. Nada é apagado: dá pra reativar depois.
        </>
      ),
      run: () => doToggle(u, 'deactivate'),
    });
  }

  function askDelete(u: AdminUser) {
    setConfirmBox({
      title: 'Deletar usuário?',
      tone: 'danger',
      confirmLabel: 'Sim, deletar de vez',
      body: (
        <>
          <b className="text-text">{u.email || u.name}</b> será removido <b className="text-text">permanentemente</b>: conta, acesso e histórico. Essa ação não tem volta.
        </>
      ),
      run: () => doToggle(u, 'delete'),
    });
  }

  const [resetModal, setResetModal] = useState<{ email: string; password: string } | null>(null);

  function askResetPassword(u: AdminUser) {
    setConfirmBox({
      title: 'Gerar nova senha provisória?',
      tone: 'amber',
      confirmLabel: 'Gerar senha',
      body: (
        <>
          <b className="text-text">{u.email}</b> vai ter que trocar a senha no próximo login. A senha atual deixa de valer.
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
          const json = await res.json().catch(() => ({}));
          if (!res.ok || !json.ok) {
            flash('err', json.error || 'Falha ao gerar a senha.');
            return;
          }
          setResetModal({ email: u.email || '', password: json.password });
          await afterAction();
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
      flash(j.applied ? 'ok' : 'err', j.applied ? `Aplicado: ${String(j.tier).toUpperCase()}. ${j.reason}` : `Nada a aplicar: ${j.reason}`, 5200);
      await afterAction();
    } finally {
      setBusyId(null);
    }
  }

  // ─── Cancelar / reembolsar (assinatura no Stripe) ───
  type CancelPreview = {
    email: string | null;
    subscription: { id: string; status: string; live: boolean; cancel_scheduled: boolean; period_end: string | null } | null;
    one_time: boolean;
    eligible_by_policy: boolean;
    block_text: string | null;
    charge: { amount: number; refunded: number; paid_at: string; deadline: string; kind: string } | null;
  };

  async function askCancelSub(u: AdminUser, mode: 'refund_now' | 'at_period_end') {
    setBusyId(u.id);
    let pv: CancelPreview;
    try {
      const res = await fetch(`/api/admin/refund-cancel?userId=${encodeURIComponent(u.id)}`, { cache: 'no-store' });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        flash('err', j.error || 'Falha ao ler o Stripe.', 6000);
        return;
      }
      pv = j as CancelPreview;
    } catch (e) {
      flash('err', (e as Error).message || 'Falha de conexão.');
      return;
    } finally {
      setBusyId(null);
    }
    const who = u.email || u.name || 'Cliente';

    const post = async () => {
      setBusyId(u.id);
      try {
        const res = await fetch('/api/admin/refund-cancel', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ userId: u.id, mode }),
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok || !j.ok) {
          flash('err', [j.error, j.detail].filter(Boolean).join(' — ') || 'Falha no Stripe.', 8000);
          return;
        }
        if (j.mode === 'refunded') {
          flash(
            'ok',
            j.already_refunded
              ? `${who}: assinatura encerrada (o valor já tinha sido devolvido). Premium removido.`
              : `${who}: ${brl(j.refunded)} devolvidos no cartão, assinatura encerrada e Premium removido.`,
            7000,
          );
        } else {
          flash('ok', `${who}: renovação desligada. Acesso até ${fmtDate(j.access_until) ?? 'o fim do período'}, sem nova cobrança.`, 7000);
        }
        await afterAction();
      } catch (e) {
        flash('err', (e as Error).message || 'Erro inesperado.');
      } finally {
        setBusyId(null);
      }
    };

    if (mode === 'at_period_end') {
      if (!pv.subscription?.live) {
        flash('err', `${who} não tem assinatura viva no Stripe.`);
        return;
      }
      if (pv.subscription.cancel_scheduled) {
        flash('ok', `${who} já está com o cancelamento agendado: acesso até ${fmtDate(pv.subscription.period_end) ?? 'o fim do período'}.`);
        return;
      }
      setConfirmBox({
        title: 'Cancelar no fim do período?',
        tone: 'amber',
        confirmLabel: 'Sim, desligar a renovação',
        body: (
          <>
            <b className="text-text">{who}</b> continua Premium até{' '}
            <b className="text-text">{fmtDate(pv.subscription.period_end) ?? 'o fim do período'}</b> e não é cobrado de novo.
            Sem reembolso.
          </>
        ),
        run: post,
      });
      return;
    }

    const c = pv.charge;
    if (!c || c.amount <= 0) {
      flash('err', `Não achei uma cobrança paga de ${who} pra devolver.`);
      return;
    }
    const remaining = Math.max(0, c.amount - c.refunded);
    setConfirmBox({
      title: remaining > 0 ? `Devolver ${brl(remaining)} e cancelar?` : 'Encerrar a assinatura?',
      tone: 'danger',
      confirmLabel: remaining > 0 ? `Sim, devolver ${brl(remaining)}` : 'Sim, encerrar agora',
      body: (
        <>
          <b className="text-text">{who}</b> pagou <b className="text-text">{brl(c.amount)}</b> em {fmtDateTime(c.paid_at)}.{' '}
          {remaining <= 0 ? (
            <>Esse valor já foi devolvido; falta só encerrar a assinatura e tirar o Premium.</>
          ) : pv.eligible_by_policy ? (
            <>
              Está dentro dos 7 dias (até {fmtDateTime(c.deadline)}), então é o reembolso que a política garante.
            </>
          ) : (
            <>
              <b style={{ color: accent('amber') }}>Fora da regra automática</b>: {pv.block_text}. Você está devolvendo por decisão própria.
            </>
          )}
          <br />
          <br />
          {remaining > 0 ? 'O valor volta pro cartão, ' : ''}a assinatura é encerrada no Stripe agora e o Premium cai na hora. Não tem como desfazer.
        </>
      ),
      run: post,
    });
  }

  // ─── Beta Pro ───
  const [betaModal, setBetaModal] = useState<{ user: AdminUser; sel: Set<string>; saving: boolean } | null>(null);

  function openBeta(u: AdminUser) {
    setBetaModal({ user: u, sel: new Set(u.tool_unlocks.filter((p) => CATALOG_PATHS.has(p))), saving: false });
  }

  async function saveBetaModal() {
    if (!betaModal) return;
    setBetaModal({ ...betaModal, saving: true });
    try {
      const res = await fetch('/api/admin/set-tool-unlocks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId: betaModal.user.id, tools: Array.from(betaModal.sel) }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) {
        flash('err', json.error || 'Falha ao salvar os desbloqueios.', 6000);
        setBetaModal((m) => (m ? { ...m, saving: false } : m));
        return;
      }
      flash(
        'ok',
        betaModal.sel.size
          ? `Beta Pro: ${betaModal.sel.size} ${betaModal.sel.size > 1 ? 'ferramentas' : 'ferramenta'} pra ${betaModal.user.email}.`
          : `Beta Pro removido de ${betaModal.user.email}.`,
      );
      setBetaModal(null);
      await afterAction();
    } catch (e) {
      flash('err', (e as Error).message || 'Erro inesperado.');
      setBetaModal((m) => (m ? { ...m, saving: false } : m));
    }
  }

  // ─── Perfil (painel lateral, com link direto ?u=<id>&aba=<aba>) ───
  const [profile, setProfile] = useState<{ id: string; tab: ProfileTab } | null>(null);
  const deepLinkRead = useRef(false);

  useEffect(() => {
    if (deepLinkRead.current || !users) return;
    deepLinkRead.current = true;
    try {
      const sp = new URLSearchParams(window.location.search);
      const id = sp.get('u');
      const aba = sp.get('aba') as ProfileTab | null;
      if (id && users.some((u) => u.id === id)) {
        setProfile({ id, tab: aba && ['geral', 'acessos', 'uso', 'pagamentos'].includes(aba) ? aba : 'geral' });
      }
    } catch {
      /* URL sem parâmetros */
    }
  }, [users]);

  useEffect(() => {
    if (!deepLinkRead.current) return;
    try {
      const url = new URL(window.location.href);
      if (profile) {
        url.searchParams.set('u', profile.id);
        if (profile.tab === 'geral') url.searchParams.delete('aba');
        else url.searchParams.set('aba', profile.tab);
      } else {
        url.searchParams.delete('u');
        url.searchParams.delete('aba');
      }
      window.history.replaceState(window.history.state, '', url.toString());
    } catch {
      /* sem history */
    }
  }, [profile]);

  const openProfile = useCallback((u: AdminUser, tab: ProfileTab = 'geral') => setProfile({ id: u.id, tab }), []);
  const profileUser = profile ? (users ?? []).find((u) => u.id === profile.id) ?? null : null;

  // Ações estáveis pras linhas memoizadas (a linha não re-renderiza quando a
  // página muda por outro motivo: busca, toast, gráfico).
  const impl = useRef<RowActions>(null as unknown as RowActions);
  impl.current = {
    open: openProfile,
    plan: changePlan,
    beta: openBeta,
    reset: askResetPassword,
    toggle: toggleActive,
    remove: askDelete,
    reconcile,
    cancelSub: askCancelSub,
  };
  const actions = useMemo<RowActions>(
    () => ({
      open: (u, t) => impl.current.open(u, t),
      plan: (u, p) => impl.current.plan(u, p),
      beta: (u) => impl.current.beta(u),
      reset: (u) => impl.current.reset(u),
      toggle: (u) => impl.current.toggle(u),
      remove: (u) => impl.current.remove(u),
      reconcile: (u) => impl.current.reconcile(u),
      cancelSub: (u, m) => impl.current.cancelSub(u, m),
    }),
    [],
  );

  // ─── Avisos (central) ───
  const [studioOpen, setStudioOpen] = useState(false);
  const [annLive, setAnnLive] = useState<number | null>(null);
  const closeStudio = useCallback(() => setStudioOpen(false), []);
  const onAnnList = useCallback((items: AdminAnnouncement[]) => setAnnLive(items.filter((a) => a.live).length), []);
  useEffect(() => {
    let off = false;
    fetch('/api/admin/announcements', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!off && j && j.enabled !== false) onAnnList((j.items ?? []) as AdminAnnouncement[]);
      })
      .catch(() => {});
    return () => {
      off = true;
    };
  }, [onAnnList]);

  // ─── Ferramentas (manutenção) ───
  const [toolsOpen, setToolsOpen] = useState(false);
  const [toolsMaint, setToolsMaint] = useState<number | null>(null);
  const closeTools = useCallback(() => setToolsOpen(false), []);
  useEffect(() => {
    let off = false;
    fetch('/api/admin/tools-status', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!off && j?.cfg) setToolsMaint(Object.keys(activeMaintenance(j.cfg as ToolsConfig)).length);
      })
      .catch(() => {});
    return () => {
      off = true;
    };
  }, []);

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
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        flash('err', json.error || 'Falha ao criar.', 6000);
        return;
      }
      flash('ok', `${newEmail} criado com senha provisória.`);
      setNewEmail('');
      setNewPassword('');
      setNewName('');
      setCreateOpen(false);
      await load();
    } catch (e2) {
      flash('err', (e2 as Error).message);
    } finally {
      setCreating(false);
    }
  }

  const chips: Array<{ key: FilterKey; label: string; count: number; a: Accent; hide?: boolean }> = [
    { key: 'all', label: 'Todos', count: stats.total, a: 'neutral' },
    { key: 'online', label: 'Online', count: stats.online, a: 'lime' },
    { key: 'paid', label: 'Pagantes', count: stats.paid, a: 'lime' },
    { key: 'granted', label: 'Liberados', count: stats.granted, a: 'cyan' },
    { key: 'free', label: 'Free', count: stats.free, a: 'neutral' },
    { key: 'beta', label: 'Beta Pro', count: stats.beta, a: 'violet' },
    { key: 'concurrent', label: 'Acesso simultâneo', count: stats.concurrent, a: 'danger', hide: stats.concurrent === 0 },
    { key: 'inactive', label: 'Desativados', count: stats.inactive, a: 'danger', hide: stats.inactive === 0 },
    { key: 'pending', label: 'Pagamento pendente', count: stats.pending, a: 'amber', hide: stats.pending === 0 },
    { key: 'canceled', label: 'Cancelaram', count: canceledCount, a: 'amber', hide: canceledCount === 0 },
    { key: 'anomaly', label: 'Sem origem', count: stats.anomaly, a: 'danger', hide: stats.anomaly === 0 },
  ];

  const g = dash?.growth;
  const cc = dash?.concurrency;
  const conversion = stats.total ? (stats.paid / stats.total) * 100 : 0;
  const shown = visible.slice(0, limit);

  return (
    <div className="mx-auto w-full max-w-[1320px] px-4 md:px-8">
      {/* ═══════ Cabeçalho ═══════ */}
      <header className="flex flex-wrap items-end justify-between gap-5 pt-2">
        <div>
          <p className="field-label flex items-center gap-2 text-[13px] text-text-muted">
            <Dot a={error ? 'danger' : 'lime'} ring size={7} />
            {error ? 'Sem conexão com os dados' : updatedAt ? `Ao vivo · atualizado às ${updatedAt.toLocaleTimeString('pt-BR')}` : 'Conectando'}
          </p>
          <h1 className="font-tech mt-2 text-[34px] font-semibold leading-none tracking-[-0.035em] text-text md:text-[44px]">Painel admin</h1>
          <p className="field-label mt-2.5 max-w-[60ch] text-[14px] text-text-muted">
            Clientes, receita e acessos em tempo real. Clique em qualquer cliente pra ver o perfil completo.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => setStudioOpen(true)}
            className="group field-label inline-flex h-11 items-center gap-2.5 rounded-full bg-[rgb(var(--text)/0.05)] pl-1.5 pr-5 text-[13.5px] font-semibold text-text transition-[transform,background-color] duration-300 hover:bg-[rgb(var(--text)/0.09)] active:scale-[0.97]"
            style={{ boxShadow: 'inset 0 0 0 1px rgb(var(--text) / 0.1)', transitionTimingFunction: 'cubic-bezier(.32,.72,0,1)' }}
            title="Avisos e propagandas na tela dos clientes"
          >
            <span
              className="relative flex h-8 w-8 items-center justify-center rounded-full transition-transform duration-300 group-hover:-rotate-6 group-hover:scale-105"
              style={{ color: accent('violet'), background: accent('violet', 0.14), boxShadow: `inset 0 0 0 1px ${accent('violet', 0.3)}`, transitionTimingFunction: 'cubic-bezier(.32,.72,0,1)' }}
            >
              <AnnIcon.megaphone size={16} />
            </span>
            Avisos
            {annLive ? (
              <span
                className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11.5px] font-semibold"
                style={{ color: accent('lime'), background: accent('lime', 0.12), boxShadow: `inset 0 0 0 1px ${accent('lime', 0.28)}` }}
              >
                <Dot a="lime" size={5} />
                {annLive} no ar
              </span>
            ) : null}
          </button>
          <button
            type="button"
            onClick={() => setToolsOpen(true)}
            className="group field-label inline-flex h-11 items-center gap-2.5 rounded-full bg-[rgb(var(--text)/0.05)] pl-1.5 pr-5 text-[13.5px] font-semibold text-text transition-[transform,background-color] duration-300 hover:bg-[rgb(var(--text)/0.09)] active:scale-[0.97]"
            style={{ boxShadow: 'inset 0 0 0 1px rgb(var(--text) / 0.1)', transitionTimingFunction: 'cubic-bezier(.32,.72,0,1)' }}
            title="Ferramentas: manutenção e quem entra"
          >
            <span
              className="relative flex h-8 w-8 items-center justify-center rounded-full transition-transform duration-300 group-hover:rotate-12 group-hover:scale-105"
              style={{
                color: accent(toolsMaint ? 'amber' : 'cyan'),
                background: accent(toolsMaint ? 'amber' : 'cyan', 0.14),
                boxShadow: `inset 0 0 0 1px ${accent(toolsMaint ? 'amber' : 'cyan', 0.3)}`,
                transitionTimingFunction: 'cubic-bezier(.32,.72,0,1)',
              }}
            >
              <WrenchGlyph size={15} />
            </span>
            Ferramentas
            {toolsMaint ? (
              <span
                className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11.5px] font-semibold"
                style={{ color: accent('amber'), background: accent('amber', 0.12), boxShadow: `inset 0 0 0 1px ${accent('amber', 0.28)}` }}
              >
                <Dot a="amber" size={5} />
                {toolsMaint} em manutenção
              </span>
            ) : null}
          </button>
          <button type="button" onClick={() => setCreateOpen((v) => !v)} className="btn-primary !h-11 !px-5 text-[13.5px]">
            {createOpen ? <I.close size={15} /> : <I.plus size={15} />}
            {createOpen ? 'Fechar' : 'Criar usuário'}
          </button>
        </div>
      </header>

      {studioOpen ? <AnnouncementsStudio users={users} onClose={closeStudio} flash={flash} onListChange={onAnnList} /> : null}
      {toolsOpen ? <ToolsCenter users={users} onClose={closeTools} flash={flash} onCountChange={setToolsMaint} /> : null}

      {users && schema !== 'full' ? (
        <div role="alert" className="field-label mt-6 flex items-start gap-3 rounded-[16px] px-5 py-4 text-[13.5px] leading-relaxed" style={{ color: accent(schema === 'basic' ? 'danger' : 'amber'), background: accent(schema === 'basic' ? 'danger' : 'amber', 0.08), boxShadow: `inset 0 0 0 1px ${accent(schema === 'basic' ? 'danger' : 'amber', 0.25)}` }}>
          <span className="mt-0.5 shrink-0"><I.alert size={16} /></span>
          <span>
            {schema === 'basic'
              ? 'O plano e a assinatura dos clientes não carregaram desta vez. Pagantes, liberados e Free abaixo NÃO estão confiáveis. Recarregue a página; se continuar, o banco recusou a consulta completa.'
              : 'O Beta Pro dos clientes não carregou desta vez (o resto está certo). Recarregue a página.'}
          </span>
        </div>
      ) : null}

      {error ? (
        <div key={error} role="alert" className="error-shake field-label mt-6 rounded-[16px] px-5 py-4 text-[13.5px]" style={{ color: accent('danger'), background: accent('danger', 0.08), boxShadow: `inset 0 0 0 1px ${accent('danger', 0.25)}` }}>
          {error}
          {errorDetail ? <div className="mono mt-1.5 text-[11.5px] opacity-80">{errorDetail}</div> : null}
        </div>
      ) : null}

      {/* ═══════ Criar usuário ═══════ */}
      {createOpen ? (
        <div className="fade-in-up mt-6">
          <Shell>
            <form onSubmit={createUser} className="grid gap-3 p-4 sm:grid-cols-[1fr_1.2fr_1fr_auto] md:p-5">
              <input type="text" placeholder="Nome" value={newName} onChange={(e) => setNewName(e.target.value)} required className="input-field" disabled={creating} minLength={2} />
              <input type="email" placeholder="email@exemplo.com" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} required className="input-field" disabled={creating} />
              <input type="text" placeholder="Senha provisória (mín. 8)" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required className="input-field" disabled={creating} minLength={8} />
              <button type="submit" className="btn-primary whitespace-nowrap" disabled={creating || !newEmail || !newPassword || !newName}>
                {creating ? 'Criando' : 'Criar e ativar'}
              </button>
              <p className="field-label text-[12.5px] text-text-muted sm:col-span-4">
                Senha provisória: no primeiro login o cliente troca por uma pessoal e você deixa de ter acesso a ela.
              </p>
            </form>
          </Shell>
        </div>
      ) : null}

      {/* ═══════ Números ═══════ */}
      <section className="mt-8 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Online agora" a="lime" live value={users ? stats.online : '·'} hint={users ? `${stats.usingTool} usando ferramenta` : undefined} onClick={() => setFilter('online')} />
        <Stat label="Clientes" a="violet" value={users ? stats.total : '·'} hint={g ? `+${g.new7d} nos últimos 7 dias` : undefined} onClick={() => setFilter('all')} />
        <Stat label="Pagantes no Stripe" a="lime" value={users && schema !== 'basic' ? stats.paid : '·'} hint={users && schema !== 'basic' ? `Conversão de ${conversion.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%` : undefined} onClick={() => setFilter('paid')} />
        <Stat label="Liberados por você" a="cyan" value={users && schema !== 'basic' ? stats.granted : '·'} hint="Premium sem cobrança" onClick={() => setFilter('granted')} />
        <Stat label="MRR estimado" a="amber" value={dash ? `R$ ${dash.totals.mrr.toLocaleString('pt-BR')}` : '·'} hint="Receita recorrente por mês" />
        <Stat
          label="Acesso simultâneo"
          a="danger"
          alert={!!cc?.accounts7d}
          value={cc?.enabled ? cc.accounts7d : '·'}
          hint={cc?.enabled ? (cc.accounts7d ? `${cc.accounts7d === 1 ? 'conta' : 'contas'} em 7 dias` : 'Nenhuma conta em 7 dias') : 'Aguardando o banco'}
          onClick={stats.concurrent ? () => setFilter('concurrent') : undefined}
        />
      </section>

      {/* ═══════ Financeiro ═══════ */}
      <div className="mt-6">
        <Panel
          title="Financeiro"
          hint="Valores líquidos: reembolso e contestação ficam fora do arrecadado"
          right={<Segmented size="sm" value={period} onChange={setPeriod} activeTone="lime" options={(Object.keys(PERIOD_LABEL) as Period[]).map((p) => ({ value: p, label: PERIOD_LABEL[p] }))} />}
        >
          {dash ? (
            <div className="flex flex-col gap-5">
              <div className="grid gap-5 lg:grid-cols-[300px_1fr]">
                <div className="flex flex-col justify-between gap-5 rounded-[16px] p-5" style={{ background: 'rgb(var(--text) / 0.03)', boxShadow: 'inset 0 0 0 1px rgb(var(--text) / 0.07)' }}>
                  <div>
                    <div className="field-label text-[13px] text-text-muted">Arrecadado · {PERIOD_LABEL[period].toLowerCase()}</div>
                    <div className="font-tech mt-1.5 text-[36px] font-semibold leading-none tracking-[-0.035em]" style={{ color: accent('lime'), fontVariantNumeric: 'tabular-nums' }}>
                      {brl(finance.total)}
                    </div>
                    {finance.refundCount > 0 ? (
                      <div className="field-label mt-2 text-[12.5px] font-semibold" style={{ color: accent('danger') }}>
                        {brl(finance.refundTotal)} devolvido em {finance.refundCount} {finance.refundCount === 1 ? 'pagamento' : 'pagamentos'}
                      </div>
                    ) : null}
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <MiniNumber label="Pagamentos" value={String(finance.count)} />
                    <MiniNumber label="Ticket médio" value={finance.count ? brl(finance.avg) : 'Sem dado'} />
                    <MiniNumber label="Desde o início" value={brl(dash.revenueTotal)} />
                    <MiniNumber label="Reembolsado (total)" value={brl(dash.refundedTotal ?? 0)} />
                  </div>
                </div>
                <div className="rounded-[16px] p-5" style={{ boxShadow: 'inset 0 0 0 1px rgb(var(--text) / 0.07)' }}>
                  <div className="field-label mb-1 text-[13px] text-text-muted">Receita por dia, últimos 30 dias</div>
                  <BarSeries points={finance.days} a="lime" height={150} ariaLabel="Receita por dia nos últimos 30 dias" format={brl} emptyText="Nenhum pagamento nos últimos 30 dias." />
                </div>
              </div>

              {finance.list.length ? (
                <div className="max-h-[320px] overflow-auto rounded-[16px]" style={{ boxShadow: 'inset 0 0 0 1px rgb(var(--text) / 0.07)' }}>
                  <table className="w-full min-w-[680px] text-left">
                    <thead className="sticky top-0 z-[1] bg-bg-soft">
                      <tr className="field-label text-[12px] text-text-muted">
                        <th className="px-4 py-3 font-medium">Cliente</th>
                        <th className="px-4 py-3 font-medium">Plano</th>
                        <th className="px-4 py-3 font-medium">Valor</th>
                        <th className="px-4 py-3 font-medium">Status</th>
                        <th className="px-4 py-3 font-medium">Data</th>
                        <th className="px-4 py-3 text-right font-medium">Comprovante</th>
                      </tr>
                    </thead>
                    <tbody>
                      {finance.list.map((p) => {
                        const refunded = isRefundPay(p);
                        const owner = p.email ? byEmail.get(p.email.toLowerCase()) : undefined;
                        return (
                          <tr key={p.id} className="border-t border-[rgb(var(--text)/0.06)] text-[13.5px] transition-colors hover:bg-[rgb(var(--text)/0.025)]">
                            <td className="max-w-[260px] px-4 py-3">
                              {owner ? (
                                <button type="button" onClick={() => openProfile(owner, 'pagamentos')} className="block max-w-full truncate text-left font-medium text-text underline-offset-4 hover:underline" title="Abrir perfil">
                                  {p.email}
                                </button>
                              ) : (
                                <span className="block truncate text-text">{p.email || 'Sem email'}</span>
                              )}
                            </td>
                            <td className="field-label px-4 py-3 text-text-muted">
                              {p.plan === 'basic' ? 'Premium' : (p.plan ?? 'Plano')}
                              {p.billing ? (p.billing === 'annual' ? ' anual' : ' mensal') : ''}
                            </td>
                            <td className={'font-tech px-4 py-3 font-semibold ' + (refunded ? 'line-through opacity-60' : '')} style={{ color: refunded ? 'rgb(var(--text-muted))' : accent('lime'), fontVariantNumeric: 'tabular-nums' }}>
                              {brl(p.amount)}
                            </td>
                            <td className="px-4 py-3">
                              {refunded ? <Tag a="danger">{p.status === 'disputed' ? 'Contestado' : 'Reembolsado'}</Tag> : <Tag a="lime">Pago</Tag>}
                            </td>
                            <td className="field-label whitespace-nowrap px-4 py-3 text-text-muted">{fmtDate(p.created_at) ?? 'Sem data'}</td>
                            <td className="px-4 py-3 text-right">
                              {p.receipt_url ? (
                                <a href={p.receipt_url} target="_blank" rel="noopener noreferrer" className="field-label inline-flex items-center gap-1.5 text-[13px] font-semibold underline-offset-4 hover:underline" style={{ color: accent('violet') }}>
                                  <I.receipt size={13} /> Abrir
                                </a>
                              ) : (
                                <span className="field-label text-[12.5px] text-text-muted">Sem link</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="field-label rounded-[16px] py-7 text-center text-[13.5px] text-text-muted" style={{ boxShadow: 'inset 0 0 0 1px rgb(var(--text) / 0.07)' }}>
                  Nenhum pagamento em &ldquo;{PERIOD_LABEL[period]}&rdquo;.
                </div>
              )}
            </div>
          ) : (
            <div className="grid gap-5 lg:grid-cols-[300px_1fr]">
              <Skeleton className="h-[230px]" />
              <Skeleton className="h-[230px]" />
            </div>
          )}
        </Panel>
      </div>

      {/* ═══════ Cancelamentos ═══════ */}
      <div className="mt-6">
        <Panel
          title="Cancelamentos"
          hint="Direto do Stripe: quem pediu pra cancelar, até quando tem acesso e quem foi reembolsado"
          right={
            <Segmented
              size="sm"
              value={cancelFilter}
              onChange={setCancelFilter}
              activeTone="amber"
              options={[
                { value: 'all', label: `Todos ${cancels ? cancels.length : ''}`.trim() },
                { value: 'scheduled', label: `Agendados ${cancels ? cancels.filter((c) => c.kind === 'scheduled').length : ''}`.trim() },
                { value: 'refunded', label: `Reembolsados ${cancels ? cancels.filter((c) => c.kind === 'refunded' || c.kind === 'refund').length : ''}`.trim() },
                { value: 'ended', label: `Encerrados ${cancels ? cancels.filter((c) => c.kind === 'ended').length : ''}`.trim() },
              ]}
            />
          }
        >
          {cancelsErr && !cancels ? (
            <div className="field-label rounded-[14px] p-4 text-[13px]" style={{ color: accent('danger'), background: accent('danger', 0.08) }}>
              {cancelsErr}
            </div>
          ) : !cancels ? (
            <Skeleton className="h-[140px]" />
          ) : cancelRows.length ? (
            <div className="max-h-[360px] overflow-auto rounded-[16px]" style={{ boxShadow: 'inset 0 0 0 1px rgb(var(--text) / 0.07)' }}>
              <table className="w-full min-w-[760px] text-left">
                <thead className="sticky top-0 z-[1] bg-bg-soft">
                  <tr className="field-label text-[12px] text-text-muted">
                    <th className="px-4 py-3 font-medium">Cliente</th>
                    <th className="px-4 py-3 font-medium">Situação</th>
                    <th className="px-4 py-3 font-medium">Pediu em</th>
                    <th className="px-4 py-3 font-medium">Acesso</th>
                    <th className="px-4 py-3 font-medium">Reembolso</th>
                    <th className="px-4 py-3 text-right font-medium">Ação</th>
                  </tr>
                </thead>
                <tbody>
                  {cancelRows.map((c) => {
                    const owner = c.user_id ? userById.get(c.user_id) : undefined;
                    const meta = CANCEL_META[c.kind];
                    return (
                      <tr key={c.key} className="border-t border-[rgb(var(--text)/0.06)] text-[13.5px] transition-colors hover:bg-[rgb(var(--text)/0.025)]">
                        <td className="max-w-[260px] px-4 py-3">
                          {owner ? (
                            <button type="button" onClick={() => openProfile(owner, 'pagamentos')} className="block max-w-full truncate text-left font-medium text-text underline-offset-4 hover:underline" title="Abrir perfil">
                              {owner.name || c.email || owner.email}
                            </button>
                          ) : (
                            <span className="block truncate text-text" title="Sem conta no app com esse cliente do Stripe">{c.email || c.customer_id || 'Sem email'}</span>
                          )}
                          {owner && (owner.name || '') !== '' ? (
                            <span className="field-label block truncate text-[12px] text-text-muted">{c.email || owner.email}</span>
                          ) : null}
                        </td>
                        <td className="px-4 py-3">
                          <span className="flex flex-col items-start gap-1">
                            <CancelTag c={c} />
                            {c.comment ? (
                              <span className="field-label max-w-[240px] truncate text-[11.5px] text-text-muted" title={c.comment}>
                                {c.comment}
                              </span>
                            ) : c.reason === 'payment_failed' ? (
                              <span className="field-label text-[11.5px] text-text-muted">Pagamento recusado</span>
                            ) : c.reason === 'payment_disputed' ? (
                              <span className="field-label text-[11.5px] text-text-muted">Contestação no banco</span>
                            ) : null}
                          </span>
                        </td>
                        <td className="field-label whitespace-nowrap px-4 py-3 text-text-muted">{fmtDate(c.requested_at) ?? '—'}</td>
                        <td className="field-label whitespace-nowrap px-4 py-3 text-text-muted">
                          {c.kind === 'scheduled' ? (
                            <span style={{ color: accent('amber') }}>até {fmtDate(c.access_until) ?? '—'}</span>
                          ) : c.access_until ? (
                            <>encerrou {fmtDate(c.access_until)}</>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="font-tech whitespace-nowrap px-4 py-3 font-semibold" style={{ color: c.refunded_amount ? accent('danger') : 'rgb(var(--text-muted))', fontVariantNumeric: 'tabular-nums' }}>
                          {c.refunded_amount ? brl(c.refunded_amount) : 'Sem reembolso'}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {c.kind === 'scheduled' && owner ? (
                            <Btn size="sm" tone="danger" onClick={() => askCancelSub(owner, 'refund_now')} disabled={busyId === owner.id} title={meta.label}>
                              Reembolsar
                            </Btn>
                          ) : (
                            <span className="field-label text-[12.5px] text-text-muted">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="field-label rounded-[16px] py-7 text-center text-[13.5px] text-text-muted" style={{ boxShadow: 'inset 0 0 0 1px rgb(var(--text) / 0.07)' }}>
              {cancelFilter === 'all' ? 'Ninguém cancelou ainda.' : 'Nenhum cancelamento nesse filtro.'}
            </div>
          )}
        </Panel>
      </div>

      {/* ═══════ Crescimento + engajamento ═══════ */}
      <div className="mt-6 grid gap-6 lg:grid-cols-[1.35fr_1fr]">
        <Panel title="Novos cadastros" hint="Por dia, últimos 30 dias (só clientes)">
          {g ? (
            <>
              <BarSeries
                points={g.signupDays.map((d) => ({ key: d.day, label: dayLabel(d.day), value: d.count }))}
                a="violet"
                height={130}
                ariaLabel="Novos cadastros por dia"
                format={(v) => `${v} ${v === 1 ? 'cadastro' : 'cadastros'}`}
              />
              <div className="mt-5 grid grid-cols-3 gap-px overflow-hidden rounded-[14px]" style={{ background: 'rgb(var(--text) / 0.07)', boxShadow: 'inset 0 0 0 1px rgb(var(--text) / 0.07)' }}>
                <Cell label="Hoje" value={g.newToday} />
                <Cell label="7 dias" value={g.new7d} />
                <Cell label="30 dias" value={g.new30d} />
              </div>
            </>
          ) : (
            <Skeleton className="h-[230px]" />
          )}
        </Panel>
        <Panel title="Engajamento" hint="Clientes que abriram o app na janela">
          {g ? (
            <div className="flex flex-col gap-4">
              {[
                { label: 'Últimas 24 horas', n: g.active24h },
                { label: 'Últimos 7 dias', n: g.active7d },
                { label: 'Últimos 30 dias', n: g.active30d },
              ].map((r) => {
                const pct = g.customers ? Math.min(100, (r.n / g.customers) * 100) : 0;
                return (
                  <div key={r.label}>
                    <div className="field-label flex items-baseline justify-between text-[13px]">
                      <span className="text-text-muted">{r.label}</span>
                      <span>
                        <span className="font-tech text-[17px] font-semibold text-text" style={{ fontVariantNumeric: 'tabular-nums' }}>{r.n}</span>
                        <span className="ml-1.5 text-[12px] text-text-muted">{pct.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%</span>
                      </span>
                    </div>
                    <div className="mt-1.5 h-[6px] overflow-hidden rounded-full bg-[rgb(var(--text)/0.06)]">
                      <div className="h-full rounded-full" style={{ width: `${Math.max(pct, 1.5)}%`, background: accent('lime', 0.75) }} />
                    </div>
                  </div>
                );
              })}
              <div className="mt-1 grid grid-cols-2 gap-px overflow-hidden rounded-[14px]" style={{ background: 'rgb(var(--text) / 0.07)', boxShadow: 'inset 0 0 0 1px rgb(var(--text) / 0.07)' }}>
                <Cell label="Com celular cadastrado" value={stats.withPhone} />
                <Cell label="Com Beta Pro" value={stats.beta} />
              </div>
            </div>
          ) : (
            <Skeleton className="h-[230px]" />
          )}
        </Panel>
      </div>

      {/* ═══════ Clientes + lateral ═══════ */}
      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-[1fr_330px]">
        <Shell>
          <section>
            <div className="flex flex-col gap-4 p-5 pb-4">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h2 className="font-tech text-[15.5px] font-semibold tracking-[-0.01em] text-text">Clientes</h2>
                  <p className="field-label mt-0.5 text-[12.5px] text-text-muted">
                    {users ? `${visible.length} ${visible.length === 1 ? 'cliente' : 'clientes'}${filter !== 'all' || q ? ' no filtro' : ''}` : 'Carregando'}
                  </p>
                </div>
                <Segmented
                  size="sm"
                  value={sort}
                  onChange={setSort}
                  options={[
                    { value: 'recent', label: 'Mais novos' },
                    { value: 'seen', label: 'Último acesso' },
                    { value: 'name', label: 'Nome' },
                  ]}
                />
              </div>
              <div className="flex flex-wrap gap-1.5">
                {chips
                  .filter((c) => !c.hide)
                  .map((c) => {
                    const on = filter === c.key;
                    return (
                      <button
                        key={c.key}
                        type="button"
                        onClick={() => setFilter(c.key)}
                        className={'field-label inline-flex h-8 items-center gap-2 rounded-full px-3.5 text-[12.5px] font-semibold transition-[background-color,color,box-shadow] duration-300 ' + (on ? '' : 'text-text-muted hover:text-text')}
                        style={
                          on
                            ? {
                                color: c.a === 'neutral' ? 'rgb(var(--text))' : accent(c.a),
                                background: c.a === 'neutral' ? 'rgb(var(--text) / 0.1)' : accent(c.a, 0.13),
                                boxShadow: `inset 0 0 0 1px ${c.a === 'neutral' ? 'rgb(var(--text) / 0.14)' : accent(c.a, 0.32)}`,
                              }
                            : { boxShadow: 'inset 0 0 0 1px rgb(var(--text) / 0.09)' }
                        }
                      >
                        {c.key !== 'all' && c.key !== 'free' ? <Dot a={c.a} size={6} /> : null}
                        {c.label}
                        <span className="opacity-70" style={{ fontVariantNumeric: 'tabular-nums' }}>{c.count}</span>
                      </button>
                    );
                  })}
              </div>
              <label className="relative block">
                <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-text-muted">
                  <I.search size={16} />
                </span>
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Buscar por nome, email, celular, IP ou ferramenta"
                  className="input-field !h-11 !rounded-full !py-0 !pl-11 text-[14px]"
                  aria-label="Buscar clientes"
                />
              </label>
            </div>

            <ul className="border-t border-[rgb(var(--text)/0.07)] [&>li+li]:border-t [&>li+li]:border-[rgb(var(--text)/0.06)]">
              {users && shown.length > 0 ? (
                shown.map((u) => {
                  const c = cancelByUser.get(u.id);
                  return <UserRow key={u.id} u={u} now={now} busy={busyId === u.id} actions={actions} cancel={cancelApplies(c, u) ? c : undefined} />;
                })
              ) : !users ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <li key={i} className="flex items-center gap-4 px-5 py-4">
                    <Skeleton className="h-10 w-10" />
                    <div className="flex-1">
                      <Skeleton className="h-3.5 w-48" />
                      <Skeleton className="mt-2 h-3 w-72" />
                    </div>
                  </li>
                ))
              ) : (
                <li className="field-label px-5 py-12 text-center text-[13.5px] text-text-muted">
                  {q || filter !== 'all' ? 'Nenhum cliente bate com esse filtro.' : 'Nenhum cliente ainda.'}
                </li>
              )}
            </ul>

            {users && visible.length > shown.length ? (
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[rgb(var(--text)/0.07)] px-5 py-4">
                <span className="field-label text-[12.5px] text-text-muted">
                  Mostrando {shown.length} de {visible.length}
                </span>
                <div className="flex gap-2">
                  <Btn size="sm" onClick={() => setLimit((n) => n + PAGE)}>Mostrar mais {Math.min(PAGE, visible.length - shown.length)}</Btn>
                  <Btn size="sm" onClick={() => setLimit(visible.length)}>Mostrar todos</Btn>
                </div>
              </div>
            ) : null}
          </section>
        </Shell>

        {/* ═══════ Lateral ═══════ */}
        <aside className="flex flex-col gap-5">
          <Panel title="Distribuição" hint={users ? `${stats.total} contas de clientes` : undefined}>
            {users ? (
              <>
                <div className="flex h-2.5 w-full gap-[2px] overflow-hidden rounded-full">
                  {(
                    [
                      ['lime', stats.paid],
                      ['cyan', stats.granted],
                      ['amber', stats.pending],
                      ['danger', stats.anomaly],
                      ['neutral', stats.free - stats.pending],
                    ] as Array<[Accent, number]>
                  ).map(([a, n], i) =>
                    n > 0 ? <div key={i} style={{ width: `${(n / Math.max(stats.total, 1)) * 100}%`, minWidth: 3, background: a === 'neutral' ? 'rgb(var(--text) / 0.16)' : accent(a, 0.85) }} /> : null,
                  )}
                </div>
                <ul className="mt-4 flex flex-col gap-2.5">
                  <Legend a="lime" label="Premium pago" n={stats.paid} total={stats.total} onClick={() => setFilter('paid')} />
                  <Legend a="cyan" label="Premium liberado" n={stats.granted} total={stats.total} onClick={() => setFilter('granted')} />
                  {stats.pending ? <Legend a="amber" label="Pagamento pendente" n={stats.pending} total={stats.total} onClick={() => setFilter('pending')} /> : null}
                  {stats.anomaly ? <Legend a="danger" label="Sem origem" n={stats.anomaly} total={stats.total} onClick={() => setFilter('anomaly')} /> : null}
                  <Legend a="neutral" label="Free" n={stats.free} total={stats.total} onClick={() => setFilter('free')} />
                  <Legend a="violet" label="Beta Pro" n={stats.beta} total={stats.total} onClick={() => setFilter('beta')} />
                </ul>
              </>
            ) : (
              <Skeleton className="h-28" />
            )}
          </Panel>

          {cc?.enabled ? (
            <Panel title="Acesso simultâneo" hint="Últimos 7 dias" tone={cc.recent.length ? 'danger' : undefined}>
              {cc.recent.length ? (
                <ul className="-mx-2 flex flex-col">
                  {cc.recent.map((e) => {
                    const owner = (users ?? []).find((u) => u.id === e.user_id);
                    return (
                      <li key={e.id}>
                        <button
                          type="button"
                          disabled={!owner}
                          onClick={() => owner && openProfile(owner, 'acessos')}
                          className="w-full rounded-[12px] px-2 py-2.5 text-left transition-colors hover:bg-[rgb(var(--text)/0.04)]"
                        >
                          <span className="flex items-center justify-between gap-2">
                            <span className="truncate text-[13.5px] font-medium text-text">{e.name || e.email || 'Cliente'}</span>
                            <span className="field-label shrink-0 text-[12px]" style={{ color: accent('danger') }}>
                              {fmtDateShort(e.started_at)} {fmtTime(e.started_at)}
                            </span>
                          </span>
                          <span className="field-label mt-0.5 block truncate text-[12px] text-text-muted">
                            {e.label_a || 'aparelho'} + {e.label_b || 'aparelho'}
                            {e.same_network ? ' · mesma rede' : e.place_a && e.place_b && e.place_a !== e.place_b ? ` · ${e.place_a.split(',')[0]} e ${e.place_b.split(',')[0]}` : ''}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="field-label text-[13px] text-text-muted">Nenhuma conta usada em dois aparelhos ao mesmo tempo.</p>
              )}
            </Panel>
          ) : null}

          <Panel title="Online agora" hint={users ? `${stats.online} ${stats.online === 1 ? 'pessoa' : 'pessoas'}` : undefined}>
            {users ? (
              stats.online > 0 ? (
                <ul className="-mx-2 flex flex-col">
                  {(users ?? [])
                    .filter((u) => isOnline(u, now))
                    .slice(0, 12)
                    .map((u) => (
                      <li key={u.id}>
                        <button type="button" onClick={() => openProfile(u)} className="flex w-full items-center gap-2.5 rounded-[12px] px-2 py-2 text-left transition-colors hover:bg-[rgb(var(--text)/0.04)]">
                          <Dot a="lime" size={7} />
                          <span className="min-w-0 flex-1 truncate text-[13.5px] text-text">{u.name || u.email}</span>
                          {isUsingTool(u, now) && u.last_tool ? (
                            <span className="field-label shrink-0 text-[12px] font-semibold" style={{ color: accent('lime') }}>
                              {toolLabel(u.last_tool)}
                            </span>
                          ) : null}
                        </button>
                      </li>
                    ))}
                </ul>
              ) : (
                <p className="field-label text-[13px] text-text-muted">Ninguém online no momento.</p>
              )
            ) : (
              <Skeleton className="h-20" />
            )}
          </Panel>

          <Panel title="Ferramentas mais usadas" hint="30 dias, só clientes">
            {dash ? (
              <RankList a="violet" numbered limit={8} emptyText="Sem uso registrado." items={dash.toolRanking.map((t) => ({ key: t.tool, label: toolLabel(t.tool) ?? t.tool, value: t.count }))} />
            ) : (
              <Skeleton className="h-40" />
            )}
          </Panel>

          <Panel title="Por onde chegaram" hint="Primeira visita, só clientes">
            {dash ? (
              <RankList a="cyan" limit={6} emptyText="Sem dados de origem." items={dash.trafficSources.map((s) => ({ key: s.source, label: s.source === 'direct' ? 'Direto' : s.source, value: s.count }))} />
            ) : (
              <Skeleton className="h-32" />
            )}
          </Panel>
        </aside>
      </div>

      <div className="h-20" />

      {/* ═══════ Perfil ═══════ */}
      {profile && profileUser ? (
        <ProfileSheet
          key={profile.id}
          user={profileUser}
          tab={profile.tab}
          onTab={(t) => setProfile((p) => (p ? { ...p, tab: t } : p))}
          now={now}
          busy={busyId === profileUser.id}
          nonce={profileNonce}
          actions={actions}
          blockEsc={!!confirmBox || !!betaModal || !!resetModal}
          onClose={() => setProfile(null)}
          cancel={cancelApplies(cancelByUser.get(profileUser.id), profileUser) ? cancelByUser.get(profileUser.id) : undefined}
        />
      ) : null}

      {/* ═══════ Aviso ═══════ */}
      {toast && typeof document !== 'undefined'
        ? createPortal(
        <div
          role="status"
          className="toast-pop field-label fixed bottom-6 left-1/2 z-[90] flex max-w-[92vw] -translate-x-1/2 items-center gap-2.5 rounded-full bg-bg-elev px-5 py-3 text-[13.5px] font-semibold"
          style={{
            color: toast.kind === 'ok' ? 'rgb(var(--text))' : accent('danger'),
            boxShadow: `inset 0 0 0 1px ${toast.kind === 'ok' ? accent('lime', 0.35) : accent('danger', 0.4)}, 0 24px 48px -16px rgb(0 0 0 / 0.6)`,
          }}
        >
          <span style={{ color: toast.kind === 'ok' ? accent('lime') : accent('danger') }}>{toast.kind === 'ok' ? <I.check size={15} /> : <I.alert size={15} />}</span>
          {toast.msg}
        </div>,
            document.body,
          )
        : null}

      {/* ═══════ Confirmação (2ª etapa) ═══════ */}
      {confirmBox ? (
        <Modal onClose={() => (confirmBox.running ? undefined : setConfirmBox(null))} tone={confirmBox.tone}>
          <h3 className="font-tech text-[21px] font-semibold tracking-[-0.02em] text-text">{confirmBox.title}</h3>
          <p className="field-label mt-2.5 text-[14px] leading-relaxed text-text-muted">{confirmBox.body}</p>
          <div className="mt-6 flex items-center justify-end gap-2">
            <Btn onClick={() => setConfirmBox(null)} disabled={confirmBox.running}>Cancelar</Btn>
            <Btn
              tone={confirmBox.tone}
              solid
              disabled={confirmBox.running}
              onClick={async () => {
                setConfirmBox((c) => (c ? { ...c, running: true } : c));
                try {
                  await confirmBox.run();
                } finally {
                  setConfirmBox(null);
                }
              }}
            >
              {confirmBox.running ? 'Executando' : confirmBox.confirmLabel}
            </Btn>
          </div>
        </Modal>
      ) : null}

      {/* ═══════ Beta Pro ═══════ */}
      {betaModal ? (
        <Modal onClose={() => (betaModal.saving ? undefined : setBetaModal(null))} tone="violet" wide>
          <div className="flex items-center gap-2 text-[13px] font-semibold" style={{ color: accent('violet') }}>
            <I.bolt size={14} /> <span className="field-label">Beta Pro</span>
          </div>
          <h3 className="font-tech mt-2 text-[21px] font-semibold tracking-[-0.02em] text-text">Ferramentas internas liberadas</h3>
          <p className="field-label mt-2 text-[13.5px] leading-relaxed text-text-muted">
            Pra <b className="text-text">{betaModal.user.email}</b>. Libera só o que estiver marcado. A conta <b className="text-text">não vira admin</b> e continua {betaModal.user.plan === 'premium' ? 'Premium' : 'Free'}.
          </p>
          <div className="mt-4 flex max-h-[46vh] flex-col gap-1.5 overflow-y-auto pr-1">
            {UNLOCKABLE_TOOLS.map((t) => {
              const fixed = betaModal.user.static_unlocks.includes(t.path);
              const on = fixed || betaModal.sel.has(t.path);
              return (
                <button
                  key={t.path}
                  type="button"
                  disabled={fixed || betaModal.saving}
                  onClick={() => {
                    const sel = new Set(betaModal.sel);
                    if (sel.has(t.path)) sel.delete(t.path);
                    else sel.add(t.path);
                    setBetaModal({ ...betaModal, sel });
                  }}
                  className={'flex items-start gap-3 rounded-[14px] p-3 text-left transition-[background-color,box-shadow] duration-200 ' + (fixed ? 'cursor-not-allowed opacity-75' : 'hover:bg-[rgb(var(--text)/0.03)]')}
                  style={{ boxShadow: `inset 0 0 0 1px ${on ? accent('violet', 0.45) : 'rgb(var(--text) / 0.08)'}`, background: on ? accent('violet', 0.07) : undefined }}
                >
                  <span
                    className="mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[6px]"
                    style={on ? { background: accent('violet'), color: 'rgb(var(--bg))' } : { boxShadow: 'inset 0 0 0 1.5px rgb(var(--text) / 0.25)', color: 'transparent' }}
                  >
                    <I.check size={12} />
                  </span>
                  <span className="min-w-0">
                    <span className="flex items-center gap-2 text-[14px] font-semibold text-text">
                      {t.label}
                      {fixed ? <Tag a="neutral" title="Fixo por email no código/env: não dá pra remover pelo painel">Fixo</Tag> : null}
                    </span>
                    <span className="field-label mt-0.5 block text-[12.5px] leading-snug text-text-muted">{t.desc}</span>
                  </span>
                </button>
              );
            })}
          </div>
          <div className="mt-5 flex items-center justify-between gap-2">
            <span className="field-label text-[12.5px] text-text-muted">
              {betaModal.sel.size} {betaModal.sel.size === 1 ? 'selecionada' : 'selecionadas'}
            </span>
            <div className="flex gap-2">
              <Btn onClick={() => setBetaModal(null)} disabled={betaModal.saving}>Cancelar</Btn>
              <Btn tone="violet" solid onClick={saveBetaModal} disabled={betaModal.saving}>
                {betaModal.saving ? 'Salvando' : 'Salvar desbloqueios'}
              </Btn>
            </div>
          </div>
        </Modal>
      ) : null}

      {/* ═══════ Senha provisória ═══════ */}
      {resetModal ? (
        <Modal onClose={() => setResetModal(null)} tone="amber">
          <h3 className="font-tech text-[21px] font-semibold tracking-[-0.02em] text-text">Nova senha gerada</h3>
          <p className="field-label mt-1.5 text-[13.5px] text-text-muted">
            Pra <b className="text-text">{resetModal.email}</b>
          </p>
          <div className="mt-4 rounded-[16px] p-5 text-center" style={{ background: accent('amber', 0.06), boxShadow: `inset 0 0 0 1px ${accent('amber', 0.25)}` }}>
            <div className="mono select-all text-[24px] font-bold tracking-[0.06em]" style={{ color: accent('amber') }}>
              {resetModal.password}
            </div>
          </div>
          <p className="field-label mt-3 text-[13px] leading-relaxed text-text-muted">
            A pessoa troca no próximo login. Copie agora: depois de fechar, essa senha não aparece mais.
          </p>
          <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
            <Btn
              tone="amber"
              solid
              onClick={() => {
                navigator.clipboard?.writeText(resetModal.password).then(
                  () => flash('ok', 'Senha copiada.', 2500),
                  () => flash('err', 'Não deu pra copiar. Selecione e copie na mão.'),
                );
              }}
            >
              <I.copy size={13} /> Copiar senha
            </Btn>
            <Btn onClick={() => setResetModal(null)}>Fechar</Btn>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

/* ───────────── pedacinhos locais ───────────── */

function MiniNumber({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="field-label text-[12px] text-text-muted">{label}</div>
      <div className="font-tech mt-0.5 truncate text-[16px] font-semibold text-text" style={{ fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </div>
    </div>
  );
}

function Cell({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-bg-soft px-4 py-3">
      <div className="field-label text-[12px] text-text-muted">{label}</div>
      <div className="font-tech mt-0.5 text-[20px] font-semibold text-text" style={{ fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </div>
    </div>
  );
}

function Legend({ a, label, n, total, onClick }: { a: Accent; label: string; n: number; total: number; onClick: () => void }) {
  return (
    <li>
      <button type="button" onClick={onClick} className="field-label flex w-full items-center gap-2.5 text-left text-[13px] transition-opacity hover:opacity-80">
        <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: a === 'neutral' ? 'rgb(var(--text) / 0.3)' : accent(a, 0.9) }} />
        <span className="text-text-muted">{label}</span>
        <span className="ml-auto text-[12px] text-text-muted" style={{ fontVariantNumeric: 'tabular-nums' }}>
          {total ? Math.round((n / total) * 100) : 0}%
        </span>
        <span className="font-tech w-9 text-right font-semibold text-text" style={{ fontVariantNumeric: 'tabular-nums' }}>
          {n}
        </span>
      </button>
    </li>
  );
}
