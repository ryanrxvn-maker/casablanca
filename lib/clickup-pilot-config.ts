/**
 * Config persistente do ClickUp Pilot — workspace + editor escolhidos.
 *
 * Persistido em localStorage pra ser lido tanto pela ferramenta
 * (/tools/clickup-pilot) quanto pela pagina de config
 * (/configuracoes/clickup-pilot). Como sao routes diferentes que
 * nao compartilham o ToolsStateProvider em memoria, precisamos de
 * uma fonte unica de verdade no disco.
 */

const KEY_TEAM = 'darkolab:clickup-pilot:teamId';
const KEY_EDITOR = 'darkolab:clickup-pilot:editorId';

export function getPilotTeam(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(KEY_TEAM);
}
export function setPilotTeam(v: string | null): void {
  if (typeof window === 'undefined') return;
  if (v === null) localStorage.removeItem(KEY_TEAM);
  else localStorage.setItem(KEY_TEAM, v);
}

export function getPilotEditor(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(KEY_EDITOR);
}
export function setPilotEditor(v: string | null): void {
  if (typeof window === 'undefined') return;
  if (v === null) localStorage.removeItem(KEY_EDITOR);
  else localStorage.setItem(KEY_EDITOR, v);
}
