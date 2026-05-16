/**
 * Command-bus cross-aba pros jobs do DARKO LAB.
 *
 * O "motor" que de fato roda/retoma/pausa lipsyncs (HeyGen) e a fila
 * Magnific vive SO na pagina do ClickUp Pilot (runTaskInBackground,
 * resumeTaskBatch, processor serial). Outras telas (lipsync-history,
 * heygen-auto, auto-broll) nao tem esse motor.
 *
 * Pra os botoes Retomar/Pausar/Debug funcionarem dessas telas, elas
 * GRAVAM um comando aqui (localStorage) e o ClickUp Pilot CONSOME
 * (mount + polling, mesmo padrao ja usado pelo flag de cancelamento).
 *
 * - PAUSAR: so grava o comando (se houver aba ClickUp Pilot rodando o
 *   job, ela pausa; se nao ha worker, nao ha nada rodando mesmo).
 * - RETOMAR/DEBUG: gravam o comando e a tela chama navigateToEngine()
 *   pra abrir o ClickUp Pilot, que consome o comando no mount e executa
 *   no motor real. Assim "funciona" sem depender de aba previamente
 *   aberta.
 */

export type JobScope = 'heygen' | 'magnific';
export type JobAction = 'retomar' | 'pausar' | 'debug';

export type JobCommand = {
  id: string;
  scope: JobScope;
  taskId: string;
  action: JobAction;
  ts: number;
};

export const JOB_COMMANDS_KEY = 'darkolab:clickup-pilot:commands';
export const ENGINE_PATH = '/tools/clickup-pilot';

function readRaw(): JobCommand[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(JOB_COMMANDS_KEY);
    const arr = raw ? (JSON.parse(raw) as JobCommand[]) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function writeRaw(cmds: JobCommand[]) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(JOB_COMMANDS_KEY, JSON.stringify(cmds));
  } catch {}
}

/** Enfileira um comando. Dedup: substitui comando pendente anterior do
 *  mesmo (scope+taskId+action) pra nao acumular cliques repetidos. */
export function sendJobCommand(scope: JobScope, taskId: string, action: JobAction) {
  const cmds = readRaw().filter(
    (c) => !(c.scope === scope && c.taskId === taskId && c.action === action),
  );
  cmds.push({
    id: `${scope}:${taskId}:${action}:${Date.now()}`,
    scope,
    taskId,
    action,
    ts: Date.now(),
  });
  writeRaw(cmds);
}

/** Lido pelo ClickUp Pilot. Retorna os comandos pendentes. */
export function readJobCommands(): JobCommand[] {
  return readRaw().sort((a, b) => a.ts - b.ts);
}

/** ClickUp Pilot chama apos executar — remove o comando consumido. */
export function clearJobCommand(id: string) {
  writeRaw(readRaw().filter((c) => c.id !== id));
}

/** Limpa comandos velhos (> 10min) que nunca foram consumidos (ex:
 *  nenhuma aba ClickUp Pilot abriu). Evita lixo acumulado. */
export function pruneStaleJobCommands(maxAgeMs = 10 * 60 * 1000) {
  const now = Date.now();
  writeRaw(readRaw().filter((c) => now - c.ts < maxAgeMs));
}

/** Navega pro motor (ClickUp Pilot) pra que ele consuma o comando e
 *  execute no worker real. Usado por Retomar/Debug de outras telas. */
export function navigateToEngine() {
  if (typeof window === 'undefined') return;
  if (window.location.pathname.startsWith(ENGINE_PATH)) return; // ja esta la
  window.location.href = ENGINE_PATH;
}
