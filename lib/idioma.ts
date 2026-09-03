/**
 * DETECÇÃO DE IDIOMA da copy (02.09).
 *
 * Por que existe: a pós-produção do Pilot transcrevia TUDO como português
 * fora do DR MILLION — uma copy B2C em espanhol ou inglês saía com legenda e
 * âncoras erradas. E no DR MILLION o doc é bilíngue de propósito: o pt-BR é a
 * TRADUÇÃO de cortesia; a copy real é o outro idioma.
 *
 * O detector é determinístico e barato: conta stopwords por idioma (palavra
 * inteira) e soma pistas de diacríticos que são assinatura de UMA língua
 * (ő/ű húngaro, ż/ł polonês, ř/ě tcheco...). Sem rede, sem modelo — roda no
 * navegador em microssegundos e o mesmo texto dá sempre a mesma resposta.
 */

export type Idioma = 'pt' | 'en' | 'es' | 'pl' | 'hu' | 'cs' | 'de' | 'fr' | 'it' | 'ro';

/** Stopwords MUITO frequentes e razoavelmente exclusivas de cada idioma. */
const STOPWORDS: Record<Idioma, string[]> = {
  pt: ['que', 'não', 'nao', 'uma', 'para', 'com', 'você', 'voce', 'mais', 'isso', 'como', 'esse', 'essa', 'já', 'depois', 'mesmo', 'aqui', 'muito', 'tem', 'seu', 'sua', 'dos', 'das', 'ele', 'ela'],
  en: ['the', 'and', 'you', 'that', 'this', 'with', 'for', 'your', 'have', 'what', 'just', 'they', 'from', 'was', 'are', 'but', 'not', 'will', 'can', 'about'],
  es: ['que', 'los', 'las', 'una', 'para', 'con', 'usted', 'más', 'esto', 'como', 'ese', 'esa', 'pero', 'porque', 'cuando', 'hacer', 'está', 'muy', 'ahora', 'también', 'tiene', 'ellos'],
  pl: ['nie', 'jest', 'się', 'sie', 'jak', 'ale', 'czy', 'tego', 'tylko', 'jego', 'przez', 'być', 'byc', 'żeby', 'już', 'bardzo', 'może', 'kiedy', 'gdy', 'czego', 'ciała'],
  hu: ['nem', 'hogy', 'egy', 'van', 'meg', 'csak', 'már', 'mar', 'akkor', 'mint', 'vagy', 'még', 'ezt', 'azt', 'nagyon', 'lehet', 'minden', 'mert', 'volt', 'amikor'],
  cs: ['nebo', 'jsem', 'jsou', 'ale', 'tak', 'když', 'kdyz', 'jako', 'protože', 'jenom', 'ještě', 'muže', 'této', 'být', 'byl', 'což', 'aby', 'před', 'které', 'tady'],
  de: ['der', 'die', 'das', 'und', 'nicht', 'ist', 'ich', 'sie', 'mit', 'ein', 'eine', 'auch', 'auf', 'für', 'aber', 'wenn', 'sind', 'noch', 'nur', 'sich'],
  fr: ['les', 'vous', 'que', 'pas', 'une', 'pour', 'avec', 'est', 'dans', 'mais', 'plus', 'votre', 'être', 'fait', 'tout', 'cette', 'comme', 'aussi', 'sur', 'quand'],
  it: ['che', 'non', 'una', 'per', 'con', 'sono', 'questo', 'come', 'anche', 'più', 'della', 'nella', 'quando', 'perché', 'fare', 'gli', 'hai', 'sei', 'del', 'alla'],
  ro: ['este', 'nu', 'care', 'pentru', 'mai', 'dar', 'sunt', 'din', 'ai', 'dacă', 'daca', 'când', 'cand', 'foarte', 'acest', 'după', 'dupa', 'fără', 'fara', 'ești'],
};

/** Diacríticos que praticamente ASSINAM um idioma. Peso alto. */
const ASSINATURAS: Array<[RegExp, Idioma, number]> = [
  [/[őű]/g, 'hu', 6],
  [/[żźćńśłę]/g, 'pl', 5],
  [/[řěůďťň]/g, 'cs', 6],
  [/[ãõ]/g, 'pt', 4],
  [/ç[aã]o/g, 'pt', 5],
  [/[ñ¿¡]/g, 'es', 6],
  [/ß/g, 'de', 6],
  [/[șț]/g, 'ro', 6],
  [/[àâîôû]/g, 'fr', 2],
];

/**
 * Detecta o idioma do texto. Devolve `null` quando não há evidência
 * suficiente — o chamador decide o fallback (no Pilot, 'pt').
 */
export function detectarIdioma(texto: string): Idioma | null {
  const limpo = String(texto || '').toLowerCase();
  if (limpo.replace(/[^a-zà-žő-ű]/gi, '').length < 20) return null; // curto demais: sem veredito

  const palavras = limpo.split(/[^a-zà-žőűẞ']+/i).filter(Boolean);
  if (palavras.length < 6) return null;

  const placar = new Map<Idioma, number>();
  for (const [idioma, stops] of Object.entries(STOPWORDS) as Array<[Idioma, string[]]>) {
    const conjunto = new Set(stops);
    let pontos = 0;
    for (const w of palavras) if (conjunto.has(w)) pontos++;
    placar.set(idioma, pontos);
  }
  for (const [re, idioma, peso] of ASSINATURAS) {
    const hits = (limpo.match(re) || []).length;
    if (hits > 0) placar.set(idioma, (placar.get(idioma) || 0) + Math.min(hits, 4) * peso);
  }

  const ordenado = [...placar.entries()].sort((a, b) => b[1] - a[1]);
  const [melhor, segundo] = ordenado;
  if (!melhor || melhor[1] < 3) return null; // pouca evidência
  // empate técnico entre línguas próximas (pt×es, cs×pl): exige margem
  if (segundo && melhor[1] - segundo[1] < Math.max(2, melhor[1] * 0.2)) {
    // desempata por assinatura exclusiva, se houver
    const temAssinatura = ASSINATURAS.some(([re, idm]) => idm === melhor[0] && re.test(limpo));
    if (!temAssinatura) return null;
  }
  return melhor[0];
}

/**
 * O idioma da COPY de um disparo, a partir das partes.
 *
 * `escolhido` (o seletor do DR MILLION, quando o user apontou) SEMPRE vence:
 * escolha explícita não se discute. Sem escolha, detecta; sem evidência, pt.
 */
export function idiomaDaCopy(
  partes: Array<{ text: string }>,
  escolhido?: Idioma | null,
): Idioma {
  if (escolhido) return escolhido;
  const texto = partes.map((p) => p.text || '').join(' ');
  return detectarIdioma(texto) ?? 'pt';
}
