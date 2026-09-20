'use client';

/**
 * QUEM PODE DIZER "NA FILA" — a regra pura do card do Pilot.
 *
 * Bug real (20.09.2026, AD01 - CREATOR): o disparo estava rodando (takes
 * rendendo no HeyGen) e o Silas clicou sem querer no ▶ Play da análise. O Play
 * reescrevia o estado pra 'queued' ANTES de chamar o porteiro (runHeyGenGated),
 * e o porteiro, vendo que JÁ existia um wrapper vivo pra aquela task, voltava
 * calado (dedup). Ninguém desfazia a marca: o card passou a mentir "NA FILA"
 * com o disparo andando, e o Retomar ficou travado (o card desabilita Retomar
 * em 'queued', o que está CERTO — quem espera vaga não tem o que retomar).
 * A fase só se corrigia sozinha no próximo write do run — foi o "BAIXANDO" que
 * apareceu ~4min depois, sem nenhuma outra task na frente.
 *
 * Duas regras, as duas testadas aqui:
 *  1. Ninguém re-enfileira um disparo que já está de pé (o clique é no-op).
 *  2. 'queued' com a vaga JÁ na mão é mentira — e mentira que ainda embaralha
 *     a contagem de vagas (a task some do countActiveSlots e o porteiro acha
 *     que sobrou vaga).
 */

export type FaseDoCard =
  | 'queued'
  | 'dispatching'
  | 'rendering'
  | 'downloading'
  | 'post'
  | 'done'
  | 'failed'
  | 'waiting-heygen'
  | 'recoverable';

/** Fases que OCUPAM vaga do HeyGen. Espelha ACTIVE_BATCH_PHASES do Pilot. */
export const FASES_ATIVAS: ReadonlyArray<FaseDoCard> = [
  'dispatching',
  'rendering',
  'downloading',
  'post',
];

export function faseEstaAtiva(fase: FaseDoCard | null | undefined): boolean {
  return !!fase && FASES_ATIVAS.includes(fase);
}

/**
 * O disparo dessa task já está de pé? Então o ▶ Play (e qualquer outro
 * enfileirador) não pode tocar no estado: nem marcar 'queued', nem zerar
 * takes/relógio. Vale tanto pra quem espera vaga quanto pra quem já roda.
 *
 * `wrapperVivo` = heygenPendingRef tem entrada pra task (porteiro em pé —
 * esperando vaga OU rodando). É a fonte mais fiel: sobrevive ao instante em
 * que o estado React ainda não refletiu a fase nova.
 */
export function disparoJaEmAndamento(args: {
  fase?: FaseDoCard | null;
  wrapperVivo?: boolean;
}): boolean {
  if (args.wrapperVivo) return true;
  return args.fase === 'queued' || faseEstaAtiva(args.fase);
}

/**
 * O card está MENTINDO "na fila"? Só quando a task diz 'queued' e o porteiro
 * dela já pegou a vaga (está rodando de fato). Rede de segurança do watchdog:
 * qualquer caminho futuro que volte a escrever 'queued' por cima de um run
 * vivo se conserta sozinho no tique seguinte, em vez de travar o Retomar.
 */
export function cardMenteNaFila(args: {
  fase?: FaseDoCard | null;
  comVagaNaMao?: boolean;
}): boolean {
  return args.fase === 'queued' && !!args.comVagaNaMao;
}

/**
 * Uma task ocupa vaga quando está numa fase ativa OU quando o porteiro dela
 * está com a vaga na mão (mesmo que a fase, por um instante ou por engano,
 * diga outra coisa). Sem a segunda metade, a mentira "na fila" fazia a
 * auto-cura do contador achar que nada rodava e liberar uma vaga a mais.
 */
export function ocupaVaga(args: {
  fase?: FaseDoCard | null;
  comVagaNaMao?: boolean;
  kind?: string;
}): boolean {
  if (args.kind === 'troca') return false; // pipeline próprio, fora do HeyGen
  return faseEstaAtiva(args.fase) || !!args.comVagaNaMao;
}
