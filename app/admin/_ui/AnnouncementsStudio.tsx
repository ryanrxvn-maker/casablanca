'use client';

/**
 * Central de avisos (09.10) — a janela do botão "Avisos" do /admin.
 *
 *  Criar     → 1. modelo (Aviso pequeno | Propaganda grande, com miniatura)
 *              2. conteúdo do template
 *              3. quem recebe (Free, Premium, Pagantes, Liberados, Pendente,
 *                 Beta Pro, contas específicas, admins), com o alcance contado
 *                 na hora pela MESMA regra do servidor (lib/announcements.ts)
 *              4. exibição (janela na tela ou só no sino) e prazo
 *              Prévia ao vivo ao lado, no computador ou no celular, com o
 *              MESMO componente que o cliente recebe.
 *  Enviados  → no ar / pausados / rascunhos / encerrados, com entregues,
 *              lidas e cliques; ativar e pausar num toque, editar, duplicar,
 *              mostrar de novo pra quem fechou e excluir (2 etapas).
 *
 * Enquanto a central está aberta, as janelas de aviso do próprio admin
 * esperam (suppressPopups) e aparecem quando ela fecha.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  annStatus,
  audienceIsEmpty,
  audienceSummary,
  AVISO_TONES,
  charCount,
  cleanAudience,
  cleanContent,
  emptyContent,
  LIMITS,
  matchesAudience,
  normalizeEmail,
  PROMO_ARTS,
  PROMO_THEMES,
  SEGMENT_META,
  SEGMENTS,
  THEME_META,
  TONE_META,
  type AdminAnnouncement,
  type AnnKind,
  type Audience,
  type AvisoContent,
  type NotifItem,
  type PromoArt,
  type PromoContent,
  type Segment,
  type Viewer,
} from '@/lib/announcements';
import { refreshNotifications, suppressPopups } from '@/lib/notifications-client';
import { travarScrollDaPagina } from '@/lib/trava-scroll';
import { AnnIcon, AvisoCard, PromoBanner, ToneIcon } from '@/components/notifications/templates';
import { AnnouncementPreview } from '@/components/notifications/AnnouncementHost';
import { Btn, I, IconOnly, Menu, MenuItem, MenuSep, Modal, Segmented, SPRING, Tag } from './kit';
import { accent, betaProTools, fmtDateTime, type Accent, type AdminUser } from './model';
import { AnnouncementSeen } from './AnnouncementSeen';
import { canResume, EmailMiniature, EmailPreview, EmailPreviewModal, EmailToggle, MailStatusTag, mailMode, mailSentence, TemplatePicker } from './AnnouncementEmail';
import { EMAIL_TEMPLATE_META, type EmailTemplate } from '@/lib/email-templates';

/* ───────────────────────── Rascunho ───────────────────────── */

type EndsMode = 'none' | '24h' | '3d' | '7d' | 'custom';

type Draft = {
  id: string | null;
  wasActive: boolean;
  kind: AnnKind;
  aviso: AvisoContent;
  promo: PromoContent;
  audience: Audience;
  popup: boolean;
  endsMode: EndsMode;
  endsCustom: string;
  republish: boolean;
};

const newDraft = (): Draft => ({
  id: null,
  wasActive: false,
  kind: 'aviso',
  aviso: emptyContent('aviso'),
  promo: emptyContent('propaganda'),
  audience: { segments: ['all'], emails: [], includeAdmins: true },
  popup: true,
  endsMode: 'none',
  endsCustom: '',
  republish: false,
});

// Fechar a central não perde o que estava escrito (volta igual ao abrir).
let savedDraft: Draft | null = null;

const ENDS_MS: Record<Exclude<EndsMode, 'none' | 'custom'>, number> = { '24h': 86_400_000, '3d': 3 * 86_400_000, '7d': 7 * 86_400_000 };

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function endsAtOf(d: Draft): string | null | 'invalid' {
  if (d.endsMode === 'none') return null;
  if (d.endsMode === 'custom') {
    if (!d.endsCustom) return 'invalid';
    const t = new Date(d.endsCustom).getTime();
    if (!Number.isFinite(t) || t <= Date.now() + 60_000) return 'invalid';
    return new Date(t).toISOString();
  }
  return new Date(Date.now() + ENDS_MS[d.endsMode]).toISOString();
}

function draftFrom(a: AdminAnnouncement, copy = false): Draft {
  const base = newDraft();
  const endsFuture = a.endsAt && Date.parse(a.endsAt) > Date.now() + 60_000;
  return {
    ...base,
    id: copy ? null : a.id,
    wasActive: copy ? false : a.active,
    kind: a.kind,
    aviso: a.kind === 'aviso' ? (a.content as AvisoContent) : base.aviso,
    promo: a.kind === 'propaganda' ? (a.content as PromoContent) : base.promo,
    audience: a.audience,
    popup: a.popup,
    endsMode: !copy && endsFuture ? 'custom' : 'none',
    endsCustom: !copy && endsFuture ? toLocalInput(a.endsAt as string) : '',
  };
}

/* ───────────────────────── Público ───────────────────────── */

function viewerOf(u: AdminUser): Viewer {
  return {
    id: u.id,
    email: u.email,
    isAdmin: false,
    isActive: u.is_active,
    plan: u.plan,
    access: u.access,
    beta: betaProTools(u).length > 0,
  };
}

const SEGMENT_TONE: Record<Segment, Accent> = {
  all: 'violet',
  free: 'neutral',
  premium: 'violet',
  paid: 'lime',
  granted: 'cyan',
  pending: 'amber',
  beta: 'violet',
};

/* ───────────────────────── Componente ───────────────────────── */

export function AnnouncementsStudio({
  users,
  onClose,
  flash,
  onListChange,
}: {
  users: AdminUser[] | null;
  onClose: () => void;
  flash: (kind: 'ok' | 'err', msg: string, ms?: number) => void;
  onListChange?: (items: AdminAnnouncement[]) => void;
}) {
  const [tab, setTab] = useState<'create' | 'sent'>('create');
  const [list, setList] = useState<AdminAnnouncement[] | null>(null);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(() => savedDraft ?? newDraft());
  const [saving, setSaving] = useState<null | 'draft' | 'publish'>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop');
  const [confirmDel, setConfirmDel] = useState<AdminAnnouncement | null>(null);
  // e-mail sai pra muita gente e não tem volta: confirma antes de mandar
  const [confirmSend, setConfirmSend] = useState<null | { publish: boolean }>(null);
  const [confirmAct, setConfirmAct] = useState<null | { a: AdminAnnouncement; action: 'activate' | 'republish' | 'send' }>(null);
  const [testing, setTesting] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const subOpen = useRef(false);
  subOpen.current = !!confirmDel || !!confirmSend || !!confirmAct;

  useEffect(() => {
    savedDraft = draft;
  }, [draft]);

  // Janela própria: trava o scroll da página e segura as janelas de aviso.
  useEffect(() => {
    const destravar = travarScrollDaPagina();
    suppressPopups(true);
    return () => {
      destravar();
      suppressPopups(false);
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || subOpen.current) return;
      if (document.querySelector('[role="menu"]')) return; // menu aberto fecha primeiro
      if (document.querySelector('[data-ann-seen]')) return; // "Quem viu" aberto: o Esc volta pra lista
      onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const onListChangeRef = useRef(onListChange);
  onListChangeRef.current = onListChange;

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/announcements', { cache: 'no-store' });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setListError(j.error || 'Falha ao carregar os avisos.');
        return;
      }
      setListError(null);
      setEnabled(j.enabled !== false);
      const items = (j.items ?? []) as AdminAnnouncement[];
      setList(items);
      onListChangeRef.current?.(items);
    } catch (e) {
      setListError((e as Error).message || 'Falha de conexão.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /* ─── alcance ─── */
  const viewers = useMemo(() => (users ?? []).map(viewerOf), [users]);
  const segCount = useMemo(() => {
    const out = {} as Record<Segment, number>;
    for (const s of SEGMENTS) out[s] = viewers.filter((v) => matchesAudience({ segments: [s], emails: [], includeAdmins: false }, v)).length;
    return out;
  }, [viewers]);
  const reach = useMemo(() => viewers.filter((v) => matchesAudience(draft.audience, v)).length, [viewers, draft.audience]);
  const knownEmails = useMemo(() => new Set((users ?? []).map((u) => (u.email ?? '').toLowerCase()).filter(Boolean)), [users]);
  const outsideEmails = draft.audience.emails.filter((e) => !knownEmails.has(e)).length;

  /* ─── edição ─── */
  const set = (patch: Partial<Draft>) => {
    setFormError(null);
    setDraft((d) => ({ ...d, ...patch }));
  };
  const setAviso = (patch: Partial<AvisoContent>) => set({ aviso: { ...draft.aviso, ...patch } });
  const setPromo = (patch: Partial<PromoContent>) => set({ promo: { ...draft.promo, ...patch } });
  const setAudience = (patch: Partial<Audience>) => set({ audience: cleanAudience({ ...draft.audience, ...patch }) });

  function toggleSegment(s: Segment) {
    const cur = draft.audience.segments;
    if (s === 'all') {
      setAudience({ segments: cur.includes('all') ? [] : ['all'] });
      return;
    }
    const base = cur.filter((x) => x !== 'all');
    setAudience({ segments: base.includes(s) ? base.filter((x) => x !== s) : [...base, s] });
  }

  const content = draft.kind === 'aviso' ? draft.aviso : draft.promo;
  const editing = draft.id ? list?.find((a) => a.id === draft.id) ?? null : null;
  /** modelo "E-mail" (só caixa de entrada) */
  const isEmail = draft.audience.email === 'only';
  /** envelope ligado num aviso/propaganda (tela + e-mail 1 vez por ativação) */
  const emailOn = draft.audience.email === 'also';
  const editingMode = editing ? mailMode(editing) : 'off';

  function pickModel(m: 'aviso' | 'propaganda' | 'email') {
    if (m === 'email') {
      set({
        kind: 'propaganda',
        popup: false,
        audience: { ...draft.audience, email: 'only' },
        promo: { ...draft.promo, mail: draft.promo.mail ?? { template: 'oferta', subject: '', preheader: '' } },
      });
      return;
    }
    set({
      kind: m,
      popup: isEmail ? true : draft.popup,
      audience: { ...draft.audience, email: isEmail ? 'off' : (draft.audience.email ?? 'off') },
      // ajustes do e-mail não acompanham a janela (o envelope usa o template automático)
      promo: isEmail ? { ...draft.promo, mail: undefined } : draft.promo,
    });
  }

  /** "Enviar teste pra mim": só pro admin logado, com [Teste]. Não salva nada. */
  async function sendTest() {
    const clean = cleanContent(draft.kind, content);
    if (!clean.ok) {
      setFormError(clean.error);
      return;
    }
    const ends = endsAtOf(draft);
    setTesting(true);
    try {
      const res = await fetch('/api/admin/announcements', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ test: true, kind: draft.kind, content: clean.value, audience: draft.audience, endsAt: ends === 'invalid' ? null : ends }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        flash('err', j.error || 'Não deu pra mandar o teste.');
        return;
      }
      flash('ok', `Teste enviado pra ${j.to}. Confere a caixa de entrada (na primeira vez, olha o spam também).`, 6500);
    } catch (e) {
      flash('err', (e as Error).message || 'Falha de conexão.');
    } finally {
      setTesting(false);
    }
  }

  async function save(publish: boolean, confirmed = false) {
    const clean = cleanContent(draft.kind, content);
    if (!clean.ok) {
      setFormError(clean.error);
      return;
    }
    const endsAt = isEmail ? null : endsAtOf(draft);
    if (endsAt === 'invalid') {
      setFormError('Escolha uma data de término no futuro (ou deixe sem prazo).');
      return;
    }
    const goingLive = publish || draft.wasActive;
    if (goingLive && audienceIsEmpty(draft.audience)) {
      setFormError(isEmail ? 'Escolha quem recebe antes de enviar.' : 'Escolha quem recebe antes de publicar.');
      return;
    }
    // Vai sair e-mail? (envio do modelo E-mail; publicar com envelope; ligar o
    // envelope num aviso no ar; "mostrar de novo" com envelope) → confirma antes.
    const sendsMail = isEmail
      ? publish
      : emailOn && (publish || (draft.wasActive && (editingMode !== 'also' || draft.republish)));
    if (sendsMail && !confirmed) {
      setConfirmSend({ publish });
      return;
    }
    setSaving(publish ? 'publish' : 'draft');
    try {
      let res: Response;
      if (!draft.id) {
        res = await fetch('/api/admin/announcements', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            kind: draft.kind,
            content: clean.value,
            audience: draft.audience,
            popup: isEmail ? false : draft.popup,
            active: isEmail ? false : publish,
            send: isEmail && publish,
            endsAt,
          }),
        });
      } else {
        res = await fetch('/api/admin/announcements', {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            id: draft.id,
            action: 'update',
            kind: draft.kind,
            content: clean.value,
            audience: draft.audience,
            popup: draft.popup,
            endsAt,
            republish: draft.wasActive && draft.republish,
          }),
        });
        if (res.ok && publish && !draft.wasActive) {
          res = await fetch('/api/admin/announcements', {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ id: draft.id, action: isEmail ? 'send' : 'activate' }),
          });
        }
      }
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFormError(j.error || 'Não deu pra salvar.');
        return;
      }
      const mail = sendsMail ? mailSentence((j.item as AdminAnnouncement | undefined)?.mail ?? null) : null;
      const live = publish || draft.wasActive;
      if (isEmail) {
        flash(publish ? (mail?.ok === false ? 'err' : 'ok') : 'ok', publish ? (mail?.text ?? 'E-mail enviado.') : 'Rascunho do e-mail salvo. Envie quando quiser na aba Enviados.', 7000);
      } else {
        const tela = live
          ? `${draft.kind === 'aviso' ? 'Aviso' : 'Propaganda'} no ar pra ${reach} ${reach === 1 ? 'conta' : 'contas'}${draft.audience.includeAdmins ? ' + admins' : ''}.`
          : 'Rascunho salvo. Publique quando quiser na aba Enviados.';
        flash(mail && !mail.ok ? 'err' : 'ok', mail ? `${tela} ${mail.text}` : tela, mail ? 7000 : 5200);
      }
      setDraft(newDraft());
      savedDraft = null;
      setTab('sent');
      await load();
      void refreshNotifications({ force: true });
    } catch (e) {
      setFormError((e as Error).message || 'Falha de conexão.');
    } finally {
      setSaving(null);
    }
  }

  async function act(a: AdminAnnouncement, action: 'activate' | 'pause' | 'republish' | 'send' | 'resume', confirmed = false) {
    const mode = mailMode(a);
    // ação que manda e-mail pra todo mundo: confirma antes (resume só continua o que faltou)
    const sendsMail = (action === 'send' && mode === 'only') || ((action === 'activate' || action === 'republish') && mode === 'also');
    if (sendsMail && !confirmed) {
      setConfirmAct({ a, action: action as 'activate' | 'republish' | 'send' });
      return;
    }
    setBusy(a.id);
    try {
      const res = await fetch('/api/admin/announcements', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: a.id, action }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        flash('err', j.error || 'Não deu pra mudar o aviso.');
        return;
      }
      const mail = sendsMail || action === 'resume' ? mailSentence((j.item as AdminAnnouncement | undefined)?.mail ?? null) : null;
      const tela =
        action === 'pause'
          ? 'Pausado. Sai da tela de todo mundo e continua no histórico de quem recebeu.'
          : action === 'activate'
            ? 'No ar. Quem está logado vê em até 30 segundos; quem entrar depois vê no login.'
            : action === 'republish'
              ? 'Pronto: a janela abre de novo pra quem já tinha fechado.'
              : '';
      const text = [tela, mail?.text].filter(Boolean).join(' ') || 'Pronto.';
      flash(mail && !mail.ok ? 'err' : 'ok', text, mail ? 7000 : 5200);
      await load();
      void refreshNotifications({ force: true });
    } finally {
      setBusy(null);
    }
  }

  async function doDelete(a: AdminAnnouncement) {
    setBusy(a.id);
    try {
      const res = await fetch(`/api/admin/announcements?id=${encodeURIComponent(a.id)}`, { method: 'DELETE' });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        flash('err', j.error || 'Não deu pra excluir.');
        return;
      }
      flash('ok', 'Excluído. Sumiu também do histórico de quem recebeu.');
      if (draft.id === a.id) setDraft(newDraft());
      await load();
      void refreshNotifications({ force: true });
    } finally {
      setBusy(null);
      setConfirmDel(null);
    }
  }

  const liveCount = (list ?? []).filter((a) => a.live).length;
  const dbMissing = enabled === false;

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-3 md:p-6" role="dialog" aria-modal="true" aria-label="Central de avisos">
      <div className="ann-veil absolute inset-0 bg-black/65 backdrop-blur-sm" onClick={onClose} />
      <div
        className="ann-pop relative flex h-[min(900px,calc(100dvh-24px))] w-full max-w-[1240px] flex-col rounded-[28px] p-[6px] md:h-[min(900px,calc(100dvh-48px))]"
        style={{
          background: 'rgb(var(--text) / 0.04)',
          boxShadow: 'inset 0 0 0 1px rgb(var(--text) / 0.09), 0 60px 120px -40px rgb(0 0 0 / 0.75)',
        }}
      >
        <div
          className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[22px] bg-bg-soft"
          style={{ boxShadow: 'inset 0 1px 0 rgb(var(--text) / 0.05), inset 0 0 0 1px rgb(var(--text) / 0.05)' }}
        >
          {/* ═══ Cabeçalho ═══ */}
          <header className="flex flex-wrap items-center gap-4 border-b border-[rgb(var(--text)/0.07)] px-5 py-4 md:px-6">
            <span
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px]"
              style={{ color: accent('violet'), background: accent('violet', 0.12), boxShadow: `inset 0 0 0 1px ${accent('violet', 0.28)}` }}
            >
              <AnnIcon.megaphone size={20} />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="font-tech text-[19px] font-semibold tracking-[-0.02em] text-text">Central de avisos</h2>
              <p className="field-label text-[13px] text-text-muted">
                Avisos e propagandas que aparecem na tela dos clientes e ficam no sino de notificações.
              </p>
            </div>
            <Segmented
              value={tab}
              onChange={setTab}
              activeTone="violet"
              options={[
                { value: 'create', label: draft.id ? 'Editando' : 'Criar novo' },
                {
                  value: 'sent',
                  label: (
                    <span className="inline-flex items-center gap-1.5">
                      Enviados
                      {list ? <span className="text-[11px] opacity-70">{list.length}</span> : null}
                      {liveCount ? <span className="h-[6px] w-[6px] rounded-full" style={{ background: accent('lime'), boxShadow: `0 0 0 3px ${accent('lime', 0.2)}` }} /> : null}
                    </span>
                  ),
                },
              ]}
            />
            <IconOnly onClick={onClose} title="Fechar (Esc)">
              <I.close size={16} />
            </IconOnly>
          </header>

          {dbMissing ? (
            <div
              role="alert"
              className="field-label mx-5 mt-4 flex items-start gap-3 rounded-[14px] px-4 py-3 text-[13px] leading-relaxed md:mx-6"
              style={{ color: accent('amber'), background: accent('amber', 0.08), boxShadow: `inset 0 0 0 1px ${accent('amber', 0.25)}` }}
            >
              <span className="mt-0.5 shrink-0">
                <I.alert size={15} />
              </span>
              <span>
                Falta criar as tabelas de avisos no banco. Rode <b>supabase/migrations/038_announcements.sql</b> no SQL Editor do Supabase e reabra esta janela.
              </span>
            </div>
          ) : null}

          {tab === 'create' ? (
            <>
              <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto lg:grid-cols-[minmax(0,1fr)_minmax(0,1.12fr)] lg:overflow-hidden">
                {/* ═══ Formulário ═══ */}
                <div className="min-h-0 px-5 py-5 md:px-6 lg:overflow-y-auto">
                  {draft.id ? (
                    <div className="mb-5 flex items-center justify-between gap-3 rounded-[14px] px-4 py-3" style={{ background: accent('violet', 0.07), boxShadow: `inset 0 0 0 1px ${accent('violet', 0.2)}` }}>
                      <span className="field-label text-[13px] text-text">
                        Editando um {draft.kind === 'aviso' ? 'aviso' : 'anúncio'} {draft.wasActive ? 'que está no ar' : 'que não está no ar'}.
                      </span>
                      <Btn size="sm" onClick={() => set({ ...newDraft() })}>
                        Começar outro
                      </Btn>
                    </div>
                  ) : null}

                  <Step n={1} title="Modelo">
                    <div className="grid grid-cols-3 gap-3">
                      <TemplateCard
                        selected={draft.kind === 'aviso' && !isEmail}
                        onClick={() => pickModel('aviso')}
                        title="Aviso"
                        hint="Pequeno, no canto da tela."
                        kind="aviso"
                        disabled={!!draft.id && (draft.kind !== 'aviso' || isEmail)}
                      />
                      <TemplateCard
                        selected={draft.kind === 'propaganda' && !isEmail}
                        onClick={() => pickModel('propaganda')}
                        title="Propaganda"
                        hint="Grande, no meio da tela."
                        kind="propaganda"
                        disabled={!!draft.id && (draft.kind !== 'propaganda' || isEmail)}
                      />
                      <TemplateCard
                        selected={isEmail}
                        onClick={() => pickModel('email')}
                        title="E-mail"
                        hint="Chega na caixa de entrada."
                        kind="email"
                        disabled={!!draft.id && !isEmail}
                      />
                    </div>
                  </Step>

                  <Step n={2} title="Conteúdo">
                    {isEmail ? (
                      <>
                        <EmailFields c={draft.promo} set={setPromo} />
                        <PromoFields c={draft.promo} set={setPromo} flash={flash} emailTemplate={draft.promo.mail?.template ?? 'oferta'} />
                      </>
                    ) : draft.kind === 'aviso' ? (
                      <AvisoFields c={draft.aviso} set={setAviso} />
                    ) : (
                      <PromoFields c={draft.promo} set={setPromo} flash={flash} />
                    )}
                  </Step>

                  <Step n={3} title="Quem recebe" right={<ReachPill reach={reach} admins={draft.audience.includeAdmins} loading={!users} />}>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {SEGMENTS.map((s) => {
                        const on = draft.audience.segments.includes(s);
                        const dim = s !== 'all' && draft.audience.segments.includes('all');
                        return (
                          <SegmentChip key={s} on={on} dim={dim} tone={SEGMENT_TONE[s]} label={SEGMENT_META[s].label} hint={SEGMENT_META[s].hint} count={users ? segCount[s] : null} onClick={() => toggleSegment(s)} />
                        );
                      })}
                    </div>
                    <EmailPicker
                      emails={draft.audience.emails}
                      users={users ?? []}
                      onChange={(emails) => setAudience({ emails })}
                      outside={outsideEmails}
                    />
                    <Toggle
                      on={draft.audience.includeAdmins}
                      onChange={(v) => setAudience({ includeAdmins: v })}
                      label="Admins também recebem"
                      hint="Você vê na sua tela também, pra conferir como ficou."
                    />
                  </Step>

                  {isEmail ? null : (
                  <Step n={4} title="Exibição">
                    <div className="grid grid-cols-2 gap-3">
                      <ModeCard
                        on={draft.popup}
                        onClick={() => set({ popup: true })}
                        title="Janela na tela"
                        hint="Abre ao entrar na conta e na hora que você publica. Fica no sino depois."
                        icon={<WindowGlyph />}
                      />
                      <ModeCard
                        on={!draft.popup}
                        onClick={() => set({ popup: false })}
                        title="Só no sino"
                        hint="Chega quieto nas notificações, sem abrir janela."
                        icon={<AnnIcon.bell size={18} />}
                      />
                    </div>
                    <div className="mt-4">
                      <p className="field-label mb-2 text-[13px] text-text-muted">Sai do ar sozinho</p>
                      <div className="flex flex-wrap items-center gap-2">
                        <Segmented<EndsMode>
                          size="sm"
                          value={draft.endsMode}
                          onChange={(v) => set({ endsMode: v, endsCustom: v === 'custom' && !draft.endsCustom ? toLocalInput(new Date(Date.now() + 2 * 86_400_000).toISOString()) : draft.endsCustom })}
                          options={[
                            { value: 'none', label: 'Sem prazo' },
                            { value: '24h', label: '24 h' },
                            { value: '3d', label: '3 dias' },
                            { value: '7d', label: '7 dias' },
                            { value: 'custom', label: 'Data' },
                          ]}
                        />
                        {draft.endsMode === 'custom' ? (
                          <input
                            type="datetime-local"
                            value={draft.endsCustom}
                            min={toLocalInput(new Date(Date.now() + 5 * 60_000).toISOString())}
                            onChange={(e) => set({ endsCustom: e.target.value })}
                            className="input-field !w-auto !py-1.5 text-[13px]"
                            aria-label="Data e hora de término"
                          />
                        ) : null}
                      </div>
                      {draft.kind === 'propaganda' && draft.endsMode !== 'none' ? (
                        <p className="field-label mt-2 text-[12.5px] text-text-muted">A propaganda mostra a contagem até o fim (&ldquo;Termina em 2 d 04 h&rdquo;).</p>
                      ) : null}
                    </div>
                    {draft.wasActive ? (
                      <div className="mt-4">
                        <Toggle
                          on={draft.republish}
                          onChange={(v) => set({ republish: v })}
                          label="Mostrar de novo pra quem já fechou"
                          hint={emailOn ? 'Sem isso, a mudança aparece no próximo login de cada pessoa. Com isso, o e-mail sai de novo também.' : 'Sem isso, a mudança aparece no próximo login de cada pessoa.'}
                        />
                      </div>
                    ) : null}
                  </Step>
                  )}
                </div>

                {/* ═══ Prévia ═══ */}
                <div className="min-h-0 border-t border-[rgb(var(--text)/0.07)] bg-[rgb(var(--text)/0.015)] px-5 py-5 md:px-6 lg:overflow-y-auto lg:border-l lg:border-t-0">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="font-tech text-[14.5px] font-semibold text-text">{isEmail ? 'Prévia do e-mail' : 'Prévia ao vivo'}</p>
                      <p className="field-label text-[12.5px] text-text-muted">{isEmail ? 'É o e-mail que chega na caixa de entrada.' : 'É exatamente o que o cliente vai ver.'}</p>
                    </div>
                    <Segmented
                      size="sm"
                      value={device}
                      onChange={setDevice}
                      options={[
                        { value: 'desktop', label: 'Computador' },
                        { value: 'mobile', label: 'Celular' },
                      ]}
                    />
                  </div>
                  {isEmail ? <EmailPreview kind={draft.kind} content={draft.promo} endsAt={null} device={device} /> : <Preview draft={draft} device={device} />}
                </div>
              </div>

              {/* ═══ Rodapé ═══ */}
              <footer className="flex flex-wrap items-center gap-3 border-t border-[rgb(var(--text)/0.07)] px-5 py-3.5 md:px-6">
                <div className="field-label mr-auto min-w-0 text-[13px]">
                  {formError ? (
                    <span key={formError} className="error-shake inline-flex items-center gap-2 font-semibold" style={{ color: accent('danger') }}>
                      <I.alert size={14} />
                      {formError}
                    </span>
                  ) : (
                    <span className="text-text-muted">
                      {audienceIsEmpty(draft.audience)
                        ? 'Ninguém selecionado ainda.'
                        : `${isEmail ? 'E-mail pra' : 'Vai pra'}: ${audienceSummary(draft.audience)}${emailOn ? ' · também por e-mail' : ''}`}
                    </span>
                  )}
                </div>
                {isEmail ? (
                  <>
                    <Btn onClick={() => void sendTest()} disabled={testing || saving !== null || dbMissing}>
                      <span className="inline-flex items-center gap-1.5">
                        <I.mail size={14} />
                        {testing ? 'Enviando teste' : 'Enviar teste pra mim'}
                      </span>
                    </Btn>
                    <Btn onClick={() => void save(false)} disabled={saving !== null || dbMissing}>
                      {saving === 'draft' ? 'Salvando' : draft.id ? 'Salvar' : 'Salvar rascunho'}
                    </Btn>
                    <PrimaryBtn onClick={() => void save(true)} busy={saving === 'publish'} disabled={saving !== null || dbMissing}>
                      {saving === 'publish' ? 'Enviando' : editing?.activatedAt ? 'Enviar de novo' : 'Enviar e-mail'}
                    </PrimaryBtn>
                  </>
                ) : draft.wasActive ? (
                  <>
                    <EmailToggle on={emailOn} onChange={(v) => setAudience({ email: v ? 'also' : 'off' })} disabled={saving !== null} />
                    <PrimaryBtn onClick={() => void save(false)} busy={saving !== null} disabled={dbMissing}>
                      {saving ? 'Salvando' : 'Salvar alterações'}
                    </PrimaryBtn>
                  </>
                ) : (
                  <>
                    <EmailToggle on={emailOn} onChange={(v) => setAudience({ email: v ? 'also' : 'off' })} disabled={saving !== null} />
                    <Btn onClick={() => void save(false)} disabled={saving !== null || dbMissing}>
                      {saving === 'draft' ? 'Salvando' : draft.id ? 'Salvar' : 'Salvar rascunho'}
                    </Btn>
                    <PrimaryBtn onClick={() => void save(true)} busy={saving === 'publish'} disabled={saving !== null || dbMissing}>
                      {saving === 'publish' ? 'Publicando' : 'Publicar agora'}
                    </PrimaryBtn>
                  </>
                )}
              </footer>
            </>
          ) : (
            <SentList
              list={list}
              error={listError}
              busy={busy}
              users={users}
              onReload={() => void load()}
              onToggle={(a) => void act(a, a.active ? 'pause' : 'activate')}
              onRepublish={(a) => void act(a, 'republish')}
              onSend={(a) => void act(a, 'send')}
              onResume={(a) => void act(a, 'resume')}
              onEdit={(a) => {
                setDraft(draftFrom(a));
                setTab('create');
              }}
              onDuplicate={(a) => {
                setDraft(draftFrom(a, true));
                setTab('create');
              }}
              onDelete={(a) => setConfirmDel(a)}
              onCreate={() => setTab('create')}
            />
          )}
        </div>
      </div>

      {confirmDel ? (
        <Modal onClose={() => setConfirmDel(null)} tone="danger">
          <h3 className="font-tech text-[18px] font-semibold tracking-[-0.02em] text-text">Excluir de vez?</h3>
          <p className="field-label mt-2 text-[14px] leading-relaxed text-text-muted">
            <b className="text-text">{confirmDel.content.title}</b> sai do ar e some também do histórico de notificações de quem recebeu
            {confirmDel.stats.delivered ? ` (${confirmDel.stats.delivered} ${confirmDel.stats.delivered === 1 ? 'conta' : 'contas'})` : ''}. Não tem volta.
            {confirmDel.active ? ' Se quiser só tirar da tela, use Pausar.' : ''}
          </p>
          <div className="mt-5 flex justify-end gap-2">
            <Btn onClick={() => setConfirmDel(null)}>Cancelar</Btn>
            <Btn tone="danger" solid onClick={() => void doDelete(confirmDel)} disabled={busy === confirmDel.id}>
              {busy === confirmDel.id ? 'Excluindo' : 'Excluir de vez'}
            </Btn>
          </div>
        </Modal>
      ) : null}

      {confirmSend ? (
        <Modal onClose={() => setConfirmSend(null)} tone="violet">
          <h3 className="font-tech text-[18px] font-semibold tracking-[-0.02em] text-text">
            {isEmail ? (editing?.activatedAt ? 'Enviar o e-mail de novo?' : 'Enviar o e-mail agora?') : 'Publicar e mandar o e-mail?'}
          </h3>
          <p className="field-label mt-2 text-[14px] leading-relaxed text-text-muted">
            Vai pra <b className="text-text">{reach} {reach === 1 ? 'conta' : 'contas'}{draft.audience.includeAdmins ? ' + admins' : ''}</b>: <b className="text-text">&ldquo;{isEmail ? draft.promo.mail?.subject || draft.promo.title : content.title}&rdquo;</b>. Depois de enviado não tem como desfazer; quem pediu pra não receber fica de fora.
          </p>
          {!isEmail ? <p className="field-label mt-2 text-[13px] leading-relaxed text-text-muted">A janela continua abrindo a cada login. O e-mail sai uma vez só nesta ativação.</p> : null}
          <div className="mt-5 flex justify-end gap-2">
            <Btn onClick={() => setConfirmSend(null)}>Cancelar</Btn>
            <Btn
              tone="violet"
              solid
              onClick={() => {
                const p = confirmSend.publish;
                setConfirmSend(null);
                void save(p, true);
              }}
            >
              Enviar agora
            </Btn>
          </div>
        </Modal>
      ) : null}

      {confirmAct ? (
        <Modal onClose={() => setConfirmAct(null)} tone="violet">
          <h3 className="font-tech text-[18px] font-semibold tracking-[-0.02em] text-text">
            {confirmAct.action === 'send' ? 'Enviar o e-mail de novo?' : confirmAct.action === 'activate' ? 'Ativar e mandar o e-mail?' : 'Mostrar de novo e mandar o e-mail?'}
          </h3>
          <p className="field-label mt-2 text-[14px] leading-relaxed text-text-muted">
            {(() => {
              const n = viewers.filter((v) => matchesAudience(confirmAct.a.audience, v)).length;
              const c = confirmAct.a.content as PromoContent;
              return (
                <>
                  Vai pra <b className="text-text">{n} {n === 1 ? 'conta' : 'contas'}{confirmAct.a.audience.includeAdmins ? ' + admins' : ''}</b>: <b className="text-text">&ldquo;{c.mail?.subject || confirmAct.a.content.title}&rdquo;</b>. É uma ativação nova, então o e-mail sai de novo pra todo mundo. Quem pediu pra não receber fica de fora.
                </>
              );
            })()}
          </p>
          <div className="mt-5 flex justify-end gap-2">
            <Btn onClick={() => setConfirmAct(null)}>Cancelar</Btn>
            <Btn
              tone="violet"
              solid
              onClick={() => {
                const { a, action } = confirmAct;
                setConfirmAct(null);
                void act(a, action, true);
              }}
            >
              Enviar agora
            </Btn>
          </div>
        </Modal>
      ) : null}
    </div>,
    document.body,
  );
}

/* ───────────────────────── Passos e campos ───────────────────────── */

function Step({ n, title, right, children }: { n: number; title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="mb-7 last:mb-2">
      <div className="mb-3 flex items-center gap-2.5">
        <span
          className="font-tech flex h-6 w-6 items-center justify-center rounded-full text-[12px] font-semibold"
          style={{ color: accent('violet'), background: accent('violet', 0.12), boxShadow: `inset 0 0 0 1px ${accent('violet', 0.28)}` }}
        >
          {n}
        </span>
        <h3 className="font-tech flex-1 text-[15px] font-semibold tracking-[-0.01em] text-text">{title}</h3>
        {right}
      </div>
      {children}
    </section>
  );
}

function Field({
  label,
  value,
  max,
  hint,
  children,
}: {
  label: string;
  value?: string;
  max?: number;
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  const n = value != null ? charCount(value) : 0;
  return (
    <label className="mb-3.5 block last:mb-0">
      <span className="field-label mb-1.5 flex items-baseline justify-between gap-3 text-[13px] text-text-muted">
        <span>{label}</span>
        {max ? (
          <span className="text-[11.5px]" style={{ color: n > max * 0.9 ? accent('amber') : undefined, fontVariantNumeric: 'tabular-nums' }}>
            {n}/{max}
          </span>
        ) : null}
      </span>
      {children}
      {hint ? <span className="field-label mt-1.5 block text-[12px] text-text-muted">{hint}</span> : null}
    </label>
  );
}

const INPUT = 'input-field !rounded-[12px] !py-2.5 text-[13.5px]';

function AvisoFields({ c, set }: { c: AvisoContent; set: (p: Partial<AvisoContent>) => void }) {
  return (
    <div>
      <p className="field-label mb-2 text-[13px] text-text-muted">Tom</p>
      <div className="mb-4 flex flex-wrap gap-2">
        {AVISO_TONES.map((t) => {
          const on = c.tone === t;
          return (
            <button
              key={t}
              type="button"
              onClick={() => set({ tone: t })}
              aria-pressed={on}
              className="field-label inline-flex h-9 items-center gap-2 rounded-full pl-1.5 pr-3.5 text-[12.5px] font-semibold transition-[background-color,box-shadow,transform] duration-300 active:scale-[0.97]"
              style={{
                ['--ann' as string]: TONE_META[t].rgb,
                color: on ? 'rgb(var(--ann))' : 'rgb(var(--text-muted))',
                background: on ? 'rgb(var(--ann) / 0.12)' : 'rgb(var(--text) / 0.04)',
                boxShadow: `inset 0 0 0 1px ${on ? 'rgb(var(--ann) / 0.35)' : 'rgb(var(--text) / 0.08)'}`,
                transitionTimingFunction: SPRING,
              }}
            >
              <span className="flex h-6 w-6 items-center justify-center rounded-full" style={{ color: 'rgb(var(--ann))', background: 'rgb(var(--ann) / 0.14)' }}>
                <ToneIcon tone={t} size={13} />
              </span>
              {TONE_META[t].label}
            </button>
          );
        })}
      </div>
      <Field label="Título" value={c.title} max={LIMITS.avisoTitle}>
        <input className={INPUT} value={c.title} maxLength={LIMITS.avisoTitle + 10} onChange={(e) => set({ title: e.target.value })} placeholder="Ex.: Manutenção hoje às 23h" />
      </Field>
      <Field label="Mensagem" value={c.body} max={LIMITS.avisoBody}>
        <textarea className={INPUT + ' min-h-[88px] resize-y leading-relaxed'} value={c.body} maxLength={LIMITS.avisoBody + 20} onChange={(e) => set({ body: e.target.value })} placeholder="Curto e direto. Ex.: O site fica fora por 15 minutos pra atualização." />
      </Field>
      <CtaFields label={c.ctaLabel} url={c.ctaUrl} onChange={(p) => set(p)} />
    </div>
  );
}

function CtaFields({ label, url, onChange }: { label: string; url: string; onChange: (p: { ctaLabel?: string; ctaUrl?: string }) => void }) {
  return (
    <div className="grid gap-x-3 sm:grid-cols-[0.8fr_1.2fr]">
      <Field label="Texto do botão (opcional)" value={label} max={LIMITS.ctaLabel}>
        <input className={INPUT} value={label} maxLength={LIMITS.ctaLabel + 6} onChange={(e) => onChange({ ctaLabel: e.target.value })} placeholder="Ex.: Ver agora" />
      </Field>
      <Field label="Link do botão" hint={<>Página do site (<b>/planos</b>) abre na mesma aba; link de fora abre em outra.</>}>
        <input className={INPUT} value={url} onChange={(e) => onChange({ ctaUrl: e.target.value })} placeholder="/planos ou https://..." inputMode="url" />
      </Field>
    </div>
  );
}

const ART_LABEL: Record<PromoArt, string> = { tema: 'Imagem ou arte do tema', pilot: 'Pilot animado' };

function PromoFields({
  c,
  set,
  flash,
  emailTemplate,
}: {
  c: PromoContent;
  set: (p: Partial<PromoContent>) => void;
  flash: (k: 'ok' | 'err', m: string) => void;
  /** modelo E-mail: esconde o que o template escolhido não usa */
  emailTemplate?: EmailTemplate;
}) {
  const bullets = [...c.bullets, '', '', ''].slice(0, LIMITS.bullets);
  const usaImagem = emailTemplate !== 'comunicado';
  const usaDestaques = emailTemplate !== 'comunicado';
  const usaPreco = !emailTemplate || emailTemplate === 'oferta';
  return (
    <div>
      <p className="field-label mb-2 text-[13px] text-text-muted">Cor</p>
      <div className="mb-4 flex flex-wrap gap-2">
        {PROMO_THEMES.map((t) => {
          const on = c.theme === t;
          return (
            <button
              key={t}
              type="button"
              onClick={() => set({ theme: t })}
              aria-pressed={on}
              className="field-label inline-flex h-9 items-center gap-2 rounded-full pl-1.5 pr-3.5 text-[12.5px] font-semibold transition-[background-color,box-shadow] duration-300"
              style={{
                ['--ann' as string]: THEME_META[t].rgb,
                color: on ? 'rgb(var(--text))' : 'rgb(var(--text-muted))',
                background: on ? 'rgb(var(--ann) / 0.12)' : 'rgb(var(--text) / 0.04)',
                boxShadow: `inset 0 0 0 1px ${on ? 'rgb(var(--ann) / 0.4)' : 'rgb(var(--text) / 0.08)'}`,
                transitionTimingFunction: SPRING,
              }}
            >
              <span
                className="h-6 w-6 rounded-full"
                style={{
                  background: 'radial-gradient(circle at 35% 30%, rgb(255 255 255 / 0.55), rgb(var(--ann)) 45%, rgb(var(--ann) / 0.7))',
                  boxShadow: on ? '0 0 0 2px rgb(var(--bg-soft)), 0 0 0 3.5px rgb(var(--ann))' : 'inset 0 0 0 1px rgb(0 0 0 / 0.2)',
                }}
              />
              {THEME_META[t].label}
            </button>
          );
        })}
      </div>

      {usaImagem ? (
      <>
      <p className="field-label mb-2 text-[13px] text-text-muted">Arte</p>
      <div className="mb-4 flex flex-wrap gap-2">
        {PROMO_ARTS.map((a) => {
          const on = c.art === a;
          return (
            <button
              key={a}
              type="button"
              onClick={() => set({ art: a })}
              aria-pressed={on}
              className="field-label inline-flex h-9 items-center rounded-full px-3.5 text-[12.5px] font-semibold transition-[background-color,box-shadow] duration-300"
              style={{
                ['--ann' as string]: THEME_META[c.theme].rgb,
                color: on ? 'rgb(var(--text))' : 'rgb(var(--text-muted))',
                background: on ? 'rgb(var(--ann) / 0.12)' : 'rgb(var(--text) / 0.04)',
                boxShadow: `inset 0 0 0 1px ${on ? 'rgb(var(--ann) / 0.4)' : 'rgb(var(--text) / 0.08)'}`,
                transitionTimingFunction: SPRING,
              }}
            >
              {ART_LABEL[a]}
            </button>
          );
        })}
      </div>

      {c.art === 'pilot' ? (
        <p className="field-label -mt-1 mb-4 text-[12px] leading-relaxed text-text-muted">
          {emailTemplate
            ? 'No e-mail vai o quadro da cena do Pilot (PILOT cromado, cérebro e avatar em holograma) no topo.'
            : 'A cena do Pilot entra no lugar da imagem, em cima do texto: o cérebro vira código e o código vira avatar em holograma, mexendo com o mouse.'}
        </p>
      ) : (
        <ImageField url={c.imageUrl} onChange={(imageUrl) => set({ imageUrl })} flash={flash} />
      )}
      </>
      ) : null}

      <div className="grid gap-x-3 sm:grid-cols-2">
        <Field label="Selo (opcional)" value={c.badge} max={LIMITS.promoBadge}>
          <input className={INPUT} value={c.badge} maxLength={LIMITS.promoBadge + 6} onChange={(e) => set({ badge: e.target.value })} placeholder="Ex.: Oferta por tempo limitado" />
        </Field>
        <Field label="Título" value={c.title} max={LIMITS.promoTitle}>
          <input className={INPUT} value={c.title} maxLength={LIMITS.promoTitle + 10} onChange={(e) => set({ title: e.target.value })} placeholder="Ex.: Premium com 40% off" />
        </Field>
      </div>
      <Field label="Texto" value={c.body} max={LIMITS.promoBody}>
        <textarea className={INPUT + ' min-h-[76px] resize-y leading-relaxed'} value={c.body} maxLength={LIMITS.promoBody + 20} onChange={(e) => set({ body: e.target.value })} placeholder="Uma ou duas frases que fazem a pessoa querer clicar." />
      </Field>
      {usaDestaques ? (
      <Field label="Destaques (até 3, opcional)">
        <div className="grid gap-2">
          {bullets.map((b, i) => (
            <div key={i} className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full" style={{ ['--ann' as string]: THEME_META[c.theme].rgb, color: 'rgb(var(--ann))', background: 'rgb(var(--ann) / 0.13)' }}>
                <AnnIcon.check size={10} />
              </span>
              <input
                className={INPUT + ' !pl-10'}
                value={b}
                maxLength={LIMITS.bullet + 6}
                placeholder={['Ex.: Legendas automáticas sem limite', 'Ex.: Lipsync de vídeo pra vídeo', 'Ex.: Suporte direto no WhatsApp'][i]}
                onChange={(e) => {
                  const next = [...bullets];
                  next[i] = e.target.value;
                  set({ bullets: next });
                }}
              />
            </div>
          ))}
        </div>
      </Field>
      ) : null}
      {usaPreco ? (
      <div className="grid grid-cols-3 gap-x-3">
        <Field label="Preço de (opcional)">
          <input className={INPUT} value={c.priceOld} maxLength={LIMITS.price} onChange={(e) => set({ priceOld: e.target.value })} placeholder="R$ 97" />
        </Field>
        <Field label="Preço por">
          <input className={INPUT} value={c.priceNew} maxLength={LIMITS.price} onChange={(e) => set({ priceNew: e.target.value })} placeholder="R$ 57" />
        </Field>
        <Field label="Detalhe">
          <input className={INPUT} value={c.priceNote} maxLength={LIMITS.priceNote} onChange={(e) => set({ priceNote: e.target.value })} placeholder="/mês" />
        </Field>
      </div>
      ) : null}
      <CtaFields label={c.ctaLabel} url={c.ctaUrl} onChange={(p) => set(p)} />
    </div>
  );
}

/** Modelo E-mail: template, assunto e pré-texto (o resto do conteúdo é o da propaganda). */
function EmailFields({ c, set }: { c: PromoContent; set: (p: Partial<PromoContent>) => void }) {
  const m = c.mail ?? { template: 'oferta' as EmailTemplate, subject: '', preheader: '' };
  const setMail = (p: Partial<NonNullable<PromoContent['mail']>>) => set({ mail: { ...m, ...p } });
  return (
    <div className="mb-5">
      <p className="field-label mb-2 text-[13px] text-text-muted">Template</p>
      <TemplatePicker value={m.template} onChange={(template) => setMail({ template })} color={THEME_META[c.theme].rgb} />
      <div className="mt-4 grid gap-x-3 sm:grid-cols-2">
        <Field label="Assunto" value={m.subject} max={LIMITS.mailSubject}>
          <input
            className={INPUT}
            value={m.subject}
            maxLength={LIMITS.mailSubject + 10}
            onChange={(e) => setMail({ subject: e.target.value })}
            placeholder={c.title ? 'Vazio = o título' : 'Ex.: Chegou o Pilot'}
          />
        </Field>
        <Field label="Pré-texto (opcional)" value={m.preheader} max={LIMITS.mailPreheader}>
          <input
            className={INPUT}
            value={m.preheader}
            maxLength={LIMITS.mailPreheader + 10}
            onChange={(e) => setMail({ preheader: e.target.value })}
            placeholder="Aparece ao lado do assunto"
          />
        </Field>
      </div>
    </div>
  );
}

/** Imagem: envia arquivo (comprimido em WebP aqui no navegador) ou cola link https. */
function ImageField({ url, onChange, flash }: { url: string; onChange: (u: string) => void; flash: (k: 'ok' | 'err', m: string) => void }) {
  const [uploading, setUploading] = useState(false);
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  async function compress(file: File): Promise<Blob> {
    if (file.type === 'image/gif') return file; // mantém a animação
    try {
      const bmp = await createImageBitmap(file);
      const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
      const w = Math.max(1, Math.round(bmp.width * scale));
      const h = Math.max(1, Math.round(bmp.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d')?.drawImage(bmp, 0, 0, w, h);
      bmp.close?.();
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/webp', 0.86));
      return blob && blob.size < file.size ? blob : file;
    } catch {
      return file;
    }
  }

  async function upload(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      flash('err', 'Escolha um arquivo de imagem (JPG, PNG, WebP).');
      return;
    }
    setUploading(true);
    try {
      const blob = await compress(file);
      if (blob.size > 4 * 1024 * 1024) {
        flash('err', 'Imagem grande demais mesmo comprimida (máximo 4 MB).');
        return;
      }
      const fd = new FormData();
      const ext = blob.type === 'image/webp' ? 'webp' : file.name.split('.').pop() || 'img';
      fd.append('file', blob, `promo.${ext}`);
      const res = await fetch('/api/admin/announcements/upload', { method: 'POST', body: fd });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.url) {
        flash('err', j.error || 'Falha ao enviar a imagem.');
        return;
      }
      onChange(j.url);
    } catch (e) {
      flash('err', (e as Error).message || 'Falha ao enviar a imagem.');
    } finally {
      setUploading(false);
      if (input.current) input.current.value = '';
    }
  }

  return (
    <div className="mb-4">
      <p className="field-label mb-1.5 text-[13px] text-text-muted">Imagem (opcional)</p>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          void upload(e.dataTransfer.files?.[0]);
        }}
        className="flex items-center gap-3 rounded-[14px] p-2.5 transition-colors duration-300"
        style={{
          background: drag ? accent('violet', 0.08) : 'rgb(var(--text) / 0.03)',
          boxShadow: `inset 0 0 0 1px ${drag ? accent('violet', 0.4) : 'rgb(var(--text) / 0.08)'}`,
        }}
      >
        <div className="relative h-[64px] w-[52px] shrink-0 overflow-hidden rounded-[10px]" style={{ background: 'rgb(var(--text) / 0.05)', boxShadow: 'inset 0 0 0 1px rgb(var(--text) / 0.08)' }}>
          {url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={url} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="flex h-full w-full items-center justify-center text-text-muted">
              <ImageGlyph />
            </span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="field-label text-[13px] text-text">
            {uploading ? 'Enviando a imagem' : url ? 'Imagem escolhida' : 'Sem imagem: entra a arte do Auto Edit na cor escolhida'}
          </p>
          <p className="field-label text-[12px] text-text-muted">Vertical ou quadrada fica melhor (ex.: 1080 x 1350). Arraste aqui ou envie.</p>
        </div>
        <input ref={input} type="file" accept="image/*" className="hidden" onChange={(e) => void upload(e.target.files?.[0])} />
        {url ? (
          <Btn size="sm" onClick={() => onChange('')} disabled={uploading}>
            Remover
          </Btn>
        ) : null}
        <Btn size="sm" tone="violet" onClick={() => input.current?.click()} disabled={uploading}>
          {uploading ? 'Enviando' : 'Enviar'}
        </Btn>
      </div>
      <input
        className={INPUT + ' mt-2'}
        value={url}
        onChange={(e) => onChange(e.target.value.trim())}
        placeholder="ou cole o link da imagem (https://...)"
        inputMode="url"
        aria-label="Link da imagem"
      />
    </div>
  );
}

/* ───────────────────────── Peças visuais ───────────────────────── */

function TemplateCard({
  selected,
  onClick,
  title,
  hint,
  kind,
  disabled,
}: {
  selected: boolean;
  onClick: () => void;
  title: string;
  hint: string;
  kind: AnnKind | 'email';
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={selected}
      className="group relative rounded-[18px] p-[4px] text-left transition-[box-shadow,transform,opacity] duration-300 active:scale-[0.985] disabled:opacity-35"
      style={{
        background: selected ? accent('violet', 0.1) : 'rgb(var(--text) / 0.03)',
        boxShadow: `inset 0 0 0 ${selected ? 1.5 : 1}px ${selected ? accent('violet', 0.55) : 'rgb(var(--text) / 0.08)'}`,
        transitionTimingFunction: SPRING,
      }}
    >
      <div className="overflow-hidden rounded-[14px]" style={{ boxShadow: 'inset 0 0 0 1px rgb(var(--text) / 0.06)' }}>
        {kind === 'email' ? <EmailMiniature /> : <Miniature kind={kind} />}
      </div>
      <div className="flex items-start justify-between gap-2 px-2 pb-1.5 pt-2.5">
        <div className="min-w-0">
          <p className="font-tech text-[14px] font-semibold text-text">{title}</p>
          <p className="field-label mt-0.5 text-[12px] leading-snug text-text-muted">{hint}</p>
        </div>
        <span
          className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full transition-[background-color,box-shadow] duration-300"
          style={{
            color: '#fff',
            background: selected ? accent('violet') : 'transparent',
            boxShadow: selected ? 'none' : 'inset 0 0 0 1.5px rgb(var(--text) / 0.2)',
          }}
        >
          {selected ? <AnnIcon.check size={11} /> : null}
        </span>
      </div>
    </button>
  );
}

/** Miniatura desenhada do resultado (tela do app com o aviso/banner). */
function Miniature({ kind }: { kind: AnnKind }) {
  return (
    <div className="dark-island relative h-[92px] w-full overflow-hidden" style={{ background: '#0b0b0e' }}>
      {/* app de fundo */}
      <div className="absolute inset-y-0 left-0 w-[11%]" style={{ background: 'rgb(255 255 255 / 0.03)', boxShadow: 'inset -1px 0 0 rgb(255 255 255 / 0.05)' }} />
      <div className="absolute left-[11%] right-0 top-0 h-[14%]" style={{ boxShadow: 'inset 0 -1px 0 rgb(255 255 255 / 0.05)' }} />
      <div className="absolute left-[17%] top-[24%] h-[7%] w-[34%] rounded-full" style={{ background: 'rgb(255 255 255 / 0.12)' }} />
      <div className="absolute left-[17%] top-[38%] grid w-[76%] grid-cols-3 gap-[5%]">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="h-[16px] rounded-[4px]" style={{ background: 'rgb(255 255 255 / 0.05)' }} />
        ))}
      </div>
      {kind === 'aviso' ? (
        <div
          className="absolute right-[5%] top-[19%] w-[38%] rounded-[7px] p-[5px]"
          style={{ background: '#1d1d24', boxShadow: '0 0 0 1px rgb(255 255 255 / 0.1), 0 8px 18px -6px rgb(0 0 0 / 0.8), 0 6px 18px -8px rgb(162 145 224 / 0.8)' }}
        >
          <div className="flex items-center gap-[4px]">
            <span className="h-[9px] w-[9px] rounded-[3px]" style={{ background: 'rgb(162 145 224 / 0.8)' }} />
            <span className="h-[3px] w-[40%] rounded-full" style={{ background: 'rgb(162 145 224 / 0.7)' }} />
          </div>
          <div className="mt-[5px] h-[3px] w-[85%] rounded-full" style={{ background: 'rgb(255 255 255 / 0.7)' }} />
          <div className="mt-[3px] h-[3px] w-[65%] rounded-full" style={{ background: 'rgb(255 255 255 / 0.3)' }} />
          <div className="mt-[5px] h-[7px] w-[42%] rounded-full" style={{ background: 'rgb(162 145 224 / 0.35)' }} />
        </div>
      ) : (
        <>
          <div className="absolute inset-0" style={{ background: 'rgb(0 0 0 / 0.55)' }} />
          <div
            className="absolute left-1/2 top-1/2 grid h-[74%] w-[68%] -translate-x-1/2 -translate-y-1/2 grid-cols-[44%_1fr] gap-[4%] rounded-[8px] p-[4px]"
            style={{ background: '#0d0d11', boxShadow: '0 0 0 1px rgb(255 255 255 / 0.1), 0 14px 28px -10px rgb(0 0 0 / 0.9), 0 10px 30px -12px rgb(200 214 132 / 0.6)' }}
          >
            <div className="relative overflow-hidden rounded-[6px]" style={{ background: 'radial-gradient(90% 70% at 50% 110%, rgb(200 214 132 / 0.7), transparent 65%), #060608' }}>
              <span className="absolute left-1/2 top-[42%] h-[46%] w-auto -translate-x-1/2 -translate-y-1/2 rounded-full" style={{ aspectRatio: '1', boxShadow: 'inset 0 0 0 1.5px rgb(200 214 132 / 0.9), 0 0 10px rgb(200 214 132 / 0.6)' }} />
            </div>
            <div className="flex flex-col justify-center gap-[4px] pr-[6%]">
              <span className="h-[5px] w-[45%] rounded-full" style={{ background: 'rgb(200 214 132 / 0.6)' }} />
              <span className="h-[5px] w-[90%] rounded-full" style={{ background: 'rgb(255 255 255 / 0.85)' }} />
              <span className="h-[5px] w-[70%] rounded-full" style={{ background: 'rgb(255 255 255 / 0.85)' }} />
              <span className="h-[3px] w-[80%] rounded-full" style={{ background: 'rgb(255 255 255 / 0.3)' }} />
              <span className="mt-[3px] h-[9px] w-[55%] rounded-full" style={{ background: 'rgb(200 214 132)' }} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function SegmentChip({
  on,
  dim,
  tone,
  label,
  hint,
  count,
  onClick,
}: {
  on: boolean;
  dim: boolean;
  tone: Accent;
  label: string;
  hint: string;
  count: number | null;
  onClick: () => void;
}) {
  const t = tone === 'neutral' ? 'violet' : tone;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      title={hint}
      className="relative flex min-w-0 items-center gap-2.5 rounded-[14px] px-3 py-2.5 text-left transition-[background-color,box-shadow,opacity] duration-300"
      style={{
        opacity: dim ? 0.45 : 1,
        background: on ? accent(t, 0.1) : 'rgb(var(--text) / 0.03)',
        boxShadow: `inset 0 0 0 1px ${on ? accent(t, 0.45) : 'rgb(var(--text) / 0.08)'}`,
        transitionTimingFunction: SPRING,
      }}
    >
      <span
        className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[6px] transition-colors duration-300"
        style={{ color: '#0b0b0e', background: on ? accent(t) : 'transparent', boxShadow: on ? 'none' : 'inset 0 0 0 1.5px rgb(var(--text) / 0.22)' }}
      >
        {on ? <AnnIcon.check size={10} /> : null}
      </span>
      <span className="min-w-0 flex-1">
        <span className="field-label block truncate text-[13px] font-semibold text-text">{label}</span>
        <span className="field-label block truncate text-[11.5px] text-text-muted">{hint}</span>
      </span>
      <span className="font-tech shrink-0 text-[13px] font-semibold text-text-muted" style={{ fontVariantNumeric: 'tabular-nums' }}>
        {count ?? '·'}
      </span>
    </button>
  );
}

function EmailPicker({
  emails,
  users,
  onChange,
  outside,
}: {
  emails: string[];
  users: AdminUser[];
  onChange: (emails: string[]) => void;
  outside: number;
}) {
  const [q, setQ] = useState('');
  const [focus, setFocus] = useState(false);
  const known = useMemo(() => new Set(users.map((u) => (u.email ?? '').toLowerCase())), [users]);
  const suggestions = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (s.length < 2) return [];
    return users
      .filter((u) => u.email && !emails.includes(u.email.toLowerCase()) && ((u.email ?? '').toLowerCase().includes(s) || (u.name ?? '').toLowerCase().includes(s)))
      .slice(0, 6);
  }, [q, users, emails]);

  function add(raw: string) {
    const parts = raw.split(/[\s,;]+/).map(normalizeEmail).filter((e): e is string => !!e);
    if (!parts.length) return false;
    onChange(Array.from(new Set([...emails, ...parts])));
    setQ('');
    return true;
  }

  return (
    <div className="mt-3 rounded-[14px] p-3" style={{ background: 'rgb(var(--text) / 0.025)', boxShadow: 'inset 0 0 0 1px rgb(var(--text) / 0.07)' }}>
      <p className="field-label text-[13px] font-semibold text-text">Contas específicas</p>
      <p className="field-label mb-2 text-[12px] text-text-muted">Somam com os grupos acima. Busque pelo nome ou email, ou cole uma lista.</p>
      {emails.length ? (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {emails.map((e) => (
            <span
              key={e}
              className="field-label inline-flex max-w-full items-center gap-1 rounded-full py-1 pl-2.5 pr-1 text-[12px] font-medium text-text"
              style={{ background: known.has(e) ? 'rgb(var(--text) / 0.07)' : accent('amber', 0.1), boxShadow: `inset 0 0 0 1px ${known.has(e) ? 'rgb(var(--text) / 0.1)' : accent('amber', 0.3)}` }}
              title={known.has(e) ? e : `${e}: não está na lista de clientes`}
            >
              <span className="truncate">{e}</span>
              <button type="button" onClick={() => onChange(emails.filter((x) => x !== e))} className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-text-muted hover:bg-[rgb(var(--text)/0.1)] hover:text-text" aria-label={`Tirar ${e}`}>
                <AnnIcon.close size={11} />
              </button>
            </span>
          ))}
        </div>
      ) : null}
      <div className="relative">
        <input
          className={INPUT}
          value={q}
          onChange={(e) => {
            const v = e.target.value;
            if (/[,;\n]/.test(v) && add(v)) return;
            setQ(v);
          }}
          onPaste={(e) => {
            const t = e.clipboardData.getData('text');
            if (/[\s,;]/.test(t.trim()) && add(t)) e.preventDefault();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              if (suggestions[0] && !normalizeEmail(q)) add(suggestions[0].email as string);
              else add(q);
            } else if (e.key === 'Backspace' && !q && emails.length) {
              onChange(emails.slice(0, -1));
            }
          }}
          onFocus={() => setFocus(true)}
          onBlur={() => setTimeout(() => setFocus(false), 150)}
          placeholder="nome ou email@exemplo.com"
          aria-label="Adicionar conta específica"
        />
        {focus && suggestions.length ? (
          <div className="dropdown-pop absolute left-0 right-0 top-[calc(100%+6px)] z-10 rounded-[14px] bg-bg-elev p-1.5" style={{ boxShadow: 'inset 0 0 0 1px rgb(var(--text) / 0.1), 0 24px 48px -16px rgb(0 0 0 / 0.6)' }}>
            {suggestions.map((u) => (
              <button
                key={u.id}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  add(u.email as string);
                }}
                className="field-label flex w-full items-center justify-between gap-3 rounded-[10px] px-3 py-2 text-left text-[13px] hover:bg-[rgb(var(--text)/0.07)]"
              >
                <span className="min-w-0 truncate text-text">{u.name || u.email}</span>
                <span className="min-w-0 truncate text-[12px] text-text-muted">{u.name ? u.email : u.plan === 'premium' ? 'Premium' : 'Free'}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
      {outside ? (
        <p className="field-label mt-2 text-[12px]" style={{ color: accent('amber') }}>
          {outside} {outside === 1 ? 'email não está' : 'emails não estão'} na lista de clientes (pode ser admin ou conta nova).
        </p>
      ) : null}
    </div>
  );
}

function Toggle({ on, onChange, label, hint }: { on: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} onClick={() => onChange(!on)} className="mt-3 flex w-full items-center gap-3 rounded-[14px] px-3 py-2.5 text-left transition-colors duration-300 hover:bg-[rgb(var(--text)/0.03)]">
      <Switch on={on} />
      <span className="min-w-0">
        <span className="field-label block text-[13px] font-semibold text-text">{label}</span>
        {hint ? <span className="field-label block text-[12px] text-text-muted">{hint}</span> : null}
      </span>
    </button>
  );
}

function Switch({ on, busy }: { on: boolean; busy?: boolean }) {
  return (
    <span
      aria-hidden
      className="relative inline-flex h-[22px] w-[38px] shrink-0 items-center rounded-full transition-[background-color,box-shadow] duration-300"
      style={{
        background: on ? accent('lime', 0.85) : 'rgb(var(--text) / 0.12)',
        boxShadow: `inset 0 0 0 1px ${on ? accent('lime', 0.9) : 'rgb(var(--text) / 0.12)'}`,
        opacity: busy ? 0.6 : 1,
        transitionTimingFunction: SPRING,
      }}
    >
      <span
        className="absolute left-[3px] h-4 w-4 rounded-full bg-white transition-transform duration-300"
        style={{ transform: on ? 'translateX(16px)' : 'none', boxShadow: '0 2px 6px rgb(0 0 0 / 0.35)', transitionTimingFunction: SPRING }}
      />
    </span>
  );
}

function ModeCard({ on, onClick, title, hint, icon }: { on: boolean; onClick: () => void; title: string; hint: string; icon: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className="flex items-start gap-3 rounded-[16px] p-3.5 text-left transition-[background-color,box-shadow] duration-300"
      style={{
        background: on ? accent('violet', 0.09) : 'rgb(var(--text) / 0.03)',
        boxShadow: `inset 0 0 0 1px ${on ? accent('violet', 0.45) : 'rgb(var(--text) / 0.08)'}`,
        transitionTimingFunction: SPRING,
      }}
    >
      <span
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px]"
        style={{ color: on ? accent('violet') : 'rgb(var(--text-muted))', background: on ? accent('violet', 0.14) : 'rgb(var(--text) / 0.06)' }}
      >
        {icon}
      </span>
      <span className="min-w-0">
        <span className="font-tech block text-[13.5px] font-semibold text-text">{title}</span>
        <span className="field-label mt-0.5 block text-[12px] leading-snug text-text-muted">{hint}</span>
      </span>
    </button>
  );
}

function ReachPill({ reach, admins, loading }: { reach: number; admins: boolean; loading: boolean }) {
  return (
    <span
      className="field-label inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-semibold"
      style={{ color: accent('lime'), background: accent('lime', 0.1), boxShadow: `inset 0 0 0 1px ${accent('lime', 0.26)}` }}
      title="Clientes ativos que recebem com a seleção atual"
    >
      <I.user size={12} />
      {loading ? 'Contando' : `${reach} ${reach === 1 ? 'conta' : 'contas'}${admins ? ' + admins' : ''}`}
    </span>
  );
}

function PrimaryBtn({ onClick, children, busy, disabled }: { onClick: () => void; children: React.ReactNode; busy?: boolean; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className="btn-primary group !h-10 !pl-5 !pr-1.5 text-[13.5px]">
      {children}
      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white/15 transition-transform duration-300 group-hover:-translate-y-[1px] group-hover:translate-x-[1px]" style={{ transitionTimingFunction: SPRING }}>
        {busy ? <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" /> : <AnnIcon.arrow size={13} />}
      </span>
    </button>
  );
}

function WindowGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
      <rect x="7" y="8.5" width="10" height="7" rx="1.5" />
    </svg>
  );
}

function ImageGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
      <circle cx="9" cy="10" r="1.6" />
      <path d="m20.5 16-4.5-4.5L7 19.5" />
    </svg>
  );
}

/* ───────────────────────── Prévia ───────────────────────── */

/** Renderiza no tamanho real e reduz pra caber (sem mudar o layout de dentro). */
function Scaled({ width, children }: { width: number; children: React.ReactNode }) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const o = outer.current;
    const i = inner.current;
    if (!o || !i) return;
    const measure = () => setBox({ w: o.clientWidth, h: i.offsetHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(o);
    ro.observe(i);
    return () => ro.disconnect();
  }, [width]);
  const scale = box.w ? Math.min(1, box.w / width) : 1;
  return (
    <div ref={outer} className="relative w-full" style={{ height: box.h * scale || undefined }}>
      <div
        ref={inner}
        className="absolute top-0"
        style={{ width, left: Math.max(0, (box.w - width * scale) / 2), transform: `scale(${scale})`, transformOrigin: 'top left' }}
      >
        {children}
      </div>
    </div>
  );
}

function FakeApp({ mobile }: { mobile: boolean }) {
  return (
    <div className="dark-island relative w-full overflow-hidden rounded-[18px]" style={{ background: '#08080a', boxShadow: 'inset 0 0 0 1px rgb(255 255 255 / 0.07)' }}>
      {/* barra do topo */}
      <div className="flex h-12 items-center justify-between px-4" style={{ boxShadow: 'inset 0 -1px 0 rgb(255 255 255 / 0.06)' }}>
        <span className="h-2.5 w-24 rounded-full" style={{ background: 'rgb(255 255 255 / 0.14)' }} />
        <span className="flex items-center gap-1.5 rounded-full p-1" style={{ boxShadow: 'inset 0 0 0 1px rgb(255 255 255 / 0.08)' }}>
          <span className="flex h-6 w-6 items-center justify-center rounded-full" style={{ color: '#c084fc' }}>
            <AnnIcon.bell size={13} />
          </span>
          <span className="h-6 w-6 rounded-full" style={{ background: 'rgb(255 255 255 / 0.05)' }} />
          {!mobile ? <span className="h-6 w-6 rounded-full" style={{ background: 'rgb(255 255 255 / 0.05)' }} /> : null}
        </span>
      </div>
      <div className="flex">
        {!mobile ? (
          <div className="flex w-14 shrink-0 flex-col items-center gap-3 py-4" style={{ boxShadow: 'inset -1px 0 0 rgb(255 255 255 / 0.05)' }}>
            {[0, 1, 2, 3].map((i) => (
              <span key={i} className="h-6 w-6 rounded-[8px]" style={{ background: 'rgb(255 255 255 / 0.05)' }} />
            ))}
          </div>
        ) : null}
        <div className="flex-1 p-5">
          <span className="block h-3 w-40 rounded-full" style={{ background: 'rgb(255 255 255 / 0.12)' }} />
          <span className="mt-2 block h-2 w-64 max-w-full rounded-full" style={{ background: 'rgb(255 255 255 / 0.06)' }} />
          <div className={'mt-5 grid gap-3 ' + (mobile ? 'grid-cols-1' : 'grid-cols-3')}>
            {Array.from({ length: mobile ? 4 : 6 }, (_, i) => (
              <div key={i} className="h-24 rounded-[14px]" style={{ background: 'rgb(255 255 255 / 0.035)', boxShadow: 'inset 0 0 0 1px rgb(255 255 255 / 0.05)' }} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function Preview({ draft, device }: { draft: Draft; device: 'desktop' | 'mobile' }) {
  const mobile = device === 'mobile';
  const endsAt = draft.kind === 'propaganda' ? endsAtOf(draft) : null;
  const ends = endsAt && endsAt !== 'invalid' ? endsAt : null;
  // App de fundo e aviso na MESMA célula do grid: o palco cresce com o que
  // for mais alto (texto longo nunca é cortado na prévia).
  const cell = { gridArea: '1 / 1' } as const;

  if (draft.kind === 'aviso') {
    return (
      <>
        <Scaled width={mobile ? 390 : 760}>
          <div className="grid">
            <div style={cell} className="flex">
              <FakeApp mobile={mobile} />
            </div>
            <div style={cell} className={mobile ? 'px-3 pb-4 pt-14' : 'flex justify-end px-4 pb-4 pt-14'}>
              <AvisoCard content={draft.aviso} placeholder onClose={() => {}} className={mobile ? '!max-w-none' : ''} />
            </div>
          </div>
        </Scaled>
        <p className="field-label mt-3 text-center text-[12px] text-text-muted">
          {draft.popup ? 'Aparece no canto da tela até a pessoa fechar. Depois fica no sino.' : 'Só no sino: este é o visual ao abrir pelo histórico.'}
        </p>
      </>
    );
  }

  return (
    <>
      <Scaled width={mobile ? 390 : 1000}>
        <div className="grid">
          <div style={cell} className="flex">
            <FakeApp mobile={mobile} />
          </div>
          <div style={cell} className="relative flex items-center justify-center rounded-[18px]">
            <div className="absolute inset-0 rounded-[18px]" style={{ background: 'rgb(4 4 6 / 0.72)' }} />
            <div className="relative w-full" style={{ maxWidth: 920, padding: mobile ? '56px 12px 16px' : '48px 40px' }}>
              <PromoBanner content={draft.promo} endsAt={ends} placeholder onClose={() => {}} onLater={() => {}} />
            </div>
          </div>
        </div>
      </Scaled>
      <p className="field-label mt-3 text-center text-[12px] text-text-muted">
        {draft.popup ? 'Abre no meio da tela ao entrar na conta e quando você publica.' : 'Só no sino: este é o visual ao abrir pelo histórico.'}
      </p>
    </>
  );
}

/* ───────────────────────── Enviados ───────────────────────── */

const STATUS_META: Record<ReturnType<typeof annStatus>, { label: string; a: Accent }> = {
  live: { label: 'No ar', a: 'lime' },
  scheduled_end: { label: 'No ar', a: 'lime' },
  paused: { label: 'Pausado', a: 'amber' },
  draft: { label: 'Rascunho', a: 'neutral' },
  ended: { label: 'Encerrado', a: 'neutral' },
};

function pct(part: number, total: number): string {
  if (!total) return '0%';
  return `${Math.round((part / total) * 100)}%`;
}

function SentList({
  list,
  error,
  busy,
  users,
  onReload,
  onToggle,
  onRepublish,
  onSend,
  onResume,
  onEdit,
  onDuplicate,
  onDelete,
  onCreate,
}: {
  list: AdminAnnouncement[] | null;
  error: string | null;
  busy: string | null;
  users: AdminUser[] | null;
  onReload: () => void;
  onToggle: (a: AdminAnnouncement) => void;
  onRepublish: (a: AdminAnnouncement) => void;
  /** modelo E-mail: manda de novo (ativação nova) */
  onSend: (a: AdminAnnouncement) => void;
  /** continua o envio desta ativação (cota/erro) — não duplica */
  onResume: (a: AdminAnnouncement) => void;
  onEdit: (a: AdminAnnouncement) => void;
  onDuplicate: (a: AdminAnnouncement) => void;
  onDelete: (a: AdminAnnouncement) => void;
  onCreate: () => void;
}) {
  const [menu, setMenu] = useState<{ a: AdminAnnouncement; el: HTMLElement } | null>(null);
  const viewers = useMemo(() => (users ?? []).map(viewerOf), [users]);
  // "Quem viu": guarda só o id e lê da lista (pausar/editar continua refletindo lá)
  const [seenId, setSeenId] = useState<string | null>(null);
  const seen = seenId ? (list?.find((x) => x.id === seenId) ?? null) : null;
  const seenReach = useMemo(() => (seen && users ? users.filter((u) => matchesAudience(seen.audience, viewerOf(u))) : null), [seen, users]);
  const closeSeen = useCallback(() => setSeenId(null), []);
  // Prévia: a mesma janela que o cliente vê (não grava nada, o botão não navega)
  const [preview, setPreview] = useState<NotifItem | null>(null);
  const closePreview = useCallback(() => setPreview(null), []);
  const [mailPreview, setMailPreview] = useState<AdminAnnouncement | null>(null);
  const closeMailPreview = useCallback(() => setMailPreview(null), []);
  if (seen) return <AnnouncementSeen a={seen} users={users} reach={seenReach} onBack={closeSeen} />;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 md:px-6">
      {error ? (
        <div className="field-label mb-4 flex items-center justify-between gap-3 rounded-[14px] px-4 py-3 text-[13px]" style={{ color: accent('danger'), background: accent('danger', 0.08), boxShadow: `inset 0 0 0 1px ${accent('danger', 0.25)}` }}>
          {error}
          <Btn size="sm" onClick={onReload}>
            Tentar de novo
          </Btn>
        </div>
      ) : null}

      {!list ? (
        <div className="flex flex-col gap-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-[88px] rounded-[18px] bg-[rgb(var(--text)/0.04)]" />
          ))}
        </div>
      ) : list.length === 0 ? (
        <div className="flex flex-col items-center px-6 py-16 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-[18px]" style={{ color: accent('violet'), background: accent('violet', 0.12), boxShadow: `inset 0 0 0 1px ${accent('violet', 0.28)}` }}>
            <AnnIcon.megaphone size={24} />
          </span>
          <p className="font-tech mt-5 text-[18px] font-semibold text-text">Nenhum aviso enviado ainda</p>
          <p className="field-label mt-1.5 max-w-[44ch] text-[13.5px] text-text-muted">Crie o primeiro: escolha o modelo, quem recebe e publique. Aparece na tela de quem estiver logado em até 30 segundos.</p>
          <div className="mt-5">
            <PrimaryBtn onClick={onCreate}>Criar aviso</PrimaryBtn>
          </div>
        </div>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {list.map((a) => {
            const st = annStatus(a);
            const meta = STATUS_META[st];
            const color = a.kind === 'aviso' ? TONE_META[(a.content as AvisoContent).tone].rgb : THEME_META[(a.content as PromoContent).theme].rgb;
            const reachNow = viewers.filter((v) => matchesAudience(a.audience, v)).length;
            const mode = mailMode(a);
            const only = mode === 'only';
            const tpl = (a.content as PromoContent).mail?.template;
            return (
              <li
                key={a.id}
                className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-3 rounded-[18px] p-3.5 md:grid-cols-[auto_minmax(0,1fr)_auto_auto]"
                style={{ background: 'rgb(var(--text) / 0.025)', boxShadow: `inset 0 0 0 1px ${a.live ? accent('lime', 0.22) : 'rgb(var(--text) / 0.07)'}` }}
              >
                <span className="ann-tile !h-11 !w-11 !rounded-[13px]" style={{ ['--ann' as string]: color }}>
                  {only ? <I.mail size={19} /> : a.kind === 'aviso' ? <ToneIcon tone={(a.content as AvisoContent).tone} size={19} /> : <AnnIcon.megaphone size={19} />}
                </span>

                <div className="min-w-0">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <p className="font-tech min-w-0 truncate text-[14.5px] font-semibold text-text">{a.content.title}</p>
                    {only ? null : (
                      <Tag a={meta.a} dot={a.live}>
                        {meta.label}
                      </Tag>
                    )}
                    <MailStatusTag a={a} />
                    {a.live && a.endsAt ? <span className="field-label text-[12px] text-text-muted">até {fmtDateTime(a.endsAt)}</span> : null}
                  </div>
                  <p className="field-label mt-1 truncate text-[12.5px] text-text-muted">
                    {only
                      ? 'E-mail · ' + EMAIL_TEMPLATE_META[tpl ?? 'oferta'].label
                      : (a.kind === 'aviso' ? 'Aviso' : 'Propaganda') + ' · ' + (a.popup ? 'janela na tela' : 'só no sino') + (mode === 'also' ? ' + e-mail' : '')}{' '}
                    · {audienceSummary(a.audience, { admins: false })}
                    {users ? ` (${reachNow} ${reachNow === 1 ? 'conta' : 'contas'}${a.audience.includeAdmins ? ' + admins' : ''})` : a.audience.includeAdmins ? ' + admins' : ''} · criado {fmtDateTime(a.createdAt)}
                  </p>
                </div>

                <div className="col-span-2 flex items-center gap-4 md:col-span-1">
                  {only ? (
                    <>
                      <Metric label="Enviados" value={a.mail?.sent ?? 0} sub={a.mail ? 'de ' + a.mail.total : undefined} title={a.mail ? 'Enviado em ' + (fmtDateTime(a.mail.at) ?? '') : 'Ainda não enviado'} />
                      <Metric label="Fora da lista" value={a.mail?.optOut ?? 0} title="Pediram pra não receber e-mail (ficaram de fora)" />
                    </>
                  ) : (
                    <>
                      <Metric label="Entregues" value={a.stats.delivered} title="Contas que já abriram o app depois da publicação e receberam (chega no próximo acesso de cada um)" />
                      <Metric label="Lidas" value={a.stats.read} sub={pct(a.stats.read, a.stats.delivered)} title="Viram a janela ou abriram no sino" />
                      <Metric label="Cliques" value={a.stats.clicked} sub={pct(a.stats.clicked, a.stats.delivered)} title="Clicaram no botão do aviso" />
                    </>
                  )}
                </div>

                <div className="col-span-2 flex items-center justify-end gap-2 md:col-span-1">
                  <IconOnly
                    title={only ? 'Ver o e-mail' : 'Ver como aparece pro cliente'}
                    onClick={() =>
                      only
                        ? setMailPreview(a)
                        : setPreview({ id: a.id, kind: a.kind, content: a.content, deliveredAt: new Date().toISOString(), readAt: null, clickedAt: null, live: a.live, activatedAt: a.activatedAt, endsAt: a.endsAt })
                    }
                  >
                    {only ? <I.mail size={16} /> : <I.monitor size={16} />}
                  </IconOnly>
                  {only ? null : (
                    <IconOnly title="Quem viu: hora e quantas vezes cada conta viu" onClick={() => setSeenId(a.id)}>
                      <I.eye size={16} />
                    </IconOnly>
                  )}
                  {only ? (
                    <Btn size="sm" tone="violet" onClick={() => onSend(a)} disabled={busy === a.id}>
                      {busy === a.id ? 'Enviando' : a.activatedAt ? 'Enviar de novo' : 'Enviar'}
                    </Btn>
                  ) : (
                  <button
                    type="button"
                    role="switch"
                    aria-checked={a.active}
                    disabled={busy === a.id}
                    onClick={() => onToggle(a)}
                    title={a.active ? 'Pausar (sai da tela de todo mundo)' : 'Ativar (vai pro ar agora)'}
                    className="field-label inline-flex h-9 items-center gap-2 rounded-full px-3 text-[12.5px] font-semibold text-text transition-colors duration-300 hover:bg-[rgb(var(--text)/0.06)] disabled:opacity-50"
                    style={{ boxShadow: 'inset 0 0 0 1px rgb(var(--text) / 0.1)' }}
                  >
                    <Switch on={a.active} busy={busy === a.id} />
                    {a.active ? 'Ativo' : 'Ativar'}
                  </button>
                  )}
                  <Btn size="sm" onClick={() => onEdit(a)}>
                    Editar
                  </Btn>
                  <IconOnly title="Mais ações" onClick={(e) => setMenu({ a, el: e.currentTarget })}>
                    <I.dots size={16} />
                  </IconOnly>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {preview ? <AnnouncementPreview key={preview.id} item={preview} onClose={closePreview} /> : null}
      {mailPreview ? <EmailPreviewModal a={mailPreview} onClose={closeMailPreview} /> : null}

      {menu ? (
        <Menu anchor={menu.el} onClose={() => setMenu(null)} width={260} layer={85}>
          {canResume(menu.a) ? (
            <MenuItem
              icon={<I.mail size={14} />}
              hint="Continua de onde parou (não duplica)"
              onClick={() => {
                setMenu(null);
                onResume(menu.a);
              }}
            >
              Tentar o resto do e-mail
            </MenuItem>
          ) : null}
          {mailMode(menu.a) === 'only' ? null : (
            <MenuItem
              icon={<I.sync size={14} />}
              disabled={!menu.a.active}
              hint={menu.a.active ? (mailMode(menu.a) === 'also' ? 'A janela abre de novo e o e-mail sai de novo' : 'A janela abre de novo pra quem fechou') : 'Ative antes'}
              onClick={() => {
                setMenu(null);
                onRepublish(menu.a);
              }}
            >
              Mostrar de novo pra todos
            </MenuItem>
          )}
          <MenuItem
            icon={<I.copy size={14} />}
            onClick={() => {
              setMenu(null);
              onDuplicate(menu.a);
            }}
          >
            Duplicar
          </MenuItem>
          <MenuSep />
          <MenuItem
            icon={<I.trash size={14} />}
            tone="danger"
            onClick={() => {
              setMenu(null);
              onDelete(menu.a);
            }}
          >
            Excluir
          </MenuItem>
        </Menu>
      ) : null}
    </div>
  );
}

function Metric({ label, value, sub, title }: { label: string; value: number; sub?: string; title?: string }) {
  return (
    <div className="min-w-[64px]" title={title}>
      <p className="field-label text-[11.5px] text-text-muted">{label}</p>
      <p className="font-tech text-[16px] font-semibold leading-tight text-text" style={{ fontVariantNumeric: 'tabular-nums' }}>
        {value}
        {sub ? <span className="field-label ml-1 text-[11.5px] font-medium text-text-muted">{sub}</span> : null}
      </p>
    </div>
  );
}
