/**
 * Agenda — tipos compartilhados, helpers de data/recorrencia e
 * expansao de ocorrencias.
 *
 * Tudo que toca banco fica em app/tools/agenda/page.tsx usando o cliente
 * Supabase. Aqui e pura logica de dominio.
 */

export type Urgency = 'low' | 'normal' | 'high' | 'urgent';

export type Recurrence = 'once' | 'daily' | 'weekly' | 'biweekly';

export type OccStatus =
  | 'pending'
  | 'on_time'
  | 'delayed'
  | 'refactor'
  | 'skipped';

export type AgendaTask = {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  urgency: Urgency;
  recurrence: Recurrence;
  start_date: string; // 'YYYY-MM-DD'
  start_time: string | null; // 'HH:MM'
  duration_min: number | null;
  weekdays: string | null; // "1,3,5"
  end_date: string | null;
  color: string | null;
  notify: boolean;
  notify_offset: number | null;
  created_at: string;
  updated_at: string;
};

export type AgendaOccurrence = {
  id: string;
  task_id: string;
  user_id: string;
  occurrence_date: string;
  status: OccStatus;
  completed_at: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
};

/** Evento concreto plotado no calendario (template + data + status). */
export type AgendaEvent = {
  task: AgendaTask;
  date: string; // 'YYYY-MM-DD'
  status: OccStatus;
  occurrence?: AgendaOccurrence;
};

// ---------- date helpers ------------------------------------------------

/** 'YYYY-MM-DD' em timezone local. */
export function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = (d.getMonth() + 1).toString().padStart(2, '0');
  const da = d.getDate().toString().padStart(2, '0');
  return `${y}-${m}-${da}`;
}

export function parseYmd(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export function addDays(d: Date, n: number): Date {
  const c = new Date(d);
  c.setDate(c.getDate() + n);
  return c;
}

export function startOfDay(d: Date): Date {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
}

export function startOfWeek(d: Date, weekStart = 0): Date {
  const c = startOfDay(d);
  const diff = (c.getDay() - weekStart + 7) % 7;
  return addDays(c, -diff);
}

export function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

export function endOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}

export function sameDate(a: Date, b: Date): boolean {
  return ymd(a) === ymd(b);
}

export function diffDays(a: Date, b: Date): number {
  const ms = startOfDay(a).getTime() - startOfDay(b).getTime();
  return Math.round(ms / 86400000);
}

// ---------- urgency helpers --------------------------------------------

export const URGENCY_META: Record<
  Urgency,
  { label: string; color: string; ring: string; dot: string }
> = {
  low: {
    label: 'Baixa',
    color: 'bg-slate-500/20 text-slate-200 border-slate-500/30',
    ring: 'ring-slate-500/30',
    dot: 'bg-slate-400',
  },
  normal: {
    label: 'Normal',
    color: 'bg-blue-500/15 text-blue-200 border-blue-500/30',
    ring: 'ring-blue-500/30',
    dot: 'bg-blue-400',
  },
  high: {
    label: 'Alta',
    color: 'bg-amber-500/15 text-amber-200 border-amber-500/30',
    ring: 'ring-amber-500/30',
    dot: 'bg-amber-400',
  },
  urgent: {
    label: 'Urgente',
    color: 'bg-red-500/20 text-red-200 border-red-500/40',
    ring: 'ring-red-500/40',
    dot: 'bg-red-400',
  },
};

export const STATUS_META: Record<
  OccStatus,
  { label: string; color: string; hex: string }
> = {
  pending: { label: 'Pendente', color: 'text-text-muted', hex: '#64748b' },
  on_time: { label: 'No prazo', color: 'text-lime', hex: '#84cc16' },
  delayed: { label: 'Atrasada', color: 'text-amber-300', hex: '#fbbf24' },
  refactor: { label: 'Refazer', color: 'text-red-300', hex: '#f87171' },
  skipped: { label: 'Pulada', color: 'text-slate-400', hex: '#94a3b8' },
};

// ---------- recurrence expansion ---------------------------------------

/**
 * Retorna TRUE se a task ocorre em `date`.
 * Regras:
 *   - once: match exato com start_date.
 *   - daily: desde start_date (inclusive) ate end_date (inclusive, se houver).
 *            Se weekdays esta preenchido, respeita a mascara.
 *   - weekly: mesma semana do start_date, respeitando weekdays (se houver),
 *             senao repete no mesmo dia da semana toda semana.
 *   - biweekly: igual weekly mas pula uma semana (diferenca de semanas par).
 */
export function occursOn(task: AgendaTask, dateStr: string): boolean {
  const date = parseYmd(dateStr);
  const start = parseYmd(task.start_date);
  if (date < startOfDay(start)) return false;
  if (task.end_date && date > parseYmd(task.end_date)) return false;

  const allowedDays = task.weekdays
    ? new Set(
        task.weekdays
          .split(',')
          .map((s) => parseInt(s.trim(), 10))
          .filter((n) => !isNaN(n)),
      )
    : null;
  const dow = date.getDay();

  switch (task.recurrence) {
    case 'once':
      return ymd(date) === task.start_date;

    case 'daily':
      if (allowedDays && !allowedDays.has(dow)) return false;
      return true;

    case 'weekly': {
      if (allowedDays) return allowedDays.has(dow);
      return dow === start.getDay();
    }

    case 'biweekly': {
      const weeks = Math.floor(diffDays(date, start) / 7);
      if (weeks < 0 || weeks % 2 !== 0) return false;
      if (allowedDays) return allowedDays.has(dow);
      return dow === start.getDay();
    }
  }
}

/** Expande tarefas em eventos para o range [from, to] (inclusive). */
export function expandEvents(
  tasks: AgendaTask[],
  occurrences: AgendaOccurrence[],
  from: Date,
  to: Date,
): AgendaEvent[] {
  const occIndex = new Map<string, AgendaOccurrence>();
  for (const o of occurrences) occIndex.set(o.task_id + '|' + o.occurrence_date, o);

  const out: AgendaEvent[] = [];
  const fromD = startOfDay(from);
  const toD = startOfDay(to);
  for (let d = new Date(fromD); d <= toD; d = addDays(d, 1)) {
    const dStr = ymd(d);
    for (const t of tasks) {
      if (!occursOn(t, dStr)) continue;
      const occ = occIndex.get(t.id + '|' + dStr);
      out.push({
        task: t,
        date: dStr,
        status: (occ?.status as OccStatus) ?? 'pending',
        occurrence: occ,
      });
    }
  }
  return out;
}

// ---------- stats ------------------------------------------------------

export type StatsBreakdown = {
  total: number;
  pending: number;
  on_time: number;
  delayed: number;
  refactor: number;
  skipped: number;
};

export function computeStats(events: AgendaEvent[]): StatsBreakdown {
  const out: StatsBreakdown = {
    total: events.length,
    pending: 0,
    on_time: 0,
    delayed: 0,
    refactor: 0,
    skipped: 0,
  };
  for (const e of events) out[e.status] += 1;
  return out;
}

// ---------- export -----------------------------------------------------

/** CSV simples UTF-8 separado por virgula, com BOM pra abrir certinho no Excel BR. */
export function toCsv(events: AgendaEvent[]): string {
  const header = [
    'data',
    'titulo',
    'urgencia',
    'recorrencia',
    'status',
    'hora',
    'duracao_min',
    'descricao',
  ];
  const esc = (v: string | number | null | undefined) => {
    if (v === null || v === undefined) return '';
    const s = String(v).replace(/"/g, '""');
    return /[",\n]/.test(s) ? '"' + s + '"' : s;
  };
  const rows = events.map((e) =>
    [
      e.date,
      esc(e.task.title),
      e.task.urgency,
      e.task.recurrence,
      e.status,
      esc(e.task.start_time),
      esc(e.task.duration_min),
      esc(e.task.description),
    ].join(','),
  );
  return '\uFEFF' + header.join(',') + '\n' + rows.join('\n');
}
