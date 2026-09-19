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
import { taskIdBaseDaVersao, versaoDoTaskId } from './versoes-ad';
import { modoDaTaskLocal } from './pilot-fontes';

/** Evento disparado na própria página quando ela JÁ é a dona da fila. */
export const EVENTO_ACAO_FILA = 'autoedit:fila-acao';
/** Evento que manda o card daquela task abrir os previews. */
export const EVENTO_ABRIR_CARD = 'autoedit:abrir-card';
/** Resposta da ferramenta: deu pra fazer, ou por que nao deu. */
export const EVENTO_RESULTADO = 'autoedit:fila-acao-resultado';
/** Onde a intenção espera quando a ação veio de OUTRA página. */
export const CHAVE_INTENCAO = 'autoedit:fila-intencao:v1';

export type AcaoFila = 'retomar' | 'debug' | 'abrir';

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

/**
 * Fases em que o disparo está TRABALHANDO — remontar/debug/remover ficam
 * travados só nelas. 'draft' (analisado, nunca disparado) e 'done'/'failed'
 * não são trabalho em curso: travar ali deixava o botão morto sem motivo.
 */
const FASES_ATIVAS = new Set(['queued', 'dispatching', 'rendering', 'downloading', 'post']);

export function faseAtiva(phase: string | undefined | null): boolean {
  return !!phase && FASES_ATIVAS.has(String(phase));
}

/**
 * Registro que o Pilot NUNCA transforma em card: arquivo morto, rascunho e a
 * fila do Hey Auto (que tem tela própria). O Pilot pula esses prefixos na
 * hidratação, então oferecer ação de card pra eles seria botão mudo.
 */
const PREFIXOS_SEM_CARD = ['archive:', 'pilot-draft:', 'heygenauto:'];

export function podeVirarCard(taskId: string | null | undefined): boolean {
  if (!taskId) return false;
  return !PREFIXOS_SEM_CARD.some((pre) => taskId.startsWith(pre));
}

/** Chaves do zip-store que pertencem a este disparo (usado ao remover). */
export function prefixosDoDisparo(taskId: string): string[] {
  return [`batch:${taskId}:`, `pilot:${taskId}:`, `va:${taskId}:`, `troca:white:${taskId}`];
}

/**
 * AS VERSÕES DO MESMO AD viram UMA linha só.
 *
 * O Pilot deixa gerar até 10 versões do mesmo anúncio (avatar diferente por
 * versão), e cada uma tem taskId próprio (`-v2`, `-yt`). No histórico elas
 * apareciam como registros repetidos, com o mesmo nome, e o dono tinha que
 * adivinhar quem era quem. Aqui elas se juntam por AD + tipo de registro, do
 * mesmo jeito que a fila do Pilot colapsa os cards, e a linha ganha o seletor.
 *
 * Só agrupa o que é do MESMO dia e do MESMO tipo: um disparo e a entrega dele
 * continuam sendo dois momentos distintos na linha do tempo.
 *
 * Registro REPETIDO da mesma versão não vira opção do seletor: o Pilot chegou a
 * gravar o mesmo disparo duas vezes com 13 segundos de diferença, e o menu
 * mostrava "v1" e "v1" — duas linhas que não se distinguem. Fica a mais nova.
 */
export type GrupoDeVersoes = {
  /** Identidade estável do grupo (serve de chave da escolha na tela). */
  chave: string;
  /** Da versão mais nova pra mais antiga, como o histórico já vinha. */
  eventos: HistoryEvent[];
};

/**
 * Junta as duas metades de UMA execução do Pilot.
 *
 * O durable-records grava o começo (`dispatch`) e a página grava a entrega
 * pronta, com as refs do arquivo. Isso é útil internamente, mas na interface
 * são a mesma task — mostrar duas linhas fazia parecer que o AD tinha sido
 * produzido duas vezes. A entrega absorve somente o dispatch imediatamente
 * anterior da MESMA task; um novo dispatch posterior continua visível como
 * uma reexecução real até que a respectiva entrega termine.
 *
 * O registro da entrega é a fonte dos arquivos/estado. O dispatch costuma ter
 * a nomenclatura completa do ClickUp, então ela vence quando for mais rica.
 */
export function consolidarCiclosDeDisparo(events: HistoryEvent[]): HistoryEvent[] {
  const ordenados = [...events].sort((a, b) => b.t - a.t);
  const absorvidos = new Set<number>();
  const taskIds = ordenados.map(taskIdDoEvento);

  return ordenados.flatMap((evento, indice) => {
    if (absorvidos.has(indice)) return [];
    const taskId = taskIds[indice];
    if (evento.kind === 'dispatch' || !taskId || !evento.ref?.length) return [evento];

    const indiceDoDisparo = ordenados.findIndex((candidato, i) =>
      i > indice &&
      !absorvidos.has(i) &&
      candidato.kind === 'dispatch' &&
      taskIds[i] === taskId,
    );
    if (indiceDoDisparo < 0) return [evento];

    absorvidos.add(indiceDoDisparo);
    const disparo = ordenados[indiceDoDisparo];
    const atualVisivel = tituloVisivelDoHistorico(evento.title);
    const disparoVisivel = tituloVisivelDoHistorico(disparo.title);
    const titulo = disparoVisivel.length > atualVisivel.length ? disparo.title : evento.title;
    return [{
      ...evento,
      title: titulo,
      channels: evento.channels?.length ? evento.channels : disparo.channels,
    }];
  });
}

export function agruparPorVersao(events: HistoryEvent[]): GrupoDeVersoes[] {
  const grupos: GrupoDeVersoes[] = [];
  const porChave = new Map<string, { grupo: GrupoDeVersoes; versoes: Set<number> }>();
  for (const e of events) {
    const taskId = taskIdDoEvento(e);
    const base = taskId ? taskIdBaseDaVersao(taskId) : null;
    // Sem task (ferramenta comum) cada registro é o seu próprio grupo.
    const chave = base ? `${base}|${e.kind}` : `ev:${e.id}`;
    const versao = taskId ? versaoDoTaskId(taskId) : 1;
    const existente = porChave.get(chave);
    if (existente) {
      // A lista chega da mais nova pra mais antiga: a primeira de cada versão
      // é a que vale, e a repetida vai embora em vez de virar um "v1" gêmeo.
      if (existente.versoes.has(versao)) continue;
      existente.versoes.add(versao);
      existente.grupo.eventos.push(e);
      continue;
    }
    const grupo: GrupoDeVersoes = { chave, eventos: [e] };
    porChave.set(chave, { grupo, versoes: new Set([versao]) });
    grupos.push(grupo);
  }
  return grupos;
}

/** Rótulo curto da versão de uma task ("v1", "v2"…). */
export function rotuloVersaoDoTaskId(taskId: string | null | undefined): string {
  if (!taskId) return '';
  return `v${versaoDoTaskId(taskId)}`;
}

/**
 * Nome que aparece na linha do histórico.
 *
 * "Entregue" é estado, não parte da nomenclatura do AD: a mesma linha já tem
 * o selo PRONTO. Remove apenas o sufixo de estado gravado pelos fluxos antigos
 * e preserva o resto byte a byte (inclusive "(VA)" e "(camuflado)").
 */
export function tituloVisivelDoHistorico(title: string): string {
  const original = String(title || '').trim();
  const limpo = original
    .replace(/\s+entregue(?=\s*(?:\([^)]*\))?\s*$)/i, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return limpo || original;
}

/**
 * DE ONDE VEIO O DISPARO: ClickUp, Creator ou Docs.
 *
 * É o mesmo critério do Pilot (o id da task carrega o prefixo da origem), e é
 * o que permite filtrar o histórico como o dono pensa: "me mostra só o que
 * saiu do ClickUp", "só o que eu escrevi no Creator".
 */
export type OrigemDoDisparo = 'clickup' | 'creator' | 'docs';

export function origemDoEvento(ev: HistoryEvent): OrigemDoDisparo | null {
  const taskId = taskIdDoEvento(ev);
  if (!taskId) return null;
  if (!podeVirarCard(taskId)) return null;
  const base = taskIdBaseDaVersao(taskId);
  const local = modoDaTaskLocal(base);
  return local === 'creator' || local === 'docs' ? local : 'clickup';
}

/** Janela de tempo do filtro de data, em dias (0 = hoje). */
export type JanelaDeDias = 0 | 1 | 7;

/**
 * Filtra por origem e por data. Registro sem origem (ferramenta comum) só
 * aparece quando nenhuma origem está escolhida — filtrar por "Creator" não
 * pode fazer o histórico do compressor sumir sem explicação.
 */
export function filtrarPorOrigemEData(
  events: HistoryEvent[],
  opts: { origem?: OrigemDoDisparo | null; dias?: JanelaDeDias | null; agora?: number },
): HistoryEvent[] {
  const origem = opts.origem ?? null;
  const dias = opts.dias ?? null;
  const agora = opts.agora ?? Date.now();
  const inicioDoDia = (t: number) => {
    const d = new Date(t);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  };
  const hoje = inicioDoDia(agora);
  return events.filter((e) => {
    if (origem && origemDoEvento(e) !== origem) return false;
    if (dias !== null) {
      const dia = inicioDoDia(e.t);
      const distancia = Math.round((hoje - dia) / 86400000);
      if (dias === 0 && distancia !== 0) return false;
      if (dias === 1 && distancia !== 1) return false;
      if (dias === 7 && (distancia < 0 || distancia > 7)) return false;
    }
    return true;
  });
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

/**
 * Quanto o histórico espera a ferramenta responder antes de desistir.
 *
 * Tem que ser MAIOR que o tempo que a ferramenta leva pra confirmar: o Pilot
 * troca de empresa/origem, espera a lista recarregar e só então diz se o card
 * apareceu (até ~2,5s). Com a espera curta demais, a linha dizia "a ferramenta
 * não respondeu" enquanto a janela de edição abria na frente do usuário.
 */
export const ESPERA_RESPOSTA_MS = 6000;

/**
 * Pede a ação e ESPERA a ferramenta dizer se deu certo.
 *
 * Existe porque "mandei o pedido" não é "aconteceu": o disparo pode ter
 * registro e mesmo assim não ter card na tela (a fila mostra só a empresa e a
 * origem selecionadas). Sem resposta, o histórico fechava a gaveta e o clique
 * morria em silêncio. Aqui a gaveta só fecha quando a ação aconteceu de fato.
 */
export function pedirAcaoEEsperar(
  acao: AcaoFila,
  taskId: string,
): Promise<{ ok: true } | { ok: false; motivo: string } | { navegar: string }> {
  const rota = rotaDaTask(taskId);
  const aqui = typeof window !== 'undefined' && window.location.pathname.startsWith(rota);
  if (!aqui) {
    salvarIntencao(acao, taskId);
    return Promise.resolve({ navegar: rota });
  }
  return new Promise((resolve) => {
    let respondeu = false;
    const ouvir = (e: Event) => {
      const d = (e as CustomEvent<{ taskId?: string; ok?: boolean; motivo?: string }>).detail;
      if (!d || d.taskId !== taskId || respondeu) return;
      respondeu = true;
      window.removeEventListener(EVENTO_RESULTADO, ouvir);
      clearTimeout(timer);
      resolve(d.ok ? { ok: true } : { ok: false, motivo: d.motivo || 'Não deu pra fazer isso agora.' });
    };
    const timer = setTimeout(() => {
      if (respondeu) return;
      respondeu = true;
      window.removeEventListener(EVENTO_RESULTADO, ouvir);
      resolve({ ok: false, motivo: 'A ferramenta não respondeu. Recarregue a página e tente de novo.' });
    }, ESPERA_RESPOSTA_MS);
    window.addEventListener(EVENTO_RESULTADO, ouvir);
    window.dispatchEvent(new CustomEvent(EVENTO_ACAO_FILA, { detail: { acao, taskId } }));
  });
}

/** A ferramenta responde ao pedido do histórico (sempre, deu certo ou não). */
export function responderAcaoDeFila(taskId: string, ok: boolean, motivo?: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(EVENTO_RESULTADO, { detail: { taskId, ok, motivo } }));
}
