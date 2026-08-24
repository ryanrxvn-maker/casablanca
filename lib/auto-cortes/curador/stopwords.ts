/**
 * AUTO CORTES · CURADOR LOCAL — stopwords e muletas (PT · EN · ES).
 *
 * Duas listas com papéis DIFERENTES:
 *  - `STOPWORDS`: palavra sem carga semântica. Some do TF-IDF (senão "que" e
 *    "de" dominam o vetor de toda frase e nenhum assunto se separa).
 *  - `FILLERS`: muleta de fala ("então", "aí", "tipo", "né"). NÃO é só ruído —
 *    frase que ABRE com muleta é o sinal nº 1 de corte automático mal feito,
 *    então a muleta vale penalidade, não só remoção.
 *
 * Tudo em forma normalizada (minúscula, sem acento) — ver `text.ts`.
 */

import { normalizeForMatch } from './text';

// ───────────────────────────────────────────────────────────────────────────
// Stopwords
// ───────────────────────────────────────────────────────────────────────────

const PT_STOP = [
  'a', 'o', 'as', 'os', 'um', 'uma', 'uns', 'umas', 'ao', 'aos', 'as', 'da', 'do',
  'das', 'dos', 'de', 'em', 'no', 'na', 'nos', 'nas', 'num', 'numa', 'pelo', 'pela',
  'pelos', 'pelas', 'por', 'para', 'pra', 'pro', 'pras', 'pros', 'com', 'sem', 'sob',
  'sobre', 'entre', 'ate', 'desde', 'apos', 'ante', 'contra', 'perante',
  'e', 'ou', 'nem', 'mas', 'porem', 'que', 'se', 'como', 'quando', 'porque', 'pois',
  'ja', 'la', 'ali', 'aqui', 'ai', 'ca', 'onde', 'quanto', 'qual', 'quais', 'quem',
  'eu', 'tu', 'voce', 'voces', 'ele', 'ela', 'eles', 'elas', 'nos', 'vos', 'me',
  'te', 'lhe', 'lhes', 'se', 'mim', 'ti', 'si', 'meu', 'minha', 'meus', 'minhas',
  'teu', 'tua', 'seu', 'sua', 'seus', 'suas', 'nosso', 'nossa', 'nossos', 'nossas',
  'dele', 'dela', 'deles', 'delas', 'este', 'esta', 'estes', 'estas', 'esse', 'essa',
  'esses', 'essas', 'aquele', 'aquela', 'aqueles', 'aquelas', 'isto', 'isso',
  'aquilo', 'disso', 'nisso', 'daquilo', 'desse', 'dessa', 'deste', 'desta',
  'ser', 'sou', 'e', 'somos', 'sao', 'era', 'eram', 'foi', 'foram', 'fui', 'seja',
  'sendo', 'sido', 'estar', 'esta', 'estao', 'estava', 'estavam', 'esteve', 'estou',
  'ter', 'tem', 'temos', 'tenho', 'tinha', 'tinham', 'teve', 'tive', 'tera', 'tenha',
  'haver', 'ha', 'havia', 'houve', 'fazer', 'faz', 'fez', 'fazia', 'faco',
  'ir', 'vai', 'vou', 'vamos', 'vao', 'ia', 'foi', 'poder', 'pode', 'posso',
  'podia', 'podem', 'dar', 'da', 'dei', 'deu', 'ficar', 'fica', 'ficou',
  'muito', 'muita', 'muitos', 'muitas', 'mais', 'menos', 'pouco', 'pouca', 'todo',
  'toda', 'todos', 'todas', 'tudo', 'nada', 'algo', 'alguem', 'ninguem', 'outro',
  'outra', 'outros', 'outras', 'mesmo', 'mesma', 'tao', 'tanto', 'tambem', 'so',
  'ainda', 'sempre', 'nunca', 'talvez', 'agora', 'hoje', 'ontem', 'amanha', 'antes',
  'depois', 'entao', 'assim', 'bem', 'mal', 'sim', 'nao', 'ne', 'ta', 'tao',
  'gente', 'coisa', 'coisas', 'jeito', 'lado', 'vez', 'vezes', 'hora', 'dia',
  'ano', 'parte', 'caso', 'ponto', 'forma', 'meio', 'fim', 'tipo',
  // determinantes e quantificadores que viravam "tema" do título ("Cada:")
  'cada', 'qualquer', 'quaisquer', 'certo', 'certa', 'varios', 'varias',
  'diversos', 'diversas', 'demais', 'proprio', 'propria', 'inteiro', 'inteira',
  'grande', 'pequeno', 'melhor', 'pior', 'maior', 'menor', 'bom', 'boa',
  'legal', 'ruim', 'novo', 'nova', 'velho', 'primeiro', 'segundo', 'terceiro',
  'acho', 'acha', 'achar', 'falar', 'falando', 'falou', 'fala', 'dizer', 'diz',
  'disse', 'sabe', 'sei', 'ver', 'vendo', 'vejo', 'olhar', 'olha', 'pensar',
  'quer', 'quero', 'queria', 'consegue', 'consegui', 'conseguir', 'precisa',
  'precisar', 'usar', 'usa', 'pegar', 'pega', 'botar', 'colocar', 'chegar',
  'chega', 'passar', 'passa', 'virar', 'vira', 'manter', 'entao',
];

const EN_STOP = [
  'a', 'an', 'the', 'and', 'or', 'but', 'if', 'then', 'than', 'that', 'this',
  'these', 'those', 'of', 'in', 'on', 'at', 'to', 'for', 'with', 'without', 'from',
  'by', 'about', 'into', 'over', 'under', 'between', 'through', 'during', 'before',
  'after', 'above', 'below', 'up', 'down', 'out', 'off', 'again', 'here', 'there',
  'when', 'where', 'why', 'how', 'all', 'any', 'both', 'each', 'few', 'more',
  'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same',
  'so', 'too', 'very', 'can', 'will', 'just', 'should', 'would', 'could', 'may',
  'might', 'must', 'is', 'am', 'are', 'was', 'were', 'be', 'been', 'being', 'have',
  'has', 'had', 'having', 'do', 'does', 'did', 'doing', 'get', 'got', 'go', 'going',
  'i', 'me', 'my', 'we', 'us', 'our', 'you', 'your', 'he', 'him', 'his', 'she',
  'her', 'it', 'its', 'they', 'them', 'their', 'what', 'which', 'who', 'whom',
  'thing', 'things', 'way', 'time', 'lot', 'kind', 'sort',
];

const ES_STOP = [
  'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'de', 'del', 'al', 'a',
  'en', 'por', 'para', 'con', 'sin', 'sobre', 'entre', 'hasta', 'desde', 'y', 'o',
  'ni', 'pero', 'que', 'si', 'como', 'cuando', 'porque', 'pues', 'ya', 'alli',
  'aqui', 'donde', 'cuanto', 'cual', 'quien', 'yo', 'tu', 'usted', 'el', 'ella',
  'nosotros', 'ellos', 'ellas', 'me', 'te', 'se', 'le', 'les', 'mi', 'su', 'sus',
  'nuestro', 'este', 'esta', 'estos', 'estas', 'ese', 'esa', 'esos', 'esas',
  'aquel', 'esto', 'eso', 'aquello', 'ser', 'soy', 'es', 'son', 'era', 'fue',
  'estar', 'esta', 'estan', 'tener', 'tiene', 'tengo', 'hay', 'hacer', 'hace',
  'ir', 'va', 'vamos', 'poder', 'puede', 'muy', 'mas', 'menos', 'todo', 'toda',
  'todos', 'todas', 'nada', 'algo', 'alguien', 'nadie', 'otro', 'otra', 'mismo',
  'tan', 'tanto', 'tambien', 'solo', 'aun', 'siempre', 'nunca', 'ahora', 'hoy',
  'antes', 'despues', 'entonces', 'asi', 'bien', 'mal', 'si', 'no', 'cosa', 'cosas',
];

// ───────────────────────────────────────────────────────────────────────────
// Muletas (o que denuncia corte automático quando abre o clipe)
// ───────────────────────────────────────────────────────────────────────────

/** Muletas de UMA palavra que podem ABRIR frase. */
const PT_FILLER_OPENERS = [
  'entao', 'ai', 'tipo', 'assim', 'ne', 'cara', 'olha', 'olhe', 'bom', 'bem',
  'enfim', 'ta', 'tah', 'certo', 'beleza', 'poxa', 'po', 'nossa', 'gente',
  'agora', 'dai', 'inclusive', 'basicamente', 'literalmente', 'sabe', 'veja',
  'pronto', 'pois', 'digamos', 'resumindo', 'obviamente', 'realmente',
];

/** Muletas de duas/três palavras que podem ABRIR frase. */
const PT_FILLER_PHRASES = [
  'entao assim', 'entao tipo', 'tipo assim', 'quer dizer', 'ou seja', 'pois e',
  'e ai', 'ai entao', 'so que assim', 'meio que', 'sei la', 'digamos assim',
  'como eu falei', 'como eu disse', 'como a gente falou', 'voltando ali',
  'deixa eu ver', 'peraí', 'pera ai', 'espera ai', 'no caso assim',
  'a questao e que', 'o negocio e o seguinte', 'e o seguinte',
];

const EN_FILLER_OPENERS = [
  'well', 'anyway', 'anyways', 'basically', 'actually', 'literally', 'yeah',
  'yep', 'okay', 'ok', 'right', 'um', 'uh', 'hmm', 'look', 'listen', 'like',
];
/** "so" abre frase em inglês o tempo todo, MAS colapsa com o "só" do PT sem
 *  acento — só entra quando o idioma é EXATAMENTE en. */
const EN_FILLER_OPENERS_AMBIGUOUS = ['so'];
const EN_FILLER_PHRASES = [
  'you know', 'i mean', 'kind of', 'sort of', 'like i said', 'as i said',
  'so yeah', 'so anyway', 'let me see', 'hold on',
];

const ES_FILLER_OPENERS = [
  'entonces', 'bueno', 'pues', 'digamos', 'osea', 'mira', 'oye', 'claro',
  'basicamente', 'literalmente', 'obviamente',
];
const ES_FILLER_OPENERS_AMBIGUOUS = ['vale', 'este', 'como'];
const ES_FILLER_PHRASES = ['o sea', 'es decir', 'como dije', 'no se', 'a ver'];

// ───────────────────────────────────────────────────────────────────────────
// API
// ───────────────────────────────────────────────────────────────────────────

export type LangCode = 'pt' | 'en' | 'es';

/**
 * `pt`/`en`/`es` → só esse. Qualquer outra coisa (inclusive `auto`, vazio ou
 * idioma que a gente não cobre) → **pt + en**, que é a instrução do produto.
 * O PRIMEIRO da lista é o idioma "primário": é dele que saem as muletas
 * ambíguas (as que colidem com palavra boa de outro idioma).
 */
export function resolveLangs(language: string | null | undefined): LangCode[] {
  const l = (language ?? '').trim().toLowerCase();
  if (l.startsWith('pt')) return ['pt'];
  if (l.startsWith('en')) return ['en'];
  if (l.startsWith('es') || l.startsWith('ca') || l.startsWith('gl')) return ['es'];
  return ['pt', 'en'];
}

const STOP_BY_LANG: Record<LangCode, string[]> = { pt: PT_STOP, en: EN_STOP, es: ES_STOP };

export function stopwordsFor(langs: LangCode[]): Set<string> {
  const out = new Set<string>();
  for (const l of langs) for (const w of STOP_BY_LANG[l]) out.add(w);
  return out;
}

export type FillerSets = {
  /** muletas de 1 palavra (bate no 1º token da frase) */
  openers: Set<string>;
  /** muletas de 2-3 palavras, já normalizadas com espaço nas bordas */
  phrases: string[];
};

export function fillersFor(langs: LangCode[]): FillerSets {
  const openers = new Set<string>();
  const phrases: string[] = [];
  const primary = langs[0];
  const solo = langs.length === 1;

  const add = (one: string[], multi: string[], ambiguous: string[], lang: LangCode) => {
    for (const w of one) openers.add(w);
    for (const p of multi) phrases.push(normalizeForMatch(p));
    // ambígua só quando o idioma é o primário E não há mistura de idiomas
    if (solo && primary === lang) for (const w of ambiguous) openers.add(w);
  };

  for (const l of langs) {
    if (l === 'pt') add(PT_FILLER_OPENERS, PT_FILLER_PHRASES, [], 'pt');
    if (l === 'en') add(EN_FILLER_OPENERS, EN_FILLER_PHRASES, EN_FILLER_OPENERS_AMBIGUOUS, 'en');
    if (l === 'es') add(ES_FILLER_OPENERS, ES_FILLER_PHRASES, ES_FILLER_OPENERS_AMBIGUOUS, 'es');
  }
  phrases.sort();
  return { openers, phrases };
}
