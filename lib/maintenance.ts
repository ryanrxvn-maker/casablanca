/**
 * Ferramentas em MANUTENÇÃO.
 *
 * Regra: bloqueadas pra TODOS os clientes — só a conta admin acessa (pra
 * testar). O bloqueio REAL é server-side no middleware (lib/supabase/
 * middleware.ts); a UI só mostra o aviso. Defesa em camadas: mesmo que
 * alguém force a URL, o middleware redireciona quem não é admin.
 *
 * Pra tirar uma ferramenta de manutenção, basta remover o path daqui.
 */
export const MAINTENANCE_TOOLS: readonly string[] = [
  '/tools/normalizador',
  '/tools/separador-audio',
  '/tools/troca-produto',
  '/tools/remover-elementos', // EM manutenção: bloqueado pra clientes, só admin acessa
  // '/tools/lipsync', — FORA de manutenção: liberado pra Pro + Admin
];

/** True se o path (ou um sub-path dele) está em manutenção. */
export function isToolInMaintenance(path: string): boolean {
  if (!path) return false;
  return MAINTENANCE_TOOLS.some((p) => path === p || path.startsWith(p + '/'));
}

/**
 * Emails que FURAM a manutenção (além do admin) — clientes de confiança.
 * Configurável SEM novo deploy via env na Vercel (lista separada por vírgula):
 *   • NEXT_PUBLIC_MAINTENANCE_BYPASS_EMAILS  (vale no client + server)
 *   • MAINTENANCE_BYPASS_EMAILS              (só server, extra)
 * Ex.: NEXT_PUBLIC_MAINTENANCE_BYPASS_EMAILS="elder@gmail.com,fulano@x.com"
 */
function parseEmails(v?: string | null): string[] {
  if (!v) return [];
  return v
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

// Clientes de confiança fixos (sempre liberados). Pode somar mais via env.
const MAINTENANCE_BYPASS_BASE = [
  'elderemanoel.13@gmail.com', // Elder Manoel — cliente PRO de confiança
];

const MAINTENANCE_BYPASS_EMAILS: ReadonlySet<string> = new Set<string>([
  ...parseEmails(MAINTENANCE_BYPASS_BASE.join(',')),
  ...parseEmails(process.env.NEXT_PUBLIC_MAINTENANCE_BYPASS_EMAILS),
  ...parseEmails(process.env.MAINTENANCE_BYPASS_EMAILS),
]);

/** True se o email pode acessar ferramentas em manutenção (cliente liberado). */
export function canBypassMaintenance(email?: string | null): boolean {
  if (!email) return false;
  return MAINTENANCE_BYPASS_EMAILS.has(email.trim().toLowerCase());
}
