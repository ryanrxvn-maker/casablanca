/**
 * AUTO CORTES · CURADOR LOCAL — léxico de marcadores (PT primeiro, EN e ES juntos).
 *
 * É aqui que mora o "editor-chefe" que antes vivia no prompt: as famílias de
 * expressões que dizem se uma frase ABRE bem, FECHA bem, tem emoção, é
 * logística/agradecimento ou depende de contexto que ficou pra trás.
 *
 * Casamento é por FRASE FEITA sobre o texto normalizado (` gancho `), então
 * `" o segredo "` casa "…qual é o segredo disso" e não casa "segredos".
 *
 * PURO: sem DOM, sem rede, sem relógio.
 */

import { normalizeForMatch } from './text';
import { fillersFor, resolveLangs, stopwordsFor, type FillerSets, type LangCode } from './stopwords';

export type LexFamily =
  | 'hook'
  | 'contrast'
  | 'imperative'
  | 'superlative'
  | 'question'
  | 'emotion'
  | 'laughter'
  | 'logistics'
  | 'externalRef';

type FamilyByLang = Record<LexFamily, Record<LangCode, string[]>>;

// ───────────────────────────────────────────────────────────────────────────
// As listas
// ───────────────────────────────────────────────────────────────────────────

const LEX: FamilyByLang = {
  // Abre criando tensão, promessa, curiosidade ou revelação.
  hook: {
    pt: [
      'a verdade e', 'a verdade sobre', 'ninguem fala', 'ninguem te conta',
      'ninguem comenta', 'o que ninguem', 'o segredo', 'o problema e',
      'o erro que', 'o maior erro', 'muita gente acha', 'muita gente pensa',
      'todo mundo acha', 'todo mundo pensa', 'todo mundo faz', 'eu descobri',
      'eu aprendi', 'eu vou te contar', 'eu vou te dar', 'eu vou te mostrar',
      'deixa eu te contar', 'presta atencao', 'escuta isso', 'voce sabia',
      'voce ja parou', 'imagina', 'nunca pensei',
      'o dia em que', 'foi quando eu', 'no dia que', 'existe um jeito',
      'tem um jeito', 'poucas pessoas', 'quase ninguem', 'isso mudou tudo',
      'mudou a minha vida', 'me custou', 'quase quebrei', 'eu quebrei',
      'o custo escondido', 'a parte que', 'opiniao impopular', 'vou ser sincero',
      'vou ser honesto', 'confesso que', 'admito que', 'o pulo do gato',
      'a real e', 'na pratica', 'te dou um numero', 'olha o numero',
    ],
    en: [
      'the truth is', 'the truth about', 'nobody talks', 'no one talks',
      'nobody tells you', 'the secret', 'the problem is', 'the mistake',
      'the biggest mistake', 'most people think', 'everyone thinks',
      'i discovered', 'i learned', 'let me tell you', 'let me show you',
      'pay attention', 'listen to this', 'did you know', 'imagine',
      'i never thought', 'the day i', 'it changed my life',
      'it cost me', 'unpopular opinion', 'to be honest', 'i confess',
      'here is the thing', 'the hidden cost',
    ],
    es: [
      'la verdad es', 'la verdad sobre', 'nadie habla', 'nadie te cuenta',
      'el secreto', 'el problema es', 'el error', 'el mayor error',
      'mucha gente cree', 'todo el mundo cree', 'descubri que', 'aprendi que',
      'te voy a contar', 'te voy a mostrar', 'presta atencion', 'escucha esto',
      'sabias que', 'imagina', 'nunca pense',
      'me cambio la vida', 'me costo', 'opinion impopular', 'voy a ser sincero',
    ],
  },

  // Vira a chave no meio do trecho — é o que faz a pessoa ficar.
  contrast: {
    pt: [
      'na verdade', 'so que', 'mas nao', 'porem', 'entretanto', 'no entanto',
      'ao contrario', 'pelo contrario', 'em vez de', 'ao inves de', 'nao e',
      'nao foi', 'nao era', 'nunca foi', 'a diferenca e', 'a diferenca entre',
      'de um lado', 'por outro lado', 'so que nao', 'acontece que', 'o problema',
      'ate que', 'de repente', 'ate o dia', 'foi ai que', 'aconteceu que',
      'nao adianta', 'nao funciona', 'e mentira', 'e o oposto',
    ],
    en: [
      'actually', 'but not', 'however', 'on the contrary', 'instead of',
      'it is not', 'it was not', 'the difference is', 'on the other hand',
      'until the day', 'that is when', 'it turns out', 'it does not work',
      'it is a lie', 'the opposite',
    ],
    es: [
      'en realidad', 'pero no', 'sin embargo', 'al contrario', 'en vez de',
      'no es', 'no fue', 'la diferencia es', 'por otro lado', 'hasta que',
      'resulta que', 'no funciona', 'es mentira', 'lo contrario',
    ],
  },

  // Ordem direta ao espectador — sozinha já é headline.
  imperative: {
    pt: [
      'pare de', 'para de', 'nao faca', 'nao faz', 'faca', 'comece', 'comeca',
      'anota', 'anote', 'escreve ai', 'escreva', 'teste', 'testa', 'experimenta',
      'evite', 'evita', 'lembre', 'lembra disso', 'aprenda', 'aprende',
      'invista', 'investe', 'cuide', 'cuida', 'foca', 'foque', 'pense',
      'esquece', 'esqueca', 'tira', 'tire', 'coloca', 'coloque', 'assume',
      'assuma', 'nunca faca', 'nunca deixe', 'sempre faca', 'comece hoje',
      'para tudo', 'repete comigo', 'entenda',
    ],
    en: [
      'stop doing', 'stop', 'do not do', 'start', 'write this down', 'test it',
      'avoid', 'remember this', 'learn', 'invest', 'take care', 'focus on',
      'forget', 'never do', 'always do', 'start today',
    ],
    es: [
      'deja de', 'no hagas', 'empieza', 'anota', 'prueba', 'evita', 'recuerda',
      'aprende', 'invierte', 'cuida', 'enfocate', 'olvida', 'nunca hagas',
      'empieza hoy',
    ],
  },

  superlative: {
    pt: [
      'o melhor', 'a melhor', 'o pior', 'a pior', 'o maior', 'a maior',
      'o menor', 'o unico', 'a unica', 'os unicos', 'mais importante',
      'principal', 'definitivo', 'jamais', 'absurdo', 'impossivel',
      'gigantesco', 'enorme', 'o numero um', 'primeira vez', 'nunca vi',
      'nunca mais', 'sempre foi', 'o mais', 'a mais',
    ],
    en: [
      'the best', 'the worst', 'the biggest', 'the only', 'most important',
      'the number one', 'never seen', 'the greatest', 'huge', 'impossible',
      'the first time', 'for the first time',
    ],
    es: [
      'el mejor', 'la mejor', 'el peor', 'el mayor', 'el unico', 'la unica',
      'mas importante', 'nunca vi', 'imposible', 'enorme', 'primera vez',
    ],
  },

  question: {
    pt: [
      'por que', 'porque voce', 'como', 'o que', 'qual', 'quais', 'quando',
      'quem', 'quanto', 'quantos', 'sera que', 'e se', 'voce ja', 'voce sabe',
      'voce faria', 'como assim', 'faz sentido',
    ],
    en: ['why', 'how', 'what', 'which', 'when', 'who', 'how much', 'what if', 'do you'],
    es: ['por que', 'como', 'que', 'cual', 'cuando', 'quien', 'cuanto', 'y si', 'sabes'],
  },

  emotion: {
    pt: [
      'incrivel', 'absurdo', 'chocante', 'assustador', 'impressionante',
      'inacreditavel', 'surreal', 'revoltante', 'maluco', 'doido', 'insano',
      'eu amo', 'eu odeio', 'odeio', 'medo', 'panico', 'raiva', 'chorei',
      'chorar', 'emocionante', 'vergonha', 'orgulho', 'apaixonado',
      'caramba', 'meu deus', 'puta', 'desesperado', 'sofri', 'dor', 'doeu',
      'perdi tudo', 'quebrei', 'falencia', 'me salvou', 'salvou a minha',
      'nunca esqueco', 'nunca vou esquecer', 'arrepiei', 'de coracao',
    ],
    en: [
      'incredible', 'insane', 'shocking', 'terrifying', 'unbelievable',
      'i love', 'i hate', 'scared', 'fear', 'angry', 'i cried', 'ashamed',
      'proud', 'desperate', 'i suffered', 'it hurt', 'lost everything',
      'bankrupt', 'saved my', 'never forget',
    ],
    es: [
      'increible', 'absurdo', 'aterrador', 'impresionante', 'inaudito',
      'me encanta', 'odio', 'miedo', 'rabia', 'llore', 'verguenza', 'orgullo',
      'desesperado', 'sufri', 'dolio', 'perdi todo', 'quiebra', 'me salvo',
    ],
  },

  laughter: {
    pt: ['risos', 'kkkk', 'kkk', 'haha', 'hahaha', 'rachei', 'morri de rir'],
    en: ['laughs', 'laughter', 'haha', 'hahaha', 'lol'],
    es: ['risas', 'jaja', 'jajaja'],
  },

  // Logística / cortesia / apresentação — NUNCA vira corte.
  logistics: {
    pt: [
      'sejam bem vindos', 'seja bem vindo', 'bem vindos', 'bem vindo',
      'bom dia', 'boa tarde', 'boa noite pessoal', 'boa noite a todos',
      'mais um episodio', 'nosso podcast', 'esse programa', 'no programa de hoje',
      'antes de comecar', 'antes da gente comecar', 'se inscreve', 'se inscreva',
      'inscreva se', 'ativa o sininho', 'deixa o like', 'deixe o like',
      'deixa seu like', 'comenta ai', 'comente ai', 'compartilha', 'compartilhe',
      'link na descricao', 'link na bio', 'segue a gente', 'nos siga',
      'nosso patrocinador', 'patrocinio', 'oferecimento', 'esse video e patrocinado',
      'cupom de desconto', 'muito obrigado', 'muito obrigada', 'obrigado por',
      'obrigada por', 'agradeco', 'meu nome e', 'eu me chamo', 'meu convidado',
      'nosso convidado', 'a nossa convidada', 'apresentar o', 'quem esta aqui',
      'ta me ouvindo', 'ta funcionando o audio', 'testando o microfone',
      'o audio ta bom', 'a camera', 'volume', 'vamos ajustar', 'ja volta',
      'a gente ja volta', 'voltamos ja', 'proximo bloco', 'intervalo',
      'depois do intervalo', 'ate a proxima', 'ate o proximo', 'era isso pessoal',
      'e isso ai pessoal', 'fica com deus', 'um abraco', 'valeu pessoal',
      'sem mais delongas', 'vamos ao que interessa', 'chega de papo',
      'na descricao do video', 'no primeiro comentario',
    ],
    en: [
      'welcome to', 'welcome back', 'good morning everyone', 'another episode',
      'before we start', 'before we begin', 'subscribe', 'hit the bell',
      'leave a like', 'comment below', 'share this', 'link in the description',
      'link in bio', 'follow us', 'our sponsor', 'sponsored by', 'discount code',
      'thank you for watching', 'thanks for watching', 'my name is',
      'my guest today', 'can you hear me', 'testing the mic', 'we will be right back',
      'after the break', 'see you next time', 'that is it for today',
    ],
    es: [
      'bienvenidos', 'bienvenido', 'buenos dias a todos', 'otro episodio',
      'antes de empezar', 'suscribete', 'dale like', 'comenta abajo',
      'comparte', 'link en la descripcion', 'siguenos', 'nuestro patrocinador',
      'patrocinado por', 'codigo de descuento', 'muchas gracias por',
      'me llamo', 'mi invitado', 'me escuchas', 'ya volvemos', 'hasta la proxima',
    ],
  },

  // Depende de algo que ficou FORA do corte — mata a autossuficiência.
  externalRef: {
    pt: [
      'como eu falei', 'como eu disse', 'como a gente falou', 'como eu comentei',
      'la atras', 'no comeco do episodio', 'no inicio do video',
      'aquilo que a gente falou', 'o que eu falei antes', 'como voces viram',
      'nesse slide', 'no slide', 'aqui na tela', 'voces estao vendo',
      'olha aqui na tela', 'como mostrei', 'no grafico', 'nessa imagem',
      'no video passado', 'no episodio passado', 'daqui a pouco eu explico',
      'ja ja eu explico', 'volto nisso depois', 'como falei antes',
      'a pergunta que ele fez', 'respondendo o que voce', 'voltando ao assunto',
      'voltando la', 'retomando',
    ],
    en: [
      'as i said', 'as i mentioned', 'earlier in the episode', 'at the beginning',
      'as you saw', 'on this slide', 'on the screen', 'you can see here',
      'as i showed', 'in the chart', 'last episode', 'i will explain later',
      'back to the topic', 'going back',
    ],
    es: [
      'como dije', 'como mencione', 'al principio del episodio', 'como vieron',
      'en esta diapositiva', 'en la pantalla', 'como mostre', 'en el grafico',
      'el episodio pasado', 'lo explico despues', 'volviendo al tema',
    ],
  },
};

// ───────────────────────────────────────────────────────────────────────────
// Anáfora e conectivo pendurado (só como ABERTURA / FECHAMENTO de frase)
// ───────────────────────────────────────────────────────────────────────────

/** Pronome/demonstrativo que ABRE frase sem dizer a quem se refere. */
const ANAPHORA_OPENERS: Record<LangCode, string[]> = {
  pt: [
    'isso', 'isto', 'aquilo', 'ele', 'ela', 'eles', 'elas', 'esse', 'essa',
    'esses', 'essas', 'este', 'esta', 'aquele', 'aquela', 'aqueles', 'aquelas',
    'dele', 'dela', 'deles', 'delas', 'disso', 'nisso', 'daquilo', 'ai',
    'la', 'ali', 'dai', 'ambos', 'tal', 'o mesmo', 'a mesma',
  ],
  en: ['it', 'this', 'that', 'these', 'those', 'he', 'she', 'they', 'them', 'there'],
  es: ['eso', 'esto', 'aquello', 'el', 'ella', 'ellos', 'ellas', 'ese', 'esa', 'este', 'esta', 'alli'],
};

/** Frases feitas com anáfora que também abrem no vazio. */
const ANAPHORA_PHRASES: Record<LangCode, string[]> = {
  pt: [
    'essa parada', 'esse cara', 'essa historia', 'esse negocio', 'aquela estrategia',
    'esse processo', 'esse tipo de coisa', 'essa coisa', 'esse assunto',
    'a mesma coisa', 'o mesmo problema',
  ],
  en: ['that guy', 'that thing', 'that strategy', 'the same thing'],
  es: ['esa cosa', 'ese tipo', 'esa estrategia', 'lo mismo'],
};

/**
 * Conectivo que ABRE frase pendurada na anterior ("Mas aí…", "E o resultado…").
 * É subconjunto proposital de `DANGLING_ENDINGS`: artigo e preposição podem
 * abrir frase ótima ("O maior erro…"), conjunção não.
 */
const CONNECTIVE_OPENERS: Record<LangCode, string[]> = {
  pt: [
    'e', 'mas', 'ou', 'porque', 'porem', 'entao', 'ai', 'que', 'pois', 'nem',
    'tambem', 'logo', 'dai', 'portanto', 'contudo', 'todavia', 'entretanto',
    'inclusive', 'alias', 'enquanto',
  ],
  en: ['and', 'but', 'or', 'because', 'then', 'also', 'plus', 'besides', 'anyway'],
  es: ['y', 'pero', 'o', 'porque', 'entonces', 'pues', 'ni', 'tambien', 'ademas'],
};

/** Palavra que, no FIM da frase, deixa a ideia pendurada. */
const DANGLING_ENDINGS: Record<LangCode, string[]> = {
  pt: [
    'e', 'ou', 'mas', 'que', 'porque', 'porem', 'entao', 'ai', 'pra', 'para',
    'com', 'sem', 'de', 'da', 'do', 'das', 'dos', 'em', 'no', 'na', 'nos',
    'nas', 'num', 'numa', 'por', 'pelo', 'pela', 'como', 'se', 'quando',
    'nem', 'sobre', 'entre', 'ate', 'desde', 'ao', 'aos', 'a', 'o', 'os',
    'as', 'um', 'uma', 'meu', 'minha', 'seu', 'sua', 'nosso', 'nossa',
    'qual', 'quanto', 'cujo', 'onde', 'tipo', 'tambem', 'muito', 'mais',
    'ja', 'so', 'tao', 'nao', 'talvez', 'quase', 'dessa', 'desse', 'deste',
  ],
  en: [
    'and', 'or', 'but', 'that', 'because', 'so', 'to', 'of', 'in', 'on',
    'for', 'with', 'the', 'a', 'an', 'if', 'when', 'which', 'who', 'while',
    'as', 'from', 'by', 'my', 'your', 'our', 'their', 'very', 'more', 'just',
  ],
  es: [
    'y', 'o', 'pero', 'que', 'porque', 'entonces', 'para', 'con', 'sin', 'de',
    'del', 'en', 'por', 'como', 'si', 'cuando', 'ni', 'hasta', 'desde', 'al',
    'el', 'la', 'los', 'las', 'un', 'una', 'mi', 'su', 'muy', 'mas',
  ],
};

// ───────────────────────────────────────────────────────────────────────────
// Léxico montado
// ───────────────────────────────────────────────────────────────────────────

export type Lexicon = {
  langs: LangCode[];
  stopwords: Set<string>;
  fillers: FillerSets;
  /** frases normalizadas (` frase `) por família, ordenadas — determinismo */
  phrases: Record<LexFamily, string[]>;
  anaphoraOpeners: Set<string>;
  anaphoraPhrases: string[];
  danglingEndings: Set<string>;
  connectiveOpeners: Set<string>;
};

const FAMILIES: LexFamily[] = [
  'hook', 'contrast', 'imperative', 'superlative', 'question',
  'emotion', 'laughter', 'logistics', 'externalRef',
];

/** Monta o léxico do idioma. Puro e memoizável — mesma entrada, mesmo objeto. */
export function buildLexicon(language: string | null | undefined): Lexicon {
  const langs = resolveLangs(language);

  const phrases = {} as Record<LexFamily, string[]>;
  for (const fam of FAMILIES) {
    const seen = new Set<string>();
    for (const l of langs) for (const p of LEX[fam][l]) seen.add(normalizeForMatch(p));
    phrases[fam] = Array.from(seen).sort();
  }

  const anaphoraOpeners = new Set<string>();
  const anaphoraPhrases: string[] = [];
  const danglingEndings = new Set<string>();
  const connectiveOpeners = new Set<string>();
  for (const l of langs) {
    for (const w of ANAPHORA_OPENERS[l]) anaphoraOpeners.add(w);
    for (const p of ANAPHORA_PHRASES[l]) anaphoraPhrases.push(normalizeForMatch(p));
    for (const w of DANGLING_ENDINGS[l]) danglingEndings.add(w);
    for (const w of CONNECTIVE_OPENERS[l]) connectiveOpeners.add(w);
  }
  anaphoraPhrases.sort();

  return {
    langs,
    stopwords: stopwordsFor(langs),
    fillers: fillersFor(langs),
    phrases,
    anaphoraOpeners,
    anaphoraPhrases,
    danglingEndings,
    connectiveOpeners,
  };
}

/** Quantas frases feitas da família aparecem no texto normalizado. */
export function countFamily(normalized: string, list: string[]): number {
  let n = 0;
  for (const p of list) if (normalized.includes(p)) n++;
  return n;
}

/** Alguma frase feita da família aparece? */
export function hasFamily(normalized: string, list: string[]): boolean {
  for (const p of list) if (normalized.includes(p)) return true;
  return false;
}
