import { stockFrameSearchText, type StockFrameVideo } from './stockframe';

export type SmartCoverage = 30 | 60 | 100;
export type SmartPace = 'fast' | 'long' | 'adaptive';
export type StockFrameCopyPart = { label: string; text: string };
export type SmartStockCandidate = { video: StockFrameVideo; score: number; reasons: string[] };
export type SmartStockSegment = {
  id: string;
  anchor: string;
  wordFrom: number;
  wordTo: number;
  text: string;
  query: string;
  concepts: string[];
  visualScore: number;
  targetSeconds: number;
  /** Sentence context survives cuts so negation is not lost at a boundary. */
  contextText?: string;
  contextConcepts?: string[];
  narrativeDirection?: 'recovery' | 'distress' | 'neutral';
  candidates: SmartStockCandidate[];
  selectedVideoId?: string;
};

const STOP = new Set(`a o as os um uma uns umas de da do das dos e em no na nos nas por para pra pro com sem sob sobre entre que quem qual quais como quando onde porque se ao aos esta este esse essa isso isto seu sua seus suas meu minha meus minhas voce você voces vocês ele ela eles elas eu nos nós mas ou ja já muito muita mais menos tem ter foi ser sao são era vai vao vão pode podem pelo pela pelos pelas ate até tambem também ainda mesmo mesma assim aqui ali entao então cada todo toda todos todas nao não`.split(/\s+/));

const CONCEPTS: Record<string, string[]> = {
  'dor-articular': ['dor no joelho', 'dor nas articulacoes', 'articulacao', 'joelho', 'quadril', 'ombro', 'artrite', 'artrose', 'cartilagem', 'inflamacao', 'reumatismo'],
  'mobilidade': ['dificuldade para andar', 'subir escada', 'caminhar', 'movimento', 'mobilidade', 'alongamento', 'fisioterapia', 'exercicio', 'levantando', 'caindo'],
  'diabetes': ['diabetes', 'glicose', 'acucar no sangue', 'insulina', 'glicemia', 'pancreas'],
  'emagrecimento': ['emagrecer', 'perder peso', 'gordura', 'balanca', 'obesidade', 'metabolismo', 'barriga', 'dieta'],
  'intestino': ['intestino', 'digestao', 'barriga inchada', 'constipacao', 'diarreia', 'microbiota', 'estomago'],
  'memoria': ['memoria', 'esquecimento', 'alzheimer', 'demencia', 'cerebro', 'concentracao', 'lembranca'],
  'gravidez': ['gravida', 'gravidez', 'gestante', 'bebe', 'feto', 'ultrassom', 'maternidade'],
  'saude-homem': ['prostata', 'erecao', 'testosterona', 'homem', 'masculino', 'libido masculina'],
  'saude-mulher': ['menopausa', 'mulher', 'feminino', 'ovario', 'utero', 'menstruacao'],
  'medico': ['medico', 'doutor', 'consulta', 'hospital', 'clinica', 'diagnostico', 'exame', 'tratamento'],
  'procedimento': ['procedimento', 'cirurgia', 'agulha', 'aplicacao', 'terapia', 'laser', 'massagem', 'radiografia'],
  'remedio': ['remedio', 'medicamento', 'capsula', 'comprimido', 'suplemento', 'frasco', 'dose', 'farmacia'],
  'alimentacao': ['comida', 'alimento', 'cozinha', 'receita', 'prato', 'fruta', 'verdura', 'cafe', 'cha', 'colher'],
  'sono': ['sono', 'dormir', 'insomnia', 'cama', 'acordar', 'cansaco', 'ronco'],
  'pele': ['pele', 'ruga', 'rosto', 'acne', 'mancha', 'colageno', 'creme'],
  'cabelo': ['cabelo', 'calvicie', 'queda de cabelo', 'fio', 'couro cabeludo'],
  'coracao': ['coracao', 'pressao', 'arteria', 'circulacao', 'infarto', 'cardiaco'],
  'dinheiro': ['dinheiro', 'preco', 'caro', 'barato', 'economia', 'conta', 'pagamento', 'cartao'],
  'celular': ['celular', 'telefone', 'aplicativo', 'app', 'tela', 'mensagem', 'internet'],
  'trabalho': ['trabalho', 'escritorio', 'computador', 'reuniao', 'profissional'],
  'relacionamento': ['casal', 'relacionamento', 'marido', 'esposa', 'amor', 'beijo', 'discussao'],
  'familia': ['familia', 'mae', 'pai', 'filho', 'filha', 'avo', 'avó', 'idosa', 'idoso'],
  'emocao-negativa': ['dor', 'sofrimento', 'triste', 'preocupado', 'ansiedade', 'medo', 'desconforto', 'frustracao'],
  'emocao-positiva': ['feliz', 'sorrindo', 'alegria', 'alivio', 'confiante', 'resultado', 'melhora'],
  'anatomia': ['anatomia', '3d', 'raio x', 'orgao', 'celula', 'musculo', 'osso', 'nervo'],
};

const INCOMPATIBLE: [string, string][] = [
  ['gravidez', 'saude-homem'],
  ['saude-mulher', 'saude-homem'],
  ['emocao-positiva', 'emocao-negativa'],
  ['alimentacao', 'procedimento'],
];

function normalize(value: string): string {
  return value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

function stem(value: string): string {
  const word = normalize(value);
  if (word.length < 5) return word;
  return word
    .replace(/(amentos|imentos|adoras|adores|acoes|icoes|mente)$/i, '')
    .replace(/(ando|endo|indo|ados|adas|idos|idas|oso|osa|osos|osas)$/i, '')
    .replace(/(es|s)$/i, '');
}

function meaningful(value: string): string[] {
  return normalize(value).split(/\s+/).filter((word) => word.length > 2 && !STOP.has(word)).map(stem).filter(Boolean);
}

function conceptsOf(value: string): string[] {
  const haystack = ` ${normalize(value)} `;
  const found: string[] = [];
  for (const [concept, terms] of Object.entries(CONCEPTS)) {
    if (terms.some((term) => {
      const normalized = normalize(term);
      return haystack.includes(` ${normalized} `) || (normalized.length > 7 && haystack.includes(normalized));
    })) found.push(concept);
  }
  return found;
}

/** Explicit polarity rules, not a language model. Keep an unresolved problem
 * separate from recovery even when both descriptions contain "dor". */
function narrativeDirection(value: string): NonNullable<SmartStockSegment['narrativeDirection']> {
  const text = normalize(value);
  if (/\b(?:dor(?:es)? (?:ainda )?(?:continua\w*|persist\w*|pior\w*)|ainda (?:sinto|sente|sentia|sofr\w*)|nao (?:consigo|consegue|conseguia) (?:mais )?(?:andar|caminhar|subir|dormir)|sem alivio|nao (?:houve |senti |sentiu )?melhora)\b/.test(text)) return 'distress';
  if (/\b(?:nao (?:sinto|sente|sentimos|tem|tenho|sente\w*) mais (?:a |as |nenhuma )?(?:dor|dores|desconforto)|sem (?:sentir |nenhuma )?(?:dor|dores|desconforto)|livre d[ae] (?:dor|dores)|dor(?:es)? (?:desaparec\w*|sumiu|passou)|alivio|recuperad\w*|volte?i? a (?:andar|caminhar)|voltou a (?:andar|caminhar)|melhora\w*|feliz|alegria)\b/.test(text)) return 'recovery';
  return conceptsOf(text).includes('emocao-negativa') ? 'distress' : 'neutral';
}

const NEGATIVE_VISUAL_WORDS = new Set(['dor', 'dores', 'sofrimento', 'desconforto', 'dificuldade', 'inflamacao', 'medo', 'triste']);
const POSITIVE_VISUAL_WORDS = new Set(['alivio', 'alegria', 'feliz', 'melhora', 'recuperacao']);
const ANATOMY: [string, RegExp][] = [
  ['joelho', /\bjoelhos?\b/], ['ombro', /\bombros?\b/], ['quadril', /\b(?:quadril|quadris)\b/],
  ['cotovelo', /\bcotovelos?\b/], ['tornozelo', /\btornozelos?\b/], ['punho', /\bpunhos?\b/], ['pescoco', /\bpescocos?\b/],
  ['prostata', /\b(?:prostata|prostatic[ao]s?)\b/], ['pancreas', /\b(?:pancreas|pancreatic[ao]s?)\b/],
  ['intestino', /\b(?:intestinos?|intestinal|intestinais|colon)\b/], ['estomago', /\b(?:estomago|gastric[ao]s?)\b/],
  ['cerebro', /\b(?:cerebro|cerebral|cerebrais)\b/], ['coracao', /\b(?:coracao|cardiac[ao]s?)\b/],
  ['figado', /\b(?:figado|hepatic[ao]s?)\b/], ['rim', /\b(?:rim|rins|renal|renais)\b/],
  ['bexiga', /\bbexigas?\b/], ['utero', /\b(?:utero|uterin[ao]s?)\b/], ['ovario', /\b(?:ovarios?|ovarian[ao]s?)\b/],
  ['pulmao', /\b(?:pulmao|pulmoes|pulmonar|pulmonares)\b/], ['olho', /\b(?:olhos?|ocular|oculares)\b/],
];

function anatomyOf(value: string): string[] {
  const text = normalize(value);
  return ANATOMY.filter(([, pattern]) => pattern.test(text)).map(([part]) => part);
}

function semanticFields(text: string, contextText = text) {
  const direction = narrativeDirection(contextText);
  let concepts = conceptsOf(text);
  if (direction === 'recovery') concepts = [...new Set([...concepts.filter((concept) => concept !== 'emocao-negativa'), 'emocao-positiva'])];
  if (direction === 'distress') concepts = concepts.filter((concept) => concept !== 'emocao-positiva');
  const rawTokens = normalize(text).split(/\s+/).filter((word) => word.length > 2 && !STOP.has(word)
    && !(direction === 'recovery' && NEGATIVE_VISUAL_WORDS.has(word))
    && !(direction === 'distress' && POSITIVE_VISUAL_WORDS.has(word)));
  const queryTokens = [...new Set(rawTokens)].sort((a, b) => b.length - a.length).slice(0, 4);
  // Taxonomy labels must not inject the opposite action: the old first term
  // for mobilidade was always "dificuldade para andar", including recovery.
  const conceptTerms = concepts.slice(0, 2).map((concept) => {
    if (concept === 'mobilidade') return direction === 'recovery' ? 'caminhar' : direction === 'distress' ? 'dificuldade para andar' : 'movimento';
    if (concept === 'dor-articular' && direction === 'recovery') return 'articulacoes';
    if (concept === 'emocao-positiva') return 'alivio';
    const haystack = ` ${normalize(text)} `;
    const mentioned = CONCEPTS[concept].filter((term) => {
      const normalized = normalize(term);
      return haystack.includes(` ${normalized} `) || (normalized.length > 7 && haystack.includes(normalized));
    }).sort((a, b) => b.length - a.length);
    // A generic "homem" must not become "próstata", nor shoulder pain knee
    // pain, simply because that is the first synonym in a concept group.
    return mentioned[0] || concept.replace(/-/g, ' ');
  });
  return { concepts, narrativeDirection: direction, query: [...new Set([...conceptTerms, ...queryTokens])].slice(0, 5).join(' ') };
}

type Word = { text: string; index: number; endSentence: boolean };

function wordsOf(value: string): Word[] {
  const matches = value.match(/\S+/g) || [];
  return matches.map((text, index) => ({ text, index, endSentence: /[.!?;:](["')\]]*)$/.test(text) }));
}

function targetWords(pace: SmartPace, position: number, total: number): number {
  if (pace === 'fast') return 9 + (position % 3);
  if (pace === 'long') return 19 + (position % 4);
  const ratio = total ? position / total : 0;
  // Abertura ganha cortes curtos; a explicacao respira; CTA volta a acelerar.
  if (ratio < .2 || ratio > .84) return 10 + (position % 2);
  return position % 3 === 0 ? 18 : position % 3 === 1 ? 13 : 15;
}

function segmentPart(part: StockFrameCopyPart, pace: SmartPace): Omit<SmartStockSegment, 'candidates'>[] {
  const words = wordsOf(part.text);
  const out: Omit<SmartStockSegment, 'candidates'>[] = [];
  let from = 0;
  while (from < words.length) {
    const desired = targetWords(pace, from, words.length);
    const min = pace === 'fast' ? 6 : pace === 'long' ? 15 : 8;
    const max = pace === 'fast' ? 13 : pace === 'long' ? 27 : 21;
    let to = Math.min(words.length - 1, from + desired - 1);
    const sentenceCandidates = words.slice(from + min - 1, Math.min(words.length, from + max))
      .filter((word) => word.endSentence);
    if (sentenceCandidates.length) {
      to = sentenceCandidates.reduce((best, word) => Math.abs((word.index - from + 1) - desired) < Math.abs((best.index - from + 1) - desired) ? word : best).index;
    }
    const slice = words.slice(from, to + 1);
    const text = slice.map((word) => word.text).join(' ');
    const tokens = meaningful(text);
    let sentenceFrom = from;
    while (sentenceFrom > 0 && !words[sentenceFrom - 1].endSentence) sentenceFrom--;
    let sentenceTo = to;
    while (sentenceTo < words.length - 1 && !words[sentenceTo].endSentence) sentenceTo++;
    const contextText = words.slice(sentenceFrom, sentenceTo + 1).map((word) => word.text).join(' ');
    const semantics = semanticFields(text, contextText);
    const { concepts } = semantics;
    const unique = [...new Set(tokens)];
    const concrete = concepts.length * 3 + unique.filter((word) => word.length > 5).length * .3;
    const abstractPenalty = /\b(?:coisa|negocio|isso|aquilo|maneira|forma|verdade|segredo)\b/i.test(normalize(text)) ? 1.5 : 0;
    const visualScore = concrete + Math.min(3, unique.length * .15) - abstractPenalty + (slice.some((word) => word.endSentence) ? .4 : 0);
    // A busca remota recebe palavras inteiras; stemming e' reservado ao
    // ranking local. Enviar "cartilag" em vez de "cartilagem" reduziria o
    // recall do endpoint mesmo com a semântica local correta.
    const secondsByWords = Math.max(2.5, slice.length / 2.35);
    const targetSeconds = pace === 'fast' ? Math.min(5, secondsByWords) : pace === 'long' ? Math.min(10, Math.max(7, secondsByWords)) : Math.min(9, Math.max(4, secondsByWords));
    out.push({
      id: `${normalize(part.label).replace(/\s/g, '-') || 'parte'}-${from}-${to}`,
      anchor: part.label,
      wordFrom: from,
      wordTo: to,
      text,
      ...semantics,
      contextText,
      contextConcepts: conceptsOf(part.text).filter((concept) => !concept.startsWith('emocao-')),
      visualScore,
      targetSeconds: Math.round(targetSeconds * 10) / 10,
    });
    from = to + 1;
  }
  return out;
}

/** Planeja os melhores momentos antes de consultar o catalogo. */
export function planSmartStockSegments(parts: StockFrameCopyPart[], options: { coverage: SmartCoverage; pace: SmartPace }): SmartStockSegment[] {
  const all = parts.flatMap((part) => segmentPart(part, options.pace));
  if (options.coverage === 100) return all.map((segment) => ({ ...segment, candidates: [] }));
  const totalWords = all.reduce((sum, segment) => sum + segment.wordTo - segment.wordFrom + 1, 0);
  const target = Math.max(1, Math.round(totalWords * options.coverage / 100));
  const ranked = all.map((segment, index) => ({ segment, index }))
    .sort((a, b) => b.segment.visualScore - a.segment.visualScore || a.index - b.index);
  const chosen = new Map<string, SmartStockSegment>();
  let words = 0;
  for (const item of ranked) {
    if (words >= target && chosen.size) break;
    const remaining = target - words;
    const length = item.segment.wordTo - item.segment.wordFrom + 1;
    let segment = { ...item.segment, candidates: [] } as SmartStockSegment;
    if (length > remaining) {
      // A short copy must not turn 30% into 100% just because it fits in a
      // single long take. Select a concrete contiguous excerpt of the budget.
      const sourceWords = segment.text.match(/\S+/g) || [];
      let bestFrom = 0;
      let bestScore = -Infinity;
      for (let from = 0; from <= sourceWords.length - remaining; from++) {
        const excerpt = sourceWords.slice(from, from + remaining).join(' ');
        const fields = semanticFields(excerpt, segment.contextText);
        const score = fields.concepts.length * 3 + new Set(meaningful(excerpt)).size * .2;
        if (score > bestScore) { bestScore = score; bestFrom = from; }
      }
      const text = sourceWords.slice(bestFrom, bestFrom + remaining).join(' ');
      const wordFrom = segment.wordFrom + bestFrom;
      const wordTo = wordFrom + remaining - 1;
      segment = { ...segment, id: `${segment.id}-partial-${wordFrom}-${wordTo}`, wordFrom, wordTo, text,
        ...semanticFields(text, segment.contextText), targetSeconds: Math.round(remaining / 2.35 * 10) / 10 };
    }
    chosen.set(item.segment.id, segment);
    words += segment.wordTo - segment.wordFrom + 1;
  }
  return all.flatMap((segment) => chosen.has(segment.id) ? [chosen.get(segment.id)!] : []);
}

function scoreVideo(segment: SmartStockSegment, video: StockFrameVideo): SmartStockCandidate {
  const title = normalize(video.title);
  const tags = normalize(video.tags.join(' '));
  const description = normalize(video.description);
  const taxonomy = normalize(`${video.nicheName || ''} ${video.subcategoryName || ''}`);
  const fields = [
    { text: title, weight: 4.4 },
    { text: tags, weight: 3.5 },
    { text: taxonomy, weight: 2.8 },
    { text: description, weight: 1.4 },
  ];
  const queryTokens = [...new Set(meaningful(`${segment.text} ${segment.query}`))];
  const videoText = stockFrameSearchText(video);
  const spokenHere = anatomyOf(segment.text);
  const spokenAnatomy = spokenHere.length ? spokenHere : anatomyOf(segment.contextText || '');
  // The scene's explicit subject outranks catalog taxonomy. "Homem" can
  // share the men's-health niche with prostate content while the shot plainly
  // shows knee pain. Prostate tags must not override a knee-only scene title.
  const titleAnatomy = anatomyOf(video.title);
  const descriptionAnatomy = anatomyOf(video.description);
  const shownAnatomy = titleAnatomy.length ? titleAnatomy : descriptionAnatomy.length ? descriptionAnatomy : anatomyOf(video.tags.join(' '));
  if (spokenAnatomy.length && shownAnatomy.length && !spokenAnatomy.some((part) => shownAnatomy.includes(part))) {
    return { video, score: -100, reasons: ['parte do corpo diferente da fala'] };
  }
  let videoConcepts = conceptsOf(videoText);
  const direction = segment.narrativeDirection || narrativeDirection(segment.contextText || segment.text);
  const videoDirection = narrativeDirection(videoText);
  if (videoDirection === 'recovery') videoConcepts = [...new Set([...videoConcepts.filter((concept) => concept !== 'emocao-negativa'), 'emocao-positiva'])];
  if (videoDirection === 'distress') videoConcepts = videoConcepts.filter((concept) => concept !== 'emocao-positiva');
  if ((direction === 'recovery' && videoDirection === 'distress') || (direction === 'distress' && videoDirection === 'recovery')) {
    return { video, score: -100, reasons: ['ação oposta ao contexto da fala'] };
  }
  const reasons: string[] = [];
  let score = 0;
  let lexicalEvidence = 0;
  for (const token of queryTokens) {
    let best = 0;
    for (const field of fields) {
      const tokens = meaningful(field.text);
      if (tokens.includes(token)) best = Math.max(best, field.weight);
      else if (token.length >= 5 && tokens.some((candidate) => candidate.startsWith(token) || token.startsWith(candidate))) best = Math.max(best, field.weight * .68);
    }
    if (best) {
      lexicalEvidence++;
      score += best * (1 + Math.min(.8, token.length / 20));
    }
  }
  const sharedConcepts = segment.concepts.filter((concept) => videoConcepts.includes(concept));
  if (sharedConcepts.length) {
    score += sharedConcepts.length * 8;
    reasons.push(`contexto: ${sharedConcepts.slice(0, 2).join(', ')}`);
  }
  // A small topical tie-break uses the rest of the part only after local
  // evidence. Global context cannot admit an otherwise unrelated clip.
  if (lexicalEvidence || sharedConcepts.length) {
    score += Math.min(2, (segment.contextConcepts || []).filter((concept) => videoConcepts.includes(concept)).length * .5);
  }
  for (const [a, b] of INCOMPATIBLE) {
    if ((segment.concepts.includes(a) && videoConcepts.includes(b)) || (segment.concepts.includes(b) && videoConcepts.includes(a))) {
      score -= 22;
      reasons.push('contexto incompatível');
    }
  }
  if (video.aspectRatio === '9:16') { score += 2.5; reasons.push('vertical'); }
  if (video.durationSec > 0) {
    const ratio = Math.min(video.durationSec, segment.targetSeconds) / Math.max(video.durationSec, segment.targetSeconds);
    score += ratio * 2.5;
    if (video.durationSec + .35 < Math.min(2.5, segment.targetSeconds)) score -= 3;
  }
  if (video.origin === 'organic') score += .7;
  if (video.downloads > 0) score += Math.min(2.2, Math.log10(video.downloads + 1) * .8);
  if (title && normalize(segment.text).includes(title) && title.length > 7) score += 6;
  // Popularidade, formato e duração só desempataM candidatos que já
  // possuem evidência semântica. Sem isto, um take irrelevante muito baixado
  // poderia ultrapassar o limiar apenas por ser vertical e ter 8 segundos.
  if (!lexicalEvidence && !sharedConcepts.length) score -= 8;
  if (score > 0 && !reasons.length) reasons.push('termos e descrição compatíveis');
  return { video, score: Math.round(score * 100) / 100, reasons };
}

/**
 * Ranking semantico local. Limiar conservador: se nenhum take faz sentido, o
 * segmento fica sem escolha em vez de a ferramenta preencher com lixo.
 */
export function rankStockFrameVideos(segment: SmartStockSegment, videos: StockFrameVideo[], limit = 8): SmartStockCandidate[] {
  return videos.map((video) => scoreVideo(segment, video))
    .filter((candidate) => candidate.score >= (segment.concepts.length ? 5 : 3.5))
    .sort((a, b) => b.score - a.score || b.video.downloads - a.video.downloads || a.video.id.localeCompare(b.video.id))
    .slice(0, Math.max(1, limit));
}

/** Global bipartite assignment: maximize reliable unique choices first, then
 * their existing evidence scores. A chronological greedy choice can steal the
 * only exact take from a later, much more specific sentence. */
export function chooseSmartStockAssignments(segments: SmartStockSegment[]): SmartStockSegment[] {
  if (!segments.length) return [];
  const eligible = segments.map((segment) => segment.candidates.filter((candidate) => Number.isFinite(candidate.score) && candidate.score >= 3));
  const videoIds = [...new Set(eligible.flatMap((candidates) => candidates.map((candidate) => candidate.video.id)))].sort();
  const columns = new Map(videoIds.map((id, index) => [id, index + 1]));
  const rows = segments.length;
  // One private dummy column per segment guarantees that "no safe take" is
  // always feasible. Forbidden pairs can never force an unrelated selection.
  const width = videoIds.length + rows;
  const maxScore = eligible.reduce((max, candidates) => candidates.reduce((best, candidate) => Math.max(best, candidate.score), max), 0);
  const uniqueBonus = maxScore * rows + 1;
  const forbidden = uniqueBonus * (rows + 1) + maxScore;
  const evidence = eligible.map((candidates) => new Map(candidates.map((candidate) => [columns.get(candidate.video.id)!, candidate.score])));
  const cost = (row: number, column: number) => {
    if (column > videoIds.length) return 0;
    const score = evidence[row - 1].get(column);
    return score === undefined ? forbidden : -(uniqueBonus + score);
  };

  // Rectangular Hungarian algorithm. The catalog pool is sparse and bounded
  // upstream (ten candidates/segment); no remote model or inference cost.
  const rowPotential = new Float64Array(rows + 1);
  const colPotential = new Float64Array(width + 1);
  const matchedRow = new Int32Array(width + 1);
  const previousColumn = new Int32Array(width + 1);
  for (let row = 1; row <= rows; row++) {
    matchedRow[0] = row;
    let column = 0;
    const minimum = new Float64Array(width + 1).fill(Infinity);
    const seen = new Uint8Array(width + 1);
    do {
      seen[column] = 1;
      const currentRow = matchedRow[column];
      let delta = Infinity;
      let nextColumn = 0;
      for (let candidateColumn = 1; candidateColumn <= width; candidateColumn++) {
        if (seen[candidateColumn]) continue;
        const reducedCost = cost(currentRow, candidateColumn) - rowPotential[currentRow] - colPotential[candidateColumn];
        if (reducedCost < minimum[candidateColumn]) {
          minimum[candidateColumn] = reducedCost;
          previousColumn[candidateColumn] = column;
        }
        if (minimum[candidateColumn] < delta) {
          delta = minimum[candidateColumn];
          nextColumn = candidateColumn;
        }
      }
      for (let candidateColumn = 0; candidateColumn <= width; candidateColumn++) {
        if (seen[candidateColumn]) {
          rowPotential[matchedRow[candidateColumn]] += delta;
          colPotential[candidateColumn] -= delta;
        } else minimum[candidateColumn] -= delta;
      }
      column = nextColumn;
    } while (matchedRow[column] !== 0);
    do {
      const previous = previousColumn[column];
      matchedRow[column] = matchedRow[previous];
      column = previous;
    } while (column !== 0);
  }

  const result = segments.map((segment) => ({ ...segment, selectedVideoId: undefined as string | undefined }));
  const occurrences = new Map<string, number[]>();
  for (let column = 1; column <= videoIds.length; column++) {
    const row = matchedRow[column];
    if (!row || !evidence[row - 1].has(column)) continue;
    const id = videoIds[column - 1];
    result[row - 1].selectedVideoId = id;
    occurrences.set(id, [row - 1]);
  }
  // A distant reuse is preferable to an empty slot only when the take already
  // passed local evidence. Never replay the same scene in adjacent segments.
  for (let index = 0; index < result.length; index++) {
    if (result[index].selectedVideoId) continue;
    const reusable = eligible[index].map((candidate) => {
      const usedAt = occurrences.get(candidate.video.id) || [];
      return { candidate, distance: usedAt.length ? Math.min(...usedAt.map((position) => Math.abs(position - index))) : Infinity };
    }).filter((item) => item.distance > 1)
      .sort((a, b) => b.candidate.score - a.candidate.score || b.distance - a.distance || a.candidate.video.id.localeCompare(b.candidate.video.id));
    const chosen = reusable[0]?.candidate;
    if (!chosen) continue;
    result[index].selectedVideoId = chosen.video.id;
    result[index].candidates = result[index].candidates.map((candidate) => candidate.video.id === chosen.video.id
      ? { ...candidate, reasons: [...candidate.reasons.filter((reason) => reason !== 'take reutilizado em trecho distante'), 'take reutilizado em trecho distante'] }
      : candidate);
    occurrences.set(chosen.video.id, [...(occurrences.get(chosen.video.id) || []), index]);
  }
  return result;
}

export function selectedSmartCandidate(segment: SmartStockSegment): SmartStockCandidate | undefined {
  return segment.candidates.find((candidate) => candidate.video.id === segment.selectedVideoId);
}
