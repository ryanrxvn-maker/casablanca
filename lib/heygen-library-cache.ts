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

type CacheState = {
  groups: LibraryAvatarGroup[];
  loading: boolean;
  error: string | null;
  /** Timestamp do ultimo fetch bem-sucedido. 0 = nunca. */
  lastFetched: number;
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
};

const subscribers = new Set<() => void>();
let inflightPromise: Promise<void> | null = null;

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
    const j = JSON.parse(raw) as { groups?: LibraryAvatarGroup[]; lastFetched?: number };
    if (Array.isArray(j.groups) && j.groups.length > 0 && state.groups.length === 0) {
      state.groups = j.groups;
      state.lastFetched = j.lastFetched || 0;
    }
  } catch {}
}

function persist() {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({ groups: state.groups, lastFetched: state.lastFetched }));
  } catch {}
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
      const r = await listMyHeyGenAvatars();
      if (r.ok) {
        state.groups = r.groups ?? [];
        state.lastFetched = Date.now();
        state.error = null;
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
