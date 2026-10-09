'use client';

/**
 * /tools/notificacoes — histórico do sino (toda conta, todo plano).
 *
 * Tudo que o admin mandou pra esta conta fica aqui: lidas e não lidas,
 * agrupadas por dia. Clicar abre o aviso/propaganda de novo do jeito que
 * apareceu na tela; dá pra marcar como lida/não lida, apagar (com desfazer)
 * e limpar as lidas. Os dados vêm de lib/notifications-client (a mesma fonte
 * do sino do topo e da janela na tela).
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Segmented, Shell, Skeleton } from '@/app/admin/_ui/kit';
import { THEME_META, TONE_META, timeLeft, type AvisoContent, type NotifItem, type PromoContent } from '@/lib/announcements';
import {
  clearRead,
  deleteNotification,
  dismissPopup,
  markAllRead,
  markRead,
  markUnread,
  refreshNotifications,
  restoreNotification,
  useNotifications,
} from '@/lib/notifications-client';
import { AvisoWindow, PromoWindow } from '@/components/notifications/AnnouncementHost';
import { AnnIcon, ToneIcon } from '@/components/notifications/templates';

type Filter = 'all' | 'unread' | 'aviso' | 'propaganda';

const TZ = 'America/Sao_Paulo';
const dayKeyFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const hourFmt = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
const dateFmt = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit' });
const longFmt = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });

const dayKey = (t: number) => dayKeyFmt.format(new Date(t));
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 86_400_000);

function when(iso: string, now: number): string {
  const t = Date.parse(iso);
  const s = (now - t) / 1000;
  if (s < 60) return 'agora';
  if (s < 3600) return `há ${Math.floor(s / 60)} min`;
  const diff = daysBetween(dayKey(t), dayKey(now));
  if (diff === 0) return `há ${Math.floor(s / 3600)} h`;
  if (diff === 1) return `ontem às ${hourFmt.format(t)}`;
  return `${dateFmt.format(t)} às ${hourFmt.format(t)}`;
}

function groupOf(iso: string, now: number): string {
  const diff = daysBetween(dayKey(Date.parse(iso)), dayKey(now));
  if (diff <= 0) return 'Hoje';
  if (diff === 1) return 'Ontem';
  if (diff < 7) return 'Últimos 7 dias';
  if (diff < 30) return 'Últimos 30 dias';
  return 'Mais antigas';
}

const GROUP_ORDER = ['Hoje', 'Ontem', 'Últimos 7 dias', 'Últimos 30 dias', 'Mais antigas'];

function itemColor(it: NotifItem): string {
  return it.kind === 'aviso' ? TONE_META[(it.content as AvisoContent).tone].rgb : THEME_META[(it.content as PromoContent).theme].rgb;
}

function kindLabel(it: NotifItem): string {
  if (it.kind === 'aviso') return TONE_META[(it.content as AvisoContent).tone].label;
  return (it.content as PromoContent).badge || 'Destaque';
}

function preview(it: NotifItem): string {
  if (it.kind === 'aviso') return (it.content as AvisoContent).body;
  const c = it.content as PromoContent;
  return c.body || c.bullets.join(' · ');
}

export default function NotificacoesPage() {
  const s = useNotifications();
  const [filter, setFilter] = useState<Filter>('all');
  const [open, setOpen] = useState<NotifItem | null>(null);
  const [undo, setUndo] = useState<NotifItem | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // Página aberta = sincroniza já (o sino pode estar com 30 s de atraso).
  useEffect(() => {
    void refreshNotifications({ force: true });
  }, []);
  // "há 5 min" anda sozinho (folha leve, a cada minuto).
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => setNow(Date.now()), [s.lastSync]);
  useEffect(
    () => () => {
      if (undoTimer.current) clearTimeout(undoTimer.current);
      if (clearTimer.current) clearTimeout(clearTimer.current);
    },
    [],
  );

  const counts = useMemo(
    () => ({
      all: s.items.length,
      unread: s.items.filter((i) => !i.readAt).length,
      aviso: s.items.filter((i) => i.kind === 'aviso').length,
      propaganda: s.items.filter((i) => i.kind === 'propaganda').length,
      read: s.items.filter((i) => !!i.readAt).length,
    }),
    [s.items],
  );

  const groups = useMemo(() => {
    const list = s.items.filter((i) =>
      filter === 'all' ? true : filter === 'unread' ? !i.readAt : i.kind === filter,
    );
    const map = new Map<string, NotifItem[]>();
    for (const it of list) {
      const g = groupOf(it.deliveredAt, now);
      const arr = map.get(g);
      if (arr) arr.push(it);
      else map.set(g, [it]);
    }
    return GROUP_ORDER.filter((g) => map.has(g)).map((g) => ({ label: g, items: map.get(g) as NotifItem[] }));
  }, [s.items, filter, now]);

  function openItem(it: NotifItem) {
    setOpen(it);
    if (!it.readAt) void markRead(it.id);
  }

  function remove(it: NotifItem) {
    const removed = deleteNotification(it.id);
    if (!removed) return;
    setUndo(removed);
    if (undoTimer.current) clearTimeout(undoTimer.current);
    undoTimer.current = setTimeout(() => setUndo(null), 6000);
  }

  function askClear() {
    if (!confirmClear) {
      setConfirmClear(true);
      if (clearTimer.current) clearTimeout(clearTimer.current);
      clearTimer.current = setTimeout(() => setConfirmClear(false), 4000);
      return;
    }
    setConfirmClear(false);
    void clearRead();
  }

  const loading = s.status === 'idle';
  const empty = !loading && s.items.length === 0;

  return (
    <div className="mx-auto w-full max-w-[920px] px-4 md:px-8">
      {/* ═══════ Cabeçalho ═══════ */}
      <header className="flex flex-wrap items-end justify-between gap-5 pt-2">
        <div className="min-w-0">
          <p className="field-label flex items-center gap-2 text-[13px] text-text-muted">
            <span
              aria-hidden
              className="inline-block h-[7px] w-[7px] rounded-full"
              style={{
                background: counts.unread ? 'rgb(var(--violet))' : 'rgb(var(--lime))',
                boxShadow: `0 0 0 3px ${counts.unread ? 'rgb(var(--violet) / 0.2)' : 'rgb(var(--lime) / 0.2)'}`,
              }}
            />
            {loading ? 'Carregando' : counts.unread ? `${counts.unread} ${counts.unread === 1 ? 'não lida' : 'não lidas'}` : 'Tudo lido'}
          </p>
          <h1 className="font-tech mt-2 text-[34px] font-semibold leading-none tracking-[-0.035em] text-text md:text-[44px]">Notificações</h1>
          <p className="field-label mt-2.5 max-w-[56ch] text-[14px] text-text-muted">
            Avisos, novidades e ofertas do Auto Edit pra você. Tudo que chega fica salvo aqui.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <PillButton onClick={() => void markAllRead()} disabled={!counts.unread} icon={<AnnIcon.check size={12} />}>
            Marcar todas como lidas
          </PillButton>
          <PillButton
            onClick={askClear}
            disabled={!counts.read}
            danger={confirmClear}
            icon={<TrashIcon size={14} />}
            title="Apaga do histórico as notificações já lidas"
          >
            {confirmClear ? `Apagar ${counts.read} ${counts.read === 1 ? 'lida' : 'lidas'}?` : 'Limpar lidas'}
          </PillButton>
        </div>
      </header>

      {/* ═══════ Filtro ═══════ */}
      <div className="mt-7 flex flex-wrap items-center justify-between gap-3">
        <div className="-mx-1 max-w-[calc(100%+8px)] overflow-x-auto px-1 py-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <Segmented<Filter>
          value={filter}
          onChange={setFilter}
          activeTone="violet"
          options={[
            { value: 'all', label: <Count label="Todas" n={counts.all} /> },
            { value: 'unread', label: <Count label="Não lidas" n={counts.unread} /> },
            { value: 'aviso', label: <Count label="Avisos" n={counts.aviso} /> },
            { value: 'propaganda', label: <Count label="Destaques" n={counts.propaganda} /> },
          ]}
        />
        </div>
        {s.status === 'error' ? (
          <button
            type="button"
            onClick={() => void refreshNotifications({ force: true })}
            className="field-label text-[12.5px] font-semibold underline-offset-4 hover:underline"
            style={{ color: 'rgb(var(--amber))' }}
          >
            Não deu pra atualizar agora. Tentar de novo
          </button>
        ) : null}
      </div>

      {/* ═══════ Lista ═══════ */}
      <div className="mt-5 flex flex-col gap-7 pb-10">
        {loading ? (
          <Shell>
            <div className="flex flex-col gap-1 p-2">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="flex items-center gap-4 p-3">
                  <Skeleton className="h-10 w-10 shrink-0" />
                  <div className="flex-1">
                    <Skeleton className="h-3.5 w-1/2" />
                    <Skeleton className="mt-2 h-3 w-4/5" />
                  </div>
                </div>
              ))}
            </div>
          </Shell>
        ) : empty ? (
          <EmptyState />
        ) : groups.length === 0 ? (
          <Shell>
            <div className="field-label px-6 py-12 text-center text-[14px] text-text-muted">
              {filter === 'unread' ? 'Nenhuma não lida. Tudo em dia.' : filter === 'aviso' ? 'Nenhum aviso por aqui.' : 'Nenhum destaque por aqui.'}
            </div>
          </Shell>
        ) : (
          groups.map((g) => (
            <section key={g.label} className="fade-in-up">
              <h2 className="field-label mb-2.5 flex items-center gap-2 px-1 text-[13px] font-semibold text-text-muted">
                {g.label}
                <span className="rounded-full px-1.5 text-[11.5px]" style={{ background: 'rgb(var(--text) / 0.06)' }}>
                  {g.items.length}
                </span>
              </h2>
              <Shell>
                <ul className="flex flex-col p-1.5">
                  {g.items.map((it, idx) => (
                    <Row
                      key={it.id}
                      it={it}
                      now={now}
                      first={idx === 0}
                      onOpen={() => openItem(it)}
                      onToggleRead={() => void (it.readAt ? markUnread(it.id) : markRead(it.id))}
                      onDelete={() => remove(it)}
                    />
                  ))}
                </ul>
              </Shell>
            </section>
          ))
        )}
      </div>

      {/* ═══════ Desfazer ═══════ */}
      {undo && typeof document !== 'undefined' ? createPortal(
        <div className="pointer-events-none fixed inset-x-0 bottom-6 z-[60] flex justify-center px-4">
          <div
            role="status"
            className="toast-pop field-label pointer-events-auto flex items-center gap-4 rounded-full bg-bg-elev py-2 pl-5 pr-2 text-[13.5px] text-text"
            style={{ boxShadow: 'inset 0 0 0 1px rgb(var(--text) / 0.1), 0 24px 48px -16px rgb(0 0 0 / 0.6)' }}
          >
            Notificação apagada
            <button
              type="button"
              onClick={() => {
                void restoreNotification(undo);
                setUndo(null);
              }}
              className="h-8 rounded-full px-4 text-[13px] font-semibold transition-colors"
              style={{ color: 'rgb(var(--violet))', background: 'rgb(var(--violet) / 0.12)', boxShadow: 'inset 0 0 0 1px rgb(var(--violet) / 0.28)' }}
            >
              Desfazer
            </button>
          </div>
        </div>,
        document.body,
      ) : null}

      {/* ═══════ Ver de novo ═══════ */}
      {open ? (
        open.kind === 'propaganda' ? (
          <PromoWindow
            key={open.id}
            item={open}
            onFinish={(clicked) => {
              if (clicked) void dismissPopup(open, true);
              setOpen(null);
            }}
          />
        ) : (
          <AvisoWindow
            key={open.id}
            item={open}
            timeLabel={when(open.deliveredAt, now)}
            onFinish={(clicked) => {
              if (clicked) void dismissPopup(open, true);
              setOpen(null);
            }}
          />
        )
      ) : null}
    </div>
  );
}

/* ───────────────────────── Linha ───────────────────────── */

function Row({
  it,
  now,
  first,
  onOpen,
  onToggleRead,
  onDelete,
}: {
  it: NotifItem;
  now: number;
  first: boolean;
  onOpen: () => void;
  onToggleRead: () => void;
  onDelete: () => void;
}) {
  const unread = !it.readAt;
  const color = itemColor(it);
  const text = preview(it);
  const promo = it.kind === 'propaganda' ? (it.content as PromoContent) : null;
  const left = promo && it.live ? timeLeft(it.endsAt, now) : null;

  return (
    <li
      className={'group relative grid grid-cols-[auto_minmax(0,1fr)] items-start gap-3.5 rounded-[14px] p-3 transition-colors duration-300 hover:bg-[rgb(var(--text)/0.035)] md:gap-4 md:p-3.5 ' + (first ? '' : 'mt-px')}
      style={{
        background: unread ? 'rgb(var(--violet) / 0.045)' : undefined,
        ['--ann' as string]: color,
      }}
    >
      {!first ? <span aria-hidden className="absolute inset-x-3 -top-px h-px bg-[rgb(var(--text)/0.06)]" /> : null}

      <button type="button" onClick={onOpen} className="relative mt-0.5" tabIndex={-1} aria-hidden>
        <span className="ann-tile !h-10 !w-10 !rounded-[12px]">
          {it.kind === 'aviso' ? <ToneIcon tone={(it.content as AvisoContent).tone} size={18} /> : <AnnIcon.megaphone size={18} />}
        </span>
        {unread ? (
          <span
            className="absolute -right-[3px] -top-[3px] h-[11px] w-[11px] rounded-full"
            style={{ background: 'rgb(var(--violet))', boxShadow: '0 0 0 2.5px rgb(var(--bg-soft))' }}
          />
        ) : null}
      </button>

      <div className="min-w-0">
        <button type="button" onClick={onOpen} className="block w-full min-w-0 text-left" aria-label={`${unread ? 'Não lida: ' : ''}${it.content.title}. Abrir`}>
          <span className="flex min-w-0 items-start gap-3">
            <span
              className={'font-tech line-clamp-2 min-w-0 flex-1 text-[14.5px] leading-snug tracking-[-0.01em] text-text ' + (unread ? 'font-semibold' : 'font-medium opacity-90')}
            >
              {it.content.title}
            </span>
            <span className="field-label mt-[2px] shrink-0 text-[12px] text-text-muted" title={longFmt.format(new Date(it.deliveredAt))}>
              {when(it.deliveredAt, now)}
            </span>
          </span>
          {text ? <span className="field-label mt-1 line-clamp-2 block text-[13px] leading-relaxed text-text-muted">{text}</span> : null}
        </button>
        <div className="mt-2 flex min-h-8 flex-wrap items-center gap-1.5">
          <span
            className="field-label inline-flex items-center rounded-[7px] px-2 py-[3px] text-[11.5px] font-semibold leading-none"
            style={{ color: 'rgb(var(--ann))', background: 'rgb(var(--ann) / 0.1)', boxShadow: 'inset 0 0 0 1px rgb(var(--ann) / 0.22)' }}
          >
            {kindLabel(it)}
          </span>
          {promo ? (
            it.live ? (
              <span
                className="field-label inline-flex items-center gap-1.5 rounded-[7px] px-2 py-[3px] text-[11.5px] font-semibold leading-none"
                style={{ color: 'rgb(var(--lime))', background: 'rgb(var(--lime) / 0.1)', boxShadow: 'inset 0 0 0 1px rgb(var(--lime) / 0.22)' }}
              >
                <span className="h-[5px] w-[5px] rounded-full" style={{ background: 'rgb(var(--lime))' }} />
                {left ? `Ativa · termina em ${left}` : 'Ativa'}
              </span>
            ) : (
              <span className="field-label inline-flex items-center rounded-[7px] px-2 py-[3px] text-[11.5px] font-semibold leading-none text-text-muted" style={{ background: 'rgb(var(--text) / 0.06)' }}>
                Encerrada
              </span>
            )
          ) : null}
          <span className="ml-auto flex items-center gap-1 transition-opacity duration-300 group-focus-within:opacity-100 group-hover:opacity-100 [@media(hover:hover)]:opacity-0">
            <RowIcon title={unread ? 'Marcar como lida' : 'Marcar como não lida'} onClick={onToggleRead}>
              {unread ? <AnnIcon.check size={14} /> : <UnreadIcon />}
            </RowIcon>
            <RowIcon title="Apagar" onClick={onDelete} danger>
              <TrashIcon size={15} />
            </RowIcon>
          </span>
        </div>
      </div>
    </li>
  );
}

/* ───────────────────────── Peças ───────────────────────── */

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

function PillButton({
  onClick,
  disabled,
  icon,
  children,
  danger,
  title,
}: {
  onClick: () => void;
  disabled?: boolean;
  icon: React.ReactNode;
  children: React.ReactNode;
  danger?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="group field-label inline-flex h-9 items-center gap-2 rounded-full pl-1 pr-4 text-[13px] font-semibold transition-[transform,background-color,color] duration-300 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-40"
      style={{
        color: danger ? 'rgb(232 92 104)' : 'rgb(var(--text))',
        background: danger ? 'rgb(232 92 104 / 0.1)' : 'rgb(var(--text) / 0.05)',
        boxShadow: `inset 0 0 0 1px ${danger ? 'rgb(232 92 104 / 0.3)' : 'rgb(var(--text) / 0.1)'}`,
        transitionTimingFunction: 'cubic-bezier(.32,.72,0,1)',
      }}
    >
      <span
        className="flex h-7 w-7 items-center justify-center rounded-full transition-transform duration-300 group-hover:scale-105"
        style={{ background: danger ? 'rgb(232 92 104 / 0.14)' : 'rgb(var(--text) / 0.08)' }}
      >
        {icon}
      </span>
      {children}
    </button>
  );
}

function RowIcon({ title, onClick, children, danger }: { title: string; onClick: () => void; children: React.ReactNode; danger?: boolean }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className={
        'flex h-8 w-8 items-center justify-center rounded-full text-text-muted transition-[background-color,color,transform] duration-300 active:scale-[0.92] ' +
        (danger ? 'hover:bg-[rgb(232_92_104/0.12)] hover:text-[rgb(232_92_104)]' : 'hover:bg-[rgb(var(--text)/0.08)] hover:text-text')
      }
    >
      {children}
    </button>
  );
}

function TrashIcon({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4.5 7h15M10 7V4.5h4V7M6.5 7l1 13h9l1-13M10 11v5.5M14 11v5.5" />
    </svg>
  );
}

function UnreadIcon() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
      <circle cx="12" cy="12" r="7.5" />
      <circle cx="12" cy="12" r="3" fill="currentColor" stroke="none" />
    </svg>
  );
}

function EmptyState() {
  return (
    <Shell>
      <div className="flex flex-col items-center px-6 py-16 text-center">
        <div className="relative flex h-[120px] w-[120px] items-center justify-center" aria-hidden>
          <svg width="120" height="120" viewBox="0 0 120 120" fill="none" className="absolute inset-0">
            <circle cx="60" cy="60" r="58" stroke="rgb(var(--text) / 0.05)" />
            <circle cx="60" cy="60" r="44" stroke="rgb(var(--text) / 0.07)" />
            <circle cx="60" cy="60" r="30" fill="rgb(var(--violet) / 0.08)" stroke="rgb(var(--violet) / 0.25)" />
            <circle cx="60" cy="2" r="2.5" fill="rgb(var(--violet))" />
            <circle cx="104" cy="60" r="2" fill="rgb(var(--lime))" />
          </svg>
          <span className="relative" style={{ color: 'rgb(var(--violet))' }}>
            <AnnIcon.bell size={26} />
          </span>
        </div>
        <h2 className="font-tech mt-6 text-[19px] font-semibold tracking-[-0.02em] text-text">Nada por aqui ainda</h2>
        <p className="field-label mt-2 max-w-[42ch] text-[14px] leading-relaxed text-text-muted">
          Quando chegar um aviso, uma novidade ou uma oferta do Auto Edit, ela aparece aqui e fica salva pra você ver quando quiser.
        </p>
      </div>
    </Shell>
  );
}
