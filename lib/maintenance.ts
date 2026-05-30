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
  '/tools/remover-elementos',
];

/** True se o path (ou um sub-path dele) está em manutenção. */
export function isToolInMaintenance(path: string): boolean {
  if (!path) return false;
  return MAINTENANCE_TOOLS.some((p) => path === p || path.startsWith(p + '/'));
}
