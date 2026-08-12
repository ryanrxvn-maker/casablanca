/**
 * Config persistente do ClickUp Pilot — workspace + editor escolhidos.
 *
 * Persistido em localStorage pra ser lido tanto pela ferramenta
 * (/tools/clickup-pilot) quanto pela pagina de config
 * (/configuracoes/clickup-pilot). Como sao routes diferentes que
 * nao compartilham o ToolsStateProvider em memoria, precisamos de
 * uma fonte unica de verdade no disco.
 *
 * MULTI-EMPRESA (2026-08-12): o mesmo token do ClickUp enxerga mais de um
 * workspace (B2C e DR MILLION). O que muda entre eles NAO e o token — e o
 * fluxo: cada empresa nomeia os status do seu jeito. Por isso a config de
 * status e ADITIVA e POR WORKSPACE:
 *
 *   filtro final = statuses globais (o de sempre)  +  extras do workspace ativo
 *
 * O B2C nao tem extras, entao o filtro dele continua sendo exatamente o
 * mesmo de antes — byte a byte, mesma chave de localStorage. Nada no fluxo
 * que ja funciona foi tocado.
 */

const KEY_TEAM = 'darkolab:clickup-pilot:teamId';
const KEY_EDITOR = 'darkolab:clickup-pilot:editorId';
const KEY_EDITOR_BY_TEAM = 'darkolab:clickup-pilot:editorId:'; // + teamId
const KEY_EXTRA_STATUSES = 'darkolab:clickup-pilot:extra-statuses:'; // + teamId

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

/* ══════════════ Editor por workspace ══════════════
 * Cada empresa tem seu time. Guardar um editor global só funciona porque
 * hoje o editor é você nos dois — mas se você olhar as tasks de outra
 * pessoa no DR MILLION, essa escolha não pode vazar pro B2C.
 * Fallback pro editor global: quem já usava não perde a escolha salva. */

export function getPilotEditorForTeam(teamId: string | null): string | null {
  if (typeof window === 'undefined' || !teamId) return getPilotEditor();
  return localStorage.getItem(KEY_EDITOR_BY_TEAM + teamId) ?? getPilotEditor();
}

/** Só o valor salvo PARA esse workspace — sem cair no global.
 *  Existe pra troca de empresa não herdar o editor da outra: se você olhar
 *  as tasks do Gabriel no DR MILLION, o B2C não pode voltar filtrado nele. */
export function getPilotEditorForTeamStrict(teamId: string | null): string | null {
  if (typeof window === 'undefined' || !teamId) return null;
  return localStorage.getItem(KEY_EDITOR_BY_TEAM + teamId);
}

export function setPilotEditorForTeam(
  teamId: string | null,
  v: string | null,
): void {
  if (typeof window === 'undefined') return;
  if (teamId) {
    if (v === null) localStorage.removeItem(KEY_EDITOR_BY_TEAM + teamId);
    else localStorage.setItem(KEY_EDITOR_BY_TEAM + teamId, v);
  }
  // Mantém o global em sincronia — é o que o resto do app (e a página de
  // configurações) continua lendo.
  setPilotEditor(v);
}

/* ══════════════ Nomes dos workspaces ══════════════
 * O Pilot é o único que chama listTeams(). Outras telas (histórico) só têm
 * o id gravado no batch — sem este mapa elas mostrariam "9011541935" no
 * lugar de "DR MILLION". */

const KEY_TEAM_NAMES = 'darkolab:clickup-pilot:team-names';

export function setPilotTeamNames(map: Record<string, string>): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(KEY_TEAM_NAMES, JSON.stringify(map));
  } catch {
    /* storage cheio — rótulo cai pro id, não quebra nada */
  }
}

export function getPilotTeamNames(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(KEY_TEAM_NAMES);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

/* ══════════════ Status extras por workspace ══════════════ */

/** Variantes de "refação vídeo" — status que só o DR MILLION usa.
 *  A API do ClickUp casa o nome EXATO, então mandamos todas as grafias;
 *  a que não existir no workspace simplesmente não casa com nada. */
export const REFACAO_STATUSES = [
  'refação vídeo',
  'refacao video',
  'refação video',
  'refacao vídeo',
];

/** Semente por NOME do workspace (não por id — se você trocar de conta ou
 *  recriar o workspace, continua funcionando). */
export function defaultExtraStatusesForTeamName(name: string | undefined | null): string[] {
  const n = (name || '').trim();
  if (!n) return [];
  if (/b2c/i.test(n)) return []; // B2C: nada a somar — fluxo intocado
  if (/mil+i?on/i.test(n)) return [...REFACAO_STATUSES];
  return [];
}

/** Extras salvos pra esse workspace. `null` = nunca configurado (o chamador
 *  deve semear com defaultExtraStatusesForTeamName). */
export function getPilotStatusExtras(teamId: string | null): string[] | null {
  if (typeof window === 'undefined' || !teamId) return null;
  const raw = localStorage.getItem(KEY_EXTRA_STATUSES + teamId);
  if (raw === null) return null;
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function setPilotStatusExtras(teamId: string | null, list: string[]): void {
  if (typeof window === 'undefined' || !teamId) return;
  const clean = list.map((s) => s.trim()).filter(Boolean);
  localStorage.setItem(KEY_EXTRA_STATUSES + teamId, clean.join(','));
}

/** Extras EFETIVOS: usa o que está salvo; se nunca foi configurado, semeia
 *  pelo nome do workspace e persiste (assim aparece na tela de config). */
export function resolveStatusExtras(
  teamId: string | null,
  teamName: string | undefined | null,
): string[] {
  if (!teamId) return [];
  const saved = getPilotStatusExtras(teamId);
  if (saved !== null) return saved;
  const seeded = defaultExtraStatusesForTeamName(teamName);
  setPilotStatusExtras(teamId, seeded);
  return seeded;
}

/** Junta o filtro global com os extras do workspace, sem duplicar.
 *  Com extras vazios (B2C) devolve exatamente a lista recebida. */
export function mergeStatuses(base: string[], extras: string[]): string[] {
  if (!extras.length) return base;
  const out = [...base];
  const seen = new Set(base.map((s) => s.toLowerCase()));
  for (const s of extras) {
    const k = s.toLowerCase();
    if (!seen.has(k)) {
      seen.add(k);
      out.push(s);
    }
  }
  return out;
}

/* ══════════════ Rótulo curto pro seletor ══════════════ */

/** "B2c  Workspace" → "B2C" · "DR MILLION" → "DR MILLION".
 *  Workspace pessoal (nome de gente) vira só o primeiro nome — "Silas Ryan
 *  Souza da Silva" truncado no botão fica ilegível e ocupa o dobro. */
export function shortWorkspaceLabel(name: string | undefined | null): string {
  const n = (name || '').replace(/\s+/g, ' ').trim();
  if (!n) return 'Workspace';
  if (/b2c/i.test(n)) return 'B2C';
  if (/mil+i?on/i.test(n)) return 'DR MILLION';
  const base = n.replace(/\bworkspace\b/i, '').trim() || n;
  const palavras = base.split(' ');
  if (palavras.length >= 3) return palavras[0].toUpperCase(); // nome de pessoa
  if (base.length <= 16) return base.toUpperCase();
  return base.slice(0, 15).trimEnd().toUpperCase() + '…';
}

/** Cor do workspace no seletor — presa à EMPRESA, não à posição na lista.
 *  Sem isso o B2C mudava de cor conforme a ordem em que o ClickUp devolve
 *  os workspaces, e o sinal periférico ("qual empresa estou?") se perde. */
export function workspaceAccent(
  name: string | undefined | null,
): 'lime' | 'violet' | 'cyan' {
  const n = (name || '').trim();
  if (/b2c/i.test(n)) return 'lime';
  if (/mil+i?on/i.test(n)) return 'violet';
  return 'cyan';
}

/** Empresas primeiro (B2C, DR MILLION), workspace pessoal por último.
 *  Estável: preserva a ordem original dentro de cada grupo. */
export function sortWorkspacesForSwitch<T extends { name?: string }>(list: T[]): T[] {
  const rank = (n: string | undefined) => {
    if (/b2c/i.test(n || '')) return 0;
    if (/mil+i?on/i.test(n || '')) return 1;
    return 2;
  };
  return list
    .map((item, i) => ({ item, i }))
    .sort((a, b) => rank(a.item.name) - rank(b.item.name) || a.i - b.i)
    .map(({ item }) => item);
}
