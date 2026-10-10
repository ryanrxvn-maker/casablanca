'use client';

/**
 * Central de ferramentas (10.10) — a janela do botão "Ferramentas" do /admin.
 *
 * Cada ferramenta numa linha com o interruptor "No ar | Manutenção":
 *  • Manutenção abre o painel da própria linha: recado pro cliente (opcional)
 *    e previsão de volta (volta SOZINHA no horário). Só grava no "Colocar em
 *    manutenção" (2 etapas: ninguém derruba ferramenta de cliente sem querer).
 *  • No ar volta na hora.
 * Ao lado: prévia EXATA do aviso que o cliente vê (o mesmo componente do hub),
 * as contas que entram mesmo em manutenção e o histórico de quem mudou o quê.
 *
 * Vale pra todo mundo em até ~15 s (cache do middleware). A regra mora em
 * lib/maintenance.ts; o estado, no Storage (lib/maintenance-store.ts).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  activeMaintenance,
  LIMITS,
  normalizeEmail,
  whenLabel,
  type ToolChange,
  type ToolsConfig,
  type ToolsLogEntry,
} from '@/lib/maintenance';
import { refreshMaintenance } from '@/lib/maintenance-client';
import { PLAN_LABEL, TOOL_CATALOG, toolName, toolSlug, type CatalogTool, type ToolPlan } from '@/lib/tool-catalog';
import { travarScrollDaPagina } from '@/lib/trava-scroll';
import '@/components/notifications/notifications.css';
import { TOOL_ICONS } from '@/components/history/tool-icons';
import { DEFAULT_MAINT_MESSAGE, MaintenanceFlashView, WrenchGlyph } from '@/components/MaintenanceFlash';
import { Btn, I, IconOnly, Menu, MenuItem, MenuSep, Modal, Segmented, SPRING, Tag } from './kit';
import { accent, fmtDateTime, timeAgo, type Accent, type AdminUser } from './model';

type Filter = 'all' | 'maint' | 'clients' | 'internal';
type UntilMode = 'none' | '30m' | '1h' | '3h' | '24h' | 'custom';

const UNTIL_MS: Record<Exclude<UntilMode, 'none' | 'custom'>, number> = { '30m': 30 * 60_000, '1h': 3_600_000, '3h': 3 * 3_600_000, '24h': 86_400_000 };
const PLAN_TONE: Record<ToolPlan, Accent> = { free: 'lime', premium: 'violet', admin: 'cyan' };

type Draft = { path: string; message: string; untilMode: UntilMode; untilCustom: string; editing: boolean };

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function untilOf(d: Draft): string | null | 'invalid' {
  if (d.untilMode === 'none') return null;
  if (d.untilMode === 'custom') {
    const t = d.untilCustom ? new Date(d.untilCustom).getTime() : NaN;
    if (!Number.isFinite(t) || t <= Date.now() + 60_000 || t > Date.now() + LIMITS.untilDays * 86_400_000) return 'invalid';
    return new Date(t).toISOString();
  }
  return new Date(Date.now() + UNTIL_MS[d.untilMode]).toISOString();
}

function ToolGlyph({ path, size = 18 }: { path: string; size?: number }) {
  const C = TOOL_ICONS[toolSlug(path)];
  return C ? <C size={size} /> : <WrenchGlyph size={size - 1} />;
}

/* ───────────────────────── Componente ───────────────────────── */

export function ToolsCenter({
  users,
  onClose,
  flash,
  onCountChange,
}: {
  users: AdminUser[] | null;
  onClose: () => void;
  flash: (kind: 'ok' | 'err', msg: string, ms?: number) => void;
  onCountChange?: (n: number) => void;
}) {
  const [cfg, setCfg] = useState<ToolsConfig | null>(null);
  const [source, setSource] = useState<string>('');
  const [fixedBypass, setFixedBypass] = useState<string[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [bulk, setBulk] = useState<null | 'on' | 'off'>(null);
  const [menuEl, setMenuEl] = useState<HTMLElement | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const subOpen = useRef(false);
  subOpen.current = !!bulk || !!menuEl;

  const countRef = useRef(onCountChange);
  countRef.current = onCountChange;

  const apply = useCallback((next: ToolsConfig) => {
    setCfg(next);
    setNow(Date.now());
    countRef.current?.(Object.keys(activeMaintenance(next)).length);
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/tools-status', { cache: 'no-store' });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setLoadError(j.error || 'Falha ao carregar as ferramentas.');
        return;
      }
      setLoadError(null);
      setSource(j.source || '');
      setFixedBypass(Array.isArray(j.fixedBypass) ? j.fixedBypass : []);
      apply(j.cfg as ToolsConfig);
    } catch (e) {
      setLoadError((e as Error).message || 'Falha de conexão.');
    }
  }, [apply]);

  useEffect(() => {
    void load();
  }, [load]);

  // Janela própria: trava o scroll; Esc fecha o painel da linha primeiro e,
  // sem nada aberto, a janela (menu/confirmação cuidam do próprio Esc).
  const draftOpen = useRef(false);
  draftOpen.current = !!draft;
  useEffect(() => {
    const destravar = travarScrollDaPagina();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || subOpen.current) return;
      if (draftOpen.current) {
        setDraft(null);
        return;
      }
      onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      destravar();
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  // "há 5 min" e prazos andando sozinhos (folha leve, a cada 30 s).
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const live = useMemo(() => (cfg ? activeMaintenance(cfg, now) : {}), [cfg, now]);
  const liveCount = Object.keys(live).length;

  const send = useCallback(
    async (change: ToolChange, key: string): Promise<boolean> => {
      if (!cfg) return false;
      setBusy(key);
      try {
        const res = await fetch('/api/admin/tools-status', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ change, rev: cfg.rev }),
        });
        const j = await res.json().catch(() => ({}));
        if (res.status === 409 && j.cfg) {
          apply(j.cfg as ToolsConfig);
          flash('err', j.error || 'A lista mudou. Confira e faça de novo.', 6000);
          return false;
        }
        if (!res.ok || !j.ok) {
          flash('err', j.error || 'Não deu pra salvar.', 6000);
          return false;
        }
        apply(j.cfg as ToolsConfig);
        if (j.changed) flash('ok', `${j.summary} Vale pra todo mundo em até 15 segundos.`, 4800);
        void refreshMaintenance(true);
        return true;
      } catch (e) {
        flash('err', (e as Error).message || 'Falha de conexão.');
        return false;
      } finally {
        setBusy(null);
      }
    },
    [apply, cfg, flash],
  );

  function arm(t: CatalogTool) {
    const cur = cfg?.tools[t.path];
    const isLive = !!live[t.path];
    setDraft({
      path: t.path,
      message: isLive ? cur?.message ?? '' : '',
      untilMode: isLive && cur?.until ? 'custom' : 'none',
      untilCustom: isLive && cur?.until ? toLocalInput(cur.until) : '',
      editing: isLive,
    });
  }

  async function confirmDraft() {
    if (!draft) return;
    const until = untilOf(draft);
    if (until === 'invalid') {
      flash('err', `Escolha uma previsão de volta no futuro (até ${LIMITS.untilDays} dias) ou deixe sem previsão.`, 5200);
      return;
    }
    const okSaved = await send({ kind: 'set', path: draft.path, maintenance: true, message: draft.message, until }, draft.path);
    if (okSaved) setDraft(null);
  }

  async function backOnAir(t: CatalogTool) {
    if (draft?.path === t.path) setDraft(null);
    await send({ kind: 'set', path: t.path, maintenance: false }, t.path);
  }

  const qn = q.trim().toLowerCase();
  const visible = TOOL_CATALOG.filter((t) => {
    if (filter === 'maint' && !live[t.path]) return false;
    if (filter === 'clients' && t.plan === 'admin') return false;
    if (filter === 'internal' && t.plan !== 'admin') return false;
    if (!qn) return true;
    return t.label.toLowerCase().includes(qn) || t.hint.toLowerCase().includes(qn) || t.path.includes(qn);
  });
  const groups: Array<{ title: string; hint: string; items: CatalogTool[] }> = [
    { title: 'Clientes', hint: 'O que os clientes Free e Premium usam', items: visible.filter((t) => t.plan !== 'admin') },
    { title: 'Uso interno', hint: 'Só admin e contas com ferramenta liberada', items: visible.filter((t) => t.plan === 'admin') },
  ].filter((g) => g.items.length);

  const clientPaths = TOOL_CATALOG.filter((t) => t.plan !== 'admin').map((t) => t.path);
  const clientsLive = clientPaths.filter((p) => live[p]).length;

  // Prévia: o que está sendo escrito agora; senão a 1ª em manutenção; senão um exemplo.
  const previewPath = draft?.path ?? Object.keys(live).find((p) => clientPaths.includes(p)) ?? Object.keys(live)[0] ?? '/tools/tipografia';
  const previewTool = TOOL_CATALOG.find((t) => t.path === previewPath);
  const previewUntil = draft ? untilOf(draft) : live[previewPath]?.until ?? null;

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-3 md:p-6" role="dialog" aria-modal="true" aria-label="Ferramentas">
      <div className="ann-veil absolute inset-0 bg-black/65 backdrop-blur-sm" onClick={onClose} />
      <div
        className="ann-pop relative flex h-[min(880px,calc(100dvh-24px))] w-full max-w-[1200px] flex-col rounded-[28px] p-[6px] md:h-[min(880px,calc(100dvh-48px))]"
        style={{ background: 'rgb(var(--text) / 0.04)', boxShadow: 'inset 0 0 0 1px rgb(var(--text) / 0.09), 0 60px 120px -40px rgb(0 0 0 / 0.75)' }}
      >
        <div
          className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[22px] bg-bg-soft"
          style={{ boxShadow: 'inset 0 1px 0 rgb(var(--text) / 0.05), inset 0 0 0 1px rgb(var(--text) / 0.05)' }}
        >
          {/* ═══ Cabeçalho ═══ */}
          <header className="flex flex-wrap items-center gap-4 border-b border-[rgb(var(--text)/0.07)] px-5 py-4 md:px-6">
            <span
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px]"
              style={{
                color: accent(liveCount ? 'amber' : 'violet'),
                background: accent(liveCount ? 'amber' : 'violet', 0.12),
                boxShadow: `inset 0 0 0 1px ${accent(liveCount ? 'amber' : 'violet', 0.28)}`,
              }}
            >
              <WrenchGlyph size={20} />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="font-tech text-[19px] font-semibold tracking-[-0.02em] text-text">Ferramentas</h2>
              <p className="field-label hidden text-[13px] text-text-muted sm:block">
                Coloque qualquer ferramenta em manutenção e volte ao ar quando quiser. Vale pra todo mundo em até 15 segundos.
              </p>
            </div>
            {cfg ? (
              <span
                className="field-label hidden items-center gap-2 rounded-full px-3 py-1.5 text-[12.5px] font-semibold sm:inline-flex"
                style={{
                  color: accent(liveCount ? 'amber' : 'lime'),
                  background: accent(liveCount ? 'amber' : 'lime', 0.1),
                  boxShadow: `inset 0 0 0 1px ${accent(liveCount ? 'amber' : 'lime', 0.26)}`,
                }}
              >
                <span className="h-[6px] w-[6px] rounded-full" style={{ background: accent(liveCount ? 'amber' : 'lime'), boxShadow: `0 0 0 3px ${accent(liveCount ? 'amber' : 'lime', 0.2)}` }} />
                {liveCount ? `${liveCount} em manutenção` : 'Tudo no ar'}
              </span>
            ) : null}
            <IconOnly onClick={onClose} title="Fechar (Esc)">
              <I.close size={16} />
            </IconOnly>
          </header>

          {/* ═══ Barra de busca e filtro ═══ */}
          <div className="flex flex-wrap items-center gap-3 border-b border-[rgb(var(--text)/0.07)] px-5 py-3 md:px-6">
            <label className="relative min-w-[200px] flex-1 md:max-w-[300px]">
              <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-text-muted">
                <I.search size={15} />
              </span>
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Buscar ferramenta"
                aria-label="Buscar ferramenta"
                className="field-label h-10 w-full rounded-full bg-[rgb(var(--text)/0.04)] pl-10 pr-4 text-[13.5px] text-text outline-none transition-shadow placeholder:text-text-muted focus:shadow-[inset_0_0_0_1px_rgb(var(--violet)/0.5)]"
                style={{ boxShadow: 'inset 0 0 0 1px rgb(var(--text) / 0.09)' }}
              />
            </label>
            <div className="max-w-full overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <Segmented<Filter>
                size="sm"
                value={filter}
                onChange={setFilter}
                activeTone={filter === 'maint' ? 'amber' : 'violet'}
                options={[
                  { value: 'all', label: <Count label="Todas" n={TOOL_CATALOG.length} /> },
                  { value: 'maint', label: <Count label="Em manutenção" n={liveCount} /> },
                  { value: 'clients', label: <Count label="Clientes" n={clientPaths.length} /> },
                  { value: 'internal', label: <Count label="Uso interno" n={TOOL_CATALOG.length - clientPaths.length} /> },
                ]}
              />
            </div>
            <div className="ml-auto">
              <IconOnly title="Ações em todas" onClick={(e) => setMenuEl(e.currentTarget)} disabled={!cfg}>
                <I.dots size={16} />
              </IconOnly>
            </div>
          </div>

          {source === 'stale' || loadError ? (
            <div
              role="alert"
              className="field-label mx-5 mt-4 flex items-center justify-between gap-3 rounded-[14px] px-4 py-3 text-[13px] md:mx-6"
              style={{ color: accent('amber'), background: accent('amber', 0.08), boxShadow: `inset 0 0 0 1px ${accent('amber', 0.25)}` }}
            >
              <span className="flex items-center gap-2">
                <I.alert size={15} />
                {loadError ?? 'Não consegui ler o estado mais novo agora. Mostrando o último que eu conheço.'}
              </span>
              <Btn size="sm" onClick={() => void load()}>
                Tentar de novo
              </Btn>
            </div>
          ) : null}

          {/* ═══ Corpo ═══ */}
          <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto lg:grid-cols-[minmax(0,1fr)_400px] lg:overflow-hidden">
            {/* Lista */}
            <div className="min-h-0 px-5 py-5 md:px-6 lg:overflow-y-auto">
              {!cfg ? (
                <div className="flex flex-col gap-2">
                  {[0, 1, 2, 3, 4, 5].map((i) => (
                    <div key={i} className="h-[68px] rounded-[16px] bg-[rgb(var(--text)/0.04)]" />
                  ))}
                </div>
              ) : groups.length === 0 ? (
                <div className="field-label rounded-[18px] px-6 py-14 text-center text-[14px] text-text-muted" style={{ boxShadow: 'inset 0 0 0 1px rgb(var(--text) / 0.07)' }}>
                  {filter === 'maint' && !qn ? 'Nenhuma ferramenta em manutenção. Tudo no ar.' : `Nenhuma ferramenta com "${q.trim()}".`}
                </div>
              ) : (
                groups.map((g) => (
                  <section key={g.title} className="mb-6 last:mb-1">
                    <div className="mb-2.5 flex items-baseline justify-between gap-3 px-1">
                      <h3 className="font-tech text-[14.5px] font-semibold text-text">
                        {g.title}
                        <span className="field-label ml-2 text-[12px] font-medium text-text-muted">{g.items.length}</span>
                      </h3>
                      <span className="field-label hidden text-[12px] text-text-muted sm:block">{g.hint}</span>
                    </div>
                    <ul className="flex flex-col gap-1.5 rounded-[20px] p-1.5" style={{ background: 'rgb(var(--text) / 0.025)', boxShadow: 'inset 0 0 0 1px rgb(var(--text) / 0.07)' }}>
                      {g.items.map((t) => (
                        <ToolRow
                          key={t.path}
                          tool={t}
                          state={cfg.tools[t.path]}
                          live={!!live[t.path]}
                          now={now}
                          busy={busy === t.path}
                          draft={draft?.path === t.path ? draft : null}
                          onArm={() => arm(t)}
                          onBack={() => void backOnAir(t)}
                          onDraft={(p) => setDraft((d) => (d ? { ...d, ...p } : d))}
                          onCancel={() => setDraft(null)}
                          onConfirm={() => void confirmDraft()}
                        />
                      ))}
                    </ul>
                  </section>
                ))
              )}
            </div>

            {/* Lateral */}
            <aside className="min-h-0 border-t border-[rgb(var(--text)/0.07)] bg-[rgb(var(--text)/0.015)] px-5 py-5 md:px-6 lg:overflow-y-auto lg:border-l lg:border-t-0">
              <SideTitle title="O que o cliente vê" hint={draft ? 'Prévia do aviso que você está escrevendo' : 'Ao abrir uma ferramenta em manutenção'} />
              <div className="pointer-events-none select-none">
                <MaintenanceFlashView
                  className="mb-2"
                  name={previewTool && previewTool.plan !== 'admin' ? previewTool.label : 'Esta ferramenta'}
                  message={draft ? draft.message : live[previewPath]?.message || ''}
                  until={previewUntil === 'invalid' ? null : previewUntil}
                  now={now}
                />
              </div>
              <p className="field-label mb-6 px-1 text-[12px] leading-relaxed text-text-muted">
                O card no início ganha o selo de manutenção e não abre. Quem já estava com a ferramenta aberta termina o que estava fazendo.
              </p>

              <BypassCard
                emails={cfg?.bypass ?? []}
                fixed={fixedBypass}
                users={users ?? []}
                busy={busy === 'bypass'}
                disabled={!cfg}
                onSave={(emails) => send({ kind: 'bypass', emails }, 'bypass')}
              />

              <SideTitle title="Últimas mudanças" hint="Quem mudou o quê" className="mt-6" />
              <LogList log={cfg?.log ?? []} now={now} />
            </aside>
          </div>
        </div>
      </div>

      {menuEl ? (
        <Menu anchor={menuEl} onClose={() => setMenuEl(null)} width={290} layer={85}>
          <MenuItem
            icon={<WrenchGlyph size={14} />}
            tone="amber"
            disabled={clientsLive === clientPaths.length}
            hint="Free e Premium de uma vez"
            onClick={() => {
              setMenuEl(null);
              setBulk('on');
            }}
          >
            Pôr todas dos clientes em manutenção
          </MenuItem>
          <MenuSep />
          <MenuItem
            icon={<I.check size={14} />}
            tone="lime"
            disabled={!liveCount}
            hint="Inclusive as de uso interno"
            onClick={() => {
              setMenuEl(null);
              setBulk('off');
            }}
          >
            Tirar todas da manutenção
          </MenuItem>
        </Menu>
      ) : null}

      {bulk ? (
        <BulkConfirm
          mode={bulk}
          count={bulk === 'on' ? clientPaths.length - clientsLive : liveCount}
          busy={busy === 'all'}
          onCancel={() => setBulk(null)}
          onConfirm={async (message) => {
            const okSaved = await send(
              bulk === 'on'
                ? { kind: 'all', maintenance: true, paths: clientPaths, message }
                : { kind: 'all', maintenance: false, paths: Object.keys(live) },
              'all',
            );
            if (okSaved) setBulk(null);
          }}
        />
      ) : null}
    </div>,
    document.body,
  );
}

/* ───────────────────────── Linha da ferramenta ───────────────────────── */

function ToolRow({
  tool,
  state,
  live,
  now,
  busy,
  draft,
  onArm,
  onBack,
  onDraft,
  onCancel,
  onConfirm,
}: {
  tool: CatalogTool;
  state: ToolsConfig['tools'][string] | undefined;
  live: boolean;
  now: number;
  busy: boolean;
  draft: Draft | null;
  onArm: () => void;
  onBack: () => void;
  onDraft: (p: Partial<Draft>) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const tone: Accent = live ? 'amber' : PLAN_TONE[tool.plan];
  const armed = !!draft;
  return (
    <li
      className="rounded-[15px] transition-[background-color,box-shadow] duration-300"
      style={{
        background: live || armed ? accent('amber', 0.05) : 'rgb(var(--bg-soft))',
        boxShadow: `inset 0 0 0 1px ${live || armed ? accent('amber', 0.22) : 'rgb(var(--text) / 0.06)'}`,
        transitionTimingFunction: SPRING,
      }}
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3 p-3 md:flex-nowrap md:p-3.5">
        <span
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px]"
          style={{ color: accent(tone), background: accent(tone, 0.12), boxShadow: `inset 0 0 0 1px ${accent(tone, 0.26)}` }}
        >
          <ToolGlyph path={tool.path} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <p className="font-tech truncate text-[14.5px] font-semibold tracking-[-0.01em] text-text">{tool.label}</p>
            <Tag a={PLAN_TONE[tool.plan]}>{PLAN_LABEL[tool.plan]}</Tag>
          </div>
          {live && state ? (
            <p className="field-label mt-1 text-[12.5px] leading-snug" style={{ color: accent('amber') }}>
              Em manutenção{state.since ? ` desde ${whenLabel(state.since, now)}` : ''}
              {state.by ? ` · por ${state.by}` : ''}
              {state.until ? ` · volta sozinha ${whenLabel(state.until, now)}` : ''}
            </p>
          ) : (
            <p className="field-label mt-0.5 truncate text-[12.5px] text-text-muted">{tool.hint}</p>
          )}
          {live && state?.message && !armed ? (
            <p className="field-label mt-1 line-clamp-2 text-[12.5px] text-text-muted" style={{ overflowWrap: 'anywhere' }}>
              Recado: &ldquo;{state.message}&rdquo;
            </p>
          ) : null}
        </div>
        <div className="flex w-full shrink-0 items-center justify-end gap-2 md:w-auto">
          {live && !armed ? (
            <Btn size="sm" onClick={onArm} disabled={busy} title="Trocar o recado ou a previsão">
              Editar aviso
            </Btn>
          ) : null}
          <StateToggle maintenance={live || armed} pendingOn={armed && !live} busy={busy} onAir={onBack} onMaint={onArm} label={tool.label} />
        </div>
      </div>

      {armed && draft ? (
        <div className="fade-in-up border-t px-3 pb-3.5 pt-3.5 md:px-4" style={{ borderColor: accent('amber', 0.18) }}>
          <label className="block">
            <span className="field-label mb-1.5 flex items-baseline justify-between text-[13px] text-text-muted">
              <span>Recado pros clientes (opcional)</span>
              <span className="text-[11.5px]" style={{ fontVariantNumeric: 'tabular-nums' }}>
                {Array.from(draft.message).length}/{LIMITS.message}
              </span>
            </span>
            <textarea
              autoFocus
              value={draft.message}
              maxLength={LIMITS.message + 10}
              onChange={(e) => onDraft({ message: e.target.value })}
              rows={2}
              placeholder={DEFAULT_MAINT_MESSAGE}
              className="input-field !rounded-[12px] !py-2.5 resize-none text-[13.5px] leading-relaxed"
            />
          </label>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="field-label mr-1 text-[13px] text-text-muted">Volta sozinha</span>
            <Segmented<UntilMode>
              size="sm"
              value={draft.untilMode}
              activeTone="amber"
              onChange={(v) =>
                onDraft({
                  untilMode: v,
                  untilCustom: v === 'custom' && !draft.untilCustom ? toLocalInput(new Date(Date.now() + 2 * 3_600_000).toISOString()) : draft.untilCustom,
                })
              }
              options={[
                { value: 'none', label: 'Sem previsão' },
                { value: '30m', label: '30 min' },
                { value: '1h', label: '1 h' },
                { value: '3h', label: '3 h' },
                { value: '24h', label: '24 h' },
                { value: 'custom', label: 'Data' },
              ]}
            />
            {draft.untilMode === 'custom' ? (
              <input
                type="datetime-local"
                value={draft.untilCustom}
                min={toLocalInput(new Date(Date.now() + 5 * 60_000).toISOString())}
                onChange={(e) => onDraft({ untilCustom: e.target.value })}
                className="input-field !w-auto !rounded-[12px] !py-1.5 text-[13px]"
                aria-label="Data e hora da volta"
              />
            ) : null}
          </div>
          <div className="mt-3.5 flex flex-wrap items-center gap-3">
            <p className="field-label mr-auto max-w-[52ch] text-[12px] leading-relaxed text-text-muted">
              {tool.plan === 'admin'
                ? 'Ferramenta interna: só afeta contas com ela liberada. Você continua entrando.'
                : 'Quem estiver com ela aberta termina o que está fazendo. Quem abrir depois vê o aviso. Você continua entrando.'}
            </p>
            <Btn size="sm" onClick={onCancel} disabled={busy}>
              Cancelar
            </Btn>
            <button
              type="button"
              onClick={onConfirm}
              disabled={busy}
              className="field-label inline-flex h-8 items-center gap-2 rounded-full px-4 text-[12.5px] font-semibold transition-[transform,filter] duration-300 hover:brightness-110 active:scale-[0.97] disabled:opacity-50"
              style={{ color: accent('amber'), background: accent('amber', 0.18), boxShadow: `inset 0 0 0 1px ${accent('amber', 0.45)}`, transitionTimingFunction: SPRING }}
            >
              {busy ? <Spinner /> : <WrenchGlyph size={13} />}
              {draft.editing ? 'Salvar aviso' : 'Colocar em manutenção'}
            </button>
          </div>
        </div>
      ) : null}
    </li>
  );
}

/** Interruptor de 2 posições com trilho deslizante: No ar | Manutenção. */
function StateToggle({
  maintenance,
  pendingOn,
  busy,
  onAir,
  onMaint,
  label,
}: {
  maintenance: boolean;
  pendingOn: boolean;
  busy: boolean;
  onAir: () => void;
  onMaint: () => void;
  label: string;
}) {
  const tone: Accent = maintenance ? 'amber' : 'lime';
  return (
    <div
      role="radiogroup"
      aria-label={`Estado de ${label}`}
      className="relative grid h-9 w-[216px] shrink-0 grid-cols-2 rounded-full p-[3px]"
      style={{ background: 'rgb(var(--text) / 0.05)', boxShadow: 'inset 0 0 0 1px rgb(var(--text) / 0.09), inset 0 1px 2px rgb(0 0 0 / 0.18)', opacity: busy ? 0.7 : 1 }}
    >
      <span
        aria-hidden
        className="absolute bottom-[3px] left-[3px] top-[3px] w-[calc(50%-3px)] rounded-full transition-transform duration-500"
        style={{
          transform: maintenance ? 'translateX(100%)' : 'none',
          background: accent(tone, 0.16),
          boxShadow: `inset 0 0 0 1px ${accent(tone, pendingOn ? 0.3 : 0.45)}, 0 4px 14px -6px ${accent(tone, 0.55)}`,
          transitionTimingFunction: SPRING,
        }}
      />
      <button
        type="button"
        role="radio"
        aria-checked={!maintenance}
        disabled={busy}
        onClick={() => maintenance && onAir()}
        className="field-label relative z-[1] inline-flex items-center justify-center gap-1.5 rounded-full text-[12.5px] font-semibold transition-colors duration-300"
        style={{ color: !maintenance ? accent('lime') : 'rgb(var(--text-muted))' }}
      >
        {busy && !maintenance ? <Spinner /> : <span className="h-[6px] w-[6px] rounded-full" style={{ background: !maintenance ? accent('lime') : 'rgb(var(--text) / 0.25)' }} />}
        No ar
      </button>
      <button
        type="button"
        role="radio"
        aria-checked={maintenance}
        disabled={busy}
        onClick={() => !maintenance && onMaint()}
        className="field-label relative z-[1] inline-flex items-center justify-center gap-1.5 rounded-full text-[12.5px] font-semibold transition-colors duration-300"
        style={{ color: maintenance ? accent('amber') : 'rgb(var(--text-muted))' }}
      >
        {busy && maintenance ? <Spinner /> : <WrenchGlyph size={12} />}
        Manutenção
      </button>
    </div>
  );
}

function Spinner() {
  return <span className="h-3 w-3 animate-spin rounded-full border-[1.5px] border-current border-t-transparent" aria-hidden />;
}

/* ───────────────────────── Lateral ───────────────────────── */

function SideTitle({ title, hint, className = '' }: { title: string; hint?: string; className?: string }) {
  return (
    <div className={'mb-3 px-1 ' + className}>
      <p className="font-tech text-[14.5px] font-semibold text-text">{title}</p>
      {hint ? <p className="field-label text-[12.5px] text-text-muted">{hint}</p> : null}
    </div>
  );
}

function BypassCard({
  emails,
  fixed,
  users,
  busy,
  disabled,
  onSave,
}: {
  emails: string[];
  fixed: string[];
  users: AdminUser[];
  busy: boolean;
  disabled: boolean;
  onSave: (emails: string[]) => Promise<boolean>;
}) {
  const [list, setList] = useState<string[]>(emails);
  const [q, setQ] = useState('');
  const [focus, setFocus] = useState(false);
  const key = emails.join(',');
  useEffect(() => setList(key ? key.split(',') : []), [key]);
  const dirty = list.join(',') !== key;
  const fixedSet = new Set(fixed);

  const suggestions = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (s.length < 2) return [];
    return users
      .filter((u) => u.email && !list.includes(u.email.toLowerCase()) && !fixedSet.has(u.email.toLowerCase()) && ((u.email ?? '').toLowerCase().includes(s) || (u.name ?? '').toLowerCase().includes(s)))
      .slice(0, 6);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, users, list, fixed]);

  function add(raw: string) {
    const parts = raw.split(/[\s,;]+/).map(normalizeEmail).filter((e): e is string => !!e && !fixedSet.has(e));
    if (!parts.length) return false;
    setList((l) => Array.from(new Set([...l, ...parts])).slice(0, LIMITS.bypass));
    setQ('');
    return true;
  }

  return (
    <div className="rounded-[18px] p-[4px]" style={{ background: 'rgb(var(--text) / 0.03)', boxShadow: 'inset 0 0 0 1px rgb(var(--text) / 0.08)' }}>
      <div className="rounded-[14px] bg-bg-soft p-3.5" style={{ boxShadow: 'inset 0 1px 0 rgb(var(--text) / 0.04), inset 0 0 0 1px rgb(var(--text) / 0.05)' }}>
        <p className="font-tech text-[14px] font-semibold text-text">Contas que entram mesmo assim</p>
        <p className="field-label mt-0.5 text-[12.5px] leading-snug text-text-muted">Clientes de confiança que podem testar ferramenta em manutenção. Admin sempre entra.</p>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {fixed.map((e) => (
            <span
              key={'f' + e}
              title="Fixo no código: não sai por aqui"
              className="field-label inline-flex max-w-full items-center gap-1.5 rounded-full py-1 pl-2 pr-2.5 text-[12px] font-medium text-text-muted"
              style={{ background: 'rgb(var(--text) / 0.05)', boxShadow: 'inset 0 0 0 1px rgb(var(--text) / 0.08)' }}
            >
              <LockGlyph />
              <span className="truncate">{e}</span>
            </span>
          ))}
          {list.map((e) => (
            <span
              key={e}
              className="field-label inline-flex max-w-full items-center gap-1 rounded-full py-1 pl-2.5 pr-1 text-[12px] font-medium text-text"
              style={{ background: accent('violet', 0.1), boxShadow: `inset 0 0 0 1px ${accent('violet', 0.25)}` }}
            >
              <span className="truncate">{e}</span>
              <button
                type="button"
                onClick={() => setList((l) => l.filter((x) => x !== e))}
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-text-muted hover:bg-[rgb(var(--text)/0.1)] hover:text-text"
                aria-label={`Tirar ${e}`}
                disabled={disabled}
              >
                <I.close size={11} />
              </button>
            </span>
          ))}
          {!fixed.length && !list.length ? <span className="field-label text-[12.5px] text-text-muted">Ninguém além do admin.</span> : null}
        </div>

        <div className="relative mt-3">
          <input
            className="input-field !rounded-[12px] !py-2 text-[13px]"
            value={q}
            disabled={disabled}
            onChange={(e) => {
              const v = e.target.value;
              if (/[,;]/.test(v) && add(v)) return;
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
              }
            }}
            onFocus={() => setFocus(true)}
            onBlur={() => setTimeout(() => setFocus(false), 150)}
            placeholder="nome ou email@exemplo.com"
            aria-label="Adicionar conta liberada"
          />
          {focus && suggestions.length ? (
            <div
              className="dropdown-pop absolute left-0 right-0 top-[calc(100%+6px)] z-10 rounded-[14px] bg-bg-elev p-1.5"
              style={{ boxShadow: 'inset 0 0 0 1px rgb(var(--text) / 0.1), 0 24px 48px -16px rgb(0 0 0 / 0.6)' }}
            >
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
                  <span className="min-w-0 truncate text-[12px] text-text-muted">{u.name ? u.email : ''}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>

        {dirty ? (
          <div className="fade-in-up mt-3 flex items-center justify-end gap-2">
            <Btn size="sm" onClick={() => setList(key ? key.split(',') : [])} disabled={busy}>
              Desfazer
            </Btn>
            <Btn size="sm" tone="violet" solid onClick={() => void onSave(list)} disabled={busy}>
              {busy ? 'Salvando' : 'Salvar lista'}
            </Btn>
          </div>
        ) : null}
      </div>
    </div>
  );
}

const ACTION_TEXT: Record<ToolsLogEntry['action'], string> = {
  on: 'pôs em manutenção',
  off: 'voltou ao ar',
  edit: 'trocou o aviso de',
  all_on: 'pôs em manutenção',
  all_off: 'tirou da manutenção',
  bypass: 'mudou as contas liberadas:',
};

function LogList({ log, now }: { log: ToolsLogEntry[]; now: number }) {
  if (!log.length) {
    return <p className="field-label rounded-[14px] px-4 py-5 text-center text-[12.5px] text-text-muted" style={{ boxShadow: 'inset 0 0 0 1px rgb(var(--text) / 0.07)' }}>Nenhuma mudança ainda.</p>;
  }
  return (
    <ol className="relative flex flex-col gap-3 pl-4">
      <span aria-hidden className="absolute bottom-1 left-[5px] top-1 w-px bg-[rgb(var(--text)/0.08)]" />
      {log.slice(0, 14).map((e, i) => {
        const tone: Accent = e.action === 'off' || e.action === 'all_off' ? 'lime' : e.action === 'bypass' ? 'violet' : 'amber';
        const target = e.path ? toolName(e.path) : e.detail ?? '';
        return (
          <li key={i} className="relative">
            <span aria-hidden className="absolute -left-[14px] top-[5px] h-[9px] w-[9px] rounded-full" style={{ background: accent(tone), boxShadow: `0 0 0 3px rgb(var(--bg-soft))` }} />
            <p className="field-label text-[12.5px] leading-snug text-text">
              <b className="font-semibold">{e.by}</b> {e.action === 'off' ? <>voltou <b className="font-semibold">{target}</b> ao ar</> : <>{ACTION_TEXT[e.action]} <b className="font-semibold">{e.action === 'bypass' ? e.detail : target}</b></>}
            </p>
            {e.path && e.detail && e.action !== 'bypass' ? (
              <p className="field-label mt-0.5 line-clamp-1 text-[12px] text-text-muted">&ldquo;{e.detail}&rdquo;</p>
            ) : null}
            <p className="field-label mt-0.5 text-[11.5px] text-text-muted" title={fmtDateTime(e.at) ?? ''}>
              {timeAgo(e.at, now)}
            </p>
          </li>
        );
      })}
    </ol>
  );
}

function BulkConfirm({
  mode,
  count,
  busy,
  onCancel,
  onConfirm,
}: {
  mode: 'on' | 'off';
  count: number;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (message: string) => void;
}) {
  const [message, setMessage] = useState('');
  return (
    <Modal onClose={busy ? () => {} : onCancel} tone={mode === 'on' ? 'amber' : 'lime'}>
      <h3 className="font-tech text-[18px] font-semibold tracking-[-0.02em] text-text">
        {mode === 'on' ? `Pôr ${count} ${count === 1 ? 'ferramenta' : 'ferramentas'} em manutenção?` : `Tirar ${count} ${count === 1 ? 'ferramenta' : 'ferramentas'} da manutenção?`}
      </h3>
      <p className="field-label mt-2 text-[14px] leading-relaxed text-text-muted">
        {mode === 'on'
          ? 'Todas as ferramentas dos clientes (Free e Premium) ficam bloqueadas pra eles em até 15 segundos. Você e as contas liberadas continuam entrando.'
          : 'Todas voltam ao ar pra todo mundo em até 15 segundos.'}
      </p>
      {mode === 'on' ? (
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          maxLength={LIMITS.message + 10}
          rows={2}
          placeholder="Recado pros clientes (opcional). Ex.: Atualização geral, voltamos em 30 minutos."
          className="input-field mt-4 !rounded-[12px] !py-2.5 resize-none text-[13.5px]"
        />
      ) : null}
      <div className="mt-5 flex justify-end gap-2">
        <Btn onClick={onCancel} disabled={busy}>
          Cancelar
        </Btn>
        <Btn tone={mode === 'on' ? 'amber' : 'lime'} solid onClick={() => onConfirm(message)} disabled={busy || !count}>
          {busy ? 'Salvando' : mode === 'on' ? 'Pôr em manutenção' : 'Tirar todas'}
        </Btn>
      </div>
    </Modal>
  );
}

function Count({ label, n }: { label: string; n: number }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {label}
      <span className="text-[11px] opacity-70" style={{ fontVariantNumeric: 'tabular-nums' }}>
        {n}
      </span>
    </span>
  );
}

function LockGlyph() {
  return (
    <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="5" y="11" width="14" height="9.5" rx="2.2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  );
}
