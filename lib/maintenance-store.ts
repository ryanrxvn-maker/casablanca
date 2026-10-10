/**
 * Onde mora o estado das ferramentas (manutenção + contas liberadas):
 * arquivo PRIVADO `app-config/tools-status.json` no Storage do Supabase.
 *
 * Por que não uma tabela: arquivo no Storage não pede migration — o painel
 * cria o bucket e o arquivo na 1ª gravação e funciona na hora (a 037 ficou
 * dias esperando alguém rodar o SQL). É lido só com a service role.
 *
 * Só usa fetch (sem supabase-js): roda igual no middleware (edge) e nas
 * rotas (node). Cache de 15 s por instância: a mudança do painel vale pra
 * todo mundo em até ~15 s, e o middleware não paga ida ao Storage a cada
 * clique. Falha de rede nunca derruba o site: usa o último estado bom (ou o
 * padrão do código, que é o que valia antes do painel).
 */

import { cleanToolsConfig, defaultToolsConfig, type ToolsConfig } from './maintenance';

export const TOOLS_BUCKET = 'app-config';
export const TOOLS_OBJECT = 'tools-status.json';
export const TOOLS_CACHE_MS = 15_000;
const READ_TIMEOUT_MS = 2_000;

export type ToolsSource = 'storage' | 'default' | 'stale' | 'unconfigured';
export type LoadedTools = { cfg: ToolsConfig; source: ToolsSource; error?: string };

type CacheEntry = { at: number; value: LoadedTools };
let cache: CacheEntry | null = null;
let inflight: Promise<LoadedTools> | null = null;

function env() {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  return url && key ? { url, key } : null;
}

const authHeaders = (key: string) => ({ Authorization: `Bearer ${key}`, apikey: key });

function looksNotFound(status: number, body: string): boolean {
  if (status === 404) return true;
  return status === 400 && /not.?found|does not exist/i.test(body);
}

async function fetchOnce(): Promise<LoadedTools> {
  const e = env();
  if (!e) return { cfg: defaultToolsConfig(), source: 'unconfigured' };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), READ_TIMEOUT_MS);
  try {
    // ?v= fura qualquer cache de CDN na frente do Storage.
    const res = await fetch(`${e.url}/storage/v1/object/${TOOLS_BUCKET}/${TOOLS_OBJECT}?v=${Date.now()}`, {
      headers: authHeaders(e.key),
      cache: 'no-store',
      signal: ctrl.signal,
    });
    const text = await res.text();
    if (res.ok) {
      let json: unknown = null;
      try {
        json = JSON.parse(text);
      } catch {
        throw new Error('arquivo de estado ilegível');
      }
      return { cfg: cleanToolsConfig(json), source: 'storage' };
    }
    if (looksNotFound(res.status, text)) return { cfg: defaultToolsConfig(), source: 'default' };
    throw new Error(`Storage respondeu ${res.status}`);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Estado atual (com cache de 15 s). `fresh` ignora o cache — o painel usa
 * antes de gravar, pra nunca escrever em cima de uma versão velha.
 */
export async function loadToolsConfig(opts: { fresh?: boolean } = {}): Promise<LoadedTools> {
  const now = Date.now();
  if (!opts.fresh && cache && now - cache.at < TOOLS_CACHE_MS) return cache.value;
  if (!opts.fresh && inflight) return inflight;
  const run = (async (): Promise<LoadedTools> => {
    try {
      const value = await fetchOnce();
      cache = { at: Date.now(), value };
      return value;
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      if (cache) {
        // Mantém o último estado bom e tenta de novo em ~5 s.
        const value: LoadedTools = { ...cache.value, source: 'stale', error };
        cache = { at: Date.now() - TOOLS_CACHE_MS + 5_000, value: cache.value };
        return value;
      }
      return { cfg: defaultToolsConfig(), source: 'default', error };
    } finally {
      if (!opts.fresh) inflight = null;
    }
  })();
  if (!opts.fresh) inflight = run;
  return run;
}

/** Só pra teste: zera o cache entre cenários. */
export function __resetToolsCache() {
  cache = null;
  inflight = null;
}

async function ensureBucket(url: string, key: string): Promise<void> {
  const res = await fetch(`${url}/storage/v1/bucket`, {
    method: 'POST',
    headers: { ...authHeaders(key), 'content-type': 'application/json' },
    body: JSON.stringify({ id: TOOLS_BUCKET, name: TOOLS_BUCKET, public: false }),
    cache: 'no-store',
  });
  if (res.ok) return;
  const body = await res.text().catch(() => '');
  if (res.status === 409 || /already exists|duplicate/i.test(body)) return;
  throw new Error(`Não deu pra criar o armazenamento (${res.status}): ${body.slice(0, 160)}`);
}

/** Grava o arquivo (cria o bucket privado na 1ª vez) e atualiza o cache desta instância. */
export async function saveToolsConfig(cfg: ToolsConfig): Promise<void> {
  const e = env();
  if (!e) throw new Error('Supabase não configurado no servidor.');
  const put = () =>
    fetch(`${e.url}/storage/v1/object/${TOOLS_BUCKET}/${TOOLS_OBJECT}`, {
      method: 'POST',
      headers: {
        ...authHeaders(e.key),
        'content-type': 'application/json',
        'x-upsert': 'true',
        'cache-control': 'max-age=0',
      },
      body: JSON.stringify(cfg),
      cache: 'no-store',
    });
  let res = await put();
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    if (!/bucket/i.test(body) || !looksNotFound(res.status, body)) {
      throw new Error(`Falha ao salvar (${res.status}): ${body.slice(0, 160)}`);
    }
    await ensureBucket(e.url, e.key);
    res = await put();
    if (!res.ok) throw new Error(`Falha ao salvar (${res.status}): ${(await res.text().catch(() => '')).slice(0, 160)}`);
  }
  cache = { at: Date.now(), value: { cfg, source: 'storage' } };
}
