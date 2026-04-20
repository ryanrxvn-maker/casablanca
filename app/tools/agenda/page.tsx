'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ToolShell } from '@/components/ToolShell';
import { createClient } from '@/lib/supabase/client';
import {
  AgendaTask,
  AgendaOccurrence,
  AgendaEvent,
  OccStatus,
  Recurrence,
  Urgency,
  URGENCY_META,
  STATUS_META,
  addDays,
  computeStats,
  endOfMonth,
  expandEvents,
  parseYmd,
  sameDate,
  startOfDay,
  startOfMonth,
  startOfWeek,
  toCsv,
  ymd,
} from '@/lib/agenda';
import { downloadBlob } from '@/lib/audio-engine';

type View = 'day' | 'week' | 'month';

type TaskDraft = {
  id: string | null;
  title: string;
  description: string;
  urgency: Urgency;
  recurrence: Recurrence;
  start_date: string;
  start_time: string;
  duration_min: string;
  weekdays: number[];
  end_date: string;
  notify: boolean;
  notify_offset: string;
};

const WEEKDAY_LABEL = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
const WEEKDAY_FULL = [
  'Domingo',
  'Segunda',
  'Terca',
  'Quarta',
  'Quinta',
  'Sexta',
  'Sabado',
];
const MONTH_LABEL = [
  'Janeiro',
  'Fevereiro',
  'Marco',
  'Abril',
  'Maio',
  'Junho',
  'Julho',
  'Agosto',
  'Setembro',
  'Outubro',
  'Novembro',
  'Dezembro',
];

function emptyDraft(date: Date): TaskDraft {
  return {
    id: null,
    title: '',
    description: '',
    urgency: 'normal',
    recurrence: 'once',
    start_date: ymd(date),
    start_time: '',
    duration_min: '',
    weekdays: [],
    end_date: '',
    notify: false,
    notify_offset: '10',
  };
}

function draftFromTask(t: AgendaTask): TaskDraft {
  return {
    id: t.id,
    title: t.title,
    description: t.description ?? '',
    urgency: t.urgency,
    recurrence: t.recurrence,
    start_date: t.start_date,
    start_time: t.start_time ?? '',
    duration_min: t.duration_min ? String(t.duration_min) : '',
    weekdays: t.weekdays
      ? t.weekdays
          .split(',')
          .map((s) => parseInt(s.trim(), 10))
          .filter((n) => !isNaN(n))
      : [],
    end_date: t.end_date ?? '',
    notify: t.notify,
    notify_offset: t.notify_offset ? String(t.notify_offset) : '10',
  };
}

export default function AgendaPage() {
  const supabase = useMemo(() => createClient(), []);
  const [userId, setUserId] = useState<string | null>(null);
  const [tasks, setTasks] = useState<AgendaTask[]>([]);
  const [occurrences, setOccurrences] = useState<AgendaOccurrence[]>([]);
  const [view, setView] = useState<View>('week');
  const [anchor, setAnchor] = useState<Date>(startOfDay(new Date()));
  const [draft, setDraft] = useState<TaskDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [now, setNow] = useState<Date>(new Date());
  const [toast, setToast] = useState<string | null>(null);
  const notifiedRef = useRef<Set<string>>(new Set());

  function flashToast(msg: string, ms = 2400) {
    setToast(msg);
    setTimeout(() => setToast((cur) => (cur === msg ? null : cur)), ms);
  }

  // ---- load user + data ----
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) {
        setLoading(false);
        return;
      }
      if (cancelled) return;
      setUserId(u.user.id);
      await reload(u.user.id);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function reload(uid: string) {
    setLoading(true);
    const [tRes, oRes] = await Promise.all([
      supabase
        .from('agenda_tasks')
        .select('*')
        .eq('user_id', uid)
        .order('start_date', { ascending: true }),
      supabase.from('agenda_occurrences').select('*').eq('user_id', uid),
    ]);
    if (tRes.error) {
      console.error('[agenda] reload tasks error:', tRes.error);
      flashToast('Erro ao carregar tarefas: ' + tRes.error.message);
    }
    if (oRes.error) {
      console.error('[agenda] reload occurrences error:', oRes.error);
    }
    setTasks((tRes.data as AgendaTask[]) ?? []);
    setOccurrences((oRes.data as AgendaOccurrence[]) ?? []);
    setLoading(false);
  }

  // ---- range based on view ----
  const range = useMemo(() => {
    if (view === 'day') return { from: anchor, to: anchor };
    if (view === 'week') {
      const s = startOfWeek(anchor, 0);
      return { from: s, to: addDays(s, 6) };
    }
    const s = startOfMonth(anchor);
    const e = endOfMonth(anchor);
    return {
      from: startOfWeek(s, 0),
      to: addDays(startOfWeek(addDays(e, 6), 0), 6),
    };
  }, [view, anchor]);

  const events = useMemo(
    () => expandEvents(tasks, occurrences, range.from, range.to),
    [tasks, occurrences, range],
  );

  const stats = useMemo(() => computeStats(events), [events]);

  // ---- realtime-ish clock for notifications + "now" indicator ----
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  // ---- browser notifications ----
  useEffect(() => {
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    const nowStr = ymd(now);
    const todayEvents = events.filter(
      (e) => e.date === nowStr && e.task.notify && e.task.start_time,
    );
    for (const ev of todayEvents) {
      const [h, m] = (ev.task.start_time || '00:00').split(':').map(Number);
      const target = new Date(now);
      target.setHours(h || 0, m || 0, 0, 0);
      const offset = (ev.task.notify_offset ?? 10) * 60_000;
      const diff = target.getTime() - now.getTime();
      const key = ev.task.id + '|' + ev.date;
      if (
        diff <= offset &&
        diff > -5 * 60_000 &&
        !notifiedRef.current.has(key) &&
        ev.status === 'pending'
      ) {
        notifiedRef.current.add(key);
        try {
          if (Notification.permission === 'granted') {
            new Notification(ev.task.title, {
              body:
                'Hoje as ' +
                (ev.task.start_time ?? '--:--') +
                (ev.task.description ? ' - ' + ev.task.description : ''),
            });
          }
        } catch {
          // noop
        }
      }
    }
  }, [now, events]);

  async function requestNotifications() {
    if (!('Notification' in window)) return;
    try {
      await Notification.requestPermission();
    } catch {
      // ignore
    }
  }

  // ---- CRUD ----
  async function saveDraft() {
    if (!draft || !userId) return;
    if (!draft.title.trim()) {
      setSaveError('O titulo e obrigatorio.');
      return;
    }
    setSaving(true);
    setSaveError(null);
    const payload = {
      user_id: userId,
      title: draft.title.trim(),
      description: draft.description.trim() || null,
      urgency: draft.urgency,
      recurrence: draft.recurrence,
      start_date: draft.start_date,
      start_time: draft.start_time || null,
      duration_min: draft.duration_min ? parseInt(draft.duration_min, 10) : null,
      weekdays:
        draft.weekdays.length > 0
          ? draft.weekdays.slice().sort((a, b) => a - b).join(',')
          : null,
      end_date: draft.end_date || null,
      notify: draft.notify,
      notify_offset: draft.notify_offset
        ? parseInt(draft.notify_offset, 10)
        : 10,
    };
    try {
      const res = draft.id
        ? await supabase.from('agenda_tasks').update(payload).eq('id', draft.id)
        : await supabase.from('agenda_tasks').insert(payload);
      if (res.error) {
        console.error('[agenda] saveDraft error:', res.error);
        setSaveError(res.error.message);
        return;
      }
      // Move a visao pra data da tarefa pro usuario VER a tarefa que criou.
      const targetDate = parseYmd(payload.start_date);
      setAnchor(startOfDay(targetDate));
      await reload(userId);
      setDraft(null);
      flashToast(draft.id ? 'Tarefa atualizada.' : 'Tarefa criada.');
    } catch (e) {
      console.error('[agenda] saveDraft exception:', e);
      setSaveError((e as Error).message ?? 'Erro ao salvar.');
    } finally {
      setSaving(false);
    }
  }

  async function deleteDraft() {
    if (!draft?.id || !userId) return;
    if (!confirm('Excluir esta tarefa? Todas as ocorrencias serao removidas.'))
      return;
    setSaving(true);
    try {
      await supabase.from('agenda_tasks').delete().eq('id', draft.id);
      await reload(userId);
      setDraft(null);
    } finally {
      setSaving(false);
    }
  }

  async function setStatus(ev: AgendaEvent, status: OccStatus) {
    if (!userId) return;
    const existing = occurrences.find(
      (o) => o.task_id === ev.task.id && o.occurrence_date === ev.date,
    );
    const now_ = new Date().toISOString();
    if (existing) {
      await supabase
        .from('agenda_occurrences')
        .update({ status, completed_at: now_ })
        .eq('id', existing.id);
    } else {
      await supabase.from('agenda_occurrences').insert({
        task_id: ev.task.id,
        user_id: userId,
        occurrence_date: ev.date,
        status,
        completed_at: now_,
      });
    }
    await reload(userId);
  }

  async function moveEvent(ev: AgendaEvent, targetDateStr: string) {
    if (!userId) return;
    if (ev.task.recurrence !== 'once') return;
    if (ev.task.start_date === targetDateStr) return;
    await supabase
      .from('agenda_tasks')
      .update({ start_date: targetDateStr })
      .eq('id', ev.task.id);
    await reload(userId);
  }

  // ---- navigation ----
  function navigate(dir: -1 | 0 | 1) {
    if (dir === 0) return setAnchor(startOfDay(new Date()));
    if (view === 'day') return setAnchor(addDays(anchor, dir));
    if (view === 'week') return setAnchor(addDays(anchor, dir * 7));
    const d = new Date(anchor);
    d.setMonth(d.getMonth() + dir);
    setAnchor(startOfDay(d));
  }

  function exportCsv() {
    const csv = toCsv(events);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    downloadBlob(blob, 'agenda_' + ymd(range.from) + '_a_' + ymd(range.to) + '.csv');
  }

  // ---- render ----
  const headerLabel = useMemo(() => {
    if (view === 'day')
      return WEEKDAY_FULL[anchor.getDay()] + ', ' + anchor.getDate() + ' ' +
        MONTH_LABEL[anchor.getMonth()];
    if (view === 'week') {
      const s = startOfWeek(anchor, 0);
      const e = addDays(s, 6);
      return (
        s.getDate() +
        ' ' +
        MONTH_LABEL[s.getMonth()].slice(0, 3) +
        ' - ' +
        e.getDate() +
        ' ' +
        MONTH_LABEL[e.getMonth()].slice(0, 3)
      );
    }
    return MONTH_LABEL[anchor.getMonth()] + ' ' + anchor.getFullYear();
  }, [anchor, view]);

  return (
    <ToolShell
      title="Agenda"
      description="Seu planner diario. Urgencias, recorrencias, notificacoes e relatorio em tempo real."
    >
      <div className="flex flex-col gap-6">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <button
              className="btn-secondary !py-1 !px-3 text-xs"
              onClick={() => navigate(-1)}
            >
              {'<'}
            </button>
            <button
              className="btn-secondary !py-1 !px-3 text-xs"
              onClick={() => navigate(0)}
            >
              Hoje
            </button>
            <button
              className="btn-secondary !py-1 !px-3 text-xs"
              onClick={() => navigate(1)}
            >
              {'>'}
            </button>
            <span className="ml-2 text-sm font-semibold text-white">
              {headerLabel}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex overflow-hidden rounded-[12px] border border-line">
              {(['day', 'week', 'month'] as const).map((v) => (
                <button
                  key={v}
                  className={
                    'px-3 py-1.5 text-xs ' +
                    (view === v
                      ? 'bg-lime text-black font-semibold'
                      : 'text-text-muted hover:text-white')
                  }
                  onClick={() => setView(v)}
                >
                  {v === 'day' ? 'Dia' : v === 'week' ? 'Semana' : 'Mes'}
                </button>
              ))}
            </div>
            <button
              className="btn-primary !py-1.5 !px-3 text-xs"
              onClick={() => setDraft(emptyDraft(anchor))}
            >
              + Nova tarefa
            </button>
          </div>
        </div>

        {/* Stats + controls row */}
        <div className="grid gap-4 md:grid-cols-[auto_1fr]">
          <StatsDonut stats={stats} />
          <div className="flex flex-col gap-3 rounded-[12px] border border-line bg-bg p-4">
            <div>
              <div className="text-xs uppercase tracking-widest text-text-muted">
                Range atual
              </div>
              <div className="mt-1 text-sm text-white">
                {ymd(range.from)} a {ymd(range.to)} - {stats.total} ocorrencias
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                className="btn-secondary !py-1.5 !px-3 text-xs"
                onClick={requestNotifications}
              >
                Ativar notificacoes
              </button>
              <button
                className="btn-secondary !py-1.5 !px-3 text-xs"
                onClick={exportCsv}
                disabled={events.length === 0}
              >
                Exportar CSV
              </button>
            </div>
            <LegendBar />
          </div>
        </div>

        {/* Calendar body */}
        {loading ? (
          <div className="rounded-[12px] border border-line bg-bg p-8 text-center text-sm text-text-muted">
            Carregando agenda...
          </div>
        ) : view === 'month' ? (
          <MonthGrid
            anchor={anchor}
            events={events}
            onClickDay={(d) => {
              setAnchor(d);
              setView('day');
            }}
            onClickEvent={(ev) => setDraft(draftFromTask(ev.task))}
            onDropTo={(date, ev) => moveEvent(ev, date)}
          />
        ) : view === 'week' ? (
          <WeekGrid
            anchor={anchor}
            events={events}
            now={now}
            onClickEvent={(ev) => setDraft(draftFromTask(ev.task))}
            onSetStatus={setStatus}
            onDropTo={(date, ev) => moveEvent(ev, date)}
          />
        ) : (
          <DayList
            anchor={anchor}
            events={events}
            onClickEvent={(ev) => setDraft(draftFromTask(ev.task))}
            onSetStatus={setStatus}
          />
        )}
      </div>

      {draft ? (
        <TaskModal
          draft={draft}
          setDraft={setDraft}
          onSave={saveDraft}
          onDelete={deleteDraft}
          saving={saving}
          error={saveError}
          onClose={() => {
            setDraft(null);
            setSaveError(null);
          }}
        />
      ) : null}

      {toast ? (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 rounded-full border border-lime/40 bg-bg px-4 py-2 text-xs text-lime shadow-2xl">
          {toast}
        </div>
      ) : null}
    </ToolShell>
  );
}

// =========================================================================
// StatsDonut
// =========================================================================
function StatsDonut({
  stats,
}: {
  stats: ReturnType<typeof computeStats>;
}) {
  const total = Math.max(stats.total, 1);
  const segs = [
    { key: 'on_time', val: stats.on_time },
    { key: 'delayed', val: stats.delayed },
    { key: 'refactor', val: stats.refactor },
    { key: 'skipped', val: stats.skipped },
    { key: 'pending', val: stats.pending },
  ] as const;
  const R = 52;
  const C = 2 * Math.PI * R;
  let offset = 0;
  return (
    <div className="flex items-center gap-4 rounded-[12px] border border-line bg-bg p-4">
      <svg viewBox="0 0 140 140" className="h-32 w-32">
        <circle
          cx="70"
          cy="70"
          r={R}
          stroke="#1f2937"
          strokeWidth="16"
          fill="none"
        />
        {segs.map((s) => {
          if (s.val === 0) return null;
          const frac = s.val / total;
          const len = C * frac;
          const el = (
            <circle
              key={s.key}
              cx="70"
              cy="70"
              r={R}
              stroke={STATUS_META[s.key].hex}
              strokeWidth="16"
              fill="none"
              strokeDasharray={len + ' ' + (C - len)}
              strokeDashoffset={-offset}
              transform="rotate(-90 70 70)"
              strokeLinecap="butt"
            />
          );
          offset += len;
          return el;
        })}
        <text
          x="70"
          y="68"
          textAnchor="middle"
          fontSize="22"
          fontWeight="700"
          fill="#ffffff"
        >
          {stats.total}
        </text>
        <text
          x="70"
          y="86"
          textAnchor="middle"
          fontSize="10"
          fill="#9ca3af"
        >
          tarefas
        </text>
      </svg>
      <div className="flex flex-col gap-1 text-xs">
        {segs.map((s) => (
          <div key={s.key} className="flex items-center gap-2">
            <span
              className="h-2 w-2 rounded-full"
              style={{ background: STATUS_META[s.key].hex }}
            />
            <span className={STATUS_META[s.key].color}>
              {STATUS_META[s.key].label}
            </span>
            <span className="mono ml-auto text-text-muted">{s.val}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// =========================================================================
// LegendBar
// =========================================================================
function LegendBar() {
  return (
    <div className="flex flex-wrap gap-2 text-[11px]">
      {(Object.keys(URGENCY_META) as Urgency[]).map((u) => (
        <span
          key={u}
          className={
            'rounded-full border px-2 py-0.5 ' + URGENCY_META[u].color
          }
        >
          {URGENCY_META[u].label}
        </span>
      ))}
    </div>
  );
}

// =========================================================================
// MonthGrid
// =========================================================================
function MonthGrid({
  anchor,
  events,
  onClickDay,
  onClickEvent,
  onDropTo,
}: {
  anchor: Date;
  events: AgendaEvent[];
  onClickDay: (d: Date) => void;
  onClickEvent: (ev: AgendaEvent) => void;
  onDropTo: (date: string, ev: AgendaEvent) => void;
}) {
  const first = startOfMonth(anchor);
  const gridStart = startOfWeek(first, 0);
  const cells: Date[] = [];
  for (let i = 0; i < 42; i++) cells.push(addDays(gridStart, i));
  const byDay = new Map<string, AgendaEvent[]>();
  for (const ev of events) {
    const arr = byDay.get(ev.date) ?? [];
    arr.push(ev);
    byDay.set(ev.date, arr);
  }

  return (
    <div className="rounded-[12px] border border-line bg-bg">
      <div className="grid grid-cols-7 border-b border-line text-center text-[11px] uppercase tracking-widest text-text-muted">
        {WEEKDAY_LABEL.map((w, i) => (
          <div key={i} className="py-2">
            {w}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {cells.map((d, i) => {
          const inMonth = d.getMonth() === anchor.getMonth();
          const isToday = sameDate(d, new Date());
          const list = byDay.get(ymd(d)) ?? [];
          return (
            <div
              key={i}
              onClick={() => onClickDay(d)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const id = e.dataTransfer.getData('text/plain');
                const ev = events.find((x) => x.task.id === id);
                if (ev) onDropTo(ymd(d), ev);
              }}
              className={
                'group min-h-[88px] cursor-pointer border-b border-r border-line p-1 transition hover:bg-bg/60 ' +
                (inMonth ? '' : 'bg-black/40 text-text-muted ')
              }
            >
              <div
                className={
                  'mb-1 flex items-center justify-between text-[11px] ' +
                  (isToday ? 'text-lime font-bold' : 'text-text-muted')
                }
              >
                <span>{d.getDate()}</span>
                {list.length > 0 ? (
                  <span className="mono">{list.length}</span>
                ) : null}
              </div>
              <div className="flex flex-col gap-0.5">
                {list.slice(0, 3).map((ev, j) => (
                  <div
                    key={j}
                    draggable={ev.task.recurrence === 'once'}
                    onDragStart={(e) => {
                      e.dataTransfer.setData('text/plain', ev.task.id);
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      onClickEvent(ev);
                    }}
                    className={
                      'truncate rounded-[4px] border px-1 py-0.5 text-[10px] ' +
                      URGENCY_META[ev.task.urgency].color
                    }
                    title={ev.task.title}
                  >
                    {ev.task.start_time ? ev.task.start_time + ' ' : ''}
                    {ev.task.title}
                  </div>
                ))}
                {list.length > 3 ? (
                  <div className="text-[10px] text-text-muted">
                    +{list.length - 3}
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// =========================================================================
// WeekGrid
// =========================================================================
function WeekGrid({
  anchor,
  events,
  now,
  onClickEvent,
  onSetStatus,
  onDropTo,
}: {
  anchor: Date;
  events: AgendaEvent[];
  now: Date;
  onClickEvent: (ev: AgendaEvent) => void;
  onSetStatus: (ev: AgendaEvent, s: OccStatus) => void;
  onDropTo: (date: string, ev: AgendaEvent) => void;
}) {
  const start = startOfWeek(anchor, 0);
  const days: Date[] = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  return (
    <div className="grid grid-cols-7 gap-2">
      {days.map((d) => {
        const dayEvents = events
          .filter((e) => e.date === ymd(d))
          .sort((a, b) =>
            (a.task.start_time ?? '99:99').localeCompare(
              b.task.start_time ?? '99:99',
            ),
          );
        const isToday = sameDate(d, now);
        return (
          <div
            key={d.toISOString()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const id = e.dataTransfer.getData('text/plain');
              const ev = events.find((x) => x.task.id === id);
              if (ev) onDropTo(ymd(d), ev);
            }}
            className={
              'flex min-h-[260px] flex-col rounded-[12px] border bg-bg p-2 ' +
              (isToday ? 'border-lime/60 ring-1 ring-lime/30' : 'border-line')
            }
          >
            <div className="mb-2 border-b border-line pb-1 text-[11px] uppercase tracking-widest text-text-muted">
              <span>{WEEKDAY_LABEL[d.getDay()]}</span>{' '}
              <span className={isToday ? 'text-lime' : 'text-white'}>
                {d.getDate()}
              </span>
            </div>
            <div className="flex flex-col gap-1.5">
              {dayEvents.length === 0 ? (
                <div className="text-[10px] text-text-muted">Sem tarefas</div>
              ) : (
                dayEvents.map((ev, i) => (
                  <EventCard
                    key={ev.task.id + ':' + i}
                    ev={ev}
                    onClick={() => onClickEvent(ev)}
                    onSetStatus={(s) => onSetStatus(ev, s)}
                  />
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// =========================================================================
// DayList
// =========================================================================
function DayList({
  anchor,
  events,
  onClickEvent,
  onSetStatus,
}: {
  anchor: Date;
  events: AgendaEvent[];
  onClickEvent: (ev: AgendaEvent) => void;
  onSetStatus: (ev: AgendaEvent, s: OccStatus) => void;
}) {
  const dayStr = ymd(anchor);
  const list = events
    .filter((e) => e.date === dayStr)
    .sort((a, b) =>
      (a.task.start_time ?? '99:99').localeCompare(b.task.start_time ?? '99:99'),
    );

  if (list.length === 0) {
    return (
      <div className="rounded-[12px] border border-line bg-bg p-8 text-center text-sm text-text-muted">
        Nada agendado pra este dia. Crie uma nova tarefa para comecar.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {list.map((ev, i) => (
        <EventCard
          key={ev.task.id + ':' + i}
          ev={ev}
          big
          onClick={() => onClickEvent(ev)}
          onSetStatus={(s) => onSetStatus(ev, s)}
        />
      ))}
    </div>
  );
}

// =========================================================================
// EventCard
// =========================================================================
function EventCard({
  ev,
  big,
  onClick,
  onSetStatus,
}: {
  ev: AgendaEvent;
  big?: boolean;
  onClick: () => void;
  onSetStatus: (s: OccStatus) => void;
}) {
  const urg = URGENCY_META[ev.task.urgency];
  const st = STATUS_META[ev.status];
  return (
    <div
      draggable={ev.task.recurrence === 'once'}
      onDragStart={(e) => e.dataTransfer.setData('text/plain', ev.task.id)}
      className={
        'group rounded-[10px] border bg-bg p-2 text-left transition hover:border-lime/60 ' +
        URGENCY_META[ev.task.urgency].color
      }
    >
      <button
        type="button"
        onClick={onClick}
        className="flex w-full flex-col items-start text-left"
      >
        <div className="flex w-full items-center gap-2">
          <span
            className={'h-2 w-2 shrink-0 rounded-full ' + urg.dot}
            aria-hidden
          />
          <span
            className={
              'min-w-0 flex-1 truncate font-semibold ' +
              (big ? 'text-sm' : 'text-xs')
            }
          >
            {ev.task.title}
          </span>
          {ev.task.start_time ? (
            <span className="mono shrink-0 text-[10px] text-text-muted">
              {ev.task.start_time}
            </span>
          ) : null}
        </div>
        {big && ev.task.description ? (
          <div className="mt-1 text-[11px] text-text-muted">
            {ev.task.description}
          </div>
        ) : null}
      </button>
      <div className="mt-2 flex items-center justify-between gap-1">
        <span className={'text-[10px] ' + st.color}>{st.label}</span>
        <div className="flex gap-1">
          {(
            [
              ['on_time', 'OK'],
              ['delayed', 'Atraso'],
              ['refactor', 'Refazer'],
            ] as const
          ).map(([s, label]) => (
            <button
              key={s}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onSetStatus(s);
              }}
              className={
                'rounded-[6px] border px-1.5 py-0.5 text-[10px] transition hover:border-lime ' +
                (ev.status === s
                  ? 'border-lime text-lime'
                  : 'border-line text-text-muted')
              }
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// =========================================================================
// TaskModal
// =========================================================================
function TaskModal({
  draft,
  setDraft,
  onSave,
  onDelete,
  onClose,
  saving,
  error,
}: {
  draft: TaskDraft;
  setDraft: (d: TaskDraft | null) => void;
  onSave: () => void;
  onDelete: () => void;
  onClose: () => void;
  saving: boolean;
  error?: string | null;
}) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  function update<K extends keyof TaskDraft>(k: K, v: TaskDraft[K]) {
    setDraft({ ...draft, [k]: v });
  }

  function toggleWeekday(n: number) {
    const has = draft.weekdays.includes(n);
    update(
      'weekdays',
      has ? draft.weekdays.filter((x) => x !== n) : [...draft.weekdays, n],
    );
  }

  const showWeekdays =
    draft.recurrence === 'daily' ||
    draft.recurrence === 'weekly' ||
    draft.recurrence === 'biweekly';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onMouseDown={onClose}
    >
      <div
        className="w-full max-w-xl overflow-y-auto rounded-[16px] border border-line bg-surface p-6 shadow-2xl"
        style={{ maxHeight: '92vh' }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-white">
            {draft.id ? 'Editar tarefa' : 'Nova tarefa'}
          </h2>
          <button
            className="btn-ghost !py-1 text-xs"
            onClick={onClose}
            type="button"
          >
            Fechar
          </button>
        </div>

        <div className="flex flex-col gap-4">
          <div>
            <label className="label-field">Titulo</label>
            <input
              type="text"
              value={draft.title}
              onChange={(e) => update('title', e.target.value)}
              className="input-field"
              placeholder="Ex: Edit do podcast semanal"
              autoFocus
            />
          </div>

          <div>
            <label className="label-field">Descricao (opcional)</label>
            <textarea
              value={draft.description}
              onChange={(e) => update('description', e.target.value)}
              className="input-field min-h-[70px]"
              placeholder="Detalhes, links, briefing..."
            />
          </div>

          <div>
            <label className="label-field">Urgencia</label>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(URGENCY_META) as Urgency[]).map((u) => (
                <button
                  key={u}
                  type="button"
                  onClick={() => update('urgency', u)}
                  className={
                    'rounded-[10px] border px-3 py-1.5 text-xs ' +
                    (draft.urgency === u
                      ? URGENCY_META[u].color + ' ring-1 ' + URGENCY_META[u].ring
                      : 'border-line-strong text-text-muted hover:text-white')
                  }
                >
                  {URGENCY_META[u].label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="label-field">Repeticao</label>
            <div className="flex flex-wrap gap-2">
              {(
                [
                  ['once', 'Uma vez'],
                  ['daily', 'Todo dia'],
                  ['weekly', 'Semanal'],
                  ['biweekly', 'Quinzenal'],
                ] as const
              ).map(([r, label]) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => {
                    // Quando troca pra weekly/biweekly e nao ha weekdays,
                    // pre-seleciona o dia da semana da data inicial pra nao
                    // dar confusao ("porque minha tarefa nao aparece?").
                    const next: TaskDraft = { ...draft, recurrence: r };
                    if (
                      (r === 'weekly' || r === 'biweekly' || r === 'daily') &&
                      draft.weekdays.length === 0 &&
                      draft.start_date
                    ) {
                      const d = new Date(draft.start_date + 'T00:00:00');
                      if (!isNaN(d.getTime())) next.weekdays = [d.getDay()];
                    }
                    setDraft(next);
                  }}
                  className={
                    'rounded-[10px] border px-3 py-1.5 text-xs ' +
                    (draft.recurrence === r
                      ? 'border-lime bg-lime/10 text-lime'
                      : 'border-line-strong text-text-muted hover:text-white')
                  }
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {showWeekdays ? (
            <div>
              <label className="label-field">Dias da semana</label>
              <div className="flex gap-1">
                {WEEKDAY_LABEL.map((w, i) => {
                  const on = draft.weekdays.includes(i);
                  return (
                    <button
                      key={i}
                      type="button"
                      onClick={() => toggleWeekday(i)}
                      className={
                        'flex h-9 w-9 items-center justify-center rounded-full text-xs font-bold transition ' +
                        (on
                          ? 'bg-lime text-black'
                          : 'border border-line-strong text-text-muted hover:border-lime')
                      }
                    >
                      {w}
                    </button>
                  );
                })}
              </div>
              <p className="mt-1 text-[11px] text-text-muted">
                Vazio = roda no mesmo dia da semana da data inicial.
              </p>
            </div>
          ) : null}

          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label className="label-field">Data</label>
              <input
                type="date"
                value={draft.start_date}
                onChange={(e) => update('start_date', e.target.value)}
                className="input-field"
              />
            </div>
            <div>
              <label className="label-field">Horario (opcional)</label>
              <input
                type="time"
                value={draft.start_time}
                onChange={(e) => update('start_time', e.target.value)}
                className="input-field"
              />
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label className="label-field">Duracao em min (opcional)</label>
              <input
                type="number"
                min={0}
                value={draft.duration_min}
                onChange={(e) => update('duration_min', e.target.value)}
                className="input-field"
                placeholder="60"
              />
            </div>
            {draft.recurrence !== 'once' ? (
              <div>
                <label className="label-field">Repetir ate (opcional)</label>
                <input
                  type="date"
                  value={draft.end_date}
                  onChange={(e) => update('end_date', e.target.value)}
                  className="input-field"
                />
              </div>
            ) : <div />}
          </div>

          <div className="rounded-[10px] border border-line bg-bg p-3">
            <label className="flex cursor-pointer items-center gap-3 text-sm">
              <input
                type="checkbox"
                checked={draft.notify}
                onChange={(e) => update('notify', e.target.checked)}
                className="h-4 w-4 accent-lime"
              />
              <span>Notificar no navegador antes do horario</span>
            </label>
            {draft.notify ? (
              <div className="mt-3">
                <label className="label-field">Antecedencia (min)</label>
                <input
                  type="number"
                  min={0}
                  value={draft.notify_offset}
                  onChange={(e) => update('notify_offset', e.target.value)}
                  className="input-field"
                />
              </div>
            ) : null}
          </div>

          {error ? (
            <div className="rounded-[8px] border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              {error}
            </div>
          ) : null}

          <div className="mt-2 flex items-center justify-between gap-2">
            {draft.id ? (
              <button
                type="button"
                onClick={onDelete}
                disabled={saving}
                className="btn-ghost text-xs text-red-300 hover:text-red-200"
              >
                Excluir tarefa
              </button>
            ) : <div />}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={saving}
                className="btn-secondary"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={onSave}
                disabled={saving || !draft.title.trim()}
                className="btn-primary"
              >
                {saving ? 'Salvando...' : 'Salvar'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
