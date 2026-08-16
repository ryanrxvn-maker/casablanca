/**
 * Parser do formato DR MILLION — copy bilíngue PT/PL com body compartilhado.
 *
 * O doc do DR MILLION não se parece com o do B2C. Um grupo de AD é assim:
 *
 *   AD07GL - COD WL PL          ← briefing/instruções do grupo
 *   AD07G1GL - COD WL PL        ← hook 1   (uma task do ClickUp)
 *     PT  <hook em português>
 *     PL  <hook em polonês>
 *   AD07G2GL - COD WL PL        ← hook 2   (outra task)
 *   AD07G3GL - COD WL PL        ← hook 3   (outra task)
 *   Body                        ← CORPO ÚNICO — vale pros três hooks
 *     PT  <corpo em português>
 *     PL  <corpo em polonês>
 *   AD08GL - COD WL PL          ← começa o próximo grupo
 *
 * Duas consequências que quebravam o parser antigo:
 *  1. A seção de um hook termina no próximo heading, então o body — que vem
 *     DEPOIS de todos os hooks — ficava de fora ("não achou hooks nem body").
 *     O body pertence ao GRUPO (AD07), não ao hook.
 *  2. O texto vem nos dois idiomas na mesma seção. Lendo tudo junto, o avatar
 *     falaria português e polonês em sequência — e ainda leria em voz alta o
 *     "PT" e os números de cena ("2 Quando vi a balança...").
 *
 * Este módulo só é usado quando o doc TEM essa cara (ver isDrMillionFormat).
 * Doc do B2C nunca tem blocos PT/PL, então nada aqui roda pra ele.
 */

import type { ParsedDarkoBriefing } from './copy-parser';

export type DrMillionLang = 'pl' | 'pt';

/** Heading de AD: "AD07G1GL - COD WL PL". */
const AD_HEADING_RE = /^\s*(AD\d+[A-Z0-9]*)\s*[-–—]/i;
/** Heading do corpo compartilhado. */
const BODY_HEADING_RE = /^\s*body\s*$/i;
/**
 * Cabeçalho de BLOCO de ADs — "AD42 a 52", "AD01 à 06". Não é um AD: é a capa
 * do lote, seguida das instruções gerais de edição em português. Como não casa
 * com AD_HEADING_RE (não tem hífen), o Body do AD anterior seguia por cima dela
 * e o avatar terminava lendo "Instruções gerais para edição:" em voz alta.
 */
const BLOCO_HEADING_RE = /^\s*AD\d+\s*(?:a|à|até|-|–|—)\s*\d+\s*$/i;
/**
 * Linhas de ESTRUTURA do doc (sempre em português, nunca fala): rótulos de
 * briefing, separadores e a capa de entrega. Descartadas em qualquer posição —
 * é o cinto de segurança pra ruído que apareça no meio de um bloco.
 */
const LINHA_ESTRUTURAL_RE = new RegExp(
  [
    '^_{5,}$',
    '^\\s*criativos\\s*$',
    '^\\s*link da pasta',
    '^\\s*os criativos são para',
    '^\\s*fazer camuflagem',
    '^\\s*(?:instruções gerais para edição|instruções para edição|briefing para o copy',
    '|avatar e vozes|música de fundo|tipo de legenda|observações|edição|referência',
    '|atenção na voz|se atentar se a voz|referência de um áudio natural)\\b',
  ].join(''),
  'i',
);

/** Uma linha que fecha a seção corrente (AD, Body ou capa de bloco). */
function ehFimDeSecao(linha: string): boolean {
  return AD_HEADING_RE.test(linha) || BODY_HEADING_RE.test(linha) || BLOCO_HEADING_RE.test(linha);
}
/**
 * Rótulo de QUEM FALA, nos ADs em diálogo — "Marek Skoczylas:",
 * "Agnieszka Kotońska:", "Marek Skoczylas + Anita Werner". Aparece igual nos
 * dois idiomas, então não é filtrado pela troca PT/PL: sem isto o avatar lê o
 * nome do outro avatar em voz alta antes de cada bloco.
 *
 * Só nomes próprios (toda palavra capitalizada), no máximo 6 palavras, e sem
 * pontuação de frase — fala de verdade termina em . ! ? … ou vírgula.
 */
const ROTULO_FALANTE_RE =
  /^\s*\p{Lu}[\p{L}.'’-]*(?:\s+\p{Lu}[\p{L}.'’-]*){0,3}(?:\s*\+\s*\p{Lu}[\p{L}.'’-]*(?:\s+\p{Lu}[\p{L}.'’-]*){0,3})?\s*:?\s*$/u;

/** Linha que existe no doc mas não é fala. */
function ehLinhaNaoFalada(linha: string): boolean {
  if (linha.length <= 2) return true; // resto de marcador ("P" solto no hook vazio)
  if (LINHA_ESTRUTURAL_RE.test(linha)) return true;
  if (/[.!?…,]\s*$/.test(linha)) return false; // tem pontuação de frase: é fala
  return ROTULO_FALANTE_RE.test(linha);
}
/** Marcador de idioma isolado na linha. */
const LANG_RE = /^\s*(PT|PL)\s*$/i;
/**
 * O mesmo marcador, mas GRUDADO no fim da última linha do idioma anterior —
 * `"...quais roupas tamanho XS você comprou. PL"`. É como o doc do WL PL vem
 * escrito, e sem isto o parser nunca troca de idioma: despeja o polonês inteiro
 * no balde do português, o balde `pl` fica vazio, e o `escolher()` cai no
 * fallback devolvendo AS DUAS línguas juntas. O disparo então gera metade dos
 * takes em português — caro e inútil.
 *
 * Exige MAIÚSCULA e fim de linha pra não confundir com texto: "PL" no meio de
 * uma frase polonesa não vira marcador.
 */
const LANG_FIM_RE = /^(.*?[^\s])[\s.,;:—–-]+(PT|PL)\s*$/;
/**
 * O mesmo marcador colado no COMEÇO da primeira linha do idioma novo —
 * `"PT Minhas amigas riram de mim..."`. É a forma mais comum no doc do WL PL, e
 * ela engana duas vezes: não casa com LANG_RE (que exige a linha inteira) nem
 * com LANG_FIM_RE (que olha o fim). Sem tratar, a troca nunca acontece e o
 * disparo sai bilíngue.
 *
 * Exige maiúscula e um separador depois, pra "PL" iniciando frase polonesa de
 * verdade não virar marcador.
 */
const LANG_INI_RE = /^\s*(PT|PL)[\s.,;:—–-]+(\S.*)$/;

/** "AD07G1GL" → "AD07" (o grupo). É o que decide de quem é o Body. */
export function adGroupOf(adId: string): string | null {
  const m = String(adId || '').match(/^(AD\d+)/i);
  return m ? m[1].toUpperCase() : null;
}

/** Um heading de briefing ("AD37GL") não tem fala: é a seção de instruções de
 *  edição do grupo. O heading que interessa é o do hook ("AD37G1GL"), o único
 *  seguido dos marcadores PT/PL. */
function secaoTemFala(linhas: string[], ini: number, fim: number): boolean {
  const { pt, pl } = separarIdiomas(linhas.slice(ini, fim));
  return pt.length > 0 || pl.length > 0;
}

/**
 * Limpa o que não pode ser falado:
 *  • número de CENA no começo ("2 Quando vi..." → "Quando vi...") — indica
 *    b-roll, não é fala. Só 1-2 dígitos seguidos de espaço e letra/aspas,
 *    pra não comer "104 quilos" no meio de uma frase.
 *  • marcador de comentário do Google Docs no fim ("...vida.[t]").
 */
export function limparLinhaFalada(linha: string): string {
  return linha
    .replace(/\[[a-z]{1,3}\]\s*$/i, '')
    .replace(/^\s*[1-9]\d?\s+(?=[\p{Lu}„“"'(])/u, '')
    .trim();
}

/** Fatia um bloco de linhas em { pt, pl } pelos marcadores PT/PL. */
function separarIdiomas(linhas: string[]): { pt: string[]; pl: string[] } {
  const pt: string[] = [];
  const pl: string[] = [];
  let atual: 'pt' | 'pl' | null = null;
  const empurrar = (texto: string) => {
    const limpa = limparLinhaFalada(texto);
    if (!limpa || ehLinhaNaoFalada(limpa)) return;
    if (atual === 'pt') pt.push(limpa);
    else if (atual === 'pl') pl.push(limpa);
  };
  for (const raw of linhas) {
    const m = raw.match(LANG_RE);
    if (m) {
      atual = m[1].toLowerCase() as 'pt' | 'pl';
      continue;
    }
    // marcador grudado no fim da linha: a fala ANTES dele ainda é do idioma
    // corrente; a troca vale da próxima linha em diante.
    const mf = raw.match(LANG_FIM_RE);
    if (mf) {
      empurrar(mf[1]);
      atual = mf[2].toLowerCase() as 'pt' | 'pl';
      continue;
    }
    // marcador no começo: a troca vale JÁ para o resto desta linha.
    const mi = raw.match(LANG_INI_RE);
    if (mi) {
      atual = mi[1].toLowerCase() as 'pt' | 'pl';
      empurrar(mi[2]);
      continue;
    }
    empurrar(raw);
  }
  return { pt, pl };
}

/** O doc tem a estrutura bilíngue do DR MILLION para ESTE ad? */
export function isDrMillionFormat(docText: string, adId: string): boolean {
  const r = extrairBlocos(docText, adId);
  if (!r) return false;
  const { hook, body } = r;
  const temHook = hook.pt.length > 0 || hook.pl.length > 0;
  const temBody = body.pt.length > 0 || body.pl.length > 0;
  return temHook && temBody;
}

/** Coração: acha o hook DO AD e o body DO GRUPO, já separados por idioma. */
export function extrairBlocos(
  docText: string,
  adId: string,
): { hook: { pt: string[]; pl: string[] }; body: { pt: string[]; pl: string[] } } | null {
  const alvo = String(adId || '').toUpperCase();
  const grupo = adGroupOf(alvo);
  if (!alvo || !grupo) return null;

  const linhas = String(docText || '').split(/\r?\n/);

  // 1. Heading do AD pedido.
  //
  // Casamento EXATO primeiro. Mas a task do WL PL se chama "AD37 - GL - COD WL
  // PL" — o Pilot tira dela o id "AD37", e no doc não existe heading "AD37":
  // existem "AD37GL" (briefing do grupo) e "AD37G1GL" (o hook). Sem o fallback
  // abaixo, extrairBlocos devolvia null, isDrMillionFormat dava false e a
  // análise caía no parser comum — que lê PT e PL grudados e manda o avatar
  // falar as duas línguas. Era essa a origem dos 319 takes bilíngues, não o
  // formato do marcador.
  //
  // O fallback só vale quando o id pedido é o GRUPO puro ("AD37"): id com
  // sufixo ("AD07G1GL") continua exigindo casamento exato, senão um hook
  // pegaria a copy do irmão.
  const candidatos: number[] = [];
  let iAd = -1;
  for (let i = 0; i < linhas.length; i++) {
    const m = linhas[i].match(AD_HEADING_RE);
    if (!m) continue;
    const id = m[1].toUpperCase();
    if (id === alvo) {
      iAd = i;
      break;
    }
    if (alvo === grupo && adGroupOf(id) === grupo) candidatos.push(i);
  }
  if (iAd < 0 && candidatos.length) {
    // Entre os headings do grupo, fica o primeiro que realmente tem fala —
    // pular o de briefing é o ponto todo do fallback.
    const proxHeading = (i: number) => {
      for (let j = i + 1; j < linhas.length; j++) {
        if (ehFimDeSecao(linhas[j])) return j;
      }
      return linhas.length;
    };
    iAd = candidatos.find((i) => secaoTemFala(linhas, i + 1, proxHeading(i))) ?? candidatos[0];
  }
  if (iAd < 0) return null;

  // 2. Hook = do heading até o próximo heading (outro AD ou o Body).
  let iFimHook = linhas.length;
  for (let i = iAd + 1; i < linhas.length; i++) {
    if (ehFimDeSecao(linhas[i])) {
      iFimHook = i;
      break;
    }
  }
  const hook = separarIdiomas(linhas.slice(iAd + 1, iFimHook));

  // 3. Body = o primeiro "Body" a partir daqui, desde que ainda seja do MESMO
  //    grupo. Se aparecer um AD de outro grupo antes, esse AD não tem body
  //    próprio (o corpo dele ficou pra trás — caso de doc fora do padrão).
  let iBody = -1;
  for (let i = iFimHook; i < linhas.length; i++) {
    if (BODY_HEADING_RE.test(linhas[i])) {
      iBody = i;
      break;
    }
    const m = linhas[i].match(AD_HEADING_RE);
    if (m && adGroupOf(m[1]) !== grupo) break; // entrou no próximo grupo
  }

  let body = { pt: [] as string[], pl: [] as string[] };
  if (iBody >= 0) {
    let iFimBody = linhas.length;
    for (let i = iBody + 1; i < linhas.length; i++) {
      if (ehFimDeSecao(linhas[i])) {
        iFimBody = i;
        break;
      }
    }
    body = separarIdiomas(linhas.slice(iBody + 1, iFimBody));
  }

  return { hook, body };
}

/**
 * Monta o briefing no MESMO formato que o pipeline já consome
 * (ParsedDarkoBriefing), então disparo/montagem não mudam em nada.
 *
 * `lang` escolhe o idioma falado. O DR MILLION dispara em POLONÊS — o
 * português está no doc pra guiar. Se o idioma pedido não existir naquele
 * AD, cai no outro em vez de devolver copy vazia.
 */
export function parseDrMillionBriefing(
  docText: string,
  adId: string,
  lang: DrMillionLang = 'pl',
): ParsedDarkoBriefing | null {
  const blocos = extrairBlocos(docText, adId);
  if (!blocos) return null;

  const escolher = (b: { pt: string[]; pl: string[] }) => {
    const preferido = lang === 'pl' ? b.pl : b.pt;
    if (preferido.length) return preferido;
    return lang === 'pl' ? b.pt : b.pl; // fallback: melhor a outra língua que nada
  };

  const hookLinhas = escolher(blocos.hook);
  const bodyLinhas = escolher(blocos.body);
  if (!hookLinhas.length && !bodyLinhas.length) return null;

  const hookText = hookLinhas.join('\n').trim();
  const bodyText = bodyLinhas.join('\n\n').trim();

  return {
    baseAdId: String(adId).toUpperCase(),
    // O doc do DR MILLION não declara avatar (é o do anúncio sendo modelado)
    // — quem resolve é o botão "Adicionar avatar" na tela.
    avatars: [],
    hooks: hookText
      ? [{ label: 'HOOK 1', text: hookText, sourceG: 1, role: null }]
      : [],
    body: bodyText || null,
    bodyRole: null,
    bodySegments: bodyText ? [{ role: null, text: bodyText }] : [],
    gSiblings: [],
  };
}

/** Qual idioma esse AD realmente tem? Alimenta o seletor PT/PL da tela. */
export function idiomasDisponiveis(
  docText: string,
  adId: string,
): { pt: boolean; pl: boolean } {
  const b = extrairBlocos(docText, adId);
  if (!b) return { pt: false, pl: false };
  return {
    pt: b.hook.pt.length > 0 || b.body.pt.length > 0,
    pl: b.hook.pl.length > 0 || b.body.pl.length > 0,
  };
}
