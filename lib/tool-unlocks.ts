/**
 * Desbloqueio de ferramentas ADMIN-ONLY por EMAIL (sem virar admin).
 *
 * Caso de uso: cliente de confiança que precisa das automações internas
 * (Hey Auto / ClickUp Pilot) sem ganhar acesso ao painel admin nem às
 * demais ferramentas de uso interno. O user usa as PRÓPRIAS credenciais
 * (chave HeyGen em /configuracoes/api, token ClickUp no próprio browser)
 * — nada da casa é compartilhado.
 *
 * O desbloqueio vale nas 3 camadas (mesmo padrão do canBypassMaintenance):
 *   1. middleware (acesso às páginas)
 *   2. requireTier server-side (rotas /api das ferramentas)
 *   3. UI client-side (cards do hub, sidebars, busca, TierGate)
 *
 * Configurável SEM novo deploy via env na Vercel (entradas separadas por
 * ';', paths por ','):
 *   NEXT_PUBLIC_TOOL_UNLOCKS="fulano@x.com:/tools/heygen-auto,/tools/clickup-pilot"
 *   TOOL_UNLOCKS (só server, extra)
 */

// Desbloqueios fixos (commitados). Pode somar mais via env.
const TOOL_UNLOCKS_BASE: Record<string, readonly string[]> = {
  // Pedão — cliente PRO de confiança (liberado em 20.07.2026)
  'pedro.99antuness@gmail.com': ['/tools/heygen-auto', '/tools/clickup-pilot'],
};

// Páginas de APOIO que cada ferramenta precisa pra funcionar de verdade
// (config, fila em segundo plano, histórico de batches). Desbloquear a
// ferramenta desbloqueia estas junto — sem elas o fluxo fica manco.
const TOOL_SUPPORT_ROUTES: Record<string, readonly string[]> = {
  '/tools/clickup-pilot': [
    '/configuracoes/clickup-pilot',
    '/tools/background',
    '/tools/lipsync-history',
  ],
  '/tools/heygen-auto': ['/tools/background', '/tools/lipsync-history'],
};

function parseEnvUnlocks(v?: string | null): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  if (!v) return out;
  for (const entry of v.split(';')) {
    const [email, paths] = entry.split(':', 2);
    const key = (email ?? '').trim().toLowerCase();
    if (!key || !paths) continue;
    const list = paths
      .split(',')
      .map((p) => p.trim())
      .filter((p) => p.startsWith('/tools/'));
    if (list.length) out[key] = [...(out[key] ?? []), ...list];
  }
  return out;
}

function buildUnlockMap(): ReadonlyMap<string, ReadonlySet<string>> {
  const map = new Map<string, Set<string>>();
  const add = (email: string, tools: readonly string[]) => {
    const key = email.trim().toLowerCase();
    const set = map.get(key) ?? new Set<string>();
    for (const tool of tools) {
      set.add(tool);
      for (const support of TOOL_SUPPORT_ROUTES[tool] ?? []) set.add(support);
    }
    map.set(key, set);
  };
  for (const [email, tools] of Object.entries(TOOL_UNLOCKS_BASE)) add(email, tools);
  for (const [email, tools] of Object.entries(
    parseEnvUnlocks(process.env.NEXT_PUBLIC_TOOL_UNLOCKS),
  ))
    add(email, tools);
  for (const [email, tools] of Object.entries(parseEnvUnlocks(process.env.TOOL_UNLOCKS)))
    add(email, tools);
  return map;
}

const UNLOCKS: ReadonlyMap<string, ReadonlySet<string>> = buildUnlockMap();

/** True se o email tem desbloqueio pro path (prefix-match, cobre sub-rotas). */
export function emailUnlocksPath(
  email: string | null | undefined,
  path: string,
): boolean {
  if (!email || !path) return false;
  const set = UNLOCKS.get(email.trim().toLowerCase());
  if (!set) return false;
  for (const p of set) {
    if (path === p || path.startsWith(p + '/')) return true;
  }
  return false;
}

/** True se o email desbloqueia QUALQUER uma das ferramentas listadas. */
export function emailUnlocksAnyTool(
  email: string | null | undefined,
  toolPaths: readonly string[],
): boolean {
  return toolPaths.some((p) => emailUnlocksPath(email, p));
}
