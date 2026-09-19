/**
 * CHIP DE CANAL DO CARD (YOUTUBE / META / KWAI / TIKTOK…).
 *
 * O chip vem de um custom field do ClickUp, que só existe enquanto a task está
 * na listagem carregada. Bug real (2026-09-19): assim que o Silas movia a task
 * pra "revisão vídeo", ela saía do filtro de status, o board deixava de
 * conhecê-la e o chip **sumia do card** — de um AD que continuava ali, pronto.
 * Ligando o olho (incluir revisão) ele voltava. Ou seja: a informação existia,
 * mas era recalculada ao vivo a cada render em vez de ficar guardada.
 *
 * A regra aqui é uma só, e é a que faltava:
 *
 *   **o que já se sabe nunca é apagado por quem não sabe.**
 *
 * O board só serve pra PREENCHER o que falta. Uma listagem que não contém a
 * task devolve lista vazia — e lista vazia não é "esse AD não tem canal", é
 * "eu não sei". As duas coisas eram tratadas igual.
 *
 * Ver [[project_pilot_chip_de_canal_some_apos_revisao]].
 */

export type CanalChip = { label: string; color: string };

/** Igualdade de conteúdo — pra não regravar estado e disparar render à toa. */
export function mesmosCanais(a?: CanalChip[] | null, b?: CanalChip[] | null): boolean {
  const x = a || [];
  const y = b || [];
  if (x.length !== y.length) return false;
  return x.every((c, i) => c.label === y[i].label && c.color === y[i].color);
}

/**
 * O que o card mostra. O SNAPSHOT (gravado no registro do disparo) manda
 * sempre; o board é só o plano B pra card que ainda não tem snapshot.
 */
export function canaisDoCard(
  snapshot: CanalChip[] | null | undefined,
  doBoard: CanalChip[] | null | undefined,
): CanalChip[] {
  if (snapshot && snapshot.length) return snapshot;
  return doBoard || [];
}

/**
 * Vale gravar o snapshot agora? Só quando o board SABE algo e o registro
 * ainda não tem. Nunca grava vazio por cima do que já existe — era isso que
 * fazia o chip sumir quando a task saía do filtro.
 */
export function precisaGravarCanais(
  snapshot: CanalChip[] | null | undefined,
  doBoard: CanalChip[] | null | undefined,
): boolean {
  if (snapshot && snapshot.length) return false;
  return !!(doBoard && doBoard.length);
}

/** Sufixo da task IRMÃ de 2ª versão (espelha lib/versao-canal.ts). */
const SUFIXO_TASK_YT = '-yt';

/**
 * Qual id procurar no board pra descobrir o canal deste card.
 *
 * A 2ª versão roda como task IRMÃ, com id `<id>-yt`, que NÃO existe no
 * ClickUp. Procurar esse id no board nunca casava nada, então a irmã nascia e
 * morria sem chip nenhum — mesmo com o board aberto e a mãe ali do lado.
 * O canal é do AD, não da versão: as duas herdam o da mãe.
 */
export function idDoBoardParaCanal(taskId: string): string {
  return taskId.endsWith(SUFIXO_TASK_YT) ? taskId.slice(0, -SUFIXO_TASK_YT.length) : taskId;
}
