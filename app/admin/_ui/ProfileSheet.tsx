'use client';

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { travarScrollDaPagina } from '@/lib/trava-scroll';
import { BarSeries, RankList } from './charts';
import {
  Avatar,
  Btn,
  CopyBtn,
  Dot,
  I,
  IconOnly,
  Menu,
  MenuItem,
  MenuSep,
  Segmented,
  Shell,
  Skeleton,
  SPRING,
  Tag,
} from './kit';
import {
  ACCESS_META,
  CATALOG_LABEL,
  STRIPE_STATUS_LABEL,
  TIER_LABEL,
  accent,
  betaProTools,
  brl,
  dayLabel,
  daysSince,
  fmtDate,
  fmtDateTime,
  fmtDuration,
  fmtPhone,
  fmtTime,
  fmtWeekday,
  initials,
  isOnline,
  isUsingTool,
  planLabel,
  timeAgo,
  toolLabel,
  whatsappLink,
  type AccessEventRow,
  type AccessSessionRow,
  type AdminUser,
  type CancelRow,
  type ProfileData,
} from './model';
import { CancelTag, type RowActions } from './UserRow';

export type ProfileTab = 'geral' | 'acessos' | 'uso' | 'pagamentos';

const TABS: Array<{ value: ProfileTab; label: string }> = [
  { value: 'geral', label: 'Visão geral' },
  { value: 'acessos', label: 'Acessos e IPs' },
  { value: 'uso', label: 'Uso' },
  { value: 'pagamentos', label: 'Pagamentos' },
];

/**
 * PERFIL COMPLETO de um cliente — painel lateral sobre a lista.
 * O cabeçalho aparece na hora (dados da lista); o resto chega de
 * /api/admin/user-profile e atualiza sozinho a cada 30 s enquanto aberto.
 */
export function ProfileSheet({
  user,
  tab,
  onTab,
  now,
  busy,
  nonce,
  actions,
  blockEsc,
  onClose,
  cancel,
}: {
  cancel?: CancelRow;
  user: AdminUser;
  tab: ProfileTab;
  onTab: (t: ProfileTab) => void;
  now: number;
  busy: boolean;
  nonce: number;
  actions: Omit<RowActions, 'open'>;
  blockEsc: boolean;
  onClose: () => void;
}) {
  const [data, setData] = useState<ProfileData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [entered, setEntered] = useState(false);
  const [menuAt, setMenuAt] = useState<HTMLElement | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const closing = useRef(false);

  // Entrada com mola + trava de scroll da página.
  useEffect(() => {
    const unlock = travarScrollDaPagina();
    const raf = requestAnimationFrame(() => setEntered(true));
    return () => {
      cancelAnimationFrame(raf);
      unlock();
    };
  }, []);

  const close = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    setEntered(false);
    setTimeout(onClose, 280);
  }, [onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !blockEsc && !menuAt) close();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [blockEsc, menuAt, close]);

  // Dados: na abertura, depois de cada ação (nonce) e a cada 30 s (aba visível).
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch(`/api/admin/user-profile?id=${encodeURIComponent(user.id)}`, { cache: 'no-store' });
        const json = await res.json().catch(() => null);
        if (!alive) return;
        if (!res.ok || !json) {
          setError(json?.error || 'Não deu pra carregar o perfil.');
          return;
        }
        setError(null);
        setData(json as ProfileData);
      } catch (e) {
        if (alive) setError((e as Error).message || 'Falha de conexão.');
      }
    };
    load();
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') load();
    }, 30_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [user.id, nonce]);

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0 });
  }, [tab]);

  const meta = ACCESS_META[user.access];
  const online = isOnline(user, now);
  const usingNow = isUsingTool(user, now);
  const phone = data?.user.phone ?? user.phone ?? null;
  const wa = whatsappLink(phone);
  const concurrent = data?.access.totals.concurrent ?? user.concurrent_30d ?? 0;
  const beta = betaProTools(user);

  return createPortal(
    <div className="fixed inset-0 z-[60]" role="dialog" aria-modal="true" aria-label={`Perfil de ${user.name || user.email}`}>
      <div
        className="absolute inset-0 bg-black/55 transition-opacity duration-300"
        style={{ opacity: entered ? 1 : 0 }}
        onClick={close}
      />
      <aside
        className="absolute inset-y-0 right-0 flex w-full max-w-[1060px] p-0 md:p-2.5"
        style={{
          transform: entered ? 'translateX(0)' : 'translateX(104%)',
          transition: `transform 460ms ${SPRING}`,
        }}
      >
        <Shell className="h-full w-full !rounded-none md:!rounded-[22px]" coreClassName="flex h-full flex-col overflow-hidden !rounded-none md:!rounded-[17px]">
          {/* ═══ Cabeçalho ═══ */}
          <header className="shrink-0 border-b border-[rgb(var(--text)/0.07)] px-5 pb-0 pt-5 md:px-7 md:pt-6">
            <div className="flex items-start gap-4">
              <Avatar text={initials(user.name, user.email)} a={meta.accent} online={online} size={56} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-tech truncate text-[23px] font-semibold leading-tight tracking-[-0.02em] text-text">
                    {user.name || 'Sem nome'}
                  </h2>
                  <Tag a={meta.accent} dot>{meta.label}</Tag>
                  {cancel ? <CancelTag c={cancel} /> : null}
                  {!user.is_active ? <Tag a="danger">Conta desativada</Tag> : null}
                  {user.must_change_password ? <Tag a="amber">Senha provisória</Tag> : null}
                </div>
                <div className="field-label mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-text-muted">
                  <span className="inline-flex min-w-0 items-center gap-1.5">
                    <I.mail size={14} />
                    <span className="truncate text-text">{user.email || 'Sem email'}</span>
                    {user.email ? <CopyBtn value={user.email} label="Copiar email" /> : null}
                  </span>
                  {phone ? (
                    <span className="inline-flex items-center gap-1.5">
                      <I.phone size={14} />
                      <span className="text-text">{fmtPhone(phone)}</span>
                      <CopyBtn value={phone} label="Copiar telefone" />
                    </span>
                  ) : null}
                </div>
                <div className="field-label mt-1 text-[12.5px]">
                  {usingNow && user.last_tool ? (
                    <span className="inline-flex items-center gap-1.5 font-semibold" style={{ color: accent('lime') }}>
                      <Dot a="lime" ring size={6} /> Online, usando {toolLabel(user.last_tool)}
                    </span>
                  ) : online ? (
                    <span className="inline-flex items-center gap-1.5 font-semibold" style={{ color: accent('lime') }}>
                      <Dot a="lime" ring size={6} /> Online agora
                    </span>
                  ) : (
                    <span className="text-text-muted">
                      {user.last_seen_at ? `Visto pela última vez ${timeAgo(user.last_seen_at, now)}` : 'Nunca entrou no app'}
                    </span>
                  )}
                </div>
              </div>
              <IconOnly title="Fechar perfil" onClick={close}>
                <I.close size={16} />
              </IconOnly>
            </div>

            {/* Ações */}
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Segmented
                size="sm"
                value={user.plan}
                disabled={busy}
                onChange={(p) => actions.plan(user, p)}
                options={[
                  { value: 'free', label: 'Free', tone: 'neutral', title: 'Rebaixar pra Free (pede confirmação)' },
                  { value: 'premium', label: 'Premium', tone: user.access === 'paid' ? 'lime' : 'cyan', title: 'Liberar Premium na mão' },
                ]}
              />
              <Btn size="sm" tone="violet" solid={beta.length > 0} onClick={() => actions.beta(user)} disabled={busy}>
                <I.bolt size={13} /> Beta Pro{beta.length ? ` · ${beta.length}` : ''}
              </Btn>
              {wa ? (
                <Btn size="sm" tone="lime" href={wa} title="Abrir conversa no WhatsApp">
                  <I.chat size={13} /> WhatsApp
                </Btn>
              ) : null}
              {user.receipt_url ? (
                <Btn size="sm" href={user.receipt_url} title="Último comprovante do Stripe">
                  <I.receipt size={13} /> Comprovante
                </Btn>
              ) : null}
              <Btn size="sm" onClick={() => actions.reconcile(user)} disabled={busy} title="Lê o estado real no Stripe e aplica o plano">
                <I.sync size={13} /> Sincronizar Stripe
              </Btn>
              {user.access === 'paid' || user.access === 'pending' ? (
                <Btn size="sm" tone="danger" onClick={() => actions.cancelSub(user, 'refund_now')} disabled={busy} title="Devolve a última cobrança, encerra a assinatura e tira o Premium agora (pede confirmação)">
                  <I.receipt size={13} /> Cancelar e reembolsar
                </Btn>
              ) : null}
              <IconOnly title="Mais ações" onClick={(e) => setMenuAt(menuAt ? null : e.currentTarget)} disabled={busy}>
                <I.dots size={16} />
              </IconOnly>
              {menuAt ? (
                <Menu anchor={menuAt} onClose={() => setMenuAt(null)} width={256}>
                  <MenuItem icon={<I.key size={14} />} onClick={() => { setMenuAt(null); actions.reset(user); }}>
                    Gerar senha provisória
                  </MenuItem>
                  {user.access === 'paid' || user.access === 'pending' ? (
                    <MenuItem icon={<I.clock size={14} />} onClick={() => { setMenuAt(null); actions.cancelSub(user, 'at_period_end'); }} hint="Sem reembolso; acesso até a próxima cobrança">
                      Cancelar no fim do período
                    </MenuItem>
                  ) : null}
                  <MenuSep />
                  <MenuItem icon={<I.power size={14} />} onClick={() => { setMenuAt(null); actions.toggle(user); }}>
                    {user.is_active ? 'Desativar conta' : 'Reativar conta'}
                  </MenuItem>
                  <MenuItem icon={<I.trash size={14} />} tone="danger" onClick={() => { setMenuAt(null); actions.remove(user); }}>
                    Deletar usuário
                  </MenuItem>
                </Menu>
              ) : null}
            </div>

            {/* Abas */}
            <nav className="-mb-px mt-5 flex gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="tablist">
              {TABS.map((t) => {
                const on = tab === t.value;
                const count =
                  t.value === 'acessos' && concurrent > 0
                    ? concurrent
                    : t.value === 'pagamentos' && data?.billing.count
                      ? data.billing.count
                      : null;
                return (
                  <button
                    key={t.value}
                    type="button"
                    role="tab"
                    aria-selected={on}
                    onClick={() => onTab(t.value)}
                    className={
                      'field-label relative flex shrink-0 items-center gap-2 px-3.5 pb-3 pt-1 text-[13.5px] font-semibold transition-colors duration-200 ' +
                      (on ? 'text-text' : 'text-text-muted hover:text-text')
                    }
                  >
                    {t.label}
                    {count != null ? (
                      <span
                        className="rounded-[6px] px-1.5 py-[1px] text-[11px] font-bold"
                        style={
                          t.value === 'acessos'
                            ? { color: accent('danger'), background: accent('danger', 0.12) }
                            : { color: 'rgb(var(--text-muted))', background: 'rgb(var(--text) / 0.07)' }
                        }
                      >
                        {count}
                      </span>
                    ) : null}
                    <span
                      aria-hidden
                      className="absolute inset-x-2 bottom-0 h-[2px] rounded-full transition-opacity duration-300"
                      style={{ background: accent('lime'), opacity: on ? 1 : 0 }}
                    />
                  </button>
                );
              })}
            </nav>
          </header>

          {/* ═══ Corpo ═══ */}
          <div ref={bodyRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-6 md:px-7">
            {error && !data ? (
              <div className="field-label rounded-[14px] p-4 text-[13px]" style={{ color: accent('danger'), background: accent('danger', 0.08) }}>
                {error}
              </div>
            ) : !data ? (
              <div className="grid gap-4">
                <Skeleton className="h-24" />
                <div className="grid gap-4 md:grid-cols-2">
                  <Skeleton className="h-48" />
                  <Skeleton className="h-48" />
                </div>
                <Skeleton className="h-40" />
              </div>
            ) : tab === 'geral' ? (
              <TabGeral data={data} now={now} onGoAccess={() => onTab('acessos')} />
            ) : tab === 'acessos' ? (
              <TabAcessos data={data} user={user} now={now} />
            ) : tab === 'uso' ? (
              <TabUso data={data} now={now} />
            ) : (
              <TabPagamentos data={data} />
            )}
          </div>
        </Shell>
      </aside>
    </div>,
    document.body,
  );
}

/* ═════════════════════ Blocos ═════════════════════ */

function Section({ title, hint, right, children }: { title: string; hint?: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="mb-8 last:mb-0">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h3 className="font-tech text-[15px] font-semibold tracking-[-0.01em] text-text">{title}</h3>
          {hint ? <p className="field-label mt-0.5 text-[12.5px] text-text-muted">{hint}</p> : null}
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

function Fact({ label, children, sub, mono }: { label: string; children: React.ReactNode; sub?: React.ReactNode; mono?: boolean }) {
  return (
    <div className="min-w-0 px-4 py-3.5">
      <div className="field-label text-[12px] text-text-muted">{label}</div>
      <div className={'mt-1 truncate text-[14px] font-medium text-text ' + (mono ? 'mono text-[13px]' : '')}>{children}</div>
      {sub ? <div className="field-label mt-0.5 truncate text-[12px] text-text-muted">{sub}</div> : null}
    </div>
  );
}

/** Grade de fatos separada por hairlines (sem card por item). */
function FactGrid({ children, cols = 3 }: { children: React.ReactNode; cols?: 2 | 3 | 4 }) {
  const c = cols === 4 ? 'sm:grid-cols-2 lg:grid-cols-4' : cols === 3 ? 'sm:grid-cols-2 lg:grid-cols-3' : 'sm:grid-cols-2';
  return (
    <div
      className={'grid grid-cols-1 gap-px overflow-hidden rounded-[16px] ' + c}
      style={{ background: 'rgb(var(--text) / 0.07)', boxShadow: 'inset 0 0 0 1px rgb(var(--text) / 0.07)' }}
    >
      {children}
    </div>
  );
}

function FactCell({ children }: { children: React.ReactNode }) {
  return <div className="bg-bg-soft">{children}</div>;
}

function MiniStat({ label, value, a }: { label: string; value: React.ReactNode; a?: 'danger' | 'lime' }) {
  return (
    <div className="bg-bg-soft px-4 py-3.5">
      <div className="field-label text-[12px] text-text-muted">{label}</div>
      <div
        className="font-tech mt-1 text-[22px] font-semibold leading-none tracking-[-0.02em] text-text"
        style={{ fontVariantNumeric: 'tabular-nums', color: a ? accent(a) : undefined }}
      >
        {value}
      </div>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="field-label rounded-[16px] px-5 py-6 text-center text-[13px] text-text-muted" style={{ boxShadow: 'inset 0 0 0 1px rgb(var(--text) / 0.08)' }}>
      {children}
    </div>
  );
}

/* ═════════════════════ Visão geral ═════════════════════ */

const TabGeral = memo(function TabGeral({
  data,
  now,
  onGoAccess,
}: {
  data: ProfileData;
  now: number;
  onGoAccess: () => void;
}) {
  const p = data.user;
  const lastEvent = data.access.events.find((e) => !e.same_machine) ?? null;
  const beta = betaProTools(p);
  const signupDays = daysSince(p.created_at, now);
  const utm = [p.utm_source, p.utm_medium, p.utm_campaign].filter(Boolean).join(' · ');
  const providers = data.auth?.providers?.length ? data.auth.providers : data.auth?.provider ? [data.auth.provider] : [];

  const activity = data.access.enabled && data.access.sessions.length
    ? data.access.days.map((d) => ({ key: d.day, label: dayLabel(d.day), value: Math.round(d.activeSeconds / 60) }))
    : data.usage.days.map((d) => ({ key: d.day, label: dayLabel(d.day), value: d.count }));
  const activityIsTime = data.access.enabled && data.access.sessions.length > 0;

  return (
    <>
      {lastEvent ? <ConcurrencyBanner count={data.access.totals.concurrent} ev={lastEvent} onGo={onGoAccess} /> : null}

      <Section title="Contato">
        <FactGrid cols={3}>
          <FactCell>
            <Fact label="Nome">{p.name || 'Não informado'}</Fact>
          </FactCell>
          <FactCell>
            <Fact
              label="Email"
              sub={
                data.auth?.email_confirmed_at
                  ? `Confirmado em ${fmtDate(data.auth.email_confirmed_at)}`
                  : data.auth
                    ? 'Email ainda não confirmado'
                    : undefined
              }
            >
              {p.email || 'Sem email'}
            </Fact>
          </FactCell>
          <FactCell>
            <div className="flex items-start justify-between gap-2 pr-3">
              <Fact
                label="Celular / WhatsApp"
                sub={
                  p.phone
                    ? p.phone_verified
                      ? `Verificado por SMS${p.phone_verified_at ? ` em ${fmtDate(p.phone_verified_at)}` : ''}`
                      : 'Informado no cadastro, sem verificação'
                    : 'A pessoa não deixou número'
                }
              >
                {p.phone ? fmtPhone(p.phone) : 'Não informado'}
              </Fact>
              {whatsappLink(p.phone) ? (
                <a
                  href={whatsappLink(p.phone)!}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-3.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-opacity hover:opacity-80"
                  style={{ color: accent('lime'), background: accent('lime', 0.12), boxShadow: `inset 0 0 0 1px ${accent('lime', 0.3)}` }}
                  title="Abrir no WhatsApp"
                >
                  <I.chat size={14} />
                </a>
              ) : null}
            </div>
          </FactCell>
        </FactGrid>
      </Section>

      <Section title="Conta">
        <FactGrid cols={3}>
          <FactCell>
            <Fact label="Cliente desde" sub={signupDays != null ? (signupDays === 0 ? 'Entrou hoje' : `Há ${signupDays} ${signupDays === 1 ? 'dia' : 'dias'}`) : undefined}>
              {fmtDate(p.created_at) ?? 'Sem data'}
            </Fact>
          </FactCell>
          <FactCell>
            <Fact label="Último acesso ao app" sub={fmtDateTime(p.last_seen_at) ?? undefined}>
              {p.last_seen_at ? timeAgo(p.last_seen_at, now) : 'Nunca'}
            </Fact>
          </FactCell>
          <FactCell>
            <Fact label="Último login" sub={providers.length ? `Entrou com ${providers.map((x) => (x === 'email' ? 'email e senha' : x)).join(', ')}` : undefined}>
              {fmtDateTime(data.auth?.last_sign_in_at) ?? 'Sem registro'}
            </Fact>
          </FactCell>
          <FactCell>
            <Fact label="Por onde chegou" sub={utm || undefined}>
              {p.traffic_source || 'Direto'}
            </Fact>
          </FactCell>
          <FactCell>
            <Fact label="Última ferramenta" sub={fmtDateTime(p.last_tool_at) ?? undefined}>
              {toolLabel(p.last_tool) ?? 'Nenhuma ainda'}
            </Fact>
          </FactCell>
          <FactCell>
            <Fact label="Último IP" mono sub={data.access.ips.find((x) => x.ip === p.last_ip)?.place ?? undefined}>
              {p.last_ip || 'Sem registro'}
            </Fact>
          </FactCell>
        </FactGrid>
      </Section>

      <Section title="Plano e cobrança">
        <FactGrid cols={4}>
          <FactCell>
            <Fact label="Plano agora">{ACCESS_META[p.access].label}</Fact>
          </FactCell>
          <FactCell>
            <Fact label="Status no Stripe" sub={p.subscription_plan ? planLabel(p.subscription_plan) : undefined}>
              {p.subscription_status ? (STRIPE_STATUS_LABEL[p.subscription_status] ?? p.subscription_status) : 'Sem assinatura'}
            </Fact>
          </FactCell>
          <FactCell>
            <Fact label="Acesso pago até">{fmtDate(p.current_period_end) ?? (p.access === 'granted' ? 'Não expira' : 'Sem prazo')}</Fact>
          </FactCell>
          <FactCell>
            <Fact label="Total pago" sub={data.billing.count ? `${data.billing.count} ${data.billing.count === 1 ? 'pagamento' : 'pagamentos'}` : 'Nenhum pagamento'}>
              <span style={{ color: data.billing.totalPaid ? accent('lime') : undefined }}>{brl(data.billing.totalPaid)}</span>
            </Fact>
          </FactCell>
        </FactGrid>
        {beta.length ? (
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <span className="field-label mr-1 text-[12.5px] text-text-muted">Beta Pro liberado:</span>
            {beta.map((x) => (
              <Tag key={x} a="violet">
                {CATALOG_LABEL.get(x) ?? x}
                {p.static_unlocks.includes(x) && !p.tool_unlocks.includes(x) ? ' (fixo)' : ''}
              </Tag>
            ))}
          </div>
        ) : null}
      </Section>

      <div className="grid gap-8 lg:grid-cols-[1.4fr_1fr]">
        <Section
          title={activityIsTime ? 'Tempo de uso por dia' : 'Ferramentas abertas por dia'}
          hint={activityIsTime ? 'Minutos com alguém mexendo no app, últimos 30 dias' : 'Últimos 30 dias'}
        >
          <BarSeries
            points={activity}
            a="lime"
            ariaLabel="Atividade nos últimos 30 dias"
            format={(v) => (activityIsTime ? fmtDuration(v * 60) : `${v} ${v === 1 ? 'abertura' : 'aberturas'}`)}
            emptyText="Sem atividade nos últimos 30 dias."
          />
        </Section>
        <Section title="Ferramentas que mais usa" hint="Último ano">
          <RankList
            a="violet"
            limit={6}
            numbered
            emptyText="Ainda não abriu nenhuma ferramenta."
            items={data.usage.tools.map((t) => ({ key: t.tool, label: toolLabel(t.tool) ?? t.tool, value: t.count, sub: timeAgo(t.last, now) ?? undefined }))}
          />
        </Section>
      </div>
    </>
  );
});

function ConcurrencyBanner({ count, ev, onGo }: { count: number; ev: AccessEventRow; onGo: () => void }) {
  return (
    <div className="mb-8">
      <Shell tone="danger">
        <div className="flex flex-wrap items-center gap-4 p-4 md:p-5">
          <span
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px]"
            style={{ color: accent('danger'), background: accent('danger', 0.12), boxShadow: `inset 0 0 0 1px ${accent('danger', 0.3)}` }}
          >
            <I.alert size={18} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="font-tech text-[15px] font-semibold text-text">
              {count === 1 ? 'Acesso simultâneo detectado' : `Acesso simultâneo detectado ${count} vezes`}
            </div>
            <p className="field-label mt-0.5 text-[13px] leading-relaxed text-text-muted">
              Último em {fmtDate(ev.started_at)}, das {fmtTime(ev.started_at)} às {fmtTime(ev.ended_at)}:{' '}
              <span className="text-text">{ev.label_a || 'aparelho'}</span>
              {ev.place_a ? ` em ${ev.place_a}` : ''} e <span className="text-text">{ev.label_b || 'aparelho'}</span>
              {ev.place_b ? ` em ${ev.place_b}` : ''}.
            </p>
          </div>
          <Btn size="sm" tone="danger" onClick={onGo}>
            Ver no histórico de IPs
          </Btn>
        </div>
      </Shell>
    </div>
  );
}

/* ═════════════════════ Acessos e IPs ═════════════════════ */

const TabAcessos = memo(function TabAcessos({ data, user, now }: { data: ProfileData; user: AdminUser; now: number }) {
  const a = data.access;
  const [showAll, setShowAll] = useState(false);
  const real = a.events.filter((e) => !e.same_machine);
  const sameMachine = a.events.filter((e) => e.same_machine);

  // Linha do tempo: sessões + avisos de simultâneo no dia em que começaram.
  const timeline = useMemo(() => {
    type Item = { kind: 'session'; at: string; s: AccessSessionRow } | { kind: 'event'; at: string; e: AccessEventRow };
    const items: Item[] = [
      ...a.sessions.map((s) => ({ kind: 'session' as const, at: s.started_at, s })),
      ...a.events.map((e) => ({ kind: 'event' as const, at: e.started_at, e })),
    ].sort((x, y) => Date.parse(y.at) - Date.parse(x.at));
    const limited = showAll ? items : items.slice(0, 80);
    const groups: Array<{ day: string; items: Item[] }> = [];
    for (const it of limited) {
      const day = fmtDate(it.at)!;
      const g = groups[groups.length - 1];
      if (g && g.day === day) g.items.push(it);
      else groups.push({ day, items: [it] });
    }
    return { groups, total: items.length };
  }, [a.sessions, a.events, showAll]);

  if (!a.enabled) {
    return (
      <Empty>
        O histórico de IPs começa a ser gravado assim que a atualização do banco (037) estiver aplicada.
        {user.last_ip ? (
          <>
            <br />
            Último IP conhecido: <span className="mono text-text">{user.last_ip}</span>
          </>
        ) : null}
      </Empty>
    );
  }

  return (
    <>
      <div className="mb-8 grid grid-cols-2 gap-px overflow-hidden rounded-[16px] md:grid-cols-4" style={{ background: 'rgb(var(--text) / 0.07)', boxShadow: 'inset 0 0 0 1px rgb(var(--text) / 0.07)' }}>
        <MiniStat label="IPs diferentes" value={a.totals.ips} />
        <MiniStat label="Aparelhos" value={a.totals.devices} />
        <MiniStat label="Tempo de uso ativo" value={fmtDuration(a.totals.activeSeconds)} />
        <MiniStat label="Acessos simultâneos" value={a.totals.concurrent} a={a.totals.concurrent ? 'danger' : undefined} />
      </div>

      <Section
        title="Acesso simultâneo"
        hint="Dois aparelhos diferentes em uso ao mesmo tempo, com alguém mexendo nos dois por pelo menos 1 min e meio. Abas do mesmo navegador, troca de rede e troca de aparelho não contam."
      >
        {real.length ? (
          <ul className="flex flex-col gap-2.5">
            {real.map((e) => (
              <EventCard key={e.id} e={e} />
            ))}
          </ul>
        ) : (
          <Empty>Nenhum acesso simultâneo{a.totals.firstAt ? ` desde ${fmtDate(a.totals.firstAt)}` : ''}.</Empty>
        )}
        {sameMachine.length ? (
          <details className="group mt-3">
            <summary className="field-label flex cursor-pointer list-none items-center gap-2 text-[12.5px] text-text-muted hover:text-text">
              <span className="transition-transform duration-200 group-open:rotate-90"><I.chevron size={12} /></span>
              {sameMachine.length} {sameMachine.length === 1 ? 'vez' : 'vezes'} no mesmo computador (janela anônima ou outro navegador, não conta como simultâneo)
            </summary>
            <ul className="mt-2.5 flex flex-col gap-2.5">
              {sameMachine.map((e) => (
                <EventCard key={e.id} e={e} />
              ))}
            </ul>
          </details>
        ) : null}
      </Section>

      <Section title="IPs usados" hint={a.totals.firstAt ? `Registro desde ${fmtDate(a.totals.firstAt)}` : undefined}>
        {a.ips.length ? (
          <div className="overflow-x-auto rounded-[16px]" style={{ boxShadow: 'inset 0 0 0 1px rgb(var(--text) / 0.08)' }}>
            <table className="w-full min-w-[720px] text-left">
              <thead>
                <tr className="field-label text-[12px] text-text-muted">
                  <th className="px-4 py-3 font-medium">IP</th>
                  <th className="px-4 py-3 font-medium">Local</th>
                  <th className="px-4 py-3 font-medium">Aparelhos</th>
                  <th className="px-4 py-3 font-medium">Primeira vez</th>
                  <th className="px-4 py-3 font-medium">Última vez</th>
                  <th className="px-4 py-3 text-right font-medium">Uso ativo</th>
                </tr>
              </thead>
              <tbody>
                {a.ips.map((ip) => (
                  <tr key={ip.ip} className="border-t border-[rgb(var(--text)/0.06)] text-[13px]">
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-2">
                        {ip.concurrent ? <Dot a="danger" size={7} /> : null}
                        <span className="mono text-[12.5px] text-text">{ip.ip}</span>
                        {ip.ip !== 'desconhecido' ? <CopyBtn value={ip.ip} label="Copiar IP" /> : null}
                      </span>
                    </td>
                    <td className="field-label px-4 py-3 text-text">{ip.place || 'Sem local'}</td>
                    <td className="field-label px-4 py-3 text-text-muted">{ip.devices.join(', ')}</td>
                    <td className="field-label whitespace-nowrap px-4 py-3 text-text-muted">{fmtDateTime(ip.firstSeen)}</td>
                    <td className="field-label whitespace-nowrap px-4 py-3 text-text">{timeAgo(ip.lastSeen, now)}</td>
                    <td className="field-label whitespace-nowrap px-4 py-3 text-right text-text">{fmtDuration(ip.activeSeconds)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>
            Nenhum acesso registrado ainda.
            {user.last_ip ? (
              <>
                {' '}Último IP conhecido: <span className="mono text-text">{user.last_ip}</span>
              </>
            ) : null}
          </Empty>
        )}
      </Section>

      {a.devices.length ? (
        <Section title="Aparelhos">
          <ul className="grid gap-px overflow-hidden rounded-[16px] sm:grid-cols-2 sm:[&>li:last-child:nth-child(odd)]:col-span-2" style={{ background: 'rgb(var(--text) / 0.07)', boxShadow: 'inset 0 0 0 1px rgb(var(--text) / 0.07)' }}>
            {a.devices.map((d) => (
              <li key={d.deviceId} className="flex items-center gap-3.5 bg-bg-soft px-4 py-3.5">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] text-text-muted" style={{ background: 'rgb(var(--text) / 0.05)', boxShadow: 'inset 0 0 0 1px rgb(var(--text) / 0.08)' }}>
                  {d.kind === 'mobile' || d.kind === 'tablet' ? <I.mobile size={17} /> : <I.monitor size={17} />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-medium text-text">{d.label}</span>
                  <span className="field-label block truncate text-[12px] text-text-muted">
                    {d.lastPlace ? `${d.lastPlace} · ` : ''}
                    {d.ips} {d.ips === 1 ? 'IP' : 'IPs'} · visto {timeAgo(d.lastSeen, now)}
                  </span>
                </span>
                <span className="field-label shrink-0 text-right text-[12px] text-text-muted">
                  desde
                  <br />
                  <span className="text-text">{fmtDate(d.firstSeen)}</span>
                </span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {timeline.groups.length ? (
        <Section title="Linha do tempo" hint="Cada linha é um aparelho conectado num IP, do primeiro ao último sinal.">
          <div className="flex flex-col gap-6">
            {timeline.groups.map((g) => (
              <div key={g.day}>
                <div className="field-label mb-2 text-[12.5px] font-semibold text-text-muted">{fmtWeekday(g.items[0].at)}</div>
                <ol className="overflow-hidden rounded-[16px]" style={{ boxShadow: 'inset 0 0 0 1px rgb(var(--text) / 0.08)' }}>
                  {g.items.map((it) =>
                    it.kind === 'event' ? (
                      <li
                        key={'e' + it.e.id}
                        className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-[rgb(var(--text)/0.06)] px-4 py-3 first:border-t-0"
                        style={{ background: accent(it.e.same_machine ? 'amber' : 'danger', 0.07) }}
                      >
                        <span style={{ color: accent(it.e.same_machine ? 'amber' : 'danger') }}>
                          <I.alert size={15} />
                        </span>
                        <span className="field-label text-[13px] font-semibold" style={{ color: accent(it.e.same_machine ? 'amber' : 'danger') }}>
                          {it.e.same_machine ? 'Duas sessões no mesmo computador' : 'Acesso simultâneo'}
                        </span>
                        <span className="field-label text-[13px] text-text">
                          {fmtTime(it.e.started_at)} às {fmtTime(it.e.ended_at)} ({fmtDuration((Date.parse(it.e.ended_at) - Date.parse(it.e.started_at)) / 1000)})
                        </span>
                        <span className="field-label basis-full text-[12.5px] text-text-muted md:basis-auto">
                          {it.e.label_a || 'aparelho'}
                          {it.e.place_a ? ` em ${it.e.place_a}` : ''} + {it.e.label_b || 'aparelho'}
                          {it.e.place_b ? ` em ${it.e.place_b}` : ''}
                        </span>
                      </li>
                    ) : (
                      <li key={'s' + it.s.id} className="grid grid-cols-[auto_1fr] items-center gap-x-3.5 gap-y-1 border-t border-[rgb(var(--text)/0.06)] px-4 py-3 first:border-t-0 md:grid-cols-[150px_1fr_auto]">
                        <span className="field-label whitespace-nowrap text-[13px] font-medium text-text" style={{ fontVariantNumeric: 'tabular-nums' }}>
                          {fmtTime(it.s.started_at)} às {fmtTime(it.s.last_seen_at)}
                        </span>
                        <span className="field-label min-w-0 truncate text-[12.5px] text-text-muted">
                          <span className="mono text-[12px] text-text">{it.s.ip || 'IP desconhecido'}</span>
                          {[it.s.city, it.s.region, it.s.country].some(Boolean) ? ` · ${[it.s.city, it.s.region, it.s.country].filter(Boolean).join(', ')}` : ''}
                          {' · '}
                          {[it.s.browser, it.s.os].filter(Boolean).join(' · ') || 'aparelho'}
                        </span>
                        <span className="field-label col-span-2 whitespace-nowrap text-[12px] text-text-muted md:col-span-1 md:text-right">
                          {it.s.active_seconds > 0 ? `${fmtDuration(it.s.active_seconds)} em uso` : 'Só conectado'}
                        </span>
                      </li>
                    ),
                  )}
                </ol>
              </div>
            ))}
          </div>
          {!showAll && timeline.total > 80 ? (
            <div className="mt-4 flex justify-center">
              <Btn size="sm" onClick={() => setShowAll(true)}>
                Mostrar tudo ({timeline.total})
              </Btn>
            </div>
          ) : null}
        </Section>
      ) : null}
    </>
  );
});

function EventCard({ e }: { e: AccessEventRow }) {
  const tone = e.same_machine ? 'amber' : 'danger';
  const dur = (Date.parse(e.ended_at) - Date.parse(e.started_at)) / 1000;
  const sameDay = fmtDate(e.started_at) === fmtDate(e.ended_at);
  return (
    <li className="rounded-[16px] p-4" style={{ background: accent(tone, 0.06), boxShadow: `inset 0 0 0 1px ${accent(tone, 0.2)}` }}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-tech text-[14.5px] font-semibold text-text">
          {fmtDate(e.started_at)}, das {fmtTime(e.started_at)} às {sameDay ? fmtTime(e.ended_at) : fmtDateTime(e.ended_at)}
        </span>
        <Tag a={tone}>{fmtDuration(dur)}</Tag>
        {e.same_machine ? <Tag a="amber">Mesmo computador</Tag> : e.same_network ? <Tag a="neutral">Mesma rede</Tag> : <Tag a="neutral">Redes diferentes</Tag>}
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {[
          { label: e.label_a, place: e.place_a, ip: e.ip_a },
          { label: e.label_b, place: e.place_b, ip: e.ip_b },
        ].map((d, i) => (
          <div key={i} className="rounded-[12px] bg-bg-soft px-3.5 py-2.5" style={{ boxShadow: 'inset 0 0 0 1px rgb(var(--text) / 0.07)' }}>
            <div className="text-[13.5px] font-medium text-text">{d.label || 'Aparelho'}</div>
            <div className="field-label mt-0.5 flex flex-wrap items-center gap-x-2 text-[12px] text-text-muted">
              <span className="inline-flex items-center gap-1"><I.pin size={12} />{d.place || 'Local desconhecido'}</span>
              {d.ip ? <span className="mono text-[11.5px]">{d.ip}</span> : null}
            </div>
          </div>
        ))}
      </div>
    </li>
  );
}

/* ═════════════════════ Uso ═════════════════════ */

const TabUso = memo(function TabUso({ data, now }: { data: ProfileData; now: number }) {
  const u = data.usage;
  const last30 = u.days.reduce((s, d) => s + d.count, 0);
  return (
    <>
      <div className="mb-8 grid grid-cols-2 gap-px overflow-hidden rounded-[16px] md:grid-cols-4" style={{ background: 'rgb(var(--text) / 0.07)', boxShadow: 'inset 0 0 0 1px rgb(var(--text) / 0.07)' }}>
        <MiniStat label="Aberturas em 30 dias" value={last30} />
        <MiniStat label="Aberturas no ano" value={u.total} />
        <MiniStat label="Ferramentas diferentes" value={u.tools.length} />
        <MiniStat label="Tempo ativo (registro)" value={fmtDuration(data.access.totals.activeSeconds)} />
      </div>

      <Section title="Ferramentas abertas por dia" hint="Conta cada vez que a pessoa entra numa ferramenta, últimos 30 dias">
        <BarSeries
          points={u.days.map((d) => ({ key: d.day, label: dayLabel(d.day), value: d.count }))}
          a="violet"
          ariaLabel="Ferramentas abertas por dia"
          format={(v) => `${v} ${v === 1 ? 'abertura' : 'aberturas'}`}
          emptyText="Nenhuma ferramenta aberta nos últimos 30 dias."
        />
      </Section>

      <div className="grid gap-8 lg:grid-cols-2">
        <Section title="Todas as ferramentas" hint="Último ano, com o último uso de cada uma">
          <RankList
            a="violet"
            limit={30}
            numbered
            emptyText="Ainda não abriu nenhuma ferramenta."
            items={u.tools.map((t) => ({ key: t.tool, label: toolLabel(t.tool) ?? t.tool, value: t.count, sub: timeAgo(t.last, now) ?? undefined }))}
          />
        </Section>
        <Section title="Atividade recente">
          {u.recent.length ? (
            <ol className="overflow-hidden rounded-[16px]" style={{ boxShadow: 'inset 0 0 0 1px rgb(var(--text) / 0.08)' }}>
              {u.recent.map((r, i) => (
                <li key={i} className="flex items-center justify-between gap-3 border-t border-[rgb(var(--text)/0.06)] px-4 py-2.5 first:border-t-0">
                  <span className="truncate text-[13.5px] text-text">{toolLabel(r.tool)}</span>
                  <span className="field-label shrink-0 text-[12px] text-text-muted">{fmtDateTime(r.at)}</span>
                </li>
              ))}
            </ol>
          ) : (
            <Empty>Sem atividade registrada.</Empty>
          )}
        </Section>
      </div>
    </>
  );
});

/* ═════════════════════ Pagamentos ═════════════════════ */

const TabPagamentos = memo(function TabPagamentos({ data }: { data: ProfileData }) {
  const b = data.billing;
  const p = data.user;
  return (
    <>
      <div className="mb-8 grid grid-cols-2 gap-px overflow-hidden rounded-[16px] md:grid-cols-4" style={{ background: 'rgb(var(--text) / 0.07)', boxShadow: 'inset 0 0 0 1px rgb(var(--text) / 0.07)' }}>
        <MiniStat label="Total pago" value={brl(b.totalPaid)} a={b.totalPaid ? 'lime' : undefined} />
        <MiniStat label="Pagamentos" value={b.count} />
        <MiniStat label="Reembolsado" value={brl(b.refunded)} a={b.refunded ? 'danger' : undefined} />
        <MiniStat label="Primeiro pagamento" value={<span className="text-[17px]">{fmtDate(b.firstAt) ?? 'Nenhum'}</span>} />
      </div>

      <Section title="Pagamentos e comprovantes">
        {data.payments.length ? (
          <div className="overflow-x-auto rounded-[16px]" style={{ boxShadow: 'inset 0 0 0 1px rgb(var(--text) / 0.08)' }}>
            <table className="w-full min-w-[620px] text-left">
              <thead>
                <tr className="field-label text-[12px] text-text-muted">
                  <th className="px-4 py-3 font-medium">Data</th>
                  <th className="px-4 py-3 font-medium">Plano</th>
                  <th className="px-4 py-3 font-medium">Valor</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 text-right font-medium">Comprovante</th>
                </tr>
              </thead>
              <tbody>
                {data.payments.map((x) => {
                  const refunded = x.status === 'refunded' || x.status === 'disputed';
                  return (
                    <tr key={x.id} className="border-t border-[rgb(var(--text)/0.06)] text-[13px]">
                      <td className="field-label whitespace-nowrap px-4 py-3 text-text">{fmtDateTime(x.created_at) ?? 'Sem data'}</td>
                      <td className="field-label px-4 py-3 text-text-muted">{planLabel(x.plan, x.billing)}</td>
                      <td
                        className={'font-tech px-4 py-3 font-semibold ' + (refunded ? 'line-through opacity-60' : '')}
                        style={{ color: refunded ? 'rgb(var(--text-muted))' : accent('lime'), fontVariantNumeric: 'tabular-nums' }}
                      >
                        {brl(x.amount)}
                      </td>
                      <td className="px-4 py-3">
                        {refunded ? <Tag a="danger">{x.status === 'disputed' ? 'Contestado' : 'Reembolsado'}</Tag> : <Tag a="lime">Pago</Tag>}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {x.receipt_url ? (
                          <a
                            href={x.receipt_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="field-label inline-flex items-center gap-1.5 text-[13px] font-semibold underline-offset-4 hover:underline"
                            style={{ color: accent('violet') }}
                          >
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
          <Empty>Nenhum pagamento registrado para esta conta.</Empty>
        )}
      </Section>

      <Section title="Histórico de plano" hint="Mudanças feitas pelo painel (quem, quando e de onde pra onde)">
        {data.tierChanges.length ? (
          <ol className="overflow-hidden rounded-[16px]" style={{ boxShadow: 'inset 0 0 0 1px rgb(var(--text) / 0.08)' }}>
            {data.tierChanges.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-[rgb(var(--text)/0.06)] px-4 py-3 first:border-t-0">
                <span className="field-label text-[13.5px] text-text">
                  {TIER_LABEL[t.from_tier ?? ''] ?? t.from_tier ?? 'Sem plano'} <span className="text-text-muted">para</span>{' '}
                  <span className="font-semibold">{TIER_LABEL[t.to_tier ?? ''] ?? t.to_tier ?? 'Sem plano'}</span>
                </span>
                {t.reason ? <span className="field-label text-[12.5px] text-text-muted">{t.reason}</span> : null}
                <span className="field-label ml-auto text-[12px] text-text-muted">
                  {fmtDateTime(t.created_at)}
                  {t.by ? ` · por ${t.by}` : ''}
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <Empty>Nenhuma mudança de plano feita pelo painel.</Empty>
        )}
      </Section>

      {p.stripe_customer_id || p.stripe_subscription_id ? (
        <Section title="Stripe">
          <FactGrid cols={2}>
            {p.stripe_customer_id ? (
              <FactCell>
                <div className="flex items-center justify-between pr-3">
                  <Fact label="Cliente" mono>{p.stripe_customer_id}</Fact>
                  <CopyBtn value={p.stripe_customer_id} label="Copiar id do cliente" />
                </div>
              </FactCell>
            ) : null}
            {p.stripe_subscription_id ? (
              <FactCell>
                <div className="flex items-center justify-between pr-3">
                  <Fact label="Assinatura" mono>{p.stripe_subscription_id}</Fact>
                  <CopyBtn value={p.stripe_subscription_id} label="Copiar id da assinatura" />
                </div>
              </FactCell>
            ) : null}
          </FactGrid>
        </Section>
      ) : null}
    </>
  );
});
