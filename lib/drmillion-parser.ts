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

/**
 * Idioma escolhido para o disparo.
 *
 * ⚠ `pl` e `hun` apontam para o MESMO balde interno — o do idioma que o avatar
 * FALA. O nome `pl` é herança do primeiro lote (polonês) e virou o nome do
 * campo em todo o ecossistema; quando o lote é húngaro, é o húngaro que mora
 * ali. Separar em dois baldes obrigaria a mexer no contrato de `hook`/`body`,
 * que atravessa parser, briefing, plano de cenas e disparo — e nada disso
 * ganharia nitidez com a mudança.
 *
 * `pt` continua sendo o GUIA que o copy escreve ao lado, nunca o que vai ao ar.
 */
export type DrMillionLang = 'pl' | 'pt' | 'hun';

/** `pt` é guia; qualquer outro idioma é o de disparo. */
function ehDisparo(lang: DrMillionLang): boolean {
  return lang !== 'pt';
}

/** Heading de AD: "AD07G1GL - COD WL PL". */
const AD_HEADING_RE = /^\s*(AD\d+[A-Z0-9]*)\s*[-–—]/i;
/**
 * Heading do corpo compartilhado.
 *
 * ⚠ Aceita `Body - AD1` além de `Body` puro: no lote WL2 não existe heading de
 * hook (`ADnnG1GL`) — quem delimita são as linhas `Hook - ADn` e `Body - ADn`.
 * Exigindo a linha inteira igual a "Body", o corpo nunca era achado e hook e
 * body saíam grudados num bloco só.
 */
const BODY_HEADING_RE = /^\s*body\s*(?:[-–—]\s*AD\s*\d+\s*)?$/i;

/** `Hook - AD1` — o delimitador de hook do dialeto sem heading de hook. */
const HOOK_ALT_RE = /^\s*hook\s*[-–—]\s*AD\s*\d+\s*$/i;
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

/** Uma linha que fecha a seção corrente (AD, Body, capa de bloco ou `Hook - ADn`). */
function ehFimDeSecao(linha: string): boolean {
  return AD_HEADING_RE.test(linha) || BODY_HEADING_RE.test(linha)
    || BLOCO_HEADING_RE.test(linha) || HOOK_ALT_RE.test(linha);
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

/** A linha é o rótulo de um falante, e não fala? */
function ehRotuloFalante(linha: string): boolean {
  if (LINHA_ESTRUTURAL_RE.test(linha)) return false;
  if (/[.!?…,]\s*$/.test(linha)) return false; // tem pontuação de frase: é fala
  return ROTULO_FALANTE_RE.test(linha);
}

/** Linha que existe no doc mas não é fala. */
function ehLinhaNaoFalada(linha: string): boolean {
  if (linha.length <= 2) return true; // resto de marcador ("P" solto no hook vazio)
  if (LINHA_ESTRUTURAL_RE.test(linha)) return true;
  return ehRotuloFalante(linha);
}
/**
 * Marcador de idioma isolado na linha.
 *
 * ⚠ `HUN` (três letras) vem ANTES de `HU` na alternância: o regex é ganancioso
 * da esquerda pra direita e `HU` casaria só o prefixo, deixando um `N` solto.
 * O lote ED BAK HUN escreve `HUN`, e sem esta forma o marcador não era
 * reconhecido — virava RÓTULO DE FALANTE (é uma palavra toda maiúscula) e o
 * húngaro inteiro caía no balde do português.
 */
const LANG_RE = /^\s*(PT|PL|HUN|HU)\s*$/i;

/**
 * Qual balde recebe cada marcador.
 *
 * O contrato do briefing tem dois campos por bloco — `pt` (o guia que o copy
 * escreve) e `pl` (o que o avatar FALA). O nome `pl` é herança do primeiro lote
 * (polonês) e virou o nome do campo em todo o ecossistema: quando o lote é
 * húngaro, é o húngaro que entra em `pl`. Regra: **português é guia, qualquer
 * outro idioma é o de disparo.**
 */
function baldeDoMarcador(m: string): 'pt' | 'pl' {
  return /^pt$/i.test(m.trim()) ? 'pt' : 'pl';
}
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
const LANG_FIM_RE = /^(.*?[^\s])[\s.,;:—–-]+(PT|PL|HUN|HU)\s*$/;
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
const LANG_INI_RE = /^\s*(PT|PL|HUN|HU)[\s.,;:—–-]+(\S.*)$/;

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

/** Uma linha de fala e de quem ela é (nos ADs em diálogo). */
type Fala = { texto: string; falante: string | null };

/** Fatia um bloco de linhas em { pt, pl }, guardando de quem é cada fala. */
function separarIdiomasComFalante(linhas: string[]): { pt: Fala[]; pl: Fala[] } {
  const pt: Fala[] = [];
  const pl: Fala[] = [];
  let atual: 'pt' | 'pl' | null = null;
  // O rótulo vale até o próximo — e é o MESMO nos dois idiomas, então cada
  // balde carrega o seu para não embaralhar quando as línguas se alternam.
  const falante: { pt: string | null; pl: string | null } = { pt: null, pl: null };
  /** `destino` só é passado no dialeto tabela, onde a coluna manda — nos outros
   *  a fala vai para o idioma corrente. */
  const empurrar = (texto: string, destino?: 'pt' | 'pl') => {
    const alvo = destino ?? atual;
    const limpa = limparLinhaFalada(texto);
    if (!limpa) return;
    if (alvo && ehRotuloFalante(limpa)) {
      falante[alvo] = limpa.replace(/\s*:\s*$/, '');
      return;
    }
    if (ehLinhaNaoFalada(limpa)) return;
    if (alvo === 'pt') pt.push({ texto: limpa, falante: falante.pt });
    else if (alvo === 'pl') pl.push({ texto: limpa, falante: falante.pl });
  };
  // ── DIALETO TABELA ────────────────────────────────────────────────────────
  // O Docs renderiza a tabela de duas colunas como CABEÇALHO + células:
  //
  //     PT  /  PL  /  <fala pt>  /  <fala pl>
  //
  // em vez do intercalado PT / <fala> / PL / <fala>. Quando dois ou mais
  // marcadores chegam SEGUIDOS, sem fala entre eles, eles são os cabeçalhos das
  // colunas — e as próximas falas são distribuídas NESSA ORDEM, uma por coluna.
  //
  // Sem isto, `atual` troca duas vezes seguidas e as DUAS línguas caem no balde
  // do segundo marcador: é a copy bilíngue dos 319 takes, com outra cara.
  // Medido em 01.09: 12 blocos assim no WL2 e 10 no ED BAK HUN, todos com
  // exatamente duas falas.
  let colunas: Array<'pt' | 'pl'> = [];   // cabeçalhos vistos em sequência
  let fila: Array<'pt' | 'pl'> = [];      // colunas ainda por preencher

  for (const raw of linhas) {
    const m = raw.match(LANG_RE);
    if (m) {
      const b = baldeDoMarcador(m[1]);
      colunas.push(b);
      atual = b;
      continue;
    }
    // marcador grudado no fim da linha: a fala ANTES dele ainda é do idioma
    // corrente; a troca vale da próxima linha em diante.
    const mf = raw.match(LANG_FIM_RE);
    if (mf) {
      empurrar(mf[1]);
      atual = baldeDoMarcador(mf[2]);
      colunas = [atual];
      fila = [];
      continue;
    }
    // marcador no começo: a troca vale JÁ para o resto desta linha.
    const mi = raw.match(LANG_INI_RE);
    if (mi) {
      atual = baldeDoMarcador(mi[1]);
      colunas = [atual];
      fila = [];
      empurrar(mi[2]);
      continue;
    }

    // primeira fala depois de 2+ cabeçalhos seguidos = tabela: abre a fila
    if (colunas.length > 1 && fila.length === 0) fila = [...colunas];
    if (fila.length) {
      const alvo = fila.shift()!;
      empurrar(raw, alvo);
      if (fila.length === 0) colunas = [];
      continue;
    }
    // intercalado: uma fala fecha a sequência de cabeçalhos
    colunas = [];
    empurrar(raw);
  }
  return { pt, pl };
}

/** A mesma fatia, só com o texto — é o que quase todo mundo aqui precisa. */
function separarIdiomas(linhas: string[]): { pt: string[]; pl: string[] } {
  const r = separarIdiomasComFalante(linhas);
  return { pt: r.pt.map((f) => f.texto), pl: r.pl.map((f) => f.texto) };
}

/** Agrupa falas consecutivas do mesmo falante — vira um bodySegment cada. */
function agruparPorFalante(falas: Fala[]): Array<{ role: string | null; text: string }> {
  const blocos: Array<{ role: string | null; text: string[] }> = [];
  for (const f of falas) {
    const ultimo = blocos[blocos.length - 1];
    if (ultimo && ultimo.role === f.falante) ultimo.text.push(f.texto);
    else blocos.push({ role: f.falante, text: [f.texto] });
  }
  return blocos.map((b) => ({ role: b.role, text: b.text.join('\n\n') }));
}

/**
 * O doc tem a estrutura bilíngue do DR MILLION para ESTE ad?
 *
 * Basta ter hook OU body: nada entra nesses baldes sem um marcador PT/PL ter
 * aparecido antes (ver separarIdiomasComFalante), então qualquer conteúdo aqui
 * já prova o formato — e doc do B2C, que não tem marcador, segue caindo fora.
 * Exigir os dois derrubava justo o AD49 e o AD67, cujo hook o doc deixou vazio:
 * eles voltavam pro parser comum e saíam bilíngues.
 */
export function isDrMillionFormat(docText: string, adId: string): boolean {
  const r = extrairBlocos(docText, adId);
  if (!r) return false;
  const { hook, body } = r;
  return hook.pt.length > 0 || hook.pl.length > 0 || body.pt.length > 0 || body.pl.length > 0;
}

/** Coração: acha o hook DO AD e o body DO GRUPO, já separados por idioma —
 *  e por FALANTE, que é o que impede um take de cruzar duas pessoas. */
function extrairBlocosComFalante(
  docText: string,
  adId: string,
): { hook: { pt: Fala[]; pl: Fala[] }; body: { pt: Fala[]; pl: Fala[] } } | null {
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
  // Id com token de variante ("AD07G1GL") exige casamento exato SEMPRE —
  // fallback de grupo aqui pegaria a copy do irmão (G2/G3).
  const ehVariante = /^AD\d+G\d/i.test(alvo);
  const candidatos: number[] = [];
  let iAdExato = -1;
  for (let i = 0; i < linhas.length; i++) {
    const m = linhas[i].match(AD_HEADING_RE);
    if (!m) continue;
    const id = m[1].toUpperCase();
    if (id === alvo && iAdExato < 0) {
      iAdExato = i;
      if (ehVariante) break;
      continue;
    }
    if (!ehVariante && adGroupOf(id) === grupo) candidatos.push(i);
  }
  const proxHeading = (i: number) => {
    for (let j = i + 1; j < linhas.length; j++) {
      if (ehFimDeSecao(linhas[j])) return j;
    }
    return linhas.length;
  };
  const temFala = (i: number) => secaoTemFala(linhas, i + 1, proxHeading(i));
  // ⚠ O doc pode ter DOIS headings com o id da task: a FICHA do grupo
  // ("AD01GL", só briefing) e o do hook ("AD01G1GL"). Casar exato com a ficha
  // deixava o hook de fora (lote ED BAK HUN, 01.09) — o exato só vence se a
  // seção dele tiver FALA; senão vale o primeiro heading do grupo que tem.
  let iAd = -1;
  if (iAdExato >= 0 && (ehVariante || temFala(iAdExato))) {
    iAd = iAdExato;
  } else {
    const fila = iAdExato >= 0 ? [iAdExato, ...candidatos] : candidatos;
    iAd = fila.find(temFala) ?? (fila.length ? fila[0] : -1);
  }
  if (iAd < 0) return null;

  // 2. Hook = do heading até o próximo heading (outro AD ou o Body).
  //
  // ⚠ No dialeto sem heading de hook (WL2), entre o heading do GRUPO e a fala
  // existe a ficha inteira (BRIEFING, INSTRUÇÕES, Avatar e Vozes…) e o hook só
  // começa depois da linha `Hook - ADn`. Sem pular até ela, o "hook" é a ficha:
  // não tem fala nenhuma e o AD sai sem gancho.
  let iIniHook = iAd + 1;
  for (let i = iAd + 1; i < linhas.length; i++) {
    if (AD_HEADING_RE.test(linhas[i]) || BODY_HEADING_RE.test(linhas[i])
        || BLOCO_HEADING_RE.test(linhas[i])) break;
    if (HOOK_ALT_RE.test(linhas[i])) { iIniHook = i + 1; break; }
  }
  let iFimHook = linhas.length;
  for (let i = iIniHook; i < linhas.length; i++) {
    if (ehFimDeSecao(linhas[i])) {
      iFimHook = i;
      break;
    }
  }
  const hook = separarIdiomasComFalante(linhas.slice(iIniHook, iFimHook));

  // 3. Body = o primeiro "Body" a partir daqui, desde que ainda seja do MESMO
  //    grupo. Se aparecer um AD de outro grupo antes, esse AD não tem body
  //    próprio (o corpo dele ficou pra trás — caso de doc fora do padrão).
  let iBody = -1;
  for (let i = iFimHook; i < linhas.length; i++) {
    if (BODY_HEADING_RE.test(linhas[i])) {
      iBody = i;
      break;
    }
    if (BLOCO_HEADING_RE.test(linhas[i])) break; // capa do próximo lote
    const m = linhas[i].match(AD_HEADING_RE);
    if (m && adGroupOf(m[1]) !== grupo) break; // entrou no próximo grupo
  }

  let body = { pt: [] as Fala[], pl: [] as Fala[] };
  if (iBody >= 0) {
    let iFimBody = linhas.length;
    for (let i = iBody + 1; i < linhas.length; i++) {
      if (ehFimDeSecao(linhas[i])) {
        iFimBody = i;
        break;
      }
    }
    body = separarIdiomasComFalante(linhas.slice(iBody + 1, iFimBody));
  }

  return { hook, body };
}

/** Só os textos — a forma pública, que o resto do app já consome. */
export function extrairBlocos(
  docText: string,
  adId: string,
): { hook: { pt: string[]; pl: string[] }; body: { pt: string[]; pl: string[] } } | null {
  const r = extrairBlocosComFalante(docText, adId);
  if (!r) return null;
  const so = (f: Fala[]) => f.map((x) => x.texto);
  return {
    hook: { pt: so(r.hook.pt), pl: so(r.hook.pl) },
    body: { pt: so(r.body.pt), pl: so(r.body.pl) },
  };
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
  const blocos = extrairBlocosComFalante(docText, adId);
  if (!blocos) return null;

  const escolher = (b: { pt: Fala[]; pl: Fala[] }) => {
    const preferido = ehDisparo(lang) ? b.pl : b.pt;
    if (preferido.length) return preferido;
    return ehDisparo(lang) ? b.pt : b.pl; // fallback: melhor a outra língua que nada
  };

  const hookFalas = escolher(blocos.hook);
  const bodyFalas = escolher(blocos.body);
  if (!hookFalas.length && !bodyFalas.length) return null;

  const hookText = hookFalas.map((f) => f.texto).join('\n').trim();
  const bodyText = bodyFalas.map((f) => f.texto).join('\n\n').trim();
  // Um segmento por FALANTE: o Pilot divide cada segmento separadamente e não
  // deixa um take cruzar duas pessoas. Nos ADs de diálogo (AD49, AD67) é o que
  // impede a Agnieszka de dizer a fala do médico. AD sem rótulo continua com um
  // segmento só — igual a antes.
  const segmentos = agruparPorFalante(bodyFalas);

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
    bodySegments: segmentos,
    gSiblings: [],
  };
}

/**
 * A copy do idioma escolhido saiu INTEIRA nos takes?
 *
 * Todo filtro deste arquivo (número de cena, rótulo de falante, linha de
 * estrutura, marcador de idioma) existe pra tirar o que não é fala — e todo
 * filtro pode um dia comer uma fala de verdade. Esta função é a rede: cobra
 * cada linha do idioma na concatenação dos takes gerados e devolve o que ficou
 * de fora. Contagem, avatar e voz não pegam isso; só a leitura pega, e é isso
 * que ela automatiza.
 *
 * A linha é cobrada na CONCATENAÇÃO (não em um take específico) porque o split
 * por duração pode partir uma linha longa entre dois takes — o que é legítimo.
 */
export function conferirCoberturaDaCopy(
  docText: string,
  adId: string,
  lang: DrMillionLang,
  textosGerados: string[],
): { total: number; faltando: string[] } {
  const blocos = extrairBlocosComFalante(docText, adId);
  if (!blocos) return { total: 0, faltando: [] };
  const escolher = (b: { pt: Fala[]; pl: Fala[] }) => {
    const preferido = ehDisparo(lang) ? b.pl : b.pt;
    return preferido.length ? preferido : ehDisparo(lang) ? b.pt : b.pl;
  };
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
  const tudo = norm(textosGerados.join(' '));
  const linhas = [...escolher(blocos.hook), ...escolher(blocos.body)].map((f) => norm(f.texto));
  return { total: linhas.length, faltando: linhas.filter((l) => l && !tudo.includes(l)) };
}

/** Qual idioma esse AD realmente tem? Alimenta o seletor PT/PL da tela. */
export function idiomasDisponiveis(
  docText: string,
  adId: string,
): { pt: boolean; pl: boolean; hun: boolean } {
  const b = extrairBlocos(docText, adId);
  if (!b) return { pt: false, pl: false, hun: false };
  const temDisparo = b.hook.pl.length > 0 || b.body.pl.length > 0;
  // ⚠ Qual das duas bandeiras acender vem do MARCADOR que o doc usa, não do
  // conteúdo: `pl` e `hun` dividem o mesmo balde, então olhar só o balde acende
  // sempre a polonesa — e o lote húngaro aparecia como se fosse polonês.
  const ehHun = marcadorDeDisparo(docText, adId) === 'hun';
  return {
    pt: b.hook.pt.length > 0 || b.body.pt.length > 0,
    pl: temDisparo && !ehHun,
    hun: temDisparo && ehHun,
  };
}

/**
 * Qual marcador de idioma de disparo o AD usa no doc — `pl` ou `hun`.
 *
 * Olha só a região daquele AD: um doc pode ter lotes de idiomas diferentes, e
 * varrer o documento inteiro devolveria o marcador do vizinho.
 */
export function marcadorDeDisparo(docText: string, adId: string): 'pl' | 'hun' {
  const linhas = String(docText || '').split(/\r?\n/);
  const alvo = adGroupOf(adId) || adId;
  let dentro = false;
  for (const l of linhas) {
    const h = l.match(AD_HEADING_RE);
    if (h) dentro = (adGroupOf(h[1]) || h[1]) === alvo;
    if (!dentro) continue;
    const m = l.match(LANG_RE) || l.match(LANG_FIM_RE) || l.match(LANG_INI_RE);
    if (!m) continue;
    const marca = (m[2] && /^(PT|PL|HUN|HU)$/i.test(m[2]) ? m[2] : m[1]) || '';
    if (/^hun?$/i.test(marca.trim())) return 'hun';
  }
  return 'pl';
}
