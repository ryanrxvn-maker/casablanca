/**
 * Blindagem contra "Loading chunk XXXX failed" (fix 2026-07-04).
 *
 * O Next.js divide o código em chunks com hash no nome. Quando um DEPLOY novo
 * sobe enquanto o user está com a página ANTIGA aberta, os chunks antigos somem
 * do CDN. Qualquer `import()` dinâmico da página velha (ex: carregar o ffmpeg,
 * o jszip, a lib de montagem) tenta buscar um chunk que não existe mais → falha
 * com "Loading chunk 7635 failed" e a task morre — MESMO com todos os takes
 * prontos. Não é bug do fluxo: é a versão nova invalidando a antiga.
 *
 * Cura: detectar esse erro e RECARREGAR a página UMA vez (os chunks novos
 * entram). O estado das tasks persiste (localStorage + IndexedDB), então depois
 * do reload elas re-hidratam e o RETOMAR reaproveita os takes já prontos.
 * Guard de 30s evita loop de reload se o erro persistir por outro motivo.
 */

export function isChunkLoadError(e: unknown): boolean {
  if (!e) return false;
  const parts: string[] = [];
  if (e instanceof Error) {
    parts.push(e.message || '', e.name || '', (e as { code?: string }).code || '');
  } else {
    parts.push(String(e));
  }
  const msg = parts.join(' ');
  return /ChunkLoadError|Loading chunk\s+[\w-]+\s+failed|Loading CSS chunk|error loading dynamically imported module|Failed to fetch dynamically imported module|importing a module script failed/i.test(
    msg,
  );
}

const RELOAD_KEY = 'darkolab:chunk-reload-at';
const RELOAD_COOLDOWN_MS = 30_000;

/** Recarrega a página UMA vez pra pegar os chunks novos. Retorna true se
 *  agendou o reload; false se já recarregou há pouco (evita loop) ou não há
 *  window. Dá um pequeno delay pro estado da task (setState→persist) gravar
 *  antes de sair. */
export function reloadOnceForChunk(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) || '0');
    const now = Date.now();
    // Já recarregou há < 30s → o erro persiste por OUTRO motivo (não só chunk
    // stale). Não recarrega de novo — deixa aparecer pro user em vez de loopar.
    if (now - last < RELOAD_COOLDOWN_MS) return false;
    sessionStorage.setItem(RELOAD_KEY, String(now));
    setTimeout(() => {
      try { window.location.reload(); } catch { /* ignora */ }
    }, 450);
    return true;
  } catch {
    return false;
  }
}
