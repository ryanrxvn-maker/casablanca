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

const state: CacheState = {
  groups: [],
  loading: false,
  error: null,
  lastFetched: 0,
};

const subscribers = new Set<() => void>();
let inflightPromise: Promise<void> | null = null;

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
  return state;
}

export async function reloadLibrary(force = false): Promise<void> {
  if (state.loading) {
    // Aguarda a fetch em andamento
    if (inflightPromise) await inflightPromise;
    return;
  }
  if (!force && state.lastFetched > 0 && Date.now() - state.lastFetched < TTL_MS && state.groups.length > 0) {
    return; // cache fresh
  }
  state.loading = true;
  state.error = null;
  notify();
  inflightPromise = (async () => {
    try {
      const r = await listMyHeyGenAvatars();
      if (r.ok) {
        state.groups = r.groups ?? [];
        state.lastFetched = Date.now();
        state.error = null;
      } else {
        state.error = r.error ?? 'Falha ao listar avatares.';
      }
    } catch (e) {
      state.error = (e as Error).message ?? 'Falha desconhecida.';
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
