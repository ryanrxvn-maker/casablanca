/**
 * BETA PRO — desbloqueio de ferramentas ADMIN-ONLY por conta (sem virar admin).
 *
 * Caso de uso: cliente de confiança que precisa das automações internas
 * (Hey Auto / ClickUp Pilot / Remover Legenda etc.) sem ganhar acesso ao
 * painel admin. O user usa as PRÓPRIAS credenciais (chave HeyGen em
 * /configuracoes/api, token ClickUp no próprio browser) — nada da casa é
 * compartilhado.
 *
 * DUAS fontes de desbloqueio, somadas:
 *   a) profiles.tool_unlocks (banco) — gerenciado pelo painel /admin,
 *      por conta, sem deploy. É o caminho principal ("BETA PRO").
 *   b) EMAIL fixo (hardcoded abaixo + env) — legado/fallback, continua
 *      valendo. Configurável sem deploy via env na Vercel (entradas
 *      separadas por ';', paths por ','):
 *        NEXT_PUBLIC_TOOL_UNLOCKS="fulano@x.com:/tools/heygen-auto,/tools/clickup-pilot"
 *        TOOL_UNLOCKS (só server, extra)
 *
 * O desbloqueio vale nas 3 camadas (mesmo padrão do canBypassMaintenance):
 *   1. middleware (acesso às páginas) — lê profiles.tool_unlocks no select
 *   2. requireTier server-side (rotas /api das ferramentas)
 *   3. UI client-side (cards do hub, sidebars, busca, TierGate) — o
 *      use-tier carrega a lista do banco e injeta via setSessionToolUnlocks
 */

/**
 * Catálogo das ferramentas admin-only que PODEM ser liberadas pra uma conta
 * (as opções do modal "BETA PRO" do painel /admin). Fonte única: o painel
 * exibe estes itens e /api/admin/set-tool-unlocks valida contra eles.
 */
export const UNLOCKABLE_TOOLS: ReadonlyArray<{
  path: string;
  label: string;
  desc: string;
}> = [
  {
    path: '/tools/heygen-auto',
    label: 'Hey Auto',
    desc: 'Lipsync no HeyGen em lote (usa a chave HeyGen do cliente).',
  },
  {
    path: '/tools/clickup-pilot',
    label: 'ClickUp Pilot',
    desc: 'Dispara lipsyncs a partir das tasks (token ClickUp do cliente).',
  },
  {
    path: '/tools/auto-broll',
    label: 'Auto B-roll',
    desc: 'Geração de b-roll em lote (consome créditos da casa).',
  },
  {
    path: '/tools/remover-elementos',
    label: 'Remover Legenda/Marca d’Água',
    desc: 'IA remove legenda queimada (consome créditos da casa).',
  },
  {
    path: '/tools/separador-audio',
    label: 'Separador de Áudio',
    desc: 'Separa voz/instrumental/SFX (consome créditos da casa).',
  },
  // '/tools/normalizador' saiu daqui em 14.08.2026: liberado pra TODOS os
  // tiers (incl. free) — não precisa mais de desbloqueio por email.
  {
    path: '/tools/ltx-video',
    label: 'LTX Video',
    desc: 'Geração de vídeo IA (quota da casa no HuggingFace).',
  },
  {
    path: '/tools/famous-hey',
    label: 'FAMOUS HEY',
    desc: 'Anima uma imagem no HeyGen sem criar avatar (crédito do plano do cliente).',
  },
];

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

/** Desbloqueios FIXOS (email hardcoded/env) — pro painel admin exibir como
 *  "fixo no código", não removível pelo painel. */
export function staticUnlocksForEmail(
  email: string | null | undefined,
): string[] {
  if (!email) return [];
  const set = UNLOCKS.get(email.trim().toLowerCase());
  return set ? Array.from(set) : [];
}

/** Expande a lista crua do banco (profiles.tool_unlocks) somando as rotas de
 *  apoio de cada ferramenta. Aceita null/undefined (coluna ainda não migrada). */
export function expandUnlocks(
  paths: readonly string[] | null | undefined,
): ReadonlySet<string> {
  const set = new Set<string>();
  for (const raw of paths ?? []) {
    const p = typeof raw === 'string' ? raw.trim() : '';
    if (!p.startsWith('/tools/')) continue;
    set.add(p);
    for (const support of TOOL_SUPPORT_ROUTES[p] ?? []) set.add(support);
  }
  return set;
}

/** True se `path` bate com algum desbloqueio da lista (prefix-match).
 *  Server-safe: função pura, sem estado de módulo. */
export function pathUnlockedByList(
  paths: readonly string[] | null | undefined,
  path: string,
): boolean {
  if (!path || !paths?.length) return false;
  for (const p of expandUnlocks(paths)) {
    if (path === p || path.startsWith(p + '/')) return true;
  }
  return false;
}

// ─── Desbloqueios da SESSÃO (client-side) ───────────────────────────────────
// O use-tier carrega profiles.tool_unlocks do user logado e injeta aqui.
// Assim TODOS os call-sites existentes de emailUnlocksPath (hub, sidebars,
// busca, TierGate) enxergam os desbloqueios do banco sem mudar de assinatura.
// GUARDA: só existe no browser — no server (middleware/rotas compartilham o
// módulo entre requests) fica sempre null, sem risco de vazar entre usuários.
let sessionUnlocks: ReadonlySet<string> | null = null;

/** Injeta os desbloqueios do banco da conta logada (client-only; no-op no server). */
export function setSessionToolUnlocks(
  paths: readonly string[] | null | undefined,
): void {
  if (typeof window === 'undefined') return;
  sessionUnlocks = paths == null ? null : expandUnlocks(paths);
}

/** True se o email tem desbloqueio pro path (prefix-match, cobre sub-rotas).
 *  No client, soma os desbloqueios do banco da sessão logada. */
export function emailUnlocksPath(
  email: string | null | undefined,
  path: string,
): boolean {
  if (!path) return false;
  if (typeof window !== 'undefined' && sessionUnlocks) {
    for (const p of sessionUnlocks) {
      if (path === p || path.startsWith(p + '/')) return true;
    }
  }
  if (!email) return false;
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
