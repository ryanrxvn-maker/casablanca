/**
 * Cliente ClickUp — READ-ONLY.
 *
 * Todas as chamadas vao via /api/clickup/proxy (server-side resolve CORS +
 * adiciona Authorization). O proxy bloqueia qualquer metodo != GET.
 *
 * REGRA: ClickUp Pilot JAMAIS altera tasks, comentarios, status, ou
 * qualquer coisa no ClickUp do user. So leitura. Nunca expor PUT/POST/DELETE
 * mesmo que pareca util — o proxy server-side rejeita 405.
 *
 * Token e armazenado em localStorage e enviado no header x-clickup-token.
 */

const TOKEN_KEY = 'darkolab:clickup:token';

export function getClickUpToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function setClickUpToken(token: string | null) {
  if (typeof window === 'undefined') return;
  if (!token) localStorage.removeItem(TOKEN_KEY);
  else localStorage.setItem(TOKEN_KEY, token);
}

type ClickUpResp<T = any> = {
  ok: boolean;
  status: number;
  body: T | { err?: string };
};

/** GET-only por contrato. Proxy server-side rejeita qualquer outro metodo. */
async function callGet<T = any>(path: string): Promise<ClickUpResp<T>> {
  const token = getClickUpToken();
  if (!token) return { ok: false, status: 401, body: { err: 'Token ClickUp nao configurado.' } as any };
  const r = await fetch('/api/clickup/proxy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-clickup-token': token },
    body: JSON.stringify({ path, method: 'GET' }),
  });
  const j = await r.json().catch(() => null);
  return j as ClickUpResp<T>;
}

/* ============= Tipos ClickUp ============= */

export type ClickUpTeam = {
  id: string;
  name: string;
  members: Array<{ user: { id: number; username: string; email: string; profilePicture?: string } }>;
};

export type ClickUpUser = {
  id: number;
  username: string;
  email: string;
  profilePicture?: string;
};

export type ClickUpStatus = {
  status: string;
  color: string;
  type: string;
};

export type ClickUpCustomField = {
  id: string;
  name: string;
  type: string;
  value?: any;
};

export type ClickUpTask = {
  id: string;
  name: string;
  status: ClickUpStatus;
  url: string;
  description?: string;
  text_content?: string;
  due_date?: string;
  date_created?: string;
  assignees: ClickUpUser[];
  list?: { id: string; name: string };
  folder?: { id: string; name: string };
  space?: { id: string; name: string };
  custom_fields?: ClickUpCustomField[];
};

/* ============= Endpoints ============= */

/** GET /team — lista todos workspaces (chamado "team" na API antiga) */
export async function listTeams(): Promise<ClickUpTeam[]> {
  const r = await callGet<{ teams: ClickUpTeam[] }>('/team');
  if (!r.ok) throw new Error(`Falha listando teams (${r.status}): ${(r.body as any)?.err || JSON.stringify(r.body).slice(0, 200)}`);
  return (r.body as any).teams || [];
}

/** GET /team/{team_id}/task — tasks do team com filtros */
export async function listTasks(
  teamId: string,
  opts: {
    assigneeIds?: (string | number)[];
    statuses?: string[];
    page?: number;
    /** include_closed default false */
    includeClosed?: boolean;
    /** subtasks default false */
    subtasks?: boolean;
  } = {},
): Promise<{ tasks: ClickUpTask[]; lastPage: boolean }> {
  const params = new URLSearchParams();
  for (const id of opts.assigneeIds || []) params.append('assignees[]', String(id));
  for (const st of opts.statuses || []) params.append('statuses[]', st);
  if (opts.page !== undefined) params.set('page', String(opts.page));
  if (opts.includeClosed) params.set('include_closed', 'true');
  if (opts.subtasks) params.set('subtasks', 'true');
  const qs = params.toString();
  const r = await callGet<{ tasks: ClickUpTask[]; last_page: boolean }>(
    `/team/${teamId}/task${qs ? '?' + qs : ''}`,
  );
  if (!r.ok) throw new Error(`Falha listando tasks (${r.status}): ${(r.body as any)?.err || JSON.stringify(r.body).slice(0, 200)}`);
  return {
    tasks: (r.body as any).tasks || [],
    lastPage: !!(r.body as any).last_page,
  };
}

/** GET /task/{task_id} — detalhes (com description completa) */
export async function getTask(taskId: string): Promise<ClickUpTask> {
  const r = await callGet<ClickUpTask>(`/task/${taskId}`);
  if (!r.ok) throw new Error(`Falha get task (${r.status}): ${(r.body as any)?.err || JSON.stringify(r.body).slice(0, 200)}`);
  return r.body as ClickUpTask;
}

/* ============= Helpers ============= */

/** Extrai links de Google Docs / outros docs da description */
export function extractDocLinks(description: string | undefined | null): string[] {
  if (!description) return [];
  const re = /(https?:\/\/docs\.google\.com\/[^\s)\]"]+|https?:\/\/[a-z0-9.-]+\/[^\s)\]"]+)/gi;
  const all = Array.from(description.matchAll(re)).map((m) => m[0]);
  // Prioriza Google Docs no top
  return all.sort((a, b) => {
    const aGdocs = /docs\.google\.com/.test(a);
    const bGdocs = /docs\.google\.com/.test(b);
    if (aGdocs && !bGdocs) return -1;
    if (!aGdocs && bGdocs) return 1;
    return 0;
  });
}
