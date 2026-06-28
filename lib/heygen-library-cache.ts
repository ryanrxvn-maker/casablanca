/**
 * Cache singleton da biblioteca de avatares HeyGen.
 *
 * Listar avatares custa ~1.5s e duas chamadas paralelas saturam o background
 * worker da extensao. Esse cache garante UMA fetch ativa e compartilha o
 * resultado entre N consumidores (HeyGenAvatarPicker + CompactAvatarPicker
 * em cada parte do modo dinamico).
 *
 * - Subscribers recebem (groups, loading, error) via callback
 * - reload() re-busca e notifica todos
 * - TTL de 5 min: depois disso, getOrLoad re-busca automaticamente
 */
import {
  listMyHeyGenAvatars,
  type LibraryAvatarGroup,
} from './heygen-extension-bridge';
import { getActiveSpaceId } from './heygen-api-direct';

type CacheState = {
  groups: LibraryAvatarGroup[];
  loading: boolean;
  error: string | null;
  /** Timestamp do ultimo fetch bem-sucedido. 0 = nunca. */
  lastFetched: number;
  /** Workspace/space do HeyGen em que ESSA lista foi buscada. null = desconhecido
   *  (extensão antiga / campo ausente) → o check de workspace fica inerte. */
  spaceId: string | null;
};

const TTL_MS = 5 * 60 * 1000;
/** Persistência local da lista — sobrevive ao reload da página pra mostrar os
 *  avatares NA HORA (stale-while-revalidate) em vez de esperar a extensão. */
const LS_KEY = 'darkolab:heygen-library:v1';

const state: CacheState = {
  groups: [],
  loading: false,
  error: null,
  lastFetched: 0,
  spaceId: null,
};

const subscribers = new Set<() => void>();
let inflightPromise: Promise<void> | null = null;
let spaceCheckInflight = false;
let lastSpaceCheckAt = 0;

/** Hidrata o state com a lista persistida (1x). Roda no client. Faz o
 *  primeiro render já ter avatares (sem skeleton) enquanto revalida. */
let hydrated = false;
function hydrate() {
  if (hydrated) return;
  hydrated = true;
  if (typeof window === 'undefined') return;
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return;
    const j = JSON.parse(raw) as { groups?: LibraryAvatarGroup[]; lastFetched?: number; spaceId?: string | null };
    if (Array.isArray(j.groups) && j.groups.length > 0 && state.groups.length === 0) {
      state.groups = j.groups;
      state.lastFetched = j.lastFetched || 0;
      state.spaceId = j.spaceId ?? null;
    }
  } catch {}
}

function persist() {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({ groups: state.groups, lastFetched: state.lastFetched, spaceId: state.spaceId }));
  } catch {}
}

/** Confere (em BACKGROUND, sem bloquear o render) se o workspace/space ATIVO do
 *  HeyGen ainda é o mesmo em que a lista cacheada foi buscada. Se mudou, a lista
 *  é de OUTRO workspace → descarta e refaz, pra o user NUNCA escolher avatar de
 *  um space que não é o ativo (raiz do erro "Avatar group not accessible in
 *  space"). FAIL-SAFE: sem space conhecido (null) ou sem extensão, não faz nada. */
async function ensureActiveSpace() {
  if (spaceCheckInflight) return;
  if (typeof window === 'undefined') return;
  if (state.groups.length === 0 || !state.spaceId) return; // nada pra comparar
  // Throttle: no máx 1 check/min (vários pickers montam juntos no modo dinâmico).
  // O "Recarregar" manual sempre refaz a lista do space ativo, independente disso.
  if (Date.now() - lastSpaceCheckAt < 60_000) return;
  lastSpaceCheckAt = Date.now();
  spaceCheckInflight = true;
  try {
    const cur = await getActiveSpaceId();
    if (cur && state.spaceId && cur !== state.spaceId) {
      console.warn(`[heygen-library-cache] workspace mudou (${state.spaceId} → ${cur}) — recarregando avatares do space ativo`);
      state.groups = [];
      state.spaceId = cur;
      state.lastFetched = 0;
      try { localStorage.removeItem(LS_KEY); } catch {}
      notify(); // some os avatares do space antigo; UI mostra loading
      await reloadLibrary(true); // busca a lista do space ATIVO agora
    }
  } catch {
    /* fail-safe: qualquer erro → mantém o comportamento atual */
  } finally {
    spaceCheckInflight = false;
  }
}

function notify() {
  for (const sub of subscribers) {
    try { sub(); } catch (e) { console.error('[heygen-library-cache] subscriber err:', e); }
  }
}

export function subscribeLibrary(cb: () => void): () => void {
  subscribers.add(cb);
  return () => { subscribers.delete(cb); };
}

export function getLibrarySnapshot(): CacheState {
  // NÃO hidrata aqui de propósito: é chamado no useState inicial (render), e
  // hidratar do localStorage no 1º render causaria hydration mismatch (SSR
  // renderiza vazio). A hidratação roda no reloadLibrary (mount, client-only).
  return state;
}

export async function reloadLibrary(force = false): Promise<void> {
  const hadGroupsBefore = state.groups.length > 0;
  hydrate();
  // Se a hidratação (localStorage) trouxe a lista agora, avisa os subscribers
  // pra UI mostrar os avatares NA HORA — mesmo que o cache esteja fresco e a
  // gente retorne sem refazer a fetch.
  if (!hadGroupsBefore && state.groups.length > 0) notify();
  // WORKSPACE-AWARE (background): se o space ativo mudou, a lista cacheada é de
  // outro workspace → descarta e refaz. Não bloqueia o que está abaixo.
  void ensureActiveSpace();
  if (state.loading) {
    // Aguarda a fetch em andamento
    if (inflightPromise) await inflightPromise;
    return;
  }
  if (!force && state.lastFetched > 0 && Date.now() - state.lastFetched < TTL_MS && state.groups.length > 0) {
    return; // cache fresh
  }
  // STALE-WHILE-REVALIDATE: se já temos lista (do localStorage ou de antes),
  // a revalidação AUTOMÁTICA (TTL) roda silenciosa (sem skeleton). Só liga o
  // loading quando não há nada pra exibir (1º uso) OU quando é Recarregar
  // manual (force) — aí mostra o indicador "Lendo..." sem perder o grid.
  const hasCached = state.groups.length > 0;
  state.loading = !hasCached || force;
  state.error = null;
  notify();
  inflightPromise = (async () => {
    try {
      // Busca a lista E o space ativo EM PARALELO (sem latência extra) — assim a
      // lista cacheada fica "carimbada" com o workspace em que foi buscada.
      const [r, sid] = await Promise.all([listMyHeyGenAvatars(), getActiveSpaceId()]);
      if (r.ok) {
        state.groups = r.groups ?? [];
        state.lastFetched = Date.now();
        state.error = null;
        if (sid) state.spaceId = sid;
        persist();
      } else {
        // Mantém a lista cacheada (se houver) e só marca erro quando vazio.
        if (!hasCached) state.error = r.error ?? 'Falha ao listar avatares.';
      }
    } catch (e) {
      if (!hasCached) state.error = (e as Error).message ?? 'Falha desconhecida.';
    } finally {
      state.loading = false;
      inflightPromise = null;
      notify();
    }
  })();
  await inflightPromise;
}

/** Limpa o cache, forcando proximo getOrLoad a re-buscar */
export function invalidateLibrary() {
  state.lastFetched = 0;
  notify();
}
