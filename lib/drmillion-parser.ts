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
    if (!limpa) return;
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
  let iAd = -1;
  for (let i = 0; i < linhas.length; i++) {
    const m = linhas[i].match(AD_HEADING_RE);
    if (m && m[1].toUpperCase() === alvo) {
      iAd = i;
      break;
    }
  }
  if (iAd < 0) return null;

  // 2. Hook = do heading até o próximo heading (outro AD ou o Body).
  let iFimHook = linhas.length;
  for (let i = iAd + 1; i < linhas.length; i++) {
    if (AD_HEADING_RE.test(linhas[i]) || BODY_HEADING_RE.test(linhas[i])) {
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
      if (AD_HEADING_RE.test(linhas[i]) || BODY_HEADING_RE.test(linhas[i])) {
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
