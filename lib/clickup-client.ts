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
  date_updated?: string;
  date_closed?: string | null;
  date_done?: string | null;
  priority?: { id: string; priority: 'urgent' | 'high' | 'normal' | 'low'; color: string; orderindex: string } | null;
  assignees: ClickUpUser[];
  list?: { id: string; name: string };
  folder?: { id: string; name: string };
  space?: { id: string; name: string };
  custom_fields?: ClickUpCustomField[];
};

/* ============= Endpoints ============= */

/** GET /user — info do user autenticado (id, username, email).
 *  Critico: workspaces com permissao limitada nao retornam membros, entao
 *  precisamos saber quem 'eu sou' independentemente da listagem do team. */
export async function getCurrentUser(): Promise<ClickUpUser> {
  const r = await callGet<{ user: ClickUpUser }>('/user');
  if (!r.ok) throw new Error(`Falha get user (${r.status}): ${(r.body as any)?.err || JSON.stringify(r.body).slice(0, 200)}`);
  return (r.body as any).user;
}

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
    /** Filtros de data (unix ms) — server-side, evita pegar tasks irrelevantes */
    dateClosedGt?: number;
    dateClosedLt?: number;
    dateUpdatedGt?: number;
    dateUpdatedLt?: number;
    dateCreatedGt?: number;
    dateCreatedLt?: number;
  } = {},
): Promise<{ tasks: ClickUpTask[]; lastPage: boolean }> {
  const params = new URLSearchParams();
  for (const id of opts.assigneeIds || []) params.append('assignees[]', String(id));
  for (const st of opts.statuses || []) params.append('statuses[]', st);
  if (opts.page !== undefined) params.set('page', String(opts.page));
  if (opts.includeClosed) params.set('include_closed', 'true');
  if (opts.subtasks) params.set('subtasks', 'true');
  if (opts.dateClosedGt != null) params.set('date_closed_gt', String(opts.dateClosedGt));
  if (opts.dateClosedLt != null) params.set('date_closed_lt', String(opts.dateClosedLt));
  if (opts.dateUpdatedGt != null) params.set('date_updated_gt', String(opts.dateUpdatedGt));
  if (opts.dateUpdatedLt != null) params.set('date_updated_lt', String(opts.dateUpdatedLt));
  if (opts.dateCreatedGt != null) params.set('date_created_gt', String(opts.dateCreatedGt));
  if (opts.dateCreatedLt != null) params.set('date_created_lt', String(opts.dateCreatedLt));
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

/** Lista TODAS tasks paginando automaticamente ate lastPage. Cap 50 paginas
 *  pra nao loop infinito. */
export async function listTasksAll(
  teamId: string,
  opts: Parameters<typeof listTasks>[1] = {},
): Promise<ClickUpTask[]> {
  const out: ClickUpTask[] = [];
  for (let page = 0; page < 50; page++) {
    const r = await listTasks(teamId, { ...opts, page });
    out.push(...r.tasks);
    if (r.lastPage || r.tasks.length === 0) break;
  }
  return out;
}

/** GET /task/{task_id} — detalhes (com description completa) */
export async function getTask(taskId: string): Promise<ClickUpTask> {
  const r = await callGet<ClickUpTask>(`/task/${taskId}`);
  if (!r.ok) throw new Error(`Falha get task (${r.status}): ${(r.body as any)?.err || JSON.stringify(r.body).slice(0, 200)}`);
  return r.body as ClickUpTask;
}

/** GET /task/{task_id}/comment — comentarios da task (READ-ONLY).
 *  Usado pela TROCA DE ÁUDIO: o link do criativo original costuma vir num
 *  comentario ("Fazer a troca do audio do criativo: https://drive...").
 *  Retorna [] em qualquer falha — chamador trata como "sem comentario". */
export async function getTaskComments(
  taskId: string,
): Promise<Array<{ id: string; comment_text: string }>> {
  try {
    const r = await callGet<{ comments: any[] }>(`/task/${taskId}/comment`);
    if (!r.ok) return [];
    const comments = (r.body as any)?.comments;
    if (!Array.isArray(comments)) return [];
    return comments.map((c: any) => {
      // ClickUp guarda o texto em `comment_text` (plano) E em `comment` (blocos
      // rich-text). Quando o user cola uma URL que vira hyperlink, a URL some
      // do comment_text e fica SO no atributo `attributes.link` do bloco. Por
      // isso concatenamos texto plano + texto dos blocos + links dos atributos.
      const parts: string[] = [];
      if (typeof c.comment_text === 'string') parts.push(c.comment_text);
      if (Array.isArray(c.comment)) {
        for (const blk of c.comment) {
          if (typeof blk?.text === 'string') parts.push(blk.text);
          const attrs = blk?.attributes || {};
          const link = attrs.link || attrs.url || attrs['link-url'];
          if (typeof link === 'string') parts.push(link);
        }
      }
      // A PROVA DE BALA: serializa o comentario inteiro. Se a URL existir em
      // QUALQUER campo (texto, atributo de hyperlink, etc), o regex de Drive
      // acha. JSON.stringify nao escapa "/", entao as URLs ficam intactas.
      try { parts.push(JSON.stringify(c)); } catch {}
      return { id: String(c.id ?? ''), comment_text: parts.join(' ') };
    });
  } catch {
    return [];
  }
}

/** Extrai o PRIMEIRO ID de arquivo do Google Drive de um texto livre.
 *  Suporta /file/d/<id>/, open?id=<id>, uc?id=<id>. Ignora links de PASTA
 *  (/folders/) — esses nao sao arquivos baixaveis. */
export function extractDriveFileIdFromText(text: string | undefined | null): string | null {
  if (!text) return null;
  const patterns = [
    /\/file\/d\/([a-zA-Z0-9_-]{20,60})/,
    /[?&]id=([a-zA-Z0-9_-]{20,60})/,
    /\/d\/([a-zA-Z0-9_-]{20,60})/,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) return m[1];
  }
  return null;
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
