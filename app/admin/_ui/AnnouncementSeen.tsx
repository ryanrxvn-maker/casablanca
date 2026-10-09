'use client';

/**
 * "Quem viu" (09.10): o olhinho de cada aviso na aba Enviados da Central abre
 * esta tela. Por conta: quando chegou, a hora de CADA login em que viu (a
 * janela volta a cada login novo enquanto o aviso está no ar), primeira e
 * última vez, quantas vezes, clique no botão e se apagou do sino. Quem está no
 * público e ainda não abriu o site desde a publicação fica em "Não entraram".
 *
 * A hora de cada vez vem da chave da janela fechada (seenFromInbox, em
 * lib/announcements.ts). Fechamentos de antes de 09.10 não gravavam a hora:
 * desses só se sabe a primeira leitura e o último fechamento.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  MAX_DISMISSED_KEYS,
  THEME_META,
  TONE_META,
  type AdminAnnouncement,
  type AvisoContent,
  type PromoContent,
  type SeenRow,
  type SeenView,
} from '@/lib/announcements';
import { AnnIcon, ToneIcon } from '@/components/notifications/templates';
import { Btn, I, IconOnly, Segmented, SPRING, Tag } from './kit';
import { accent, fmtDateShort, fmtDateTime, fmtTime, timeAgo, type AdminUser } from './model';

type Filter = 'viram' | 'so' | 'nao';
/** Quem é a conta: da lista de clientes do painel, ou (admin, fora da lista) do próprio "Quem viu". */
type Person = { email: string | null; name: string | null; isAdmin: boolean; plan: 'premium' | 'free' | null; lastSeenAt: string | null };
type Line = { id: string; person: Person | null; seen: SeenRow | null };
type Data = { rows: SeenRow[]; people: Map<string, Person>; activatedAt: string | null; popup: boolean };

const fromUser = (u: AdminUser): Person => ({ email: u.email, name: u.name, isAdmin: u.is_admin, plan: u.plan, lastSeenAt: u.last_seen_at });

const PAGE = 60;

/** Mesmas colunas no cabeçalho e em toda linha: nada desalinha. */
const COLS =
  'grid grid-cols-[minmax(0,1fr)_auto_14px] items-center gap-x-4 md:grid-cols-[minmax(0,1fr)_104px_104px_104px_56px_14px]';

const short = (iso: string | null | undefined) => (iso ? `${fmtDateShort(iso)} · ${fmtTime(iso)}` : '—');
const full = (iso: string | null | undefined) => (iso ? `${fmtDateTime(iso)} (${timeAgo(iso)})` : undefined);
/** busca sem acento e sem caixa ("Íris" acha "iris") */
const norm = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const at = (iso: string | null | undefined) => (iso ? Date.parse(iso) || 0 : 0);
const pct = (part: number, total: number) => (total ? `${Math.round((part / total) * 100)}%` : '0%');

function ordinal(i: number): string {
  return `${i + 1}ª vez`;
}

export function AnnouncementSeen({
  a,
  users,
  reach,
  onBack,
}: {
  a: AdminAnnouncement;
  users: AdminUser[] | null;
  /** contas do público (mesma conta do "461 contas" da lista); null = lista de contas ainda carregando */
  reach: AdminUser[] | null;
  onBack: () => void;
}) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<Filter | null>(null);
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const [open, setOpen] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/announcements?views=${encodeURIComponent(a.id)}`, { cache: 'no-store' });
      const j = (await res.json().catch(() => ({}))) as {
        error?: string;
        enabled?: boolean;
        rows?: SeenRow[];
        people?: Array<{ id: string; email: string | null; name: string | null; isAdmin: boolean }>;
        activatedAt?: string | null;
        popup?: boolean;
      };
      if (!res.ok) throw new Error(j.error || 'Não deu pra carregar quem viu.');
      if (j.enabled === false) throw new Error('As tabelas de avisos ainda não existem no banco.');
      const people = new Map<string, Person>();
      for (const p of Array.isArray(j.people) ? j.people : []) people.set(p.id, { email: p.email, name: p.name, isAdmin: p.isAdmin, plan: null, lastSeenAt: null });
      setData({ rows: Array.isArray(j.rows) ? j.rows : [], people, activatedAt: j.activatedAt ?? null, popup: j.popup !== false });
    } catch (e) {
      setError((e as Error).message || 'Não deu pra carregar quem viu.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a.id]);

  // Esc volta pra lista (a Central só fecha com Esc fora desta tela)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.querySelector('[role="menu"]')) onBack();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onBack]);

  const byId = useMemo(() => new Map((users ?? []).map((u) => [u.id, u])), [users]);

  const groups = useMemo(() => {
    if (!data) return null;
    const got = new Set(data.rows.map((r) => r.userId));
    const who = (id: string): Person | null => {
      const u = byId.get(id);
      return u ? fromUser(u) : (data.people.get(id) ?? null);
    };
    const lines = data.rows.map((s): Line => ({ id: s.userId, person: who(s.userId), seen: s }));
    const viram = lines.filter((l) => l.seen!.views.length > 0).sort((x, y) => at(y.seen!.lastAt) - at(x.seen!.lastAt));
    const so = lines.filter((l) => l.seen!.views.length === 0).sort((x, y) => at(y.seen!.deliveredAt) - at(x.seen!.deliveredAt));
    const nao = (reach ?? [])
      .filter((u) => !got.has(u.id))
      .map((u): Line => ({ id: u.id, person: fromUser(u), seen: null }))
      .sort((x, y) => at(y.person!.lastSeenAt) - at(x.person!.lastSeenAt));
    return {
      viram,
      so,
      nao,
      received: lines.length,
      again: viram.filter((l) => l.seen!.views.length >= 2).length,
      clicked: lines.filter((l) => l.seen!.clickedAt).length,
    };
  }, [data, byId, reach]);

  // primeira aba com gente (sem trocar sozinha depois que a pessoa escolheu)
  useEffect(() => {
    if (!groups || filter) return;
    setFilter(groups.viram.length ? 'viram' : groups.so.length ? 'so' : 'nao');
  }, [groups, filter]);

  useEffect(() => {
    setLimit(PAGE);
    setOpen(null);
  }, [filter, query]);

  const tab: Filter = filter ?? 'viram';
  const list = useMemo(() => {
    if (!groups) return [];
    const base = groups[tab];
    const q = norm(query.trim());
    if (!q) return base;
    return base.filter((l) => norm(`${l.person?.email ?? ''} ${l.person?.name ?? ''}`).includes(q));
  }, [groups, tab, query]);

  const promo = a.kind === 'propaganda';
  const color = promo ? THEME_META[(a.content as PromoContent).theme].rgb : TONE_META[(a.content as AvisoContent).tone].rgb;
  const hasCta = !!a.content.ctaLabel;
  const audienceTotal = groups ? groups.received + groups.nao.length : 0;

  return (
    <div data-ann-seen className="min-h-0 flex-1 overflow-y-auto px-5 py-5 md:px-6">
      {/* cabeçalho */}
      <div className="flex items-center gap-3">
        <IconOnly title="Voltar pros enviados (Esc)" onClick={onBack}>
          <I.back size={16} />
        </IconOnly>
        <span className="ann-tile !hidden !h-10 !w-10 shrink-0 !rounded-[12px] sm:!inline-flex" style={{ ['--ann' as string]: color }}>
          {promo ? <AnnIcon.megaphone size={18} /> : <ToneIcon tone={(a.content as AvisoContent).tone} size={18} />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-tech truncate text-[15px] font-semibold leading-tight text-text">{a.content.title}</p>
          <p className="field-label mt-1 truncate text-[12.5px] text-text-muted">
            Quem viu · {promo ? 'Propaganda' : 'Aviso'} · {a.popup ? 'janela na tela' : 'só no sino'}
            {a.activatedAt ? ` · no ar desde ${fmtDateTime(a.activatedAt)}` : ''}
          </p>
        </div>
        <Btn size="sm" onClick={() => void load()} disabled={loading} title="Atualizar">
          <span className="inline-flex items-center gap-1.5">
            <I.sync size={13} />
            <span className="hidden sm:inline">{loading ? 'Atualizando' : 'Atualizar'}</span>
          </span>
        </Btn>
      </div>

      {error ? (
        <div
          className="field-label mt-5 flex items-center justify-between gap-3 rounded-[14px] px-4 py-3 text-[13px]"
          style={{ color: accent('danger'), background: accent('danger', 0.08), boxShadow: `inset 0 0 0 1px ${accent('danger', 0.25)}` }}
        >
          {error}
          <Btn size="sm" onClick={() => void load()}>
            Tentar de novo
          </Btn>
        </div>
      ) : null}

      {/* resumo */}
      {/* 2 colunas até o computador (o 5º ocupa a linha toda: nada de buraco), 5 no computador */}
      <div className="mt-5 grid grid-cols-2 gap-2.5 lg:grid-cols-5">
        <Tile label="Receberam" value={groups?.received} sub={groups ? `${pct(groups.received, audienceTotal)} do público` : undefined} title="A janela chegou na conta (no primeiro acesso depois da publicação)" />
        <Tile label="Viram" value={groups?.viram.length} sub={groups ? `${pct(groups.viram.length, groups.received)} de quem recebeu` : undefined} title={a.popup ? 'Viram e fecharam a janela (ou abriram no sino)' : 'Abriram no sino'} />
        <Tile label="Viram de novo" value={groups?.again} sub="em outro login" title="Viram em mais de um login: a janela volta a cada login novo enquanto está no ar" tone="violet" />
        <Tile label="Clicaram" value={hasCta ? groups?.clicked : undefined} sub={hasCta ? (groups ? `${pct(groups.clicked, groups.received)} de quem recebeu` : undefined) : 'sem botão neste aviso'} title="Clicaram no botão do aviso" />
        <Tile label="Não entraram" value={groups?.nao.length} sub="desde a publicação" title="Estão no público e ainda não abriram o site depois que o aviso foi ao ar" className="col-span-2 lg:col-span-1" />
      </div>

      {/* filtro + busca */}
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <Segmented<Filter>
          value={tab}
          onChange={setFilter}
          size="sm"
          options={[
            { value: 'viram', label: <Count label="Viram" n={groups?.viram.length} /> },
            { value: 'so', label: <Count label="Só receberam" n={groups?.so.length} />, title: a.popup ? 'A janela chegou e ainda não foi fechada' : 'Chegou no sino e ainda não foi aberto' },
            { value: 'nao', label: <Count label="Não entraram" n={groups?.nao.length} />, title: 'No público, sem acesso desde a publicação' },
          ]}
        />
        <label className="relative w-full sm:w-[260px]">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted">
            <I.search size={14} />
          </span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por e-mail ou nome"
            aria-label="Buscar conta"
            className="field-label h-9 w-full rounded-full bg-transparent pl-9 pr-3 text-[13px] text-text outline-none placeholder:text-text-muted"
            style={{ boxShadow: 'inset 0 0 0 1px rgb(var(--text) / 0.1)' }}
          />
        </label>
      </div>

      {/* tabela */}
      <div className="mt-3 overflow-hidden rounded-[18px]" style={{ background: 'rgb(var(--text) / 0.02)', boxShadow: 'inset 0 0 0 1px rgb(var(--text) / 0.07)' }}>
        <div className={COLS + ' field-label px-4 py-2.5 text-[11.5px] text-text-muted'} style={{ boxShadow: 'inset 0 -1px 0 rgb(var(--text) / 0.07)' }}>
          <span>Conta</span>
          <span className="hidden md:block">Recebeu</span>
          <span className="hidden md:block">Viu pela 1ª vez</span>
          <span className="hidden md:block">Última vez</span>
          <span className="justify-self-end">Vezes</span>
          <span />
        </div>

        {!groups ? (
          <div className="flex flex-col">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="h-[57px]" style={{ boxShadow: 'inset 0 -1px 0 rgb(var(--text) / 0.05)', background: i % 2 ? 'transparent' : 'rgb(var(--text) / 0.015)' }} />
            ))}
          </div>
        ) : list.length === 0 ? (
          <Empty filter={tab} query={query.trim()} popup={a.popup} />
        ) : (
          <ul>
            {list.slice(0, limit).map((l) => (
              <SeenLine key={l.id} line={l} popup={a.popup} open={open === l.id} onToggle={() => setOpen(open === l.id ? null : l.id)} />
            ))}
          </ul>
        )}
      </div>

      {list.length > limit ? (
        <div className="mt-3 flex justify-center">
          <Btn size="sm" onClick={() => setLimit(limit + PAGE)}>
            Mostrar mais {Math.min(PAGE, list.length - limit)} de {list.length - limit}
          </Btn>
        </div>
      ) : null}

      <p className="field-label mt-4 text-[12px] leading-relaxed text-text-muted">
        Cada vez = um login em que a pessoa viu e fechou {a.popup ? 'a janela' : 'o aviso'}. Guardamos os últimos {MAX_DISMISSED_KEYS} logins de cada conta. Fechamentos de antes de 09/10 não tinham a hora gravada.
      </p>
    </div>
  );
}

function Count({ label, n }: { label: string; n: number | undefined }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {label}
      <span className="opacity-60" style={{ fontVariantNumeric: 'tabular-nums' }}>
        {n ?? '·'}
      </span>
    </span>
  );
}

function Tile({ label, value, sub, title, tone, className = '' }: { label: string; value: number | undefined; sub?: string; title?: string; tone?: 'violet'; className?: string }) {
  return (
    <div className={'rounded-[16px] px-4 py-3.5 ' + className} title={title} style={{ background: 'rgb(var(--text) / 0.025)', boxShadow: `inset 0 0 0 1px ${tone ? accent(tone, 0.2) : 'rgb(var(--text) / 0.07)'}` }}>
      <p className="field-label text-[12px] text-text-muted">{label}</p>
      <p className="font-tech mt-1 text-[22px] font-semibold leading-none text-text" style={{ fontVariantNumeric: 'tabular-nums', color: tone && value ? accent(tone) : undefined }}>
        {value ?? '—'}
      </p>
      {/* altura fixa (2 linhas no estreito, 1 no computador): todo cartão do mesmo tamanho */}
      <p className="field-label mt-1.5 line-clamp-2 h-[30px] text-[11.5px] leading-[15px] text-text-muted lg:line-clamp-1 lg:h-[15px]">{sub ?? ''}</p>
    </div>
  );
}

function Empty({ filter, query, popup }: { filter: Filter; query: string; popup: boolean }) {
  const [title, sub] = query
    ? [`Nenhuma conta com “${query}”`, 'Confira o e-mail ou procure em outra aba.']
    : filter === 'viram'
      ? ['Ninguém viu ainda', popup ? 'A janela aparece no próximo acesso de cada conta.' : 'Aparece aqui quando alguém abrir pelo sino.']
      : filter === 'so'
        ? ['Todo mundo que recebeu já viu', 'Quem receber e ainda não fechar aparece aqui.']
        : ['Todo o público já entrou', 'Ninguém do público ficou sem acessar desde a publicação.'];
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      <span className="flex h-11 w-11 items-center justify-center rounded-[14px] text-text-muted" style={{ background: 'rgb(var(--text) / 0.05)', boxShadow: 'inset 0 0 0 1px rgb(var(--text) / 0.08)' }}>
        <I.eye size={18} />
      </span>
      <p className="font-tech mt-4 text-[15px] font-semibold text-text">{title}</p>
      <p className="field-label mt-1 text-[12.5px] text-text-muted">{sub}</p>
    </div>
  );
}

function Avatar({ person }: { person: Person | null }) {
  const letter = (person?.name || person?.email || '?').trim().charAt(0).toUpperCase();
  const a = person?.isAdmin ? 'lime' : 'violet';
  return (
    <span
      className="font-tech flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold"
      style={{ color: accent(a), background: accent(a, 0.12), boxShadow: `inset 0 0 0 1px ${accent(a, 0.25)}` }}
      aria-hidden
    >
      {letter}
    </span>
  );
}

function PlanTag({ person }: { person: Person | null }) {
  if (!person) return null;
  if (person.isAdmin) return <Tag a="lime">Admin</Tag>;
  if (!person.plan) return null;
  return person.plan === 'premium' ? <Tag a="violet">Premium</Tag> : <Tag a="neutral">Free</Tag>;
}

function SeenLine({ line, popup, open, onToggle }: { line: Line; popup: boolean; open: boolean; onToggle: () => void }) {
  const { person, seen } = line;
  const n = seen?.views.length ?? 0;
  const expandable = !!seen && (n > 0 || !!seen.clickedAt || !!seen.deletedAt);
  const email = person?.email ?? `Conta ${line.id.slice(0, 8)}`;
  // o "·" só vem depois do selo de plano (é a única peça que aparece em toda largura)
  const sep = person && (person.isAdmin || person.plan) ? '· ' : '';
  // curto de propósito: cabe ao lado do plano até no celular
  const ago = person?.lastSeenAt ? timeAgo(person.lastSeenAt) : null;
  const status = !seen
    ? ago
      ? `acessou ${ago.includes('/') ? `em ${ago}` : ago}`
      : 'nunca entrou'
    : n === 0
      ? popup
        ? 'ainda não fechou'
        : 'ainda não abriu'
      : null;

  const row = (
    <>
      <span className="flex min-w-0 items-center gap-3">
        <Avatar person={person} />
        <span className="min-w-0">
          <span className="field-label block truncate text-[13px] font-medium text-text">{email}</span>
          <span className="field-label mt-0.5 flex min-w-0 items-center gap-1.5 text-[12px] text-text-muted">
            {/* no estreito o e-mail já identifica: fica plano · hora */}
            {person?.name ? <span className="hidden truncate md:inline">{person.name}</span> : null}
            <PlanTag person={person} />
            {status ? (
              <span className="truncate">
                {sep}
                {status}
              </span>
            ) : null}
            {seen && n > 0 ? (
              <span className="shrink-0 md:hidden" style={{ fontVariantNumeric: 'tabular-nums' }}>
                {sep}
                {short(seen.lastAt)}
              </span>
            ) : null}
          </span>
        </span>
      </span>
      <Cell iso={seen?.deliveredAt} />
      <Cell iso={seen?.firstAt} />
      <Cell iso={seen?.lastAt} />
      <span className="flex items-center justify-self-end">
        {n > 0 ? (
          <Tag a={n >= 2 ? 'violet' : 'neutral'} title={seen!.capped ? `Viu em ${n} logins ou mais` : `Viu em ${n} ${n === 1 ? 'login' : 'logins'}`}>
            {seen!.capped ? `${n}+` : `${n}×`}
          </Tag>
        ) : (
          <span className="field-label text-[12.5px] text-text-muted">—</span>
        )}
      </span>
      <span className="flex justify-end text-text-muted" aria-hidden>
        {expandable ? (
          <span className="transition-transform duration-300" style={{ transform: open ? 'rotate(90deg)' : 'none', transitionTimingFunction: SPRING }}>
            <I.chevron size={14} />
          </span>
        ) : null}
      </span>
    </>
  );

  return (
    <li style={{ boxShadow: 'inset 0 -1px 0 rgb(var(--text) / 0.05)' }}>
      {expandable ? (
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className={COLS + ' w-full px-4 py-3 text-left transition-colors duration-200 hover:bg-[rgb(var(--text)/0.03)]'}
        >
          {row}
        </button>
      ) : (
        <div className={COLS + ' px-4 py-3'}>{row}</div>
      )}
      {open && seen ? <Timeline seen={seen} /> : null}
    </li>
  );
}

function Cell({ iso }: { iso: string | null | undefined }) {
  return (
    <span className="field-label hidden text-[12.5px] text-text md:block" style={{ fontVariantNumeric: 'tabular-nums', color: iso ? undefined : 'rgb(var(--text-muted))' }} title={full(iso)}>
      {short(iso)}
    </span>
  );
}

/** Linha do tempo da conta: começa na mesma vertical do e-mail (16 de margem + 28 do avatar + 12). */
function Timeline({ seen }: { seen: SeenRow }) {
  const events: Array<{ label: string; iso: string | null; tags: React.ReactNode[] }> = seen.views.map((v: SeenView, i) => ({
    label: ordinal(i),
    iso: v.at,
    tags: [
      <Tag key="via" a="neutral">
        {v.via === 'sino' ? 'no sino' : 'janela'}
      </Tag>,
      i > 0 && v.via === 'janela' ? (
        <Tag key="login" a="violet">
          login novo
        </Tag>
      ) : null,
      v.earlier ? (
        <Tag key="earlier" a="amber" title="Foi antes de você usar “Mostrar de novo pra todos”">
          antes de reexibir
        </Tag>
      ) : null,
    ].filter(Boolean),
  }));
  if (seen.clickedAt) events.push({ label: 'Clique', iso: seen.clickedAt, tags: [<Tag key="c" a="lime">clicou no botão</Tag>] });
  if (seen.deletedAt) events.push({ label: 'Sino', iso: seen.deletedAt, tags: [<Tag key="d" a="neutral">apagou do histórico</Tag>] });

  return (
    <div className="pb-3.5 pl-[56px] pr-4">
      <ol className="flex flex-col gap-1.5 border-l pl-3.5" style={{ borderColor: 'rgb(var(--text) / 0.1)' }}>
        {events.map((e, i) => (
          <li key={i} className="grid grid-cols-[64px_minmax(0,1fr)] items-center gap-x-3">
            <span className="field-label text-[12px] text-text-muted">{e.label}</span>
            <span className="flex min-w-0 flex-wrap items-center gap-1.5">
              <span className="field-label text-[12.5px] text-text" style={{ fontVariantNumeric: 'tabular-nums' }} title={e.iso ? timeAgo(e.iso) ?? undefined : undefined}>
                {e.iso ? fmtDateTime(e.iso) : 'hora não registrada'}
              </span>
              {e.tags}
            </span>
          </li>
        ))}
      </ol>
      {seen.capped ? (
        <p className="field-label mt-2 pl-3.5 text-[12px] text-text-muted">Mostrando os últimos {MAX_DISMISSED_KEYS} logins: pode ter visto mais vezes antes.</p>
      ) : null}
    </div>
  );
}
