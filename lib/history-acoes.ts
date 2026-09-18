/**
 * AÇÕES DO HISTÓRICO — a parte pura.
 *
 * O histórico de um disparo não serve só pra baixar de novo: o Silas pediu os
 * MESMOS botões do card pronto do Pilot (baixar · remontar · debug · remover),
 * funcionando de verdade. Quem sabe remontar e reiniciar é a página do Pilot,
 * então aqui mora só a decisão — qual arquivo o botão entrega, de que disparo
 * o registro fala e pra onde a ação tem que ir. A execução é da ferramenta.
 *
 * Tudo testável no node (lib/history-acoes.test.ts): nada aqui toca React.
 */

import { canonicalTool, type Chain, type HistoryEvent } from './history-tools';

/** Evento disparado na própria página quando ela JÁ é a dona da fila. */
export const EVENTO_ACAO_FILA = 'autoedit:fila-acao';
/** Onde a intenção espera quando a ação veio de OUTRA página. */
export const CHAVE_INTENCAO = 'autoedit:fila-intencao:v1';

export type AcaoFila = 'retomar' | 'debug';

export type IntencaoFila = { acao: AcaoFila; taskId: string; t: number };

/**
 * De qual disparo este registro fala.
 *
 * Duas origens, nesta ordem:
 *  1. as referências de arquivo carregam `taskId` (refsDaEntregaPilot);
 *  2. o registro de DISPARO é criado pelo durable-records com o id
 *     `dispatch:<taskId>:<startedAt>` — e o taskId do Hey Auto tem ':' dentro
 *     (`heygenauto:heygen:<ts>:<rand>`), então o corte é no ÚLTIMO ':'.
 */
export function taskIdDoEvento(ev: HistoryEvent): string | null {
  for (const r of ev.ref ?? []) {
    const id = (r as { taskId?: string }).taskId;
    if (id) return id;
  }
  if (ev.id.startsWith('dispatch:')) {
    const corpo = ev.id.slice('dispatch:'.length);
    const corte = corpo.lastIndexOf(':');
    if (corte > 0) {
      const taskId = corpo.slice(0, corte);
      const carimbo = corpo.slice(corte + 1);
      if (taskId && /^\d+$/.test(carimbo)) return taskId;
    }
  }
  return null;
}

/** A ferramenta deste registro tem fila de disparo (card com Retomar/Debug)? */
export function temFilaDeDisparo(tool: string): boolean {
  const c = canonicalTool(tool);
  return c === 'clickup-pilot' || c === 'heygen-auto';
}

/** Rota da ferramenta dona do disparo (o Hey Auto marca o taskId no prefixo). */
export function rotaDaTask(taskId: string): string {
  return taskId.startsWith('heygenauto:') ? '/tools/heygen-auto' : '/tools/clickup-pilot';
}

/**
 * Só a página do Pilot sabe remontar/reiniciar um disparo ANTIGO pelo taskId.
 * O Hey Auto tem um card só, o da rodada atual — oferecer "remontar" num
 * disparo velho dele seria um botão que não faz nada.
 */
export function aceitaAcaoDeFila(taskId: string): boolean {
  return rotaDaTask(taskId) === '/tools/clickup-pilot';
}

/**
 * Qual arquivo o botão de download entrega.
 *
 * No disparo é SÓ O MONTADO (pedido do Silas: "só faz download dos montados
 * aqui no Pilot"). Takes e resgate do HeyGen continuam salvos na receita do
 * registro — quem precisa deles usa REMONTAR, que é o caminho certo — mas não
 * viram botão. Nas outras ferramentas o download é o arquivo do evento.
 */
export function chainDeDownload(ev: HistoryEvent, chains: Chain[]): Chain | null {
  if (chains.length === 0) return null;
  if (!temFilaDeDisparo(ev.tool)) return chains[0];
  const porRotulo = (alvo: string) =>
    chains.find((c) => c.refs.some((r) => (r.label || '').toLowerCase() === alvo));
  return (
    porRotulo('montado') ??
    porRotulo('camuflado') ??
    chains.find((c) => c.refs.every((r) => r.via !== 'heygen') && !/take/i.test(c.label)) ??
    null
  );
}

/** Chaves do zip-store que pertencem a este disparo (usado ao remover). */
export function prefixosDoDisparo(taskId: string): string[] {
  return [`batch:${taskId}:`, `pilot:${taskId}:`, `va:${taskId}:`, `troca:white:${taskId}`];
}

// ---------- Intenção entre páginas ----------------------------------------

/**
 * Guarda o pedido pra a página da fila executar quando abrir. Vale por pouco
 * tempo de propósito: intenção velha (usuário desistiu, voltou horas depois)
 * NUNCA pode reiniciar um disparo sozinha.
 */
export const VALIDADE_INTENCAO_MS = 60_000;

export function intencaoValida(i: IntencaoFila | null, agora = Date.now()): boolean {
  return !!i && agora - i.t <= VALIDADE_INTENCAO_MS && !!i.taskId;
}

export function salvarIntencao(acao: AcaoFila, taskId: string): void {
  if (typeof window === 'undefined') return;
  try {
    const i: IntencaoFila = { acao, taskId, t: Date.now() };
    sessionStorage.setItem(CHAVE_INTENCAO, JSON.stringify(i));
  } catch {
    /* sem sessionStorage a ação só não sobrevive à navegação */
  }
}

/**
 * Lê a intenção guardada. NÃO apaga: quem executa chama limparIntencao() ao
 * conseguir. Apagar na leitura perdia o pedido quando o React monta o efeito
 * duas vezes (StrictMode) — o primeiro mount consumia, o segundo não achava
 * nada e a ação sumia sem aviso. A janela de 1 minuto é que limita o estrago.
 */
export function lerIntencao(): IntencaoFila | null {
  if (typeof window === 'undefined') return null;
  try {
    const cru = sessionStorage.getItem(CHAVE_INTENCAO);
    if (!cru) return null;
    const i = JSON.parse(cru) as IntencaoFila;
    if (!intencaoValida(i)) {
      sessionStorage.removeItem(CHAVE_INTENCAO);
      return null;
    }
    return i;
  } catch {
    return null;
  }
}

/** Some com a intenção — chamado quando a ação foi executada de verdade. */
export function limparIntencao(): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.removeItem(CHAVE_INTENCAO);
  } catch {}
}

/**
 * Pede a ação pra a ferramenta dona da fila.
 * - já estamos na página dela → avisa por evento, sem recarregar nada;
 * - estamos em outra → guarda a intenção e devolve a rota pra navegar.
 */
export function pedirAcaoDeFila(
  acao: AcaoFila,
  taskId: string,
): { modo: 'aqui' } | { modo: 'navegar'; rota: string } {
  const rota = rotaDaTask(taskId);
  const aqui = typeof window !== 'undefined' && window.location.pathname.startsWith(rota);
  if (aqui) {
    window.dispatchEvent(new CustomEvent(EVENTO_ACAO_FILA, { detail: { acao, taskId } }));
    return { modo: 'aqui' };
  }
  salvarIntencao(acao, taskId);
  return { modo: 'navegar', rota };
}
