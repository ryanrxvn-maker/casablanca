/**
 * DUAS VERSÕES POR AD — META e YouTube (2026-08-22).
 *
 * O PEDIDO: todo AD tem duas versões. A do **META** é a editada (decupagem +
 * zoom + b-roll + SFX + trilha) e a do **YouTube** é só o avatar decupado com
 * zoom. Quando o avatar indicado é o MESMO nos dois canais, a versão YouTube
 * reaproveita o avatar decupado que já vai pra edição — não custa geração
 * nenhuma, a diferença mora só no CapCut. Quando o doc indica avatar (ou look)
 * DIFERENTE pro YouTube, aí sim é preciso **gerar de novo**.
 *
 * Por isso a função só liga quando o doc PEDE: ligar por padrão dobraria a
 * conta do HeyGen em lote (num doc real de 53 ADs, só 18 pediam avatar
 * diferente — os outros 35 sairiam pagos duas vezes à toa).
 *
 * INVARIANTES (travadas em versao-canal.test.ts):
 *  1. O canal META é o caminho de HOJE, byte a byte: mesmo nome de arquivo,
 *     mesma chave de IndexedDB. Nada que funciona é desfeito.
 *  2. O canal YouTube NUNCA colide com o META — nem em nome, nem em chave.
 *  3. `precisaGerarDeNovo` só é true quando existe avatar de YouTube que
 *     DIFERE do de META em algum papel. Igual, vazio ou ausente ⇒ false.
 *  4. `avatarDoCanal` cai no avatar do META sempre que o do YouTube falta —
 *     um slot sem escolha nunca dispara com avatar vazio.
 */

export type VersaoCanal = 'meta' | 'youtube';

/** As duas versões, na ordem em que são produzidas (META primeiro: é a que já
 *  existia, e a do YouTube pode reaproveitar o resultado dela). */
export const CANAIS: VersaoCanal[] = ['meta', 'youtube'];

/** Rótulo pra UI e pra mensagem de progresso. */
export function rotuloCanal(canal: VersaoCanal): string {
  // O canal virou detalhe INTERNO (02.09): na tela e no arquivo isto é
  // "Versão 1" e "Versão 2". Ver [[lib/versoes-ad.ts]].
  return canal === 'youtube' ? 'Versão 2' : 'Versão 1';
}

/**
 * Sufixo no nome do arquivo entregue. A versão 1 fica SEM sufixo de propósito:
 * é o nome que a edição, a entrega e o Drive já esperam (`AD06G1GL.mp4`).
 *
 * A 2 saía `_YOUTUBE`. Virou `_V2` em 02.09 — o mesmo sufixo que as versões
 * 3..10 já usavam. Silas: *"nunca colocar na nomenclatura: YouTube, nem META
 * e sim versão 1, 2 e etc"*.
 */
export function sufixoCanal(canal: VersaoCanal): string {
  return canal === 'youtube' ? '_V2' : '';
}

/** `AD06G1GL.mp4` + a 2ª versão → `AD06G1GL_V2.mp4`. A 1ª devolve igual. */
export function nomeComCanal(filename: string, canal: VersaoCanal): string {
  const sufixo = sufixoCanal(canal);
  if (!sufixo) return filename;
  const ponto = filename.lastIndexOf('.');
  if (ponto <= 0) return filename + sufixo;
  return filename.slice(0, ponto) + sufixo + filename.slice(ponto);
}

/**
 * Chave de entrega no IndexedDB. As duas versões coexistem: hoje a chave é
 * `batch:<id>:montado` e ela CONTINUA sendo a do META — a do YouTube ganha um
 * segmento próprio. Sem isso a segunda versão sobrescreveria a primeira.
 */
export function chaveEntregaCanal(chaveBase: string, canal: VersaoCanal): string {
  if (canal === 'meta') return chaveBase;
  // `batch:<id>:montado` → `batch:<id>:yt:montado`
  const corte = chaveBase.lastIndexOf(':');
  if (corte < 0) return `${chaveBase}:yt`;
  return `${chaveBase.slice(0, corte)}:yt${chaveBase.slice(corte)}`;
}

/**
 * A versão YouTube roda como TASK IRMÃ: mesmo runner, mesmo gate, mesma
 * montagem, mesmo RETOMAR — só com os avatares do YouTube. Sai de graça toda a
 * blindagem que o disparo já tem, sem duplicar uma linha do runner.
 *
 * O separador é `-` e NÃO `:` de propósito: as chaves do IndexedDB são
 * purgadas por prefixo (`pilot:<taskId>:`), e um `::yt` deixaria a task irmã
 * DENTRO do prefixo da mãe — o disparo do zero do META apagaria os artefatos
 * do YouTube junto.
 */
const SUFIXO_TASK_YT = '-yt';

/** Id da task daquele canal. META devolve o id original, intocado. */
export function taskIdDoCanal(taskId: string, canal: VersaoCanal): string {
  return canal === 'youtube' ? taskId + SUFIXO_TASK_YT : taskId;
}

/** De que canal é esta task? */
export function canalDoTaskId(taskId: string): VersaoCanal {
  return taskId.endsWith(SUFIXO_TASK_YT) ? 'youtube' : 'meta';
}

/** Id da task MÃE (a do META). Task de META devolve ela mesma. */
export function taskIdBase(taskId: string): string {
  return taskId.endsWith(SUFIXO_TASK_YT) ? taskId.slice(0, -SUFIXO_TASK_YT.length) : taskId;
}

/** O mínimo que um papel precisa ter pra virar take. */
export type EscolhaAvatar = {
  avatarId?: string | null;
  avatarName?: string | null;
  avatarThumb?: string | null;
  avatarVoiceId?: string | null;
  /** MODO IMAGEM (30.08): a versao troca o FRAME, nao o avatar da biblioteca.
   *  Quem esta em modo imagem nao tem `avatarId` nenhum — o que identifica a
   *  escolha e' a chave do frame. */
  imageKey?: string | null;
  imageDataUrl?: string | null;
  imageName?: string | null;
};

/** Um papel do AD com a escolha de cada canal. `youtube` ausente = mesmo do META. */
export type PapelCanal = EscolhaAvatar & {
  /** escolha SÓ do YouTube; `null`/ausente significa "usa a do META" */
  youtube?: EscolhaAvatar | null;
};

/** Avatar efetivo do papel naquele canal. YouTube sem escolha cai no do META. */
export function avatarDoCanal(papel: PapelCanal, canal: VersaoCanal): EscolhaAvatar {
  if (canal === 'meta') return papel;
  const y = papel.youtube;
  // MODO IMAGEM: o que muda no canal e' o FRAME. Voz e nome continuam do papel
  // — e' a mesma pessoa em outra foto, nao outra pessoa.
  if (y && !y.avatarId && y.imageKey) {
    return {
      ...papel,
      imageKey: y.imageKey,
      imageDataUrl: y.imageDataUrl ?? null,
      imageName: y.imageName ?? papel.imageName ?? null,
    };
  }
  if (!y || !y.avatarId) return papel;
  return {
    avatarId: y.avatarId,
    avatarName: y.avatarName ?? papel.avatarName ?? null,
    avatarThumb: y.avatarThumb ?? papel.avatarThumb ?? null,
    // voz do YouTube só troca se foi escolhida; senão continua a do papel
    avatarVoiceId: y.avatarVoiceId ?? papel.avatarVoiceId ?? null,
  };
}

/**
 * A versão YouTube exige geração NOVA no HeyGen?
 *
 * Só quando algum papel tem avatar de YouTube diferente do de META. É a
 * pergunta que decide custo: `false` = a versão YouTube é o mesmo decupado
 * (zero crédito), `true` = segundo disparo.
 */
export function precisaGerarDeNovo(papeis: PapelCanal[]): boolean {
  return papeis.some((p) => {
    const y = p.youtube;
    if (!y) return false;
    // frame proprio no canal = segundo disparo, mesmo sem avatar de biblioteca
    if (!y.avatarId) return !!y.imageKey && y.imageKey !== (p.imageKey || null);
    return y.avatarId !== p.avatarId;
  });
}

/** Quais papéis mudam no YouTube — pro relatório antes de gastar crédito. */
export function papeisQueMudam(papeis: PapelCanal[]): number[] {
  const fora: number[] = [];
  papeis.forEach((p, i) => {
    const y = p.youtube;
    if (!y) return;
    if (y.avatarId ? y.avatarId !== p.avatarId : !!y.imageKey && y.imageKey !== (p.imageKey || null)) {
      fora.push(i);
    }
  });
  return fora;
}

/** O plano das duas versões, pronto pra guardar no estado da fila. */
export type PlanoDuasVersoes = {
  /** ligado só quando o doc pede — desligado, TUDO se comporta como hoje */
  ativo: boolean;
  /** true = segundo disparo; false = a versão YouTube é o mesmo decupado */
  gerarDeNovo: boolean;
  /** motivo em português, pro card e pro relatório de custo */
  motivo: string;
};

/** Monta o plano a partir dos papéis já escolhidos. */
export function planejarDuasVersoes(ativo: boolean, papeis: PapelCanal[]): PlanoDuasVersoes {
  if (!ativo) {
    return { ativo: false, gerarDeNovo: false, motivo: 'versão única (META)' };
  }
  const mudam = papeisQueMudam(papeis);
  if (!mudam.length) {
    return {
      ativo: true,
      gerarDeNovo: false,
      motivo: 'mesmo avatar nos dois canais — YouTube reaproveita o decupado',
    };
  }
  return {
    ativo: true,
    gerarDeNovo: true,
    motivo:
      mudam.length === 1
        ? 'avatar diferente no YouTube em 1 papel — gera de novo'
        : `avatar diferente no YouTube em ${mudam.length} papéis — gera de novo`,
  };
}
