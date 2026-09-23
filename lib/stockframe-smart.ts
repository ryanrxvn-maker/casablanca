import { stockFrameSearchText, type StockFrameNiche, type StockFrameVideo } from './stockframe';

export type SmartCoverage = 30 | 60 | 100;
export type SmartPace = 'fast' | 'long' | 'adaptive';
export type StockFrameCopyPart = { label: string; text: string };
export type SmartStockCandidate = { video: StockFrameVideo; score: number; reasons: string[]; genericFallback?: boolean };
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
  visualBeat?: 'problem' | 'demonstration' | 'relief' | 'proof' | 'context';
  campaignText?: string;
  campaignNicheId?: string;
  campaignIngredients?: string[];
  semanticText?: string;
  semanticContextText?: string;
  candidates: SmartStockCandidate[];
  selectedVideoId?: string;
};

const STOP = new Set(`a o as os um uma uns umas de da do das dos e em no na nos nas por para pra pro com sem sob sobre entre que quem qual quais como quando onde porque se ao aos esta este esse essa isso isto seu sua seus suas meu minha meus minhas voce você voces vocês ele ela eles elas eu nos nós mas ou ja já muito muita mais menos tem ter foi ser sao são era vai vao vão pode podem pelo pela pelos pelas ate até tambem também ainda mesmo mesma assim aqui ali entao então cada todo toda todos todas nao não video vídeos videos clique clicar botao cena cenas take takes`.split(/\s+/));
const GENERIC_PERSON_TOKENS = new Set(['homem', 'mulher', 'pessoa', 'idoso', 'idosa', 'senhor', 'senhora']);

const CONCEPTS: Record<string, string[]> = {
  'dor-articular': ['dor no joelho', 'dor nas articulacoes', 'articulacao', 'joelho', 'quadril', 'ombro', 'artrite', 'artrose', 'cartilagem', 'inflamacao', 'reumatismo'],
  'mobilidade': ['dificuldade para andar', 'subir escada', 'caminhar', 'movimento', 'mobilidade', 'alongamento', 'fisioterapia', 'exercicio', 'levantando', 'caindo'],
  'diabetes': ['diabetes', 'glicose', 'acucar no sangue', 'insulina', 'glicemia', 'pancreas'],
  'emagrecimento': ['emagrecer', 'perder peso', 'gordura', 'balanca', 'obesidade', 'metabolismo', 'barriga', 'dieta'],
  'intestino': ['intestino', 'digestao', 'barriga inchada', 'constipacao', 'diarreia', 'microbiota', 'estomago'],
  'memoria': ['memoria', 'esquecimento', 'alzheimer', 'demencia', 'cerebro', 'concentracao', 'lembranca'],
  'gravidez': ['gravida', 'gravidez', 'gestante', 'bebe', 'feto', 'ultrassom', 'maternidade'],
  'saude-homem': ['prostata', 'erecao', 'erétil', 'disfuncao eretil', 'impotencia', 'desempenho sexual', 'potencia', 'testosterona', 'libido masculina'],
  'saude-mulher': ['menopausa', 'ovario', 'utero', 'menstruacao'],
  'medico': ['medico', 'doutor', 'consulta', 'hospital', 'clinica', 'diagnostico', 'exame', 'tratamento'],
  'procedimento': ['procedimento', 'cirurgia', 'agulha', 'aplicacao', 'terapia', 'laser', 'massagem', 'radiografia'],
  'remedio': ['remedio', 'medicamento', 'capsula', 'comprimido', 'suplemento', 'frasco', 'dose', 'farmacia'],
  'alimentacao': ['comida', 'alimento', 'cozinha', 'receita', 'prato', 'fruta', 'verdura', 'cafe', 'cha', 'colher'],
  'botanico': ['erva', 'ervas', 'planta', 'plantas', 'folha', 'folhas', 'botanico', 'extrato vegetal', 'fitoterapico', 'hortela', 'camomila', 'alecrim'],
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
  return value.toLowerCase().replace(/ł/g, 'l').replace(/ß/g, 'ss').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

const INGREDIENTS: [string, RegExp][] = [
  ['bicarbonato', /\b(?:bicarbonato|bicarbonate|baking soda|bicarbonat|natron|soda oczyszczona|jedl(?:a|e|ou|y|u) sod(?:a|y|ou|u|e))\b/], ['mel', /\b(?:mel|honey|miel|miod|honig)\b/], ['vick', /\b(?:vick|vicks|vaporub)\b/],
  ['babosa', /\b(?:babosa|aloe vera|aloes)\b/], ['limao', /\b(?:limao|lemon|limon|citron|cytryna|zitrone)\b/], ['vinagre', /\b(?:vinagre|vinegar|essig|ocet)\b/],
  ['gengibre', /\b(?:gengibre|ginger|jengibre|imbir|ingwer)\b/], ['canela', /\b(?:canela|cinnamon|cynamon|zimt)\b/], ['alho', /\b(?:alho|garlic|ajo|czosnek|knoblauch)\b/],
  ['hortela', /\bhortela\b/], ['camomila', /\bcamomila\b/], ['alecrim', /\balecrim\b/],
  ['ginseng', /\bginseng\b/], ['maca', /\bmaca peruana\b/], ['guarana', /\bguarana\b/],
  ['cafe', /\bcafe\b/], ['oleo', /\boleo\b/], ['sal', /\bsal\b/],
  ['banana', /\b(?:banana|platano|plantain)\b/], ['cebola', /\b(?:cebola|onion|cebolla|zwiebel|cebula)\b/],
  ['laranja', /\b(?:laranja|orange|naranja|apfelsine|pomarancza)\b/], ['vaselina', /\b(?:vaselina|vaseline|petroleum jelly)\b/],
  ['acucar', /\b(?:acucar|sugar|azucar|zucker|cukier)\b/], ['leite', /\b(?:leite|milk|leche|milch|mleko)\b/],
  ['ovo', /\b(?:ovo|ovos|egg|eggs|huevo|huevos|ei|jajko)\b/], ['abacate', /\b(?:abacate|avocado|aguacate|awokado)\b/],
  ['curcuma', /\b(?:curcuma|turmeric|azafran|kurkuma)\b/], ['aveia', /\b(?:aveia|oats|oatmeal|avena|hafer|owies)\b/],
  ['abobora', /\b(?:abobora|pumpkin|calabaza|kurbis|dynia)\b/],
];
const BOTANICAL = /\b(?:erva|ervas|hierba|hierbas|herb|herbs|ziola|ziol|krauter|planta|plantas|plants|pflanzen|rosliny|folha|folhas|leaves|hojas|liscie|botanic\w*|fitoterap\w*|hortela|camomila|alecrim|ginseng|maca peruana|guarana)\b/;
const GENERIC_RECIPE = /\b(?:truque|trick|truc|truco|sposob|receita|recipe|receta|rezept|przepis|mistura|mixture|mezcla|mischung|caseiro|caseira|homemade|casero|domowy|ervas?|herbs?|ziola|plantas?|plants?|formula natural)\b/;
// These describe a visible sexual act, not reproductive health. In particular,
// "ereção", "pênis", "próstata" and educational anatomy are not exclusions.
const EXPLICIT_SEXUAL_SCENE = /\b(?:transando|fodendo|trepando|chupando (?:o |um )?(?:pau|pinto|penis)|fazendo (?:sexo )?oral|fazendo anal|sexo anal|penetracao anal|pau defeituoso|pau mole|boquete|gemendo|sexo oral|oral sex|relacao sexual|casal em momento libidinoso|blowjob|handjob|cumshot|gangbang|porn\w*|ejaculando|ejaculating|gozando|masturbando|masturbating|penetrando|fucking|having sex|sexually explicit|nude genitals|genitais expostos)\b/;
const SUGGESTIVE_SCENE = /\b(?:apos relac\w*|depois da relac\w*|pegando na coxa|tocando na coxa|massag\w*|massage\w*|costas arranhad\w*|desejo com namorad\w*|surpreend\w* com tamanho|libidinos\w*|calcinha|lingerie|pelad[ao]\w*|nudez|tirando a roupa|no ato|gestos? sexua\w*|segundas intencoes|biscoitando|hot|18|tamanho ideal|medindo o tamanho|sensual\w*|erotic\w*)\b/;
const LOCAL_RECIPE_REFERENCE = /\b(?:bicarbonato|mel|limao|receita|recipe|receta|mistur\w*|mix\w*|mixture|prepar\w*|truque|trick|ingrediente|ingredient|caseir\w*|homemade|formula|erva|herb|planta|plant|soda|colher|produto|product|suplemento|supplement)\b/;
const CONVERSATION = /\b(?:convers\w*|dialog\w*|talk\w*|chatting)\b/;
const INVASIVE_PROCEDURE_SCENE = /\b(?:cirurg\w*|operac\w*|sutura|incisao|bisturi|surgical procedure|surgery)\b/;
const INVASIVE_PROCEDURE_COPY = /\b(?:cirurg\w*|operac\w*|sutura|incisao|bisturi|surgical procedure|surgery)\b/;
// Cross-pack recipe shots can be useful, but a different medical niche must
// not become a source of unrelated pathology just because it mentions honey.
const MEDICAL_NICHE = /\b(?:ed|eretil|erectile|prostata|prostate|diabetes|diabetico|articular\w*|artrite|arthritis|artrose|joint pain|memoria|memory|alzheimer|demencia|menopausa|menopause|lipedema|lipoedema|celulite|cellulite|gravidez|pregnancy|intestino|visao|vision|emagrecimento|weight loss|pele|skin care|skincare)\b/;

function ingredientsOf(value: string): string[] {
  const normalized = normalize(value);
  return INGREDIENTS.filter(([, pattern]) => pattern.test(normalized)).map(([name]) => name);
}

export function chooseCampaignRecipeTheme(segments: SmartStockSegment[]): string[] {
  const copy = segments[0]?.campaignText || '';
  const explicit = ingredientsOf(copy);
  if (explicit.length || !GENERIC_RECIPE.test(normalize(copy))) return explicit;
  const herbal = BOTANICAL.test(normalize(copy));
  const themes = new Map<string, { ingredients: string[]; score: number; occurrences: number }>();
  for (const segment of segments) for (const candidate of segment.candidates.slice(0, 8)) {
    const videoText = stockFrameSearchText(candidate.video);
    const ingredients = ingredientsOf(videoText);
    if (!ingredients.length || (herbal && !BOTANICAL.test(normalize(videoText)))) continue;
    const key = [...ingredients].sort().join('|');
    const prior = themes.get(key);
    themes.set(key, { ingredients, score: Math.max(prior?.score || 0, candidate.score) + (prior ? 1 : 0), occurrences: (prior?.occurrences || 0) + 1 });
  }
  return [...themes.values()].sort((a, b) => (b.score + b.occurrences * 2 + b.ingredients.length) - (a.score + a.occurrences * 2 + a.ingredients.length))[0]?.ingredients || [];
}

/** Broad catalog searches for the mechanism, independent of the campaign's
 * health pack. These are discovery queries only; all results still pass the
 * ingredient, anatomy and visual-evidence gates when ranked for a segment. */
export function smartStockMechanismQueries(segments: SmartStockSegment[]): string[] {
  const source = [...new Set(segments.flatMap((segment) => [segment.campaignText || '', segment.text,
    segment.semanticText || '', segment.contextText || '', segment.semanticContextText || '']))].join(' ');
  const ingredients = [...new Set([...ingredientsOf(source), ...segments.flatMap((segment) => segment.campaignIngredients || [])])];
  const queries: string[] = [];
  const add = (query: string) => { if (query && !queries.includes(query) && queries.length < 8) queries.push(query); };
  if (ingredients.length > 1) add(ingredients.slice(0, 4).join(' '));
  // Individual ingredients must remain discoverable: a shot of only honey is
  // valid for honey + lemon, even if the API treats multiword search as AND.
  for (const ingredient of ingredients) add(ingredient);
  for (let i = 0; i < ingredients.length && queries.length < 6; i++) {
    for (let j = i + 1; j < ingredients.length && queries.length < 6; j++) add(`${ingredients[i]} ${ingredients[j]}`);
  }
  if (BOTANICAL.test(normalize(source))) { add('ervas plantas'); add('preparando folhas'); }
  if (!queries.length && GENERIC_RECIPE.test(normalize(source))) { add('receita caseira'); add('preparando mistura'); }
  return queries;
}

export function inferStockFrameNiche(parts: StockFrameCopyPart[], niches: StockFrameNiche[]): StockFrameNiche | undefined {
  const copy = normalize(parts.map((part) => part.text).join(' '));
  const aliases: [RegExp, RegExp][] = [
    [/\b(?:ed|disfuncao eretil|erecao|impotencia|potencia|desempenho sexual|erectile dysfunction|erection|impotence|potency|disfuncion erectil|ereccion|zaburzenia erekcji|erekcja|erekci|potenci|erektionsstorung)\b/, /\b(?:ed|erecao|disfuncao eretil|erectile|erekcja|ereccion)\b/],
    [/\b(?:prostata|prostate|prostaty|prostatitis|prostatite)\b/, /\b(?:prostata|prostate)\b/],
    [/\b(?:joelho|artrose|artrite|articulac\w*|dor(?:es)? articulares?|joint pain|arthritis|dolor articular|bol stawow|gelenkschmerz)\b/, /\b(?:dores? articulares?|articulac\w*|joint|stawow|arthritis)\b/],
    [/\b(?:diabetes|diabetico|glicose|glicemia|insulina|blood sugar|glucose|azucar en sangre|cukrzyca|blutzucker)\b/, /\b(?:diabetes|diabetic|cukrzyca)\b/],
    [/\b(?:emagrec\w*|perder peso|gordura corporal|weight loss|lose weight|perdida de peso|odchudzanie|schudnac|abnehmen)\b/, /\b(?:emagrecimento|weight loss|perdida de peso|odchudzanie)\b/],
    [/\b(?:memoria|alzheimer|demencia|memory loss|memory|dementia|pamiec|demenz)\b/, /\b(?:memoria|memory|pamiec|alzheimer)\b/],
    [/\b(?:visao|vista|olhos|enxergar|vision|eyesight|sight|ojos|wzrok|sehen|yeux)\b/, /\b(?:visao|visao ocular|vision|vista|wzrok|eyesight)\b/],
    [/\b(?:menopausa|menopause|menopauza|wechseljahre)\b/, /\b(?:menopausa|menopause|menopauza)\b/],
    [/\b(?:lipedema|lipoedema)\b/, /\b(?:lipedema|lipoedema)\b/],
    [/\b(?:celulite|cellulite|celulitis|cellulit)\b/, /\b(?:celulite|cellulite|celulitis)\b/],
    [/\b(?:pele|skin care|skincare|cuidado de la piel|piel|skora|peau|hautpflege)\b/, /\b(?:pele|skin care|skincare|piel|skora|peau)\b/],
    [/\b(?:gravidez|gestante|gravida|pregnancy|embarazo|ciaza|schwangerschaft)\b/, /\b(?:gravidez|pregnancy|embarazo|ciaza)\b/],
    [/\b(?:intestino|constipacao|digestao|gut health|bowel|intestine|intestino|jelita|darm)\b/, /\b(?:intestino|gut|bowel|jelita)\b/],
  ];
  for (const [copyPattern, nichePattern] of aliases) {
    if (copyPattern.test(copy)) {
      const match = niches.find((niche) => nichePattern.test(normalize(niche.name)));
      if (match) return match;
      const nested = niches.filter((niche) => niche.subcategories?.some((folder) => nichePattern.test(normalize(folder.name))));
      if (nested.length === 1) return nested[0];
    }
  }
  // A taxonomia da conta também reconhece nichos adicionados depois, sem
  // exigir nova versão da extensão para cada pasta criada pelo StockFrame.
  const tokens = new Set(meaningful(copy));
  const ranked = niches.map((niche) => {
    const nameTokens = meaningful(niche.name).filter((token) => !['saud', 'video', 'stock', 'geral'].includes(token));
    const hits = nameTokens.filter((token) => tokens.has(token)).length;
    const folderTokens = (niche.subcategories || []).flatMap((folder) => meaningful(folder.name));
    const folderHits = [...new Set(folderTokens)].filter((token) => token.length >= 5 && tokens.has(token)).length;
    return { niche, hits, score: hits * 5 + Math.min(3, folderHits) };
  }).filter((item) => item.hits > 0 && (meaningful(item.niche.name).length === 1 || item.hits >= 2))
    .sort((a, b) => b.score - a.score || a.niche.name.localeCompare(b.niche.name, 'pt-BR'));
  return ranked[0]?.niche;
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
  if (/\b(?:frustrad\w*|sofrend\w*|impotencia|disfuncao eretil|dificuldade (?:de|para) erecao|sem erecao)\b/.test(text)) return 'distress';
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

function visualBeat(value: string, direction: SmartStockSegment['narrativeDirection']): NonNullable<SmartStockSegment['visualBeat']> {
  const text = normalize(value);
  if (/\b(?:bicarbonato|mel|limao|receita|recipe|receta|mistura|mixture|prepar\w*|aplic\w*|apply|truque|trick|erva|herb|planta|plant|ingrediente|ingredient|produto|product|suplemento|supplement|frasco|bottle|comprimido|tablet|creme|cream|aparelho|device|procedimento|procedure|mecanismo|mechanism|tratamento|treatment)\b/.test(text)) return 'demonstration';
  if (/\b(?:depoimento|prova|resultado|antes e depois|comprov\w*|mostr\w*)\b/.test(text)) return 'proof';
  if (direction === 'recovery' || /\b(?:alivio|melhora|confianca|volt\w* a|consegu\w* novamente)\b/.test(text)) return 'relief';
  if (direction === 'distress' || /\b(?:problema|dificuldade|frustr\w*|impotencia|disfuncao)\b/.test(text)) return 'problem';
  return 'context';
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
      visualBeat: visualBeat(text, semantics.narrativeDirection),
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

export function balanceMechanismPresence(segments: SmartStockSegment[]): SmartStockSegment[] {
  // Vizinhança temporal não torna uma fala sobre sintomas ou CTA uma cena de
  // receita. A promoção antiga espalhava o mecanismo para frases sem relação.
  return segments;
}

export function measureSmartStockCoverage(parts: StockFrameCopyPart[], segments: SmartStockSegment[]) {
  const seenLabels = new Set<string>();
  const counts = new Map<string, Uint8Array>();
  let totalWords = 0;
  let valid = true;
  for (const part of parts) {
    const words = part.text.match(/\S+/g)?.length || 0;
    if (!words) continue;
    if (seenLabels.has(part.label)) valid = false;
    seenLabels.add(part.label);
    counts.set(part.label, new Uint8Array(words));
    totalWords += words;
  }
  for (const segment of segments) {
    if (!segment.selectedVideoId) continue;
    const words = counts.get(segment.anchor);
    if (!words || !Number.isInteger(segment.wordFrom) || !Number.isInteger(segment.wordTo)
      || segment.wordFrom < 0 || segment.wordTo < segment.wordFrom || segment.wordTo >= words.length) {
      valid = false;
      continue;
    }
    for (let index = segment.wordFrom; index <= segment.wordTo; index++) words[index] = Math.min(2, words[index] + 1);
  }
  let coveredWords = 0;
  let overlaps = 0;
  for (const words of counts.values()) for (const count of words) {
    if (count) coveredWords++;
    if (count > 1) overlaps++;
  }
  return { totalWords, coveredWords, overlaps, percent: totalWords ? Math.round(coveredWords / totalWords * 1000) / 10 : 0,
    complete: valid && totalWords > 0 && coveredWords === totalWords && overlaps === 0 };
}

export function localizeSmartSegments(segments: SmartStockSegment[], texts: string[], contexts: string[]): SmartStockSegment[] {
  const campaignText = texts.join(' ');
  return segments.map((segment, index) => {
    const translated = texts[index] || segment.text;
    const context = contexts[index] || translated;
    const semantics = semanticFields(translated, context);
    return { ...segment, ...semantics, semanticText: translated, semanticContextText: context,
      campaignText, contextConcepts: conceptsOf(campaignText).filter((concept) => !concept.startsWith('emocao-')),
      visualBeat: visualBeat(translated, semantics.narrativeDirection) };
  });
}

type PreparedVideo = {
  title: string;
  taxonomy: string;
  visualText: string;
  visualSearchText: string;
  contentText: string;
  explicitSexualScene: boolean;
  ingredients: string[];
  shownAnatomy: string[];
  concepts: string[];
  direction: NonNullable<SmartStockSegment['narrativeDirection']>;
  recipe: boolean;
  fields: { tokens: string[]; weight: number; visual: boolean }[];
};

const preparedVideos = new WeakMap<StockFrameVideo, PreparedVideo>();

function prepareVideo(video: StockFrameVideo): PreparedVideo {
  const cached = preparedVideos.get(video);
  if (cached) return cached;
  const title = normalize(video.title);
  const tags = normalize(video.tags.join(' '));
  const description = normalize(video.description);
  const taxonomy = normalize(`${video.nicheName || ''} ${video.subcategoryName || ''}`);
  const smart = video.smartMetadata;
  const visualText = normalize([smart?.summary, smart?.concepts.join(' '), smart?.subjects.join(' '), smart?.actions.join(' '), smart?.objects.join(' '), smart?.bodyParts.join(' '), smart?.positiveKeywords.join(' ')].filter(Boolean).join(' '));
  const visualSearchText = normalize(stockFrameSearchText(video));
  const contentText = [title, tags, description, visualText].filter(Boolean).join(' ');
  const titleAnatomy = anatomyOf(video.title);
  const descriptionAnatomy = anatomyOf(video.description);
  const direction = narrativeDirection(contentText);
  let concepts = conceptsOf(contentText);
  if (direction === 'recovery') concepts = [...new Set([...concepts.filter((concept) => concept !== 'emocao-negativa'), 'emocao-positiva'])];
  if (direction === 'distress') concepts = concepts.filter((concept) => concept !== 'emocao-positiva');
  const prepared = {
    title, taxonomy, visualText, visualSearchText, contentText,
    explicitSexualScene: EXPLICIT_SEXUAL_SCENE.test(contentText),
    ingredients: ingredientsOf([video.title, video.description, video.tags.join(' '), smart?.summary, smart?.objects.join(' '), smart?.concepts.join(' ')].filter(Boolean).join(' ')),
    shownAnatomy: titleAnatomy.length ? titleAnatomy : descriptionAnatomy.length ? descriptionAnatomy : anatomyOf(video.tags.join(' ')),
    concepts, direction,
    recipe: /\b(?:receita|preparo|mistura|cozinha|ingrediente|caseiro)\b/.test(taxonomy) || ingredientsOf(video.title).length > 0,
    fields: [
      { tokens: meaningful(title), weight: 4.4, visual: true },
      { tokens: meaningful(tags), weight: 3.5, visual: true },
      { tokens: meaningful(taxonomy), weight: 2.8, visual: false },
      { tokens: meaningful(description), weight: 1.4, visual: true },
      { tokens: meaningful(visualText), weight: 3.8, visual: true },
    ],
  };
  preparedVideos.set(video, prepared);
  return prepared;
}

/** Prepare a segment once per ranking, not once for every catalog candidate.
 * Deliberately not cached by identity: the editor can change its context or
 * recipe lock between rankings, and those edits must take effect immediately. */
function prepareRanking(segment: SmartStockSegment) {
  const spokenText = segment.semanticText || segment.text;
  const spokenContext = segment.semanticContextText || segment.contextText || spokenText;
  const spokenHere = anatomyOf(spokenText);
  const localIngredients = [...new Set([...ingredientsOf(spokenText), ...ingredientsOf(segment.text)])];
  const contextIngredients = [...new Set([...ingredientsOf(spokenContext), ...ingredientsOf(segment.contextText || '')])];
  const campaignIngredients = segment.campaignIngredients?.length ? segment.campaignIngredients : ingredientsOf(segment.campaignText || '');
  const direction = segment.narrativeDirection || narrativeDirection(spokenContext);
  return {
    spokenNormalized: normalize(spokenText),
    contextNormalized: normalize(spokenContext),
    campaignIngredients: campaignIngredients.length ? campaignIngredients : contextIngredients,
    herbalCampaign: BOTANICAL.test(normalize(segment.campaignText || '')),
    queryTokens: [...new Set(meaningful(`${spokenText} ${segment.query}`))],
    localTokens: new Set(meaningful(spokenText)),
    contextTokens: new Set(meaningful(spokenContext)),
    contextConcepts: conceptsOf(spokenContext),
    localIngredients,
    contextIngredients,
    localBotanical: BOTANICAL.test(normalize(`${spokenText} ${spokenContext}`)),
    campaignConcepts: conceptsOf(segment.campaignText || spokenContext),
    campaignAnatomy: anatomyOf(segment.campaignText || spokenContext),
    campaignIsHealth: MEDICAL_NICHE.test(normalize(segment.campaignText || spokenContext)) || /\b(?:saude|erecao|potencia|testosterona|glicose|joelho|artrite|olhos|health|erection|potency)\b/.test(normalize(segment.campaignText || spokenContext)),
    spokenAnatomy: spokenHere.length ? spokenHere : anatomyOf(spokenContext),
    contextHasIngredients: contextIngredients.length > 0,
    direction,
    beat: segment.visualBeat || visualBeat(spokenText, direction),
  };
}

function scoreVideo(segment: SmartStockSegment, video: StockFrameVideo, ranking: ReturnType<typeof prepareRanking>, allowGenericFallback = false): SmartStockCandidate {
  if (!video.available || video.conflictingConcepts.length) return { video, score: -100, reasons: ['indisponível ou conflito informado pelo StockFrame'] };
  const prepared = prepareVideo(video);
  const { title, visualSearchText, ingredients: videoIngredients, shownAnatomy, recipe } = prepared;
  const smart = video.smartMetadata;
  const { campaignIngredients, herbalCampaign, queryTokens, spokenAnatomy, direction, beat } = ranking;
  const videoVisualText = visualSearchText;
  if (prepared.explicitSexualScene) {
    return { video, score: -100, reasons: ['cena sexual explícita não entra na seleção automática de anúncios'] };
  }
  if (SUGGESTIVE_SCENE.test(prepared.title)) {
    return { video, score: -100, reasons: ['cena sugestiva não entra na seleção automática de anúncios'] };
  }
  if (INVASIVE_PROCEDURE_SCENE.test(prepared.contentText) && !INVASIVE_PROCEDURE_COPY.test(ranking.contextNormalized)) {
    return { video, score: -100, reasons: ['a fala não descreve um procedimento invasivo'] };
  }
  if (/\b(?:mulher(?:es)?|esposa|parceira|casal)\b/.test(ranking.spokenNormalized)
      && /\b(?:dinheiro|grana|pagamento|pagar)\b/.test(ranking.spokenNormalized)
      && /\b(?:industria farmaceutica|farmaceutic\w*|laboratorio de remedios)\b/.test(prepared.contentText)) {
    return { video, score: -100, reasons: ['dinheiro da indústria farmacêutica não representa a fala sobre relacionamento'] };
  }
  if (smart?.negativeKeywords.some((keyword) => ranking.contextNormalized.includes(normalize(keyword)))) {
    return { video, score: -100, reasons: ['metadado visual exclui o assunto deste trecho'] };
  }
  if (herbalCampaign && videoIngredients.length && !BOTANICAL.test(videoVisualText)) {
    return { video, score: -100, reasons: ['a copy pede ervas ou plantas; a cena mostra outra fórmula'] };
  }
  if (campaignIngredients.length && videoIngredients.some((ingredient) => !campaignIngredients.includes(ingredient))) {
    return { video, score: -100, reasons: ['ingrediente diferente da combinação da copy'] };
  }
  const localRecipeReference = LOCAL_RECIPE_REFERENCE.test(ranking.spokenNormalized);
  const ingredientEvidence = videoIngredients.some((ingredient) => ranking.localIngredients.includes(ingredient)
    || (localRecipeReference && ranking.contextIngredients.includes(ingredient))
    || (localRecipeReference && beat === 'demonstration' && campaignIngredients.includes(ingredient)));
  const botanicalEvidence = BOTANICAL.test(ranking.spokenNormalized) && BOTANICAL.test(prepared.contentText);
  const compatibleMechanism = (beat === 'demonstration' || ranking.contextHasIngredients)
    && (ingredientEvidence || botanicalEvidence);
  const compatibleGeneralScene = beat !== 'demonstration' && !MEDICAL_NICHE.test(prepared.taxonomy)
    && segment.concepts.some((concept) => prepared.concepts.includes(concept));
  const neutralCrossPackFallback = allowGenericFallback && ranking.campaignIsHealth
    && !MEDICAL_NICHE.test(prepared.taxonomy)
    && /\b(?:casal|homem|mulher|pessoa|idos[ao]|familia)\b/.test(prepared.contentText)
    && /\b(?:convers\w*|sentad\w*|olhando|caminh\w*|rotina|abrac\w*|consulta|consultorio)\b/.test(prepared.contentText);
  if (segment.campaignNicheId && video.nicheId && video.nicheId !== segment.campaignNicheId
      && !(compatibleMechanism && !MEDICAL_NICHE.test(prepared.taxonomy)) && !compatibleGeneralScene && !neutralCrossPackFallback) {
    return { video, score: -100, reasons: ['nicho incompatível com a campanha'] };
  }
  if (recipe && !localRecipeReference && !ranking.localIngredients.length) {
    return { video, score: -100, reasons: ['receita não mencionada neste trecho da fala'] };
  }
  if (smart?.graphicContent || smart?.containsWatermark) return { video, score: -100, reasons: ['conteúdo impróprio para anúncio'] };
  // The scene's explicit subject outranks catalog taxonomy. "Homem" can
  // share the men's-health niche with prostate content while the shot plainly
  // shows knee pain. Prostate tags must not override a knee-only scene title.
  if (spokenAnatomy.length && shownAnatomy.length && !spokenAnatomy.some((part) => shownAnatomy.includes(part))) {
    return { video, score: -100, reasons: ['parte do corpo diferente da fala'] };
  }
  const neutralCoupleAction = /\b(?:casal|namorad\w*|marido|esposa)\b/.test(prepared.title)
    && /\b(?:abrac\w*|sorri\w*|sorris\w*|sentad\w*|caminh\w*|maos dadas|olhando um para o outro)\b/.test(prepared.title);
  const genericHealthcareScene = allowGenericFallback && ranking.campaignIsHealth
    && /\b(?:medico|urologista|doutor|consulta|consultorio)\b/.test(`${prepared.title} ${prepared.visualText}`);
  if (CONVERSATION.test(ranking.spokenNormalized)
      && !CONVERSATION.test(`${prepared.title} ${prepared.visualText}`) && !neutralCoupleAction && !genericHealthcareScene) {
    return { video, score: -100, reasons: ['a fala descreve conversa, mas o take mostra outra ação'] };
  }
  const videoConcepts = prepared.concepts;
  const videoDirection = prepared.direction;
  if ((direction === 'recovery' && videoDirection === 'distress') || (direction === 'distress' && videoDirection === 'recovery')) {
    return { video, score: -100, reasons: ['ação oposta ao contexto da fala'] };
  }
  const reasons: string[] = [];
  let score = 0;
  let lexicalEvidence = 0;
  for (const token of queryTokens) {
    let best = 0;
    let visualMatch = false;
    for (const field of prepared.fields) {
      const tokens = field.tokens;
      const exact = tokens.includes(token);
      const partial = token.length >= 5 && tokens.some((candidate) => candidate.startsWith(token) || token.startsWith(candidate));
      if (exact || partial) {
        best = Math.max(best, field.weight * (exact ? 1 : .68));
        if (field.visual) visualMatch = true;
      }
    }
    if (best) {
      if (visualMatch && ranking.localTokens.has(token) && !GENERIC_PERSON_TOKENS.has(token)) lexicalEvidence++;
      score += best * (1 + Math.min(.8, token.length / 20));
    }
  }
  const sharedConcepts = segment.concepts.filter((concept) => videoConcepts.includes(concept));
  // A split sentence can inherit its own subject, but the campaign's niche,
  // aspect ratio and remote numeric score cannot stand in for scene evidence.
  const contextualConcepts = ranking.contextConcepts.filter((concept) => videoConcepts.includes(concept));
  const contextLexicalEvidence = prepared.fields.some((field) => field.visual && field.tokens.some((token) => token.length >= 4 && ranking.contextTokens.has(token)));
  if (!lexicalEvidence && !sharedConcepts.length && !ingredientEvidence && !botanicalEvidence) {
    // Invoked only by the explicit last-resort helper, after broad retrieval.
    // Same pack alone is insufficient: require a neutral identifiable scene
    // plus a real thematic connection in its own title/description/metadata.
    const neutralHuman = /\b(?:homem|mulher|pessoa|idos[ao]|casal|familia)\b/.test(prepared.contentText)
      && /\b(?:convers\w*|sentad\w*|olhando|caminh\w*|rotina|abra[cç]\w*)\b/.test(prepared.contentText);
    const healthcare = /\b(?:medico|doutor|urologista|consulta|clinica|consultorio|profissional de saude)\b/.test(prepared.contentText);
    const educationalAnatomy = /\b(?:anatomia|3d|ilustracao)\b/.test(prepared.contentText)
      && shownAnatomy.some((part) => ranking.campaignAnatomy.includes(part));
    const thematicEducationalHealth = /\b(?:anatomia|animacao|3d|sistema reprodutor|fluxo sanguineo)\b/.test(prepared.contentText)
      && prepared.concepts.some((concept) => concept.startsWith('saude-') && ranking.campaignConcepts.includes(concept));
    const themeLink = videoConcepts.some((concept) => ranking.campaignConcepts.includes(concept))
      || (healthcare && ranking.campaignIsHealth)
      || educationalAnatomy
      || thematicEducationalHealth
      || (neutralHuman && /\bcasal\b/.test(prepared.contentText) && ranking.campaignConcepts.includes('saude-homem'));
    const anatomyConflict = shownAnatomy.length > 0
      && !shownAnatomy.some((part) => ranking.campaignAnatomy.includes(part));
    if (!allowGenericFallback || recipe || videoDirection !== 'neutral' || anatomyConflict
        || !(neutralHuman || healthcare || educationalAnatomy || thematicEducationalHealth) || !themeLink) {
      return { video, score: -100, reasons: ['sem evidência visual do trecho ou da frase de contexto'] };
    }
    score += 3;
    reasons.push('alternativa genérica com vínculo ao tema da campanha; sem correspondência específica com a fala');
  }
  if (ingredientEvidence) { score += 12; reasons.push('ingrediente congruente com a receita'); }
  if (botanicalEvidence) { score += 8; reasons.push('cena botânica congruente'); }
  if (lexicalEvidence) reasons.push('termos visuais do trecho');
  if (!lexicalEvidence && !sharedConcepts.length && (contextualConcepts.length || contextLexicalEvidence)) {
    score += Math.min(8, contextualConcepts.length * 4 + (contextLexicalEvidence ? 3 : 0));
    reasons.push('contexto visual da mesma frase');
  }
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
  if (segment.campaignNicheId && video.nicheId === segment.campaignNicheId) {
    score += 7;
    reasons.push('nicho da campanha');
  }
  if (video.finalScore !== undefined) {
    score += Math.max(0, Math.min(1, video.finalScore)) * 24;
    if (video.matchReason) reasons.push(video.matchReason.slice(0, 160));
  }
  if (video.matchedConcepts.length) score += Math.min(6, video.matchedConcepts.length * 2);
  if (smart?.adSuitabilityScore !== undefined) score += Math.max(0, Math.min(1, smart.adSuitabilityScore)) * 2;
  if (smart?.containsText) score -= 5;
  if (beat === 'problem' && /\b(?:dor|dificuldade|frustr\w*|problema|impotencia|disfuncao|triste|desconforto)\b/.test(videoVisualText)) score += 7;
  if (beat === 'relief' && /\b(?:alivio|melhora|feliz|sorris\w*|confian\w*|recuper\w*|casal)\b/.test(videoVisualText)) score += 8;
  if (beat === 'proof' && /\b(?:depoimento|resultado|antes e depois|medico|doutor|explic\w*)\b/.test(videoVisualText)) score += 5;
  if (beat === 'demonstration' && /\b(?:prepar\w*|mistura|ingrediente|receita|aplic\w*|folha|erva|planta)\b/.test(videoVisualText)) score += 6;
  if (recipe && beat !== 'demonstration' && !ranking.contextHasIngredients && segment.campaignNicheId
      && !(herbalCampaign && BOTANICAL.test(videoVisualText))) {
    score -= 30;
    reasons.push('receita fora deste trecho');
  }
  if (video.durationSec > 0) {
    const ratio = Math.min(video.durationSec, segment.targetSeconds) / Math.max(video.durationSec, segment.targetSeconds);
    score += ratio * 2.5;
    if (video.durationSec + .35 < Math.min(2.5, segment.targetSeconds)) score -= 3;
  }
  if (video.origin === 'organic') score += .7;
  if (video.downloads > 0) score += Math.min(2.2, Math.log10(video.downloads + 1) * .8);
  if (title && ranking.spokenNormalized.includes(title) && title.length > 7) score += 6;
  // Format, popularity and remote scores are tie-breaks only: the hard scene
  // evidence gate above also applies when full coverage lowers the threshold.
  if (score > 0 && !reasons.length) reasons.push('termos e descrição compatíveis');
  return { video, score: Math.round(score * 100) / 100, reasons };
}

/**
 * Ranking semantico local. Limiar conservador: se nenhum take faz sentido, o
 * segmento fica sem escolha em vez de a ferramenta preencher com lixo.
 */
export function rankStockFrameVideos(segment: SmartStockSegment, videos: StockFrameVideo[], limit = 8, fullCoverage = false): SmartStockCandidate[] {
  const ranking = prepareRanking(segment);
  return videos.map((video) => scoreVideo(segment, video, ranking))
    .filter((candidate) => candidate.score >= (fullCoverage ? 1 : segment.concepts.length ? 5 : 3.5))
    .sort((a, b) => b.score - a.score || b.video.downloads - a.video.downloads || a.video.id.localeCompare(b.video.id))
    .slice(0, Math.max(1, limit));
}

/** Global bipartite assignment: maximize reliable unique choices first, then
 * their existing evidence scores. A chronological greedy choice can steal the
 * only exact take from a later, much more specific sentence. */
export function chooseSmartStockAssignments(segments: SmartStockSegment[], fullCoverage = false): SmartStockSegment[] {
  if (!segments.length) return [];
  const eligible = segments.map((segment) => segment.candidates.filter((candidate) => Number.isFinite(candidate.score) && candidate.score >= (fullCoverage ? 1 : 3)));
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
  if (fullCoverage) {
    // A cobertura total pode reutilizar um take seguro somente quando não há
    // outra alternativa. Jamais transforma um conflito em correspondência.
    for (let index = 0; index < result.length; index++) {
      if (result[index].selectedVideoId) continue;
      const candidate = eligible[index].sort((a, b) => b.score - a.score)[0];
      if (candidate) result[index].selectedVideoId = candidate.video.id;
    }
  }
  // A mesma pasta visual três vezes em seguida deixa o anúncio monótono.
  // Só troca quando a alternativa é quase tão relevante e ainda não foi usada.
  for (let index = 2; index < result.length; index++) {
    const current = result[index];
    const selected = current.candidates.find((candidate) => candidate.video.id === current.selectedVideoId);
    const previous = result[index - 1].candidates.find((candidate) => candidate.video.id === result[index - 1].selectedVideoId);
    const earlier = result[index - 2].candidates.find((candidate) => candidate.video.id === result[index - 2].selectedVideoId);
    if (!selected || !previous || !earlier) continue;
    const group = (video: StockFrameVideo) => video.subcategoryId || video.subcategoryName || video.duplicateGroupId || '';
    if (!group(selected.video) || group(selected.video) !== group(previous.video) || group(selected.video) !== group(earlier.video)) continue;
    const used = new Set(result.map((segment) => segment.selectedVideoId).filter(Boolean));
    const alternative = current.candidates.find((candidate) => candidate.score >= selected.score - 6
      && candidate.video.id !== selected.video.id && !used.has(candidate.video.id)
      && group(candidate.video) !== group(selected.video)
      && (!candidate.video.duplicateGroupId || candidate.video.duplicateGroupId !== selected.video.duplicateGroupId));
    if (alternative) current.selectedVideoId = alternative.video.id;
  }
  return result;
}

/** Last resort for unfilled full100 slots ONLY, after the caller has exhausted
 * specific and broad catalog searches. Normal ranking never invokes this. */
export function rankStockFrameGenericFallback(segment: SmartStockSegment, videos: StockFrameVideo[], limit = 8): SmartStockCandidate[] {
  const ranking = prepareRanking(segment);
  return videos.map((video) => scoreVideo(segment, video, ranking, true))
    .filter((candidate) => candidate.score >= 1)
    .sort((a, b) => b.score - a.score || a.video.id.localeCompare(b.video.id))
    .slice(0, Math.max(1, limit))
    .map((candidate) => ({ ...candidate, genericFallback: true,
      reasons: candidate.reasons.some((reason) => reason.startsWith('alternativa genérica')) ? candidate.reasons
        : ['alternativa genérica após esgotar a busca específica', ...candidate.reasons] }));
}

export function selectedSmartCandidate(segment: SmartStockSegment): SmartStockCandidate | undefined {
  return segment.candidates.find((candidate) => candidate.video.id === segment.selectedVideoId);
}
