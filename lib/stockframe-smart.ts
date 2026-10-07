import { stockFrameSearchText, type StockFrameNiche, type StockFrameOrigin, type StockFrameVideo } from './stockframe';
import { stockFrameVisualAudit, stockFrameVisualAuditVersion, type StockFrameVisualAudit } from './stockframe-visual-audit';
import { stockFrameFeelingNiche, stockFrameFeelingVersion, type StockFrameFeelingNiche } from './stockframe-feeling';
import {
  campaignPersonaOf, isPeopleFamily, NEUTRAL_SCENE_FAMILIES, personaMatch, personasNamedIn, SCENE_FAMILY_LABEL, sceneIntentFit, sceneProfileOf,
  segmentVisualIntent, type SceneFamily, type SceneProfile, type ScenePersona, type VisualIntent,
} from './stockframe-director';

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

export type SmartStockTimelineBlock = {
  id: string;
  kind: 'stock' | 'avatar';
  anchor: string;
  wordFrom: number;
  wordTo: number;
  text: string;
  targetSeconds: number;
  segmentId?: string;
};

/** Show the entire copy, including the words deliberately left to the avatar. */
export function buildSmartStockTimeline(parts: StockFrameCopyPart[], segments: SmartStockSegment[]): SmartStockTimelineBlock[] {
  const timeline: SmartStockTimelineBlock[] = [];
  for (const [partIndex, part] of parts.entries()) {
    const words = part.text.match(/\S+/g) || [];
    const chosen = segments.filter((segment) => segment.anchor === part.label && segment.selectedVideoId)
      .sort((a, b) => a.wordFrom - b.wordFrom || a.wordTo - b.wordTo);
    let cursor = 0;
    const addAvatar = (to: number) => {
      if (to < cursor) return;
      const from = cursor;
      timeline.push({ id: `avatar:${partIndex}:${from}-${to}`, kind: 'avatar', anchor: part.label,
        wordFrom: from, wordTo: to, text: words.slice(from, to + 1).join(' '),
        targetSeconds: Math.round((to - from + 1) / 2.35 * 10) / 10 });
    };
    for (const segment of chosen) {
      if (segment.wordFrom < cursor || segment.wordTo >= words.length || segment.wordFrom < 0) continue;
      addAvatar(segment.wordFrom - 1);
      timeline.push({ id: `stock:${segment.id}`, kind: 'stock', anchor: part.label,
        wordFrom: segment.wordFrom, wordTo: segment.wordTo, text: words.slice(segment.wordFrom, segment.wordTo + 1).join(' '),
        targetSeconds: segment.targetSeconds, segmentId: segment.id });
      cursor = segment.wordTo + 1;
    }
    addAvatar(words.length - 1);
  }
  return timeline;
}

const STOP = new Set(`a o as os um uma uns umas de da do das dos e em no na nos nas por para pra pro com sem sob sobre entre que quem qual quais como quando onde porque se ao aos esta este esse essa isso isto seu sua seus suas meu minha meus minhas voce você voces vocês ele ela eles elas eu nos nós mas ou ja já muito muita mais menos tem ter foi ser sao são era vai vao vão pode podem pelo pela pelos pelas ate até tambem também ainda mesmo mesma assim aqui ali entao então cada todo toda todos todas nao não video vídeos videos clique clicar botao cena cenas take takes
parte conta contam contar ninguem detalhe jeito final atencao presta prestar existe muda completamente quase nada tudo sempre nunca coisa coisas vez vezes relataram muitos muitas maioria sabe saiba saber quer querem acha acham servia deixar fica ficar faz fazer diz dizer passa`.split(/\s+/));
// "A parte que ninguém te CONTA" não é "conta do banco"; palavras de ligação
// e de discurso não são evidência visual. Pessoas genéricas pontuam, mas
// sozinhas não provam que a cena mostra o que a fala diz.
const GENERIC_PERSON_TOKENS = new Set(['homem', 'mulher', 'pessoa', 'idoso', 'idosa', 'senhor', 'senhora', 'pessoa', 'gente', 'homen', 'mulhere']);

const CONCEPTS: Record<string, string[]> = {
  'dor-articular': ['dor no joelho', 'dor nas articulacoes', 'articulacao', 'joelho', 'quadril', 'ombro', 'artrite', 'artrose', 'cartilagem', 'reumatismo'],
  // Inflamação não é só de articulação: a próstata inflamada mostrava
  // "contexto: dor-articular" na revisão.
  'inflamacao': ['inflamacao', 'inflamado', 'inflamada', 'inchaco', 'inchado', 'inchada', 'incha', 'desincha'],
  'mobilidade': ['dificuldade para andar', 'subir escada', 'caminhar', 'movimento', 'mobilidade', 'alongamento', 'fisioterapia', 'exercicio', 'levantando', 'caindo'],
  'diabetes': ['diabetes', 'glicose', 'acucar no sangue', 'insulina', 'glicemia', 'pancreas'],
  'emagrecimento': ['emagrecer', 'perder peso', 'gordura', 'balanca', 'obesidade', 'metabolismo', 'barriga', 'dieta'],
  'lipedema': ['lipedema', 'lipoedema', 'pernas inchadas', 'perna inflamada', 'sistema linfatico'],
  'celulite': ['celulite', 'cellulite', 'furinhos nas pernas'],
  'intestino': ['intestino', 'digestao', 'barriga inchada', 'constipacao', 'diarreia', 'microbiota', 'estomago'],
  // Memória é o SINTOMA (gente esquecendo); cérebro é o ÓRGÃO. Juntos, toda
  // frase de memória casava qualquer cérebro 3D e o AD virava só cérebro.
  'memoria': ['memoria', 'esquecimento', 'esquecendo', 'esquecido', 'esquecida', 'esquecer', 'alzheimer', 'demencia', 'concentracao', 'lembranca', 'confusao mental', 'lapsos de memoria', 'nevoa mental'],
  'cerebro': ['cerebro', 'cerebral', 'neuronio', 'neuronios', 'neural', 'sistema nervoso'],
  'gravidez': ['gravida', 'gravidez', 'gestante', 'bebe', 'feto', 'ultrassom', 'maternidade'],
  'saude-homem': ['prostata', 'prosta', 'erecao', 'erétil', 'disfuncao eretil', 'impotencia', 'desempenho sexual', 'potencia', 'testosterona', 'libido masculina'],
  'urinario': ['urina', 'urinar', 'mijar', 'mijando', 'bexiga', 'jato urinario', 'jato fraco', 'miccao', 'nocturia', 'ir ao banheiro', 'fralda', 'fraldas', 'sonda', 'incontinencia', 'vazando', 'xixi'],
  'saude-mulher': ['menopausa', 'ovario', 'utero', 'menstruacao'],
  'medico': ['medico', 'doutor', 'consulta', 'hospital', 'clinica', 'diagnostico', 'exame', 'tratamento'],
  'procedimento': ['procedimento', 'cirurgia', 'cortar o tecido', 'raspar a prostata', 'agulha', 'aplicacao', 'terapia', 'laser', 'massagem', 'radiografia'],
  'incontinencia': ['fralda', 'fraldas', 'incontinencia', 'vazando', 'mijando na calca', 'xixi na calca', 'urina escapando', 'pinga na cueca', 'gotejando'],
  'disfuncao': ['broxa', 'broxar', 'broxava', 'broxei', 'brochar', 'brochava', 'brochei', 'falha eretil', 'impotencia', 'impotente', 'pau mole', 'nao subia', 'falhando na cama', 'falhei na cama'],
  'industria-farmaceutica': ['industria farmaceutica', 'farmaceutica', 'farmaceuticas', 'big pharma', 'laboratorio de remedios', 'industria de remedios'],
  'toxina': ['toxina', 'toxinas', 'toxico', 'toxica', 'toxicos', 'toxicas', 'veneno', 'impurezas', 'microplastico', 'microplasticos', 'placas toxicas'],
  'remedio': ['remedio', 'medicamento', 'capsula', 'comprimido', 'suplemento', 'frasco', 'dose', 'farmacia', 'finasterida', 'dutasterida', 'tansulosina', 'tamsulosina', 'prescrito', 'receitado', 'azulzinho', 'viagra', 'pilula'],
  'alimentacao': ['comida', 'alimento', 'cozinha', 'receita', 'prato', 'fruta', 'verdura', 'cafe', 'cha', 'colher'],
  'botanico': ['erva', 'ervas', 'planta', 'plantas', 'folha', 'folhas', 'botanico', 'extrato vegetal', 'fitoterapico', 'hortela', 'camomila', 'alecrim'],
  'sono': ['sono', 'dormir', 'insomnia', 'cama', 'acordar', 'cansaco', 'ronco', 'acordando', 'acordou', 'acordo', 'madrugada', 'noite inteira', 'insonia'],
  'pele': ['pele', 'ruga', 'rosto', 'acne', 'mancha', 'colageno', 'creme'],
  'cabelo': ['cabelo', 'calvicie', 'queda de cabelo', 'fio', 'couro cabeludo'],
  'coracao': ['coracao', 'pressao', 'arteria', 'circulacao', 'infarto', 'cardiaco'],
  'dinheiro': ['dinheiro', 'preco', 'caro', 'barato', 'economia', 'conta bancaria', 'conta de luz', 'pagamento', 'cartao', 'custa', 'custo', 'gastar', 'gasto', 'reais', 'centavos'],
  'celular': ['celular', 'telefone', 'aplicativo', 'app', 'tela', 'mensagem', 'internet'],
  'trabalho': ['trabalho', 'escritorio', 'computador', 'reuniao', 'profissional'],
  'relacionamento': ['casal', 'relacionamento', 'marido', 'esposa', 'amor', 'beijo', 'discussao'],
  'familia': ['familia', 'mae', 'pai', 'filho', 'filha', 'avo', 'avó', 'idosa', 'idoso'],
  'emocao-negativa': ['dor', 'dores', 'doendo', 'dolorido', 'dolorida', 'sofrimento', 'triste', 'preocupado', 'ansiedade', 'medo', 'desconforto', 'frustracao'],
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
  ['curcuma', /\b(?:curcuma|acafrao|turmeric|azafran|kurkuma)\b/], ['aveia', /\b(?:aveia|oats|oatmeal|avena|hafer|owies)\b/],
  ['abobora', /\b(?:abobora|pumpkin|calabaza|kurbis|dynia)\b/],
  // Heróis de oferta que o catálogo ainda não cobre (quiabo) precisam ser
  // reconhecidos mesmo assim: sem isso, "faz tudo na sua cozinha" aceitava
  // qualquer cena de cozinha com OUTRO alimento — o café de um casal.
  ['quiabo', /\b(?:quiabos?|okra|quimbombo|ocra)\b/], ['melancia', /\b(?:melancia|watermelon|sandia|arbuz)\b/],
  ['abacaxi', /\b(?:abacaxi|pineapple|pina|ananas)\b/], ['pepino', /\b(?:pepino|cucumber|ogorek|gurke)\b/],
  ['beterraba', /\b(?:beterraba|beetroot|beet|remolacha|burak)\b/], ['chia', /\bchia\b/],
  ['cerveja', /\b(?:cerveja|beer|cerveza|piwo|bier)\b/], ['ginkgo', /\b(?:ginkgo|ginko|gingko)\b/],
  // Suplementos com nome também são "outro ingrediente" numa receita de quiabo.
  ['omega 3', /\bomega\s?3\b/], ['colageno', /\bcolageno\b/], ['magnesio', /\bmagnesio\b/],
  // Bases como azeite e iogurte ficam de fora de propósito: "azeite de
  // alecrim" é o mesmo ritual do alecrim, não uma oferta diferente.
];
const BOTANICAL = /\b(?:erva|ervas|hierba|hierbas|herb|herbs|ziola|ziol|krauter|planta|plantas|plants|pflanzen|rosliny|folha|folhas|leaves|hojas|liscie|botanic\w*|fitoterap\w*|hortela|camomila|alecrim|ginseng|maca peruana|guarana)\b/;
const GENERIC_RECIPE = /\b(?:truque|trick|truc|truco|sposob|receita|recipe|receta|rezept|przepis|mistura|mixture|mezcla|mischung|caseiro|caseira|homemade|casero|domowy|ervas?|herbs?|ziola|plantas?|plants?|formula natural)\b/;
// These describe a visible sexual act, not reproductive health. In particular,
// "ereção", "pênis", "próstata" and educational anatomy are not exclusions.
const EXPLICIT_SEXUAL_SCENE = /\b(?:transando|fodendo|trepando|chupando (?:o |um )?(?:pau|pinto|penis)|fazendo (?:sexo )?oral|fazendo anal|sexo anal|penetracao anal|pau defeituoso|pau mole|boquete|gemendo|sexo oral|oral sex|relacao sexual|casal em momento libidinoso|blowjob|handjob|cumshot|gangbang|porn\w*|ejaculando|ejaculacao|ejaculating|gozando|masturbando|masturbating|penetrando|fucking|having sex|sexually explicit|nude genitals|genitais expostos)\b/;
// A checked frame can be non-explicit even under an explicit catalog title.
// Nonetheless, that source title is unsuitable for automatic ad selection;
// educational words such as "ejaculação" remain governed by the visual audit.
const EXPLICIT_STOCK_TITLE = /\b(?:transando|fazendo sexo|having sex|fucking|porn\w*|boquete|sexo oral|sexo anal|penetracao sexual)\b/;
const SUGGESTIVE_SCENE = /\b(?:duplo sentido|safad\w*|seux\w*|sexua\w*|apos relac\w*|depois da relac\w*|pegando na coxa|tocando na coxa|massag\w*|massage\w*|costas arranhad\w*|desejo com namorad\w*|surpreend\w* com tamanho|libidinos\w*|calcinha|lingerie|pelad[ao]\w*|nudez|tirando a roupa|no ato|segundas intencoes|biscoitando|exibind\w*|hot|18|tamanho ideal|medindo o tamanho|sensual\w*|erotic\w*|(?:homem|velho) com erecao)\b/;
const ED_CAMPAIGN = /\b(?:ed|disfuncao eretil|erecao|impotencia|potencia masculina|desempenho sexual|erectile dysfunction|erection|erectile|potency|potencia|potenci\w*|erekcja|erekci|zaburzenia erekcji|erektionsstorung|disfuncion erectil|ereccion)\b/;
const ED_INTIMATE_MOMENT = /\b(?:casal|parceir\w*|esposa|mulher|namorad\w*|intim\w*|desejo|libido|sedu\w*|relacionamento|satisf\w*|cama|quarto|couple|partner|wife|desire|intimacy|relationship|bedroom|pareja|intimidad|kobiet\w*|zona|partnerk\w*|lozk\w*)\b/;
const MECHANISM_DETAIL_COPY = /\b(?:valv\w*|blood|sangue|arter\w*|circula\w*|microscop\w*|fluxo|toxins?|toxina\w*|pesquisa\w*|research|studies|study|estudo\w*)\b/;
const SOCIAL_PROOF_COPY = /\b(?:likes?|comentari\w*|comments?|viral|plataforma|platform|views?|visualiza\w*|exploded|explodiu)\b/;
const SOCIAL_PROOF_SCENE = /\b(?:celular|smartphone|telefone|phone|tela|screen|rede social|social media|comentari\w*|comments?|likes?|video|apresentador|falando para camera)\b/;
const CONFLICT_SCENE = /\b(?:discut\w*|brig\w*|conflito|separac\w*|arguing|fight\w*)\b/;
const CONFLICT_COPY = /\b(?:discut\w*|brig\w*|conflito|separac\w*|arguing|fight\w*)\b/;
const BETRAYAL_SCENE = /\b(?:traind\w*|traic\w*|infidel\w*|adulter\w*)\b/;
const BETRAYAL_COPY = /\b(?:traind\w*|traic\w*|infidel\w*|adulter\w*)\b/;
// Educational anatomy can show an erection even during a generic health
// explanation. Only the negative/sexual metaphor needs the stricter moment.
const ERECTILE_SCENE = /\b(?:brox\w*|broch\w*|pau mole)\b/;
const ERECTILE_MOMENT = /\b(?:brox\w*|broch\w*|erecao|disfuncao eretil|impotencia|potencia|desempenho sexual|sexo|desejo|libido|relacionamento|namor\w*|parceir\w*|cama)\b/;
const NAMED_PUBLIC_FIGURE = /\b(?:vini jr|vinicius junior|neymar|cristiano ronaldo|ronaldo|messi)\b/;
const URINARY_BLEEDING_SCENE = /(?:\b(?:mij\w*|urin\w*)\b.{0,40}\bsangu\w*\b|\bsangu\w*\b.{0,40}\b(?:mij\w*|urin\w*)\b|\bhematuria\b)/;
const RECTAL_EXAM_SCENE = /(?:\bexame\w*\b.{0,30}\btoque\b|\btoque\b.{0,30}\bexame\w*\b|\bprosta\w*\b.{0,30}\btoque\b|\btoque\b.{0,30}\bprosta\w*\b|\btoque retal\b)/;
const PROSTATE_EXAM_SCENE = /(?:\bexame\w*\b.{0,25}\bprosta\w*\b|\bprosta\w*\b.{0,25}\bexame\w*\b)/;
const ERECTILE_ANATOMY_SCENE = /\b(?:erecao|ejaculacao)\b/;
const LIPEDEMA_CAMPAIGN = /\b(?:lipedema|lipoedema)\b/;
const LIPEDEMA_VISUAL = /\b(?:lipedema|lipoedema)\b/;
const MEDICATION_SCENE = /\b(?:remedio|medicamento|capsula|comprimido|tomando pilulas?)\b/;
const URINARY_ACTION_SCENE = /\b(?:urin\w*|mij\w*|bexiga|jato urinario|mangueira jato)\b/;
const LOCAL_RECIPE_REFERENCE = /\b(?:bicarbonato|mel|limao|receita|recipe|receta|mistur\w*|mix\w*|mixture|prepar\w*|truque|trick|ingrediente|ingredient|caseir\w*|homemade|formula|erva|herb|planta|plant|soda|colher|produto|product|suplemento|supplement)\b/;
const CONVERSATION = /\b(?:convers\w*|dialog\w*|talk\w*|chatting)\b/;
const INVASIVE_PROCEDURE_SCENE = /\b(?:cirurg\w*|operac\w*|sutura|incisao|bisturi|surgical procedure|surgery)\b/;
const INVASIVE_PROCEDURE_COPY = /\b(?:cirurg\w*|operac\w*|sutura|incisao|bisturi|surgical procedure|surgery|cortar o tecido|cortar a prostata|raspar a prostata|retirar a prostata|tirar a prostata)\b/;
const CTA_COPY = /\b(?:clic\w*|botao|saiba mais|assist\w* (?:ao? )?video|ver (?:o |esse )?video|watch (?:the )?video|click\w*|tap\w*|button|learn more)\b/;
const CTA_SCENE = /\b(?:clic\w*|apert\w*|tocando (?:na )?tela|botao|celular|smartphone|telefone|assist\w* (?:ao? )?video|video (?:no |em )?celular|click\w*|tap\w*|phone|screen)\b/;
const CTA_PHONE = /\b(?:celular|smartphone|telefone|phone|tela|screen)\b/;
const CTA_NEUTRAL_ACTION = /\b(?:usand\w*|olhand\w*|clic\w*|apert\w*|tocand\w*|assistind\w*|vendo|using|looking|watching|clicking|tapping)\b/;
const CTA_CONFLICT_SCENE = /\b(?:toxic\w*|chor\w*|trist\w*|discut\w*|brig\w*|briga|desesper\w*|pagament\w*|pagando|paying)\b/;
// Cross-pack recipe shots can be useful, but a different medical niche must
// not become a source of unrelated pathology just because it mentions honey.
const MEDICAL_NICHE = /\b(?:ed|eretil|erectile|prosta|prostata|prostate|diabetes|diabetico|articular\w*|artrite|arthritis|artrose|joint pain|memoria|memory|alzheimer|demencia|menopausa|menopause|lipedema|lipoedema|celulite|cellulite|gravidez|pregnancy|intestino|visao|vision|emagrecimento|weight loss|pele|skin care|skincare|rejuvenesc\w*|neuropatia|zumbido)\b/;
// Cena de casal/namoro só ilustra fala que fala de parceira, desejo ou
// desempenho. Num AD de próstata, "faz tudo na sua cozinha" virava o café
// que o namorado prepara pra namorada de toalha na cama.
const ROMANCE_SCENE = /\b(?:namorad\w*|casal|casais|beij\w*|romant\w*|romance|amante|apaixonad\w*|lua de mel)\b/;
const PARTNER_OR_INTIMACY_COPY = /\b(?:mulher(?:es)?|esposa|parceir\w*|namorad\w*|casal|marido|companheir\w*|relacionamento|amor|romance|desejo|intim\w*|libido|sexo|sexual|cama|potencia|erecao|eretil|impoten\w*|brox\w*|broch\w*|wife|partner|couple|girlfriend|desire|intimacy|relationship|sex|bedroom|kobiet\w*|zona|partnerk\w*|pareja|esposa)\b/;
const RELATIONSHIP_PACK = /\brelacionamento\b/;
// Remédio por nome comercial ou "prescrito" também é fala de medicação.
const MEDICATION_COPY = /\b(?:remedio\w*|medicament\w*|capsula\w*|comprimido\w*|pilula\w*|farmacia\w*|dose|prescri\w*|receitad\w*|finasterid\w*|finas|dutasterid\w*|tansulosin\w*|tamsulosin\w*|sildenafil\w*|tadalafil\w*|viagra|cialis|metformin\w*|tratamento|farmaceutic\w*|azulzinho)\b/;
// Packs que não são b-roll: cabeças falantes de I.A (viram outra pessoa
// falando por cima do avatar) e efeitos/SFX/setas de edição.
const NON_BROLL_PACK = /\b(?:avatares realistas|edicao)\b/;
// Packs de renda/prosperidade só ilustram fala de dinheiro, riqueza ou fé —
// "o quiabo custa quase nada" puxava ostentação, anjo e dashboard de lucro.
const WEALTH_PACK = /\b(?:renda extra|prosperidade|religios\w*)\b/;
const WEALTH_COPY = /\b(?:rico|ricos|riqueza|luxo|milion\w*|milhoes|ostent\w*|lucr\w*|faturamento|faturar|vendas|renda|enriquec\w*|fortuna|dinheiro|grana|pagar|pagamento|gast\w*|conta bancaria|salario|aposentadoria|divida\w*|endivid\w*)\b/;
const LUXURY_SCENE = /\b(?:luxo|luxuos\w*|ostent\w*|grife|mansao|iate|jatinho|diamante|louis vuitton|dashboard|lucro|notificacao de vendas)\b/;
const LUXURY_COPY = /\b(?:rico|ricos|riqueza|luxo|milion\w*|milhoes|ostent\w*|lucr\w*|faturamento|faturar|vendas|enriquec\w*|fortuna)\b/;
const SALES_PANEL_SCENE = /\b(?:dashboard|utmify|notificac\w* de vendas?|vendas aprovadas|painel de vendas|venda aprovada)\b/;
const SALES_PANEL_COPY = /\b(?:renda extra|faturar|faturamento|faturei|vend\w* (?:online|na internet|pelo celular)|minhas vendas|comiss\w*|afiliad\w*|negocio proprio|empreend\w*|infoproduto|trafego pago|dashboard)\b/;
const PAYMENT_SCENE = /\b(?:pagament\w*|pagando|pagar com|maquininha|cartao|cartoes|boleto)\b/;
// O vilão da copy de saúde é a indústria de remédios, não dinheiro qualquer.
const PHARMA_INDUSTRY_SCENE = /\b(?:industria\w* farmaceutic\w*|industria farmaceutica|farmaceutic\w*|fabrica de remedios|big pharma|medicos? corrupt\w*|empresari\w* .{0,20}farmac\w*)\b/;
const PAYMENT_COPY = /\b(?:pag\w*|compr\w*|cartao|preco|custa|custo|pix|parcel\w*|dinheiro|reais|barato|caro)\b/;
const RELIGIOUS_SCENE = /\b(?:anjo\w*|serafim|deus|jesus|biblia|biblic\w*|igreja|templo|monge\w*|oracao|rezand\w*|judeu|santo|santa|milagre|ritual com)\b/;
const RELIGIOUS_COPY = /\b(?:deus|jesus|biblia|biblic\w*|igreja|templo|monge\w*|oracao|orar|reza\w*|milagre\w*|anjo\w*|espiritual\w*|bencao|abencoad\w*|senhor jesus|fe em)\b/;
const FEMALE_ONLY_SCENE =/\b(?:mulher(?:es)?|idosas?|senhoras?|esposa|namorada|menina|garota|loira|morena|ruiva|gravida|gestante)\b/;
const MALE_OR_COUPLE_SCENE = /\b(?:homem|homens|idoso|idosos|senhor|velho|marido|casal|pessoas|familia|medico|urologista)\b/;
const FEMALE_COPY = /\b(?:mulher(?:es)?|esposa|parceira|namorada|companheira|filha|mae|avo|idosa|senhora|wife|woman|women|partner|girlfriend|kobiet\w*|zona)\b/;
// Insônia, levantar de madrugada e cansaço são o PROBLEMA; nunca podem
// ilustrar "dormir a noite inteira".
const DISTRESS_VISUAL = /\b(?:acord\w* (?:a|de|durante a|no meio da) (?:noite|madrugada)|levant\w* (?:a|de|durante a|no meio da) (?:noite|madrugada)|insoni\w*|nao consegu\w* dormir|dificuldade de dormir|cansad\w*|exaust\w*|debilitad\w*|caind\w*|caiu|queda|tombo|escorreg\w*|tropec\w*|chorand\w*|desesperad\w*|inchad\w*|inflamad\w*|tumor\w*|deformad\w*|apodrec\w*|infeccionad\w*|doente)\b/;
const DISTRESS_AUDIT_BEATS = new Set(['doenca', 'dor', 'cansaco', 'vergonha']);

/** Segundos que a montagem de fato usa: o melhor trecho recomendado pelo
 * StockFrame quando existe (o mesmo recorte de stockFrameInsert), senão o take. */
export function stockFrameUsableSeconds(video: Pick<StockFrameVideo, 'durationSec' | 'recommendedStartSec' | 'recommendedEndSec'>): number {
  const from = Math.max(0, video.recommendedStartSec ?? 0);
  const to = Math.min(video.durationSec || video.recommendedEndSec || 0, video.recommendedEndSec || 0);
  if (Number.isFinite(from) && Number.isFinite(to) && to > from + .25) return to - from;
  return video.durationSec > 0 ? video.durationSec : 0;
}

/** Série visual do take: o mesmo título sem numeração nem letra repetida de
 * digitação. "PROSTATA INFALAMADA 3D(3)" e "(8)", "MANGUEIRA JATO FORTE" e
 * "FORTEE" são o MESMO conceito na tela — o Silas nunca usa dois no mesmo AD. */
export function stockFrameSeriesKey(video: Pick<StockFrameVideo, 'title'>): string {
  const base = normalize(video.title)
    .replace(/(?:\s*\d+)+$/, '')
    .split(/\s+/)
    .map((word) => word.length > 3 ? word.replace(/([a-z])\1+$/, '$1') : word)
    .join(' ')
    .trim();
  return base || normalize(video.title);
}

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
  if (LIPEDEMA_CAMPAIGN.test(normalize(source))) {
    add('lipedema'); add('pernas inflamadas lipedema'); add('celulite');
  }
  return queries;
}

export function inferStockFrameNiche(parts: StockFrameCopyPart[], niches: StockFrameNiche[]): StockFrameNiche | undefined {
  const copy = normalize(parts.map((part) => part.text).join(' '));
  const aliases: [RegExp, RegExp][] = [
    [/\b(?:ed|disfuncao eretil|erecao|impotencia|potencia|desempenho sexual|erectile dysfunction|erection|impotence|potency|disfuncion erectil|ereccion|zaburzenia erekcji|erekcja|erekci|potenci|erektionsstorung)\b/, /\b(?:ed|erecao|disfuncao eretil|erectile|erekcja|ereccion)\b/],
    [/\b(?:prosta|prostata|prostate|prostaty|prostatitis|prostatite)\b/, /\b(?:prostata|prostate)\b/],
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
  // "ED +18 - EM BREVE" também casa com "ed", mas é o pack adulto bloqueado:
  // a campanha de ED usa o pack "ED". Entre vários, vence o nome mais direto.
  const restricted = (niche: StockFrameNiche) => /\b(?:18|em breve)\b/.test(normalize(niche.name));
  for (const [copyPattern, nichePattern] of aliases) {
    if (copyPattern.test(copy)) {
      const match = niches.filter((niche) => nichePattern.test(normalize(niche.name)))
        .sort((a, b) => Number(restricted(a)) - Number(restricted(b)) || normalize(a.name).length - normalize(b.name).length)[0];
      if (match) return match;
      const nested = niches.filter((niche) => niche.subcategories?.some((folder) => nichePattern.test(normalize(folder.name))));
      if (nested.length === 1) return nested[0];
    }
  }
  // The current StockFrame catalog files lipedema clips under Emagrecimento.
  // A dedicated niche or subfolder, if added later, wins in the loop above.
  if (LIPEDEMA_CAMPAIGN.test(copy)) {
    const parent = niches.find((niche) => /\bemagrecimento\b/.test(normalize(niche.name)));
    if (parent) return parent;
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

// Prefixo que é OUTRA palavra: "meu celular" não é "célula" (neurônio 3D numa
// fala de melhora), "contar" não é "conta", "mamãe" não é "mama".
const FALSE_PREFIX_FRIENDS: [string, string][] = [['celula', 'celular'], ['conta', 'contar'], ['mama', 'mamae'], ['pena', 'penal'], ['cara', 'carac']];
function falsePrefixFriends(a: string, b: string): boolean {
  return FALSE_PREFIX_FRIENDS.some(([short, long]) => (a === short && b.startsWith(long)) || (b === short && a.startsWith(long)));
}

function stem(value: string): string {
  const word = normalize(value);
  if (word.length < 5) return word;
  // Um radical de 2–3 letras casa com tudo por prefixo: "caindo" virava "ca"
  // e "IDOSO CAINDO" entrava em "por CAusa dessa receita" (Silas, 07.10).
  const strip = (current: string, suffix: RegExp) => {
    const next = current.replace(suffix, '');
    return next.length >= 4 ? next : current;
  };
  return strip(strip(strip(word, /(amentos|imentos|adoras|adores|acoes|icoes|mente)$/i),
    /(ando|endo|indo|ados|adas|idos|idas|oso|osa|osos|osas)$/i), /(es|s)$/i);
}

function meaningful(value: string): string[] {
  return normalize(value).split(/\s+/).filter((word) => word.length > 2 && !STOP.has(word)).map(stem).filter(Boolean);
}

// Termos já normalizados uma vez: conceptsOf roda milhares de vezes por análise.
let normalizedConcepts: [string, string[]][] | undefined;
function conceptsOf(value: string): string[] {
  const haystack = ` ${normalize(value)} `;
  const found: string[] = [];
  normalizedConcepts ||= Object.entries(CONCEPTS).map(([concept, terms]) => [concept, terms.map(normalize)]);
  for (const [concept, terms] of normalizedConcepts) {
    if (terms.some((normalized) => haystack.includes(` ${normalized} `) || (normalized.length > 7 && haystack.includes(normalized)))) found.push(concept);
  }
  return found;
}

/** Explicit polarity rules, not a language model. Keep an unresolved problem
 * separate from recovery even when both descriptions contain "dor". */
function narrativeDirection(value: string): NonNullable<SmartStockSegment['narrativeDirection']> {
  const text = normalize(value);
  if (/\b(?:frustrad\w*|sofrend\w*|impotencia|disfuncao eretil|dificuldade (?:de|para) erecao|sem erecao|broxa|brox(?:ava|ei|ando|ou)|broch\w*|falhando na cama|falhei na cama|nao (?:consegue|consigo|conseguia) durar)\b/.test(text)) return 'distress';
  if (/\b(?:dor(?:es)? (?:ainda )?(?:continua\w*|persist\w*|pior\w*)|ainda (?:sinto|sente|sentia|sofr\w*)|nao (?:consigo|consegue|conseguia) (?:mais )?(?:andar|caminhar|subir|dormir)|sem alivio|nao (?:houve |senti |sentiu )?melhora)\b/.test(text)) return 'distress';
  if (/\b(?:nao (?:sinto|sente|sentimos|tem|tenho|sente\w*) mais (?:a |as |nenhuma )?(?:dor|dores|desconforto)|sem (?:sentir |nenhuma )?(?:dor|dores|desconforto)|livre d[ae] (?:dor|dores)|dor(?:es)? (?:desaparec\w*|sumiu|passou)|alivio|recuperad\w*|volte?i? a (?:andar|caminhar)|voltou a (?:andar|caminhar)|melhora\w*|feliz|alegria|apaixonad\w*|satisfeit\w*)\b/.test(text)) return 'recovery';
  if (/\b(?:recuper\w*|volt\w*)\b.{0,35}\b(?:energia|vigor|disposicao|potencia)\b/.test(text)) return 'recovery';
  // "Tenho 78 anos, mas minha memória está mais afiada do que quando eu tinha
  // 20" é o RESULTADO, não o sintoma: idoso bem, nunca idoso debilitado.
  if (/\b(?:mais afiad\w*|afiad\w*|lucid\w*|clareza mental|cabeca boa|memoria (?:de elefante|perfeita|boa)|melhor do que (?:nunca|antes|quando)|como (?:quando|se) (?:eu )?(?:tivesse|tinha) \d+)\b/.test(text)) return 'recovery';
  // Melhora urinária/prostática: "voltar a mijar forte", "dormir a noite
  // inteira", "reduzir de tamanho", "desinchar". Sem isso o trecho ficava
  // neutro e aceitava "homem acordando à noite" — o sintoma, não a cura.
  if (/\b(?:volt\w* a (?:mijar|urinar|dormir|funcionar|esvaziar|lembrar|enxergar|ouvir|escutar|correr|trabalhar|sorrir|viver|dancar|brincar|dirigir|subir|transar|namorar)|volt\w* a ter (?:erec\w*|vontade|energia|disposicao|desejo|forca|vida|memoria)|dorm\w* (?:a noite (?:inteira|toda)|bem|tranquil\w*|direto)|reduz\w* (?:de |o )?tamanho|desinch\w*|encolh\w*|jato forte|bexiga vazia|esvazi\w* (?:a bexiga|tudo|completamente))\b/.test(text)) return 'recovery';
  if (/\b(?:durar|dure|dura|aguentar|resistir)\b.{0,45}\b(?:mais|longer|tempo|minutos|horas)\b/.test(text)) return 'recovery';
  if (DISTRESS_VISUAL.test(text)) return 'distress';
  return conceptsOf(text).includes('emocao-negativa') ? 'distress' : 'neutral';
}

const NEGATIVE_VISUAL_WORDS = new Set(['dor', 'dores', 'sofrimento', 'desconforto', 'dificuldade', 'inflamacao', 'medo', 'triste']);
const POSITIVE_VISUAL_WORDS = new Set(['alivio', 'alegria', 'feliz', 'melhora', 'recuperacao']);
const ANATOMY: [string, RegExp][] = [
  ['joelho', /\bjoelhos?\b/], ['ombro', /\bombros?\b/], ['quadril', /\b(?:quadril|quadris)\b/],
  ['cotovelo', /\bcotovelos?\b/], ['tornozelo', /\btornozelos?\b/], ['punho', /\bpunhos?\b/], ['pescoco', /\bpescocos?\b/],
  ['prostata', /\b(?:prosta|prostata|prostatic[ao]s?|glandula prostatica|glandula)\b/], ['pancreas', /\b(?:pancreas|pancreatic[ao]s?)\b/],
  ['intestino', /\b(?:intestinos?|intestinal|intestinais|colon)\b/], ['estomago', /\b(?:estomago|gastric[ao]s?)\b/],
  ['cerebro', /\b(?:cerebro|cerebral|cerebrais)\b/], ['coracao', /\b(?:coracao|cardiac[ao]s?)\b/],
  ['figado', /\b(?:figado|hepatic[ao]s?)\b/], ['rim', /\b(?:rim|rins|renal|renais)\b/],
  ['bexiga', /\bbexigas?\b/], ['utero', /\b(?:utero|uterin[ao]s?)\b/], ['ovario', /\b(?:ovarios?|ovarian[ao]s?)\b/],
  ['pulmao', /\b(?:pulmao|pulmoes|pulmonar|pulmonares)\b/], ['olho', /\b(?:olhos?|ocular|oculares)\b/],
  // Testículo não é próstata: "age na inflamação da glândula" pedia a próstata
  // e recebia ANIMAÇÃO 3D TESTICULOS.
  ['testiculo', /\btesticul\w*\b/],
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
    } else if (to < words.length - 1) {
      // Sem ponto final por perto, corta onde a fala respira — vírgula ou
      // antes de uma conjunção — em vez de "em cerca de | 14 dias".
      const window = words.slice(from + min - 1, Math.min(words.length - 1, from + max));
      const pause = (word: Word) => /,["')\]]*$/.test(word.text) ? 2 : BURST_JOINERS.has(normalize(words[word.index + 1]?.text || '')) ? 1 : 0;
      const breathing = window.filter((word) => pause(word) > 0);
      if (breathing.length) {
        to = breathing.reduce((best, word) => {
          const cost = (item: Word) => Math.abs((item.index - from + 1) - desired) - pause(item) * 2;
          return cost(word) < cost(best) ? word : best;
        }).index;
      }
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

const BURST_JOINERS = new Set(['e', 'mas', 'que', 'porque', 'pra', 'para', 'quando', 'ou', 'se', 'como', 'enquanto', 'depois', 'sem', 'and', 'but', 'when', 'because']);

/** Divisão inteligente = o RITMO do Silas (230 drafts revisados: take mediano
 * de 2,5s, 61% abaixo de 3s, 31% encadeados em rajada). Um trecho escolhido
 * longo vira 2–3 takes seguidos, cortados onde a fala respira, cada um com a
 * sua própria cena: "reduzir de tamanho" ≠ "voltar a mijar forte". Também
 * evita o take curto do catálogo congelar no fim de um bloco de 9s. */
function splitIntoBursts(segment: SmartStockSegment, words: Word[]): SmartStockSegment[] {
  const length = segment.wordTo - segment.wordFrom + 1;
  if (length < 15) return [segment];
  const pieces = length >= 26 ? 3 : 2;
  const minimum = 5;
  const cuts: number[] = [];
  let from = segment.wordFrom;
  for (let piece = 1; piece < pieces; piece++) {
    const ideal = segment.wordFrom + Math.round(length * piece / pieces) - 1;
    let best = -1;
    let bestScore = -Infinity;
    for (let end = Math.max(from + minimum - 1, ideal - 4); end <= Math.min(segment.wordTo - minimum * (pieces - piece), ideal + 4); end++) {
      const word = words[end]?.text || '';
      const next = normalize(words[end + 1]?.text || '');
      const score = (/[.!?;:]["')\]]*$/.test(word) ? 3 : /,["')\]]*$/.test(word) ? 2.5 : BURST_JOINERS.has(next) ? 1.2 : 0)
        - Math.abs(end - ideal) * .35;
      if (score > bestScore) { bestScore = score; best = end; }
    }
    if (best < 0) break;
    cuts.push(best);
    from = best + 1;
  }
  if (!cuts.length) return [segment];
  const bounds = [segment.wordFrom - 1, ...cuts, segment.wordTo];
  return bounds.slice(1).map((to, index) => {
    const pieceFrom = bounds[index] + 1;
    const text = words.slice(pieceFrom, to + 1).map((word) => word.text).join(' ');
    const semantics = semanticFields(text, segment.contextText || text);
    const targetSeconds = Math.round(Math.max(2.2, (to - pieceFrom + 1) / 2.35) * 10) / 10;
    // Pedaço sem imagem própria ("presta atenção nesse vídeo até o final")
    // continua a rajada do assunto do trecho: busca pelo texto inteiro e a
    // atribuição dá a ele OUTRA cena do mesmo tema, nunca a mesma.
    const ownIntent = segmentVisualIntent({ spoken: text, context: text, direction: semantics.narrativeDirection,
      callToAction: CTA_COPY.test(normalize(text)), localIngredients: ingredientsOf(text).length });
    const strongOwnScene = Object.values(ownIntent.weights).some((weight) => (weight || 0) >= .8);
    const weak = !semantics.concepts.length && !anatomyOf(text).length && !ingredientsOf(text).length && !strongOwnScene
      && meaningful(text).filter((token) => token.length > 5).length < 2;
    if (weak) {
      return { ...segment, id: `${segment.id}~${index + 1}`, wordFrom: pieceFrom, wordTo: to, text,
        semanticText: segment.semanticText || segment.text, targetSeconds };
    }
    return { ...segment, ...semantics, id: `${segment.id}~${index + 1}`, wordFrom: pieceFrom, wordTo: to, text,
      visualBeat: visualBeat(text, semantics.narrativeDirection), targetSeconds };
  });
}

/** Planeja os melhores momentos antes de consultar o catalogo. */
export function planSmartStockSegments(parts: StockFrameCopyPart[], options: { coverage: SmartCoverage; pace: SmartPace }): SmartStockSegment[] {
  const planned = planSmartStockMoments(parts, options);
  if (options.pace !== 'adaptive') return planned;
  const wordsByLabel = new Map(parts.map((part) => [part.label, wordsOf(part.text)]));
  return planned.flatMap((segment) => splitIntoBursts(segment, wordsByLabel.get(segment.anchor) || []));
}

function planSmartStockMoments(parts: StockFrameCopyPart[], options: { coverage: SmartCoverage; pace: SmartPace }): SmartStockSegment[] {
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
    // In a long AD, forcing a two- or three-word insert just to hit the
    // arithmetic target creates an editorial flash that says nothing. The
    // caller already accepts a 3% tolerance for 30/60% coverage.
    if (totalWords >= 60 && remaining < 5 && remaining <= Math.ceil(totalWords * .03) && chosen.size) break;
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
  audit?: StockFrameVisualAudit;
  /** Título original do catálogo + título conferido, normalizados (travas). */
  sceneTitle: string;
  /** Situação que a cena mostra (família visual, persona, real × 3D). */
  profile: SceneProfile;
  /** Orgânico × I.A: o rótulo do StockFrame e, sem ele, a ficha conferida. */
  origin: StockFrameOrigin;
  auditVersion: number;
};

const preparedVideos = new WeakMap<StockFrameVideo, PreparedVideo>();
const COLOR_TOKEN = /^(?:azu|vermelh|verde|amarel|rosa|rox|laranj|pret|branc|cinz|marrom|dourad|pratead|bege|lilas|salmao|colorid|estampad|listrad)/;

/** Origem efetiva do take. O StockFrame marca "Orgânico"/"I.A" em source_tags;
 * quando a API não manda, a ficha visual conferida (flag IA) e o pack de
 * avatares de I.A ainda dizem que é gerado. */
export function stockFrameEffectiveOrigin(video: Pick<StockFrameVideo, 'id' | 'origin' | 'nicheName'>): StockFrameOrigin {
  if (video.origin !== 'unknown') return video.origin;
  const audit = stockFrameVisualAudit(video.id);
  if (audit?.flags.includes('IA') || /\bi\.?a\b/i.test(video.nicheName || '')) return 'ai';
  return 'unknown';
}
const AUDITED_BEAT_WORDS: Record<string, string> = {
  broxa: 'falha eretil impotencia disfuncao erecao mole frustracao',
  potencia: 'erecao potencia firme desempenho sexual vigor',
  desejo: 'desejo atracao seducao parceira',
  intimidade: 'casal intimidade relacionamento cama',
  satisfacao: 'satisfacao prazer mulher satisfeita casal feliz',
  vergonha: 'vergonha frustracao decepcao',
  sangue: 'fluxo sanguineo circulacao sangue',
  alivio: 'alivio melhora recuperacao',
  urina: 'urina urinar bexiga jato urinario miccao banheiro noturno',
};

function prepareVideo(video: StockFrameVideo): PreparedVideo {
  const cached = preparedVideos.get(video);
  const auditVersion = stockFrameVisualAuditVersion();
  if (cached && cached.auditVersion === auditVersion) return cached;
  const audit = stockFrameVisualAudit(video.id);
  const auditedBeats = audit?.beats.map((beat) => AUDITED_BEAT_WORDS[beat] || beat.replace(/^ing:/, '')).join(' ') || '';
  // A checked scene description outranks sometimes misleading catalog tags.
  // Unknown IDs retain their existing provider-metadata path unchanged.
  const title = normalize(audit?.title || video.title);
  const tags = normalize(audit ? auditedBeats : video.tags.join(' '));
  const description = normalize(audit ? audit.title : video.description);
  const taxonomy = normalize(`${video.nicheName || ''} ${video.subcategoryName || ''}`);
  const smart = video.smartMetadata;
  const visualText = normalize(audit ? `${audit.title} ${auditedBeats}` : [smart?.summary, smart?.concepts.join(' '), smart?.subjects.join(' '), smart?.actions.join(' '), smart?.objects.join(' '), smart?.bodyParts.join(' '), smart?.positiveKeywords.join(' ')].filter(Boolean).join(' '));
  const visualSearchText = normalize(audit ? `${audit.title} ${auditedBeats}` : stockFrameSearchText(video));
  const contentText = [title, tags, description, visualText].filter(Boolean).join(' ');
  const titleAnatomy = anatomyOf(audit?.title || video.title);
  const descriptionAnatomy = audit ? [] : anatomyOf(video.description);
  // O título (e a ficha conferida) diz o que a cena mostra; a descrição
  // automática do catálogo mistura "alívio ou indicação de dor" e não pode
  // virar "IDOSA COM DOR NA COLUNA" em cena de melhora.
  const titleDirection = narrativeDirection([title, audit ? tags : ''].join(' '));
  let direction = titleDirection !== 'neutral' ? titleDirection : narrativeDirection(contentText);
  // A ficha conferida diz quando a cena mostra doença, dor ou cansaço: isso é
  // o problema da copy, nunca a melhora ("reduzir de tamanho", "dormir bem").
  if (direction === 'neutral' && audit?.beats.some((beat) => DISTRESS_AUDIT_BEATS.has(beat))) direction = 'distress';
  // Desejo, intimidade e satisfação são a PROMESSA, não o problema: nunca
  // ilustram "eu brochava e minha esposa desconfiava".
  else if (direction === 'neutral' && audit?.beats.some((beat) => ['desejo', 'intimidade', 'satisfacao', 'alegria', 'alivio'].includes(beat))
    && !audit.beats.some((beat) => ['broxa', 'vergonha', 'conflito'].includes(beat))) direction = 'recovery';
  let concepts = conceptsOf(contentText);
  if (direction === 'recovery') concepts = [...new Set([...concepts.filter((concept) => concept !== 'emocao-negativa'), 'emocao-positiva'])];
  if (direction === 'distress') concepts = concepts.filter((concept) => concept !== 'emocao-positiva');
  const recipeScene = audit ? audit.beats.includes('receita') || audit.beats.some((beat) => beat.startsWith('ing:'))
    : /\b(?:receita|preparo|mistura|cozinha|ingrediente|caseiro)\b/.test(taxonomy) || ingredientsOf(video.title).length > 0;
  const profile = sceneProfileOf(video, audit, recipeScene);
  // Em neurônio/órgão/animação, "celular" é CÉLULA ("metabolismo celular"),
  // nunca o telefone de "deixei meu celular" — a tag do catálogo engana.
  const cellular = profile.subject === 'orgao' || profile.family === 'abstrato';
  if (cellular) concepts = concepts.filter((concept) => concept !== 'celular');
  // Cor da roupa/fundo na ficha ("sinapse 3D AZUL") não é evidência: casava com
  // o "ingrediente azul" da copy.
  const lexical = (value: string, ficha = false) => meaningful(value)
    .filter((token) => !(cellular && token.startsWith('celular')) && !(ficha && COLOR_TOKEN.test(token)));
  const prepared: PreparedVideo = {
    auditVersion,
    sceneTitle: `${normalize(video.title)} ${title}`,
    profile,
    origin: stockFrameEffectiveOrigin(video),
    title, taxonomy, visualText, visualSearchText, contentText,
    explicitSexualScene: /\bed\s*18\b/.test(taxonomy) || EXPLICIT_STOCK_TITLE.test(normalize(video.title))
      || (audit ? audit.appeal === 3 : EXPLICIT_SEXUAL_SCENE.test(contentText)),
    // A ficha só marca ingrediente de receita; o título ainda revela o
    // alimento em cena ("prepara CAFÉ na cozinha"), e ele também conta.
    ingredients: audit ? [...new Set([...audit.beats.filter((beat) => beat.startsWith('ing:')).map((beat) => beat.slice(4)), ...ingredientsOf(`${video.title} ${audit.title}`)])]
      : ingredientsOf([video.title, video.description, video.tags.join(' '), smart?.summary, smart?.objects.join(' '), smart?.concepts.join(' ')].filter(Boolean).join(' ')),
    shownAnatomy: titleAnatomy.length ? titleAnatomy : descriptionAnatomy.length ? descriptionAnatomy : audit ? [] : anatomyOf(video.tags.join(' ')),
    concepts, direction,
    recipe: recipeScene,
    fields: [
      { tokens: lexical(title, !!audit), weight: audit ? 5.2 : 4.4, visual: true },
      { tokens: lexical(tags), weight: audit ? 4.4 : 3.5, visual: true },
      { tokens: meaningful(taxonomy), weight: 2.8, visual: false },
      { tokens: lexical(description, !!audit), weight: 1.4, visual: true },
      { tokens: lexical(visualText, !!audit), weight: audit ? 4.6 : 3.8, visual: true },
      // Sinônimos que o próprio StockFrame escreve para a cena: ajudam a
      // achar, mas pesam menos que título e ficha conferida.
      ...(video.searchVariations ? [{ tokens: lexical(video.searchVariations), weight: 2.4, visual: true }] : []),
    ],
    audit,
  };
  preparedVideos.set(video, prepared);
  return prepared;
}

/** Qual feeling do Silas vale para a campanha (célula nicho do acervo dele). */
function feelingNicheOf(campaign: string): string | undefined {
  const text = normalize(campaign);
  if (/\bprosta\w*/.test(text)) return 'prostata';
  if (ED_CAMPAIGN.test(text) || /\bbrox\w*|broch\w*/.test(text)) return 'ed';
  if (/\b(?:memoria|alzheimer|demencia|esquec\w*)\b/.test(text)) return 'memoria';
  if (/\b(?:diabet\w*|glicose|glicemia)\b/.test(text)) return 'diabetes';
  if (LIPEDEMA_CAMPAIGN.test(text)) return 'lipedema';
  return undefined;
}

/** Palavras e pares de palavras da fala, no formato das chaves do feeling. */
function feelingKeysOf(spoken: string, campaign: string) {
  const words = normalize(spoken).split(/\s+/).filter(Boolean);
  const keys = new Set<string>();
  for (let index = 0; index < words.length; index++) {
    if (words[index].length >= 4 && !STOP.has(words[index])) keys.add(words[index]);
    if (index + 1 < words.length) keys.add(`${words[index]} ${words[index + 1]}`);
  }
  return { keys: [...keys], niche: feelingNicheOf(campaign) };
}

const feelingSceneTokens = new WeakMap<StockFrameFeelingNiche, Set<string>[]>();
function sceneTokensOf(niche: StockFrameFeelingNiche): Set<string>[] {
  let cached = feelingSceneTokens.get(niche);
  if (!cached) {
    cached = niche.scenes.map((scene) => new Set(meaningful(scene).filter((token) => token.length >= 3)));
    feelingSceneTokens.set(niche, cached);
  }
  return cached;
}

/** O que o Silas pôs na tela em falas com as mesmas palavras, comparado com
 * o que este take mostra (título, tags e ficha visual). Só pontua — as
 * travas de contexto já decidiram se o take pode entrar. */
function feelingMatch(ranking: { feeling: { keys: string[]; niche?: string } }, prepared: PreparedVideo) {
  const sources: [StockFrameFeelingNiche, number][] = [];
  const own = ranking.feeling.niche ? stockFrameFeelingNiche(ranking.feeling.niche) : undefined;
  if (own) sources.push([own, 1]);
  const general = stockFrameFeelingNiche('geral');
  if (general) sources.push([general, .5]);
  if (!sources.length || !ranking.feeling.keys.length) return { total: 0, strong: false, example: '' };
  const videoTokens = new Set(prepared.fields.filter((field) => field.visual).flatMap((field) => field.tokens));
  let total = 0;
  let strong = false;
  let best = 0;
  let example = '';
  for (const [niche, factor] of sources) {
    const scenes = sceneTokensOf(niche);
    for (const key of ranking.feeling.keys) {
      for (const [sceneIndex, weight] of niche.keys[key] || []) {
        const sceneTokens = scenes[sceneIndex];
        if (!sceneTokens?.size) continue;
        const shared = [...sceneTokens].filter((token) => videoTokens.has(token));
        const similarity = shared.length / sceneTokens.size;
        if (similarity < .5 || !shared.some((token) => token.length >= 4)) continue;
        const contribution = weight * similarity * factor;
        total += contribution;
        // Palavra de conteúdo, associação repetida e cena quase igual: é o
        // tipo de take que ele usa ali, vale como evidência de cena.
        if (factor === 1 && !key.includes(' ') && key.length >= 5 && weight >= 1.5 && similarity >= .67) strong = true;
        if (contribution > best) { best = contribution; example = `"${key}" → ${niche.scenes[sceneIndex]}`; }
      }
    }
  }
  return { total, strong, example };
}

/** Prepare a segment once per ranking, not once for every catalog candidate.
 * Deliberately not cached by identity: the editor can change its context or
 * recipe lock between rankings, and those edits must take effect immediately. */
/** Leitura da CAMPANHA (a copy inteira, até 15 mil caracteres), feita uma vez
 * por copy. Antes, scoreVideo normalizava a copy inteira ~7 vezes POR TAKE —
 * dezenas de milhares de vezes numa análise: era isso que travava a tela. */
type CampaignReading = {
  normalized: string; concepts: string[]; anatomy: string[]; ingredients: string[]; herbal: boolean; isHealth: boolean;
  ed: boolean; lipedema: boolean; persona?: ScenePersona;
};
const campaignReadings = new Map<string, CampaignReading>();
function readCampaign(text: string): CampaignReading {
  const cached = campaignReadings.get(text);
  if (cached) return cached;
  const normalized = normalize(text);
  const reading: CampaignReading = {
    normalized,
    concepts: conceptsOf(text),
    anatomy: anatomyOf(text),
    ingredients: ingredientsOf(text),
    herbal: BOTANICAL.test(normalized),
    isHealth: MEDICAL_NICHE.test(normalized) || /\b(?:saude|erecao|potencia|testosterona|glicose|joelho|artrite|olhos|health|erection|potency)\b/.test(normalized),
    ed: ED_CAMPAIGN.test(normalized),
    lipedema: LIPEDEMA_CAMPAIGN.test(normalized),
    persona: campaignPersonaOf(text),
  };
  if (campaignReadings.size > 24) campaignReadings.delete(campaignReadings.keys().next().value!);
  campaignReadings.set(text, reading);
  return reading;
}

type Ranking = ReturnType<typeof buildRanking>;
function buildRanking(segment: SmartStockSegment) {
  const spokenText = segment.semanticText || segment.text;
  const spokenContext = segment.semanticContextText || segment.contextText || spokenText;
  const spokenHere = anatomyOf(spokenText);
  const localIngredients = [...new Set([...ingredientsOf(spokenText), ...ingredientsOf(segment.text)])];
  const contextIngredients = [...new Set([...ingredientsOf(spokenContext), ...ingredientsOf(segment.contextText || '')])];
  const campaign = readCampaign(segment.campaignText || spokenContext);
  const campaignIngredients = segment.campaignIngredients?.length ? segment.campaignIngredients : segment.campaignText ? campaign.ingredients : ingredientsOf('');
  const direction = segment.narrativeDirection || narrativeDirection(spokenContext);
  const spokenNormalized = normalize(spokenText);
  const callToAction = CTA_COPY.test(spokenNormalized);
  return {
    spokenNormalized,
    contextNormalized: normalize(spokenContext),
    campaignNormalized: segment.campaignText ? campaign.normalized : '',
    edCampaign: !!segment.campaignText && campaign.ed,
    lipedemaCampaign: !!segment.campaignText && campaign.lipedema,
    campaignIngredients: campaignIngredients.length ? campaignIngredients : contextIngredients,
    herbalCampaign: !!segment.campaignText && campaign.herbal,
    queryTokens: [...new Set(meaningful(`${spokenText} ${segment.query}`))],
    localTokens: new Set(meaningful(spokenText)),
    contextTokens: new Set(meaningful(spokenContext)),
    contextConcepts: conceptsOf(spokenContext),
    localIngredients,
    contextIngredients,
    localBotanical: BOTANICAL.test(normalize(`${spokenText} ${spokenContext}`)),
    campaignConcepts: campaign.concepts,
    campaignAnatomy: campaign.anatomy,
    campaignIsHealth: campaign.isHealth,
    spokenAnatomy: spokenHere.length ? spokenHere : anatomyOf(spokenContext),
    contextHasIngredients: contextIngredients.length > 0,
    direction,
    beat: segment.visualBeat || visualBeat(spokenText, direction),
    callToAction,
    feeling: feelingKeysOf(spokenText, segment.campaignText || spokenContext),
    /** A situação que a fala pede na tela (direção de cena), lida nas palavras
     * que ficam EMBAIXO do take. Pedaço de rajada herda o texto da frase
     * inteira em semanticText para a busca; a intenção não pode herdar
     * ("amigo neurologista" virava a "família" do jantar da frase). Copy
     * traduzida (semanticContextText presente) usa a tradução. */
    intent: segmentVisualIntent({
      spoken: segment.semanticContextText ? spokenText : segment.text, context: spokenContext, direction,
      callToAction: CTA_COPY.test(normalize(segment.semanticContextText ? spokenText : segment.text)) || callToAction,
      localIngredients: localIngredients.length,
    }),
    persona: campaign.persona,
    // Só as palavras embaixo do take: "Se você tem mais de 50 anos" não chama a
    // "sua mulher" que aparece depois na mesma frase.
    namedPersonas: personasNamedIn(segment.semanticContextText ? spokenText : segment.text),
    hook: /^hook\b/i.test(segment.anchor),
    /** Placar de cada take para ESTA leitura (por modo de fallback). */
    memo: new WeakMap<StockFrameVideo, Partial<Record<'specific' | 'generic' | 'pack', SmartStockCandidate>>>(),
  };
}

function hashText(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) hash = Math.imul(hash ^ value.charCodeAt(index), 0x01000193);
  return (hash >>> 0).toString(36) + value.length.toString(36);
}

/** Uma leitura por trecho, reaproveitada entre as várias passadas da análise
 * (busca, ampliação, alternativas, sugestões): o mesmo take no mesmo trecho
 * não é pontuado duas vezes. A assinatura cobre tudo que o placar lê, e as
 * versões da ficha visual e do feeling invalidam quando eles carregam. */
const rankingCache = new Map<string, Ranking>();
function prepareRanking(segment: SmartStockSegment): Ranking {
  const signature = JSON.stringify([segment.id, segment.anchor, segment.text, segment.semanticText, segment.contextText,
    segment.semanticContextText, segment.query, segment.concepts, segment.contextConcepts, segment.narrativeDirection,
    segment.visualBeat, segment.targetSeconds, segment.campaignNicheId, segment.campaignIngredients,
    segment.campaignText ? hashText(segment.campaignText) : '', stockFrameVisualAuditVersion(), stockFrameFeelingVersion()]);
  const cached = rankingCache.get(signature);
  if (cached) return cached;
  const ranking = buildRanking(segment);
  if (rankingCache.size > 400) rankingCache.delete(rankingCache.keys().next().value!);
  rankingCache.set(signature, ranking);
  return ranking;
}

function memoScore(segment: SmartStockSegment, video: StockFrameVideo, ranking: Ranking, fallback: false | 'generic' | 'pack'): SmartStockCandidate {
  const mode = fallback || 'specific';
  let entry = ranking.memo.get(video);
  if (!entry) { entry = {}; ranking.memo.set(video, entry); }
  return entry[mode] ||= scoreVideo(segment, video, ranking, fallback);
}

function scoreVideo(segment: SmartStockSegment, video: StockFrameVideo, ranking: Ranking, fallback: false | 'generic' | 'pack' = false): SmartStockCandidate {
  const allowGenericFallback = fallback !== false;
  if (!video.available || video.conflictingConcepts.length) return { video, score: -100, reasons: ['indisponível ou conflito informado pelo StockFrame'] };
  const prepared = prepareVideo(video);
  if (NON_BROLL_PACK.test(prepared.taxonomy)) {
    return { video, score: -100, reasons: ['pack de avatar falante ou efeito de edição não é b-roll'] };
  }
  const { title, visualSearchText, ingredients: videoIngredients, shownAnatomy, recipe } = prepared;
  // The visual audit can use a shorter scene label. Keep the provider's
  // original title for safety checks: "mijando sangue" must not disappear.
  const sceneTitle = prepared.sceneTitle;
  const audit = prepared.audit;
  const smart = video.smartMetadata;
  const { campaignIngredients, herbalCampaign, queryTokens, spokenAnatomy, direction, beat } = ranking;
  const videoVisualText = visualSearchText;
  const lipedemaCampaign = ranking.lipedemaCampaign;
  const lipedemaVisual = lipedemaCampaign && LIPEDEMA_VISUAL.test(sceneTitle);
  if (allowGenericFallback && ranking.callToAction && CTA_PHONE.test(prepared.title)
      && (!CTA_NEUTRAL_ACTION.test(prepared.title) || CTA_CONFLICT_SCENE.test(prepared.title))) {
    return { video, score: -100, reasons: ['celular com ação ou emoção incompatível com a chamada para assistir'] };
  }
  if (prepared.explicitSexualScene) {
    return { video, score: -100, reasons: ['cena sexual explícita não entra na seleção automática de anúncios'] };
  }
  if (audit?.flags.includes('CRIANCA') && ranking.edCampaign) {
    return { video, score: -100, reasons: ['criança não entra em criativo de desempenho sexual'] };
  }
  if (audit ? audit.appeal >= 2 : SUGGESTIVE_SCENE.test(prepared.title)) {
    const edContext = ranking.edCampaign;
    const intimateMoment = ED_INTIMATE_MOMENT.test(ranking.spokenNormalized);
    const unsuitable = /\b(?:pelad\w*|nudez|nude|naked|genitais|lingerie|calcinha|apos relac\w*|depois da relac\w*|no ato|tamanho ideal|medindo o tamanho)\b/.test(prepared.title);
    if (!edContext || !intimateMoment || ranking.callToAction || ranking.localIngredients.length || unsuitable || recipe) {
      return { video, score: -100, reasons: ['cena sugestiva não combina com este momento da fala'] };
    }
  }
  if (/\b(?:amput\w*|sem perna|cadeira de rodas|muleta\w*)\b/.test(sceneTitle)
      && !/\b(?:amput\w*|perna\w*|cadeira de rodas|muleta\w*|deficien\w*)\b/.test(ranking.contextNormalized)) {
    return { video, score: -100, reasons: ['amputação ou cadeira de rodas não é narrada'] };
  }
  if (INVASIVE_PROCEDURE_SCENE.test(prepared.contentText) && !INVASIVE_PROCEDURE_COPY.test(ranking.contextNormalized)) {
    return { video, score: -100, reasons: ['a fala não descreve um procedimento invasivo'] };
  }
  if (/\bmicroplastic\w*\b/.test(prepared.title)
      && !/\bmicroplastic\w*\b/.test(ranking.contextNormalized)) {
    return { video, score: -100, reasons: ['microplásticos não são o mecanismo narrado'] };
  }
  if (/\b(?:mulher(?:es)?|esposa|parceira|casal)\b/.test(ranking.spokenNormalized)
      && /\b(?:dinheiro|grana|pagamento|pagar)\b/.test(ranking.spokenNormalized)
      && /\b(?:medico|industria|farmaceutic\w*|laboratorio de remedios)\b/.test(prepared.title)
      && !/\b(?:mulher(?:es)?|esposa|parceira|casal)\b/.test(prepared.title)) {
    return { video, score: -100, reasons: ['dinheiro da indústria farmacêutica não representa a fala sobre relacionamento'] };
  }
  if (CONFLICT_SCENE.test(prepared.title) && !CONFLICT_COPY.test(ranking.spokenNormalized)) {
    return { video, score: -100, reasons: ['cena de conflito não descrita na fala'] };
  }
  if (BETRAYAL_SCENE.test(sceneTitle) && !BETRAYAL_COPY.test(ranking.spokenNormalized)) {
    return { video, score: -100, reasons: ['traição não representa a situação narrada'] };
  }
  const spokenWithContext = `${ranking.spokenNormalized} ${ranking.contextNormalized}`;
  if (RELIGIOUS_SCENE.test(sceneTitle) && !RELIGIOUS_COPY.test(spokenWithContext)) {
    return { video, score: -100, reasons: ['cena religiosa sem fé ou religião na fala'] };
  }
  if (LUXURY_SCENE.test(sceneTitle) && !LUXURY_COPY.test(spokenWithContext)) {
    return { video, score: -100, reasons: ['luxo, ostentação ou lucro não é o que a fala diz'] };
  }
  // "Os lucros exorbitantes da venda de remédios" é a indústria, não um
  // painel de vendas de infoproduto (DASHBOARD UTMIFY, notificação de venda).
  if (SALES_PANEL_SCENE.test(sceneTitle) && !SALES_PANEL_COPY.test(spokenWithContext)) {
    return { video, score: -100, reasons: ['painel de vendas só cabe em fala sobre vender/faturar'] };
  }
  // Pagar no celular não é "clique no botão que está na sua tela".
  if (PAYMENT_SCENE.test(sceneTitle) && !PAYMENT_COPY.test(spokenWithContext)) {
    return { video, score: -100, reasons: ['pagamento não é a ação narrada'] };
  }
  if (WEALTH_PACK.test(prepared.taxonomy) && !(segment.campaignNicheId && video.nicheId === segment.campaignNicheId)
      && !WEALTH_COPY.test(ranking.spokenNormalized)) {
    return { video, score: -100, reasons: ['pack de renda/prosperidade fora de uma fala sobre dinheiro'] };
  }
  const clinicalScene = audit
    ? audit.beats.some((beat) => ['anatomia', 'sangue', 'medico', 'celula', 'prova'].includes(beat))
    : /\b(?:anatomia|sangue|medic\w*|consult\w*|celula|fluxo|doutor|urologista)\b/.test(sceneTitle);
  const romanticScene = !clinicalScene && (ROMANCE_SCENE.test(sceneTitle) || RELATIONSHIP_PACK.test(prepared.taxonomy)
    || !!audit?.beats.some((beat) => ['romance', 'desejo', 'intimidade', 'satisfacao'].includes(beat)));
  if (romanticScene && !ranking.edCampaign
      && !(segment.campaignNicheId && video.nicheId === segment.campaignNicheId)
      && !PARTNER_OR_INTIMACY_COPY.test(`${ranking.spokenNormalized} ${ranking.contextNormalized}`)) {
    return { video, score: -100, reasons: ['cena de casal ou romance sem parceira, desejo ou relacionamento na fala'] };
  }
  if ((ERECTILE_SCENE.test(sceneTitle) || audit?.beats.includes('broxa'))
      && (!ranking.edCampaign
        || (!ERECTILE_MOMENT.test(ranking.spokenNormalized)
          && !(INVASIVE_PROCEDURE_SCENE.test(prepared.title) && INVASIVE_PROCEDURE_COPY.test(ranking.spokenNormalized))))) {
    return { video, score: -100, reasons: ['metáfora de disfunção erétil fora do momento ED da copy'] };
  }
  const namedFigure = sceneTitle.match(NAMED_PUBLIC_FIGURE)?.[0];
  if (namedFigure && !ranking.spokenNormalized.includes(namedFigure)) {
    return { video, score: -100, reasons: ['pessoa famosa não é citada neste trecho'] };
  }
  if (/\b(?:estabulo|cavalo|fazenda)\b/.test(sceneTitle)
      && !/\b(?:estabulo|cavalo|fazenda|rancho|haras)\b/.test(ranking.spokenNormalized)) {
    return { video, score: -100, reasons: ['ambiente rural específico não é narrado'] };
  }
  if (/\b(?:nao querendo mulher|rejeitando mulher|recusando mulher)\b/.test(sceneTitle)
      && !/\b(?:mulher|esposa|namorad\w*|parceir\w*|relacionamento|desejo|rejeic\w*|recus\w*)\b/.test(ranking.spokenNormalized)) {
    return { video, score: -100, reasons: ['rejeição da parceira não é a ação narrada'] };
  }
  if (/\b(?:mostrando pacote|pacote de produto|embalagem)\b/.test(sceneTitle)
      && !/\b(?:produto|pacote|embalagem|vick|comprimido|frasco|suplemento|receita|ingrediente)\b/.test(ranking.spokenNormalized)) {
    return { video, score: -100, reasons: ['embalagem não representa esta fala'] };
  }
  const bleedingScene = URINARY_BLEEDING_SCENE.test(sceneTitle) || /\bmangueira\b.{0,30}\bsangu\w*/.test(sceneTitle)
    || (!!audit?.beats.includes('urina') && audit.beats.includes('sangue') && !audit.beats.includes('anatomia'));
  if (bleedingScene && !URINARY_BLEEDING_SCENE.test(ranking.spokenNormalized) && !/\bsangu\w*\b/.test(ranking.spokenNormalized)) {
    return { video, score: -100, reasons: ['sangue na urina não é um sintoma narrado'] };
  }
  if (RECTAL_EXAM_SCENE.test(sceneTitle)
      && !/\b(?:exame de toque|toque retal|exame retal)\b/.test(ranking.spokenNormalized)) {
    return { video, score: -100, reasons: ['exame íntimo não é o procedimento narrado'] };
  }
  if (PROSTATE_EXAM_SCENE.test(sceneTitle)
      && !/\b(?:exame\w*|teste\w*|diagnostico|avaliacao clinica)\b/.test(ranking.spokenNormalized)) {
    return { video, score: -100, reasons: ['exame de próstata não representa este trecho'] };
  }
  if (ERECTILE_ANATOMY_SCENE.test(sceneTitle)
      && !ranking.edCampaign
      && !ERECTILE_MOMENT.test(ranking.spokenNormalized)) {
    return { video, score: -100, reasons: ['ereção ou ejaculação não representa este momento da copy'] };
  }
  if (lipedemaCampaign && /\b(?:homem|velho|idoso)\b/.test(sceneTitle)
      && !/\b(?:homem|senhor|marido|idoso|pai)\b/.test(ranking.spokenNormalized)) {
    return { video, score: -100, reasons: ['personagem masculino não representa a paciente de lipedema'] };
  }
  if (MEDICATION_SCENE.test(sceneTitle) && !MEDICATION_COPY.test(ranking.spokenNormalized)) {
    return { video, score: -100, reasons: ['medicação não representa esta fala'] };
  }
  if (/\bvideo chamativo\b/.test(sceneTitle) && !ranking.callToAction
      && !/\b(?:video|assistir|ver na tela)\b/.test(ranking.spokenNormalized)) {
    return { video, score: -100, reasons: ['take de vídeo genérico não ilustra a explicação clínica'] };
  }
  if (URINARY_ACTION_SCENE.test(sceneTitle)
      && !/\b(?:urin\w*|mij\w*|bexiga|banheiro|jato|prosta\w*|fralda\w*|sonda|incontinen\w*|xixi)\b/.test(ranking.spokenNormalized)) {
    return { video, score: -100, reasons: ['ação urinária não representa este trecho'] };
  }
  if (/\b(?:radiografia|raio x|raiox)\b/.test(sceneTitle)
      && !/\b(?:radiografia|raio x|raiox|exame|diagnostico|imagem medica)\b/.test(ranking.spokenNormalized)) {
    return { video, score: -100, reasons: ['radiografia não foi narrada'] };
  }
  if (/\b(?:dormind\w*|dormir|dorme|sono|insonia|sleep\w*|adormec\w*)\b/.test(sceneTitle)
      && !/\b(?:dorm\w*|sono|insomnia|insonia|sleep\w*|adormec\w*|noite|madrugada|cama|cansad\w*|cansaco)\b/.test(ranking.spokenNormalized)) {
    return { video, score: -100, reasons: ['sono não é a ação narrada'] };
  }
  if (/\b(?:mangueira|hose)\b/.test(sceneTitle)
      && !/\b(?:mangueira|jato|fluxo|urin\w*|mij\w*|pressao)\b/.test(ranking.spokenNormalized)) {
    return { video, score: -100, reasons: ['metáfora de jato não representa a fala'] };
  }
  if (CTA_PHONE.test(sceneTitle)
      && !ranking.callToAction && !SOCIAL_PROOF_COPY.test(ranking.spokenNormalized)
      && !/\b(?:celular|telefone|tela|mensagem|internet|aplicativo|app)\b/.test(ranking.spokenNormalized)) {
    return { video, score: -100, reasons: ['celular fora de um momento digital da copy'] };
  }
  if (!allowGenericFallback && ranking.callToAction
      && !CTA_SCENE.test(sceneTitle)
      && !(LOCAL_RECIPE_REFERENCE.test(ranking.spokenNormalized) && recipe)) {
    return { video, score: -100, reasons: ['chamada para assistir pede ação visual digital antes de cena genérica'] };
  }
  // Generic human imagery must still depict the action being spoken. These
  // two catalog scenes used to displace specialist/benefit shots on a Czech
  // ED ad solely because their tags mentioned the same niche.
  if (/\b(?:vestind\w*|tirando roupa|getting dressed)\b/.test(prepared.title)
      && !/\b(?:vestind\w*|roupa|dress\w*|clothes)\b/.test(ranking.spokenNormalized)) {
    return { video, score: -100, reasons: ['troca de roupa não é a ação narrada'] };
  }
  // "Levanta de madrugada pra urinar" É a cena de acordar à noite — a que o
  // Silas mais usa ali ("IDOSO LEVANTA DE MADRUGADA PRA MIJAR").
  if (/\b(?:acord\w*|wake\w*)\b/.test(prepared.title)
      && !/\b(?:acord\w*|wake\w*|sono|dorm\w*|sleep\w*|madrugada|noite|noturn\w*|nocturia|insoni\w*)\b/.test(ranking.spokenNormalized)) {
    return { video, score: -100, reasons: ['acordar alguém não é a ação narrada'] };
  }
  if (/\b(?:dormind\w*|sleep\w*)\b/.test(prepared.title)
      && !/\b(?:dorm\w*|sono|sleep\w*|adormec\w*)\b/.test(ranking.spokenNormalized)) {
    return { video, score: -100, reasons: ['casal dormindo não representa desempenho ou ação na cama'] };
  }
  if (/\b(?:treinand\w*|academia|workout|exercic\w*)\b/.test(prepared.title)
      && !/\b(?:trein\w*|academia|workout|exercic\w*|fitness|muscul\w*)\b/.test(ranking.spokenNormalized)) {
    return { video, score: -100, reasons: ['treino não é a ação narrada'] };
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
  const romanticOnly = audit
    ? audit.beats.some((beat) => ['desejo', 'intimidade', 'satisfacao', 'romance'].includes(beat))
      && !audit.beats.some((beat) => ['anatomia', 'sangue', 'medico', 'celula', 'prova'].includes(beat))
    : /\b(?:casal|mulher sensual|mulher provocante|beijo|romance|romantico)\b/.test(prepared.title)
      && !/\b(?:anatomia|sangue|medico|celula|fluxo)\b/.test(prepared.title);
  if (MECHANISM_DETAIL_COPY.test(ranking.spokenNormalized) && romanticOnly) {
    return { video, score: -100, reasons: ['cena de romance ou desejo não demonstra o mecanismo técnico narrado'] };
  }
  if (SOCIAL_PROOF_COPY.test(ranking.spokenNormalized) && !SOCIAL_PROOF_SCENE.test(`${prepared.title} ${prepared.visualText}`)) {
    return { video, score: -100, reasons: ['fala de repercussão online pede vídeo, tela, comentários ou apresentador visível'] };
  }
  const namedExpertShowing = /\b(?:dr|doutor|medico|doctor|physician|urologist|especialista|expert)\b/.test(ranking.spokenNormalized)
    && /\b(?:video|filme|recording|gravacao)\b/.test(ranking.spokenNormalized)
    && /\b(?:mostr\w*|ensin\w*|explic\w*|show\w*|teach\w*|explain\w*)\b/.test(ranking.spokenNormalized);
  const expertOrDemonstrationVisible = audit
    ? audit.beats.some((beat) => ['medico', 'avatar', 'receita'].includes(beat))
    : /\b(?:medico|doutor|doctor|physician|urologista|especialista|apresentador|prepar\w*|mistur\w*|receita)\b/.test(prepared.visualText);
  if (namedExpertShowing && !expertOrDemonstrationVisible) {
    return { video, score: -100, reasons: ['a fala apresenta um especialista demonstrando, mas a cena não mostra especialista nem preparo'] };
  }
  if (audit?.beats.includes('broxa') && (ranking.beat === 'demonstration' || ranking.localIngredients.length
      || (LOCAL_RECIPE_REFERENCE.test(ranking.spokenNormalized) && ranking.beat !== 'problem'))) {
    return { video, score: -100, reasons: ['metáfora de disfunção não representa preparo de ingrediente'] };
  }
  const localRecipeReference = LOCAL_RECIPE_REFERENCE.test(ranking.spokenNormalized);
  const namedRecipeIngredients = ranking.localIngredients.length ? ranking.localIngredients
    : localRecipeReference ? campaignIngredients : [];
  if (namedRecipeIngredients.length && /\b(?:cozinh\w*|receita|prepar\w*|mistur\w*|mix\w*)\b/.test(prepared.title)
      && !videoIngredients.some(ingredient => namedRecipeIngredients.includes(ingredient))) {
    return { video, score: -100, reasons: ['cena de preparo não mostra o ingrediente nomeado neste trecho'] };
  }
  const ingredientEvidence = videoIngredients.some((ingredient) => ranking.localIngredients.includes(ingredient)
    || (localRecipeReference && ranking.contextIngredients.includes(ingredient))
    || (localRecipeReference && beat === 'demonstration' && campaignIngredients.includes(ingredient)));
  const botanicalEvidence = BOTANICAL.test(ranking.spokenNormalized) && BOTANICAL.test(prepared.contentText);
  const compatibleMechanism = (beat === 'demonstration' || ranking.contextHasIngredients)
    && (ingredientEvidence || botanicalEvidence);
  // Pack NEUTRO (Mecanismos Gerais, VSL…) atravessa nicho quando o próprio
  // título da cena diz o que a fala diz: "indústria farmacêutica" é a cena
  // "INDÚSTRIA FARMACÊUTICA CONTANDO DINHEIRO", mesmo sem conceito mapeado.
  const sharedTitleTokens = prepared.fields[0].tokens.filter((token) => ranking.localTokens.has(token) && !GENERIC_PERSON_TOKENS.has(token));
  const strongTitleMatch = sharedTitleTokens.length >= 2 || sharedTitleTokens.some((token) => token.length >= 7);
  const feeling = feelingMatch(ranking, prepared);
  // Mecanismo e cena neutra atravessam nicho (lei 6 do Silas); anatomia e
  // sintoma de outro nicho de saúde, nunca — nem pelo feeling.
  const compatibleGeneralScene = beat !== 'demonstration' && !MEDICAL_NICHE.test(prepared.taxonomy)
    && (segment.concepts.some((concept) => prepared.concepts.includes(concept)) || strongTitleMatch || feeling.strong);
  const neutralDigitalAction = allowGenericFallback && (ranking.callToAction || SOCIAL_PROOF_COPY.test(ranking.spokenNormalized))
    && !MEDICAL_NICHE.test(prepared.taxonomy) && CTA_SCENE.test(prepared.title)
    && CTA_PHONE.test(prepared.title) && CTA_NEUTRAL_ACTION.test(prepared.title)
    && !CTA_CONFLICT_SCENE.test(prepared.title);
  const neutralCrossPackFallback = allowGenericFallback && ranking.campaignIsHealth
    && !MEDICAL_NICHE.test(prepared.taxonomy)
    && /\b(?:casal|homem|mulher|pessoa|idos[ao]|familia)\b/.test(prepared.contentText)
    && /\b(?:convers\w*|sentad\w*|olhando|caminh\w*|rotina|abrac\w*|consulta|consultorio)\b/.test(prepared.contentText);
  const recoveryCrossPackFallback = allowGenericFallback && ranking.campaignIsHealth && direction === 'recovery'
    && !MEDICAL_NICHE.test(prepared.taxonomy)
    && /\b(?:homem|casal|pessoa|idos[ao])\b/.test(prepared.title)
    && /\b(?:sorrind\w*|feliz|caminh\w*|ativo|abrac\w*)\b/.test(prepared.title)
    && prepared.direction !== 'distress';
  // Direção de cena: a SITUAÇÃO que a fala pede (sintoma → gente com o
  // problema, autoridade → médico, vilão → dinheiro da indústria…). Uma cena
  // neutra de outro pack (VSL, Mecanismos Gerais) que mostra exatamente essa
  // situação atravessa nicho; gente de outro pack só com a persona certa.
  const profile = prepared.profile;
  const sameNiche = !!segment.campaignNicheId && video.nicheId === segment.campaignNicheId;
  const situation = sceneIntentFit(ranking.intent, profile, ranking.persona, sameNiche, ranking.namedPersonas);
  const crossPackSituation = situation.weight >= .8 && !MEDICAL_NICHE.test(prepared.taxonomy)
    && (NEUTRAL_SCENE_FAMILIES.has(profile.family) || (isPeopleFamily(profile.family) && situation.personaFit >= .85));
  if (segment.campaignNicheId && video.nicheId && video.nicheId !== segment.campaignNicheId
      && !(compatibleMechanism && !MEDICAL_NICHE.test(prepared.taxonomy)) && !compatibleGeneralScene && !neutralCrossPackFallback && !recoveryCrossPackFallback && !neutralDigitalAction
      && !crossPackSituation) {
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
      // Prefixo curto só vale como flexão ("dor" × "dores"), nunca como acaso.
      const partial = token.length >= 5 && tokens.some((candidate) => (candidate.length >= 4 || (candidate.length === 3 && token.length - candidate.length <= 2))
        && (candidate.startsWith(token) || token.startsWith(candidate)) && !falsePrefixFriends(token, candidate));
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
  // Emoção (alívio, sofrimento) é expressão de GENTE: uma animação de sangue
  // "normal" não é a cena de "livre dos riscos do Alzheimer".
  const emotionless = profile.subject !== 'pessoa';
  const sharedConcepts = segment.concepts.filter((concept) => videoConcepts.includes(concept) && !(emotionless && concept.startsWith('emocao-')));
  // A split sentence can inherit its own subject, but the campaign's niche,
  // aspect ratio and remote numeric score cannot stand in for scene evidence.
  const contextualConcepts = ranking.contextConcepts.filter((concept) => videoConcepts.includes(concept) && !(emotionless && concept.startsWith('emocao-')));
  const contextLexicalEvidence = prepared.fields.some((field) => field.visual && field.tokens.some((token) => token.length >= 4 && ranking.contextTokens.has(token)));
  // A cena mostra a situação que a fala pede ("perda de memória avançada" →
  // idoso esquecido do pack de Memória), mesmo sem palavra em comum: é
  // evidência de cena — é assim que o editor escolhe, pela situação.
  const situationEvidence = situation.weight >= .8 && situation.personaOk
    && profile.family !== 'outro' && profile.family !== 'abstrato' && (sameNiche || crossPackSituation);
  if (!lexicalEvidence && !sharedConcepts.length && !ingredientEvidence && !botanicalEvidence && !feeling.strong && !situationEvidence) {
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
    const themeLink = lipedemaVisual || videoConcepts.some((concept) => ranking.campaignConcepts.includes(concept))
      || (healthcare && ranking.campaignIsHealth)
      || educationalAnatomy
      || thematicEducationalHealth
      || neutralDigitalAction
      || recoveryCrossPackFallback
      || (neutralHuman && /\bcasal\b/.test(prepared.contentText) && ranking.campaignConcepts.includes('saude-homem'));
    const anatomyConflict = shownAnatomy.length > 0
      && !shownAnatomy.some((part) => ranking.campaignAnatomy.includes(part));
    // Pack do nicho da campanha (ex.: Prostata) como ALTERNATIVA revisável
    // quando a fala não tem cena específica. Todas as travas acima valem.
    const packScene = fallback === 'pack' && !!segment.campaignNicheId && video.nicheId === segment.campaignNicheId
      && (videoDirection === 'neutral' || videoDirection === direction);
    if (packScene && !recipe && !anatomyConflict) {
      score += 2 + (shownAnatomy.length ? 2 : 0) + (healthcare ? 1 : 0);
      reasons.push(`alternativa do pack ${video.nicheName || 'da campanha'}; sem correspondência específica com a fala`);
    } else if (!allowGenericFallback || recipe || (videoDirection !== 'neutral' && !(recoveryCrossPackFallback && videoDirection === 'recovery')) || anatomyConflict
        || !(lipedemaVisual || neutralHuman || healthcare || educationalAnatomy || thematicEducationalHealth || recoveryCrossPackFallback || neutralDigitalAction) || !themeLink) {
      return { video, score: -100, reasons: ['sem evidência visual do trecho ou da frase de contexto'] };
    } else {
      score += 3;
      reasons.push('alternativa genérica com vínculo ao tema da campanha; sem correspondência específica com a fala');
    }
  }
  if (feeling.total > 0) {
    // Retorno decrescente: o feeling desempata e puxa o take do jeito dele,
    // sem transformar uma associação frequente em vale-tudo.
    const bonus = Math.min(8, 3 * Math.log2(1 + feeling.total));
    score += bonus;
    if (bonus >= 2) reasons.push(`feeling Silas: ${feeling.example}`);
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
  if (lipedemaVisual) { score += 16; reasons.push('condição da campanha visível no take'); }
  if (situation.weight > 0) {
    score += 11 * situation.weight;
    if (situation.weight >= .6) reasons.push(`situação: ${SCENE_FAMILY_LABEL[profile.family]} (${ranking.intent.label})`);
  }
  // Cena neutra de outro pack que mostra exatamente a situação (médico da VSL
  // na fala do neurologista) compete de igual com o pack da campanha.
  if (crossPackSituation && !sameNiche) score += 4;
  // "Lucros exorbitantes com a venda de medicamentos": a indústria de remédio
  // contando dinheiro, antes de uma pilha de notas de renda extra.
  if ((ranking.intent.weights.dinheiro || 0) >= .8 && ranking.campaignIsHealth && PHARMA_INDUSTRY_SCENE.test(sceneTitle)) {
    score += 5;
    reasons.push('vilão da copy: indústria de remédios');
  }
  // O público se vê na tela: idoso em AD de idoso; jovem num AD de memória
  // de 78 anos destoa, mesmo segurando o celular do CTA.
  if (profile.persona && ranking.persona) {
    const matched = personaMatch(ranking.persona, profile.persona);
    const fit = ranking.namedPersonas.has(profile.persona) ? Math.max(matched, .85) : matched;
    // Bônus só para a cena que a fala pede; o desencontro pesa sempre.
    if (fit === 1 && situation.weight >= .6) { score += 3; reasons.push('persona da campanha'); }
    else if (fit <= .35) { score -= 4; reasons.push('fora da persona da campanha'); }
  }
  // Sintoma, história, família e melhora pedem GENTE. Cérebro/órgão ali só
  // quando a fala nomeia o órgão — senão o AD vira uma aula de anatomia.
  const spokenOrgan = anatomyOf(ranking.spokenNormalized);
  if (ranking.intent.humanFirst && profile.subject === 'orgao' && !spokenOrgan.length) {
    score -= 8;
    reasons.push('órgão/animação onde a fala pede gente');
  }
  // Clima oposto: "você não perde apenas nomes e lembranças" nunca é idosos
  // dançando felizes; "voltei a lembrar" nunca é idoso acamado.
  if ((ranking.intent.mood === 'distress' && prepared.direction === 'recovery')
    || (ranking.intent.mood === 'recovery' && prepared.direction === 'distress')) {
    score -= 10;
    reasons.push('clima oposto ao da fala');
  }
  // O gancho precisa prender: rosto real com emoção na tela.
  if (ranking.hook && profile.live && (isPeopleFamily(profile.family) || profile.family === 'medico')) score += 2.5;
  // Fala que nomeia o órgão pede a cena que MOSTRA o órgão (o beat de ciência
  // do Silas), antes de uma metáfora genérica do mesmo assunto.
  if (spokenOrgan.some((part) => shownAnatomy.includes(part))) {
    score += 6;
    reasons.push('mostra o órgão citado na fala');
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
  if (audit) {
    if (audit.flags.includes('Q')) score -= 14;
    if (audit.flags.includes('T')) score -= 6;
    if (audit.flags.includes('E')) score -= 3;
    // A flag IA da ficha já vale como origem I.A (stockFrameEffectiveOrigin).
    if (audit.appeal === 2 && ranking.edCampaign
      && ED_INTIMATE_MOMENT.test(ranking.spokenNormalized)) score += 5;
    reasons.push('cena conferida visualmente');
  }
  // Outra pessoa falando para a câmera por cima da voz do avatar confunde
  // quem está falando. Só cabe quando a fala apresenta alguém, um vídeo ou
  // repercussão online.
  const talkingHead = audit ? audit.beats.includes('avatar')
    : /\b(?:fala(?:ndo)? (?:para|pra|diretamente para) (?:a )?camera|talking to camera)\b/.test(prepared.visualText);
  if (talkingHead && !ranking.callToAction && !SOCIAL_PROOF_COPY.test(ranking.spokenNormalized)
      && !/\b(?:dr|doutor|medico|especialista|urologista|apresent\w*|entrevist\w*|depoimento|video)\b/.test(ranking.spokenNormalized)) {
    score -= 9;
    reasons.push('pessoa falando para a câmera por cima do avatar');
  }
  // Saúde masculina: a cena é do homem (Silas limita mulher a quando a fala
  // pede). Penalidade, não veto — o editor ainda vê como alternativa.
  if (ranking.campaignConcepts.includes('saude-homem') && FEMALE_ONLY_SCENE.test(sceneTitle)
      && !MALE_OR_COUPLE_SCENE.test(sceneTitle) && !FEMALE_COPY.test(`${ranking.spokenNormalized} ${ranking.contextNormalized}`)) {
    score -= 8;
    reasons.push('cena só feminina num anúncio de saúde masculina');
  }
  if (allowGenericFallback) {
    // A campanha ser de saúde não transforma um CTA ou frase de ligação em
    // explicação anatômica. É uma preferência editorial, não um veto: quando
    // o catálogo só oferece esse take seguro, a cobertura total continua
    // possível e o editor pode revisá-lo antes de consumir a cota.
    const educationalScene = /\b(?:anatomia|animacao|3d|sistema reprodutor|erecao|orgao|fluxo sanguineo)\b/.test(prepared.title);
    if (ranking.callToAction && CTA_SCENE.test(prepared.title)) {
      score += 14;
      reasons.push('ação visual acompanha a chamada para assistir');
    } else if (educationalScene && !ranking.localIngredients.length
      && !ranking.spokenAnatomy.length && !segment.concepts.some((concept) => concept.startsWith('saude-') || concept === 'anatomia')) {
      score -= ranking.callToAction ? 9 : 5;
      reasons.push('anatomia reduzida em fala sem assunto clínico local');
    }
  }
  // A smiling person holding a phone is useful for a click/watch CTA, not as
  // the primary visual proof of restored energy, pain relief or performance.
  // Keep it as a low-priority last resort if no better safe take exists.
  if (!ranking.callToAction && CTA_PHONE.test(prepared.title)
      && !/\b(?:celular|telefone|smartphone|phone|tela|screen)\b/.test(ranking.spokenNormalized)) {
    score -= 7;
    reasons.push('celular sem ação digital nesta fala');
  }
  if (beat === 'problem' && /\b(?:dor|dificuldade|frustr\w*|problema|impotencia|disfuncao|triste|desconforto|doenca|inflamad\w*|inchad\w*|urgencia|fraco|insoni\w*|cansad\w*|cansaco)\b/.test(videoVisualText)) score += 7;
  if (beat === 'relief' && /\b(?:alivio|melhora|feliz|sorris\w*|confian\w*|recuper\w*|casal)\b/.test(videoVisualText)) score += 8;
  if (beat === 'proof' && /\b(?:depoimento|resultado|antes e depois|medico|doutor|explic\w*)\b/.test(videoVisualText)) score += 5;
  if (beat === 'demonstration' && /\b(?:prepar\w*|mistura|ingrediente|receita|aplic\w*|folha|erva|planta)\b/.test(videoVisualText)) score += 6;
  if (recipe && beat !== 'demonstration' && !ranking.contextHasIngredients && segment.campaignNicheId
      && !(herbalCampaign && BOTANICAL.test(videoVisualText))) {
    score -= 30;
    reasons.push('receita fora deste trecho');
  }
  const usableSec = stockFrameUsableSeconds(video);
  if (usableSec > 0) {
    // Take mais longo é só cortado no fim do trecho; o mais curto desacelera
    // até 0,75x e CONGELA o último quadro no que faltar (pilot-inserts). Regra
    // do Silas: o bloco nunca é maior que o take.
    score += (usableSec >= segment.targetSeconds ? 1 : usableSec / segment.targetSeconds) * 2.5;
    if (usableSec + .35 < Math.min(2.5, segment.targetSeconds)) score -= 3;
    if (usableSec / .75 + .2 < segment.targetSeconds) {
      score -= 10;
      reasons.push('take mais curto que o trecho: o fim congelaria');
    }
  }
  // Silas, 07.10: "sempre priorizar takes orgânicos… mas a prioridade é fazer
  // sentido". Orgânico é critério forte de desempate, nunca passa por cima de
  // sentido: uma cena exata de I.A ainda vence uma orgânica genérica.
  if (prepared.origin === 'organic') { score += 4; reasons.push('orgânico'); }
  else if (prepared.origin === 'ai') score -= 2;
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
  const sorted = videos.map((video) => memoScore(segment, video, ranking, false))
    .filter((candidate) => candidate.score >= (fullCoverage ? 1 : segment.concepts.length ? 5 : 3.5))
    .sort((a, b) => b.score - a.score || b.video.downloads - a.video.downloads || a.video.id.localeCompare(b.video.id));
  const top = sorted.slice(0, Math.max(1, limit));
  if (limit < 12 || sorted.length <= top.length) return top;
  // O top-N por placar costuma ser todo da mesma situação (24 idosos felizes):
  // a variedade do plano e das alternativas precisa das melhores opções de
  // CADA situação válida, não só das primeiras do ranking.
  const perFamily = new Map<SceneFamily, number>();
  for (const candidate of top) {
    const family = prepareVideo(candidate.video).profile.family;
    perFamily.set(family, (perFamily.get(family) || 0) + 1);
  }
  const extra: SmartStockCandidate[] = [];
  for (const candidate of sorted.slice(top.length)) {
    if (extra.length >= 12) break;
    const family = prepareVideo(candidate.video).profile.family;
    if ((perFamily.get(family) || 0) >= 2) continue;
    perFamily.set(family, (perFamily.get(family) || 0) + 1);
    extra.push(candidate);
  }
  return [...top, ...extra];
}

/** Mesma cena na tela: mesmo id, mesmo grupo de duplicata do StockFrame ou a
 * mesma série de título (o mesmo take subido duas vezes, ou "(1)…(9)"). */
const seriesKeys = new WeakMap<object, string>();
function seriesKeyOf(video: Pick<StockFrameVideo, 'title'>): string {
  let key = seriesKeys.get(video);
  if (key === undefined) { key = stockFrameSeriesKey(video); seriesKeys.set(video, key); }
  return key;
}

const titleTokenCache = new Map<string, Set<string>>();
function titleTokens(title: string): Set<string> {
  let tokens = titleTokenCache.get(title);
  if (!tokens) {
    tokens = new Set(meaningful(title));
    if (titleTokenCache.size > 5000) titleTokenCache.clear();
    titleTokenCache.set(title, tokens);
  }
  return tokens;
}

function tokenSimilarity(a: string, b: string): number {
  const ta = titleTokens(a); const tb = titleTokens(b);
  if (!ta.size || !tb.size) return 0;
  const shared = [...ta].filter((token) => tb.has(token)).length;
  return shared / new Set([...ta, ...tb]).size;
}

const CG_TITLE = /\b(?:3d|animac\w*|raio x|raiox|ressonancia|tomografia|anatomi\w*|ilustrac\w*|render\w*|hologra\w*)\b/;

/** Mesma SÉRIE de título, mas cenas diferentes de verdade. O catálogo sobe
 * filmagem real como "VELHO DEBILITADO (1)…(46)": são 43 pessoas e situações
 * diferentes (10s a 223s), não o mesmo take — tratá-las como um só deixava
 * entrar UM velhinho por AD e o resto virava cérebro 3D (Silas, 07.10).
 * Animação/3D da mesma série continua sendo a mesma cena (Silas nunca usa
 * "PROSTATA INFLAMADA 3D (3)" e "(8)" no mesmo AD); com ficha visual dos
 * dois lados, a ficha decide. */
export function stockFrameDistinctSiblings(a: StockFrameVideo, b: StockFrameVideo): boolean {
  if (a.id === b.id || seriesKeyOf(a) !== seriesKeyOf(b)) return false;
  const auditA = stockFrameVisualAudit(a.id);
  const auditB = stockFrameVisualAudit(b.id);
  if (auditA && auditB) return tokenSimilarity(auditA.title, auditB.title) < .6;
  if (CG_TITLE.test(normalize(a.title)) || CG_TITLE.test(normalize(b.title))
    || auditA?.flags.includes('3D') || auditB?.flags.includes('3D')) return false;
  const da = a.durationSec; const db = b.durationSec;
  if (!(da > 0 && db > 0)) return false;
  return Math.abs(da - db) > Math.max(.35, Math.min(da, db) * .03);
}

/** O mesmo vídeo subido com títulos diferentes ("VELHA COM ALZHEIMER (2)" e
 * "VELHA DEBILITADA", os dois com 28,6s) tem a MESMA ficha visual e a mesma
 * duração — a série do título não pega, a ficha pega. */
function sameFichaKey(video: StockFrameVideo): string | undefined {
  const audit = stockFrameVisualAudit(video.id);
  return audit && video.durationSec > 0 ? `${normalize(audit.title)}|${Math.round(video.durationSec)}` : undefined;
}

export function stockFrameSameVisual(a: StockFrameVideo, b: StockFrameVideo): boolean {
  if (a.id === b.id) return true;
  const dupA = a.duplicateGroupId || a.smartMetadata?.duplicateGroupId;
  const dupB = b.duplicateGroupId || b.smartMetadata?.duplicateGroupId;
  if (dupA && dupA === dupB) return true;
  const fichaA = sameFichaKey(a);
  if (fichaA && fichaA === sameFichaKey(b)) return true;
  return seriesKeyOf(a) === seriesKeyOf(b) && !stockFrameDistinctSiblings(a, b);
}

/** Agrupa takes que são a mesma cena (union-find por id, duplicata e série,
 * separando dentro da série as filmagens que são cenas diferentes). */
function visualGroups(videos: StockFrameVideo[]): Map<string, string> {
  const parent = new Map<string, string>();
  const find = (key: string): string => {
    let root = key;
    while (parent.get(root) !== root) root = parent.get(root)!;
    parent.set(key, root);
    return root;
  };
  const link = (a: string, b: string) => {
    for (const key of [a, b]) if (!parent.has(key)) parent.set(key, key);
    const ra = find(a); const rb = find(b);
    if (ra !== rb) parent.set(ra < rb ? rb : ra, ra < rb ? ra : rb);
  };
  const unique = [...new Map(videos.map((video) => [video.id, video])).values()];
  const bySeries = new Map<string, StockFrameVideo[]>();
  for (const video of unique) {
    link(`id:${video.id}`, `id:${video.id}`);
    const dup = video.duplicateGroupId || video.smartMetadata?.duplicateGroupId;
    if (dup) link(`id:${video.id}`, `dup:${dup}`);
    const ficha = sameFichaKey(video);
    if (ficha) link(`id:${video.id}`, `ficha:${ficha}`);
    const series = seriesKeyOf(video);
    bySeries.set(series, [...(bySeries.get(series) || []), video]);
  }
  for (const members of bySeries.values()) {
    for (let i = 0; i < members.length; i++) for (let j = i + 1; j < members.length; j++) {
      if (!stockFrameDistinctSiblings(members[i], members[j])) link(`id:${members[i].id}`, `id:${members[j].id}`);
    }
  }
  return new Map(videos.map((video) => [video.id, find(`id:${video.id}`)]));
}

/** Penalidade editorial de um plano (ordem da timeline): a mesma situação em
 * takes colados, a mesma série de novo, animação demais em sequência ou uma
 * família dominando o AD. É o "dinamismo visual" do Silas, medido. */
function planMonotony(picks: { segment: SmartStockSegment; video: StockFrameVideo }[]): number {
  const n = picks.length;
  if (n < 2) return 0;
  const familyCap = Math.max(2, Math.ceil(n * .34));
  const organCap = Math.max(2, Math.ceil(n * .4));
  const families = new Map<SceneFamily, number>();
  let organ = 0;
  let cgRun = 0;
  let penalty = 0;
  const profiles = picks.map((pick) => prepareVideo(pick.video).profile);
  for (let index = 0; index < n; index++) {
    const profile = profiles[index];
    families.set(profile.family, (families.get(profile.family) || 0) + 1);
    if (profile.subject === 'orgao') organ++;
    cgRun = profile.live ? 0 : cgRun + 1;
    if (cgRun > 2) penalty += 5;
    if (index) {
      const previous = picks[index - 1].segment;
      const current = picks[index].segment;
      const touching = previous.anchor === current.anchor && previous.wordTo + 1 === current.wordFrom;
      if (profiles[index - 1].family === profile.family) penalty += touching ? 7 : 3;
    }
    for (let earlier = 0; earlier < index; earlier++) {
      const auditA = stockFrameVisualAudit(picks[earlier].video.id);
      const auditB = stockFrameVisualAudit(picks[index].video.id);
      const near = index - earlier <= 3;
      // Com as duas fichas, o que se repete é o MOTIVO visual (duas idosas
      // ninando boneca); sem ficha, a série do título é a melhor pista.
      if (auditA && auditB) {
        if (tokenSimilarity(auditA.title, auditB.title) >= .45) penalty += near ? 10 : 8;
      } else if (seriesKeyOf(picks[earlier].video) === seriesKeyOf(picks[index].video)) penalty += near ? 14 : 9;
    }
  }
  for (const count of families.values()) if (count > familyCap) penalty += (count - familyCap) * 8;
  if (organ > organCap) penalty += (organ - organCap) * 8;
  return penalty;
}

/** Busca local sobre a atribuição sem repetição: troca o take de um trecho por
 * uma alternativa QUASE tão relevante quando isso tira o plano da monotonia
 * (sempre a mesma situação, cérebro atrás de cérebro). Nunca repete cena e
 * nunca sacrifica mais que 14 pontos de sentido num trecho. */
function diversifySmartPlan(result: SmartStockSegment[], threshold: number): void {
  const chosen = result.map((segment) => selectedSmartCandidate(segment));
  const value = () => {
    const picks = chosen.flatMap((candidate, index) => candidate ? [{ segment: result[index], video: candidate.video }] : []);
    return chosen.reduce((sum, candidate) => sum + (candidate?.score || 0), 0) - planMonotony(picks);
  };
  const intents = result.map((segment) => prepareRanking(segment).intent);
  for (let pass = 0; pass < 4; pass++) {
    let improved = false;
    for (let index = 0; index < result.length; index++) {
      const current = chosen[index];
      if (!current) continue;
      let best = current;
      let bestValue = value();
      for (const candidate of result[index].candidates) {
        // Variar, sim; trocar por cena que a fala não pede, não: só uma
        // alternativa da situação certa pode custar até 14 pontos de sentido.
        const rightSituation = (intents[index].weights[prepareVideo(candidate.video).profile.family] || 0) >= .6;
        if (candidate === current || !Number.isFinite(candidate.score) || candidate.score < threshold
          || candidate.score < current.score - (rightSituation ? 14 : 6)) continue;
        if (chosen.some((other, position) => position !== index && other && stockFrameSameVisual(other.video, candidate.video))) continue;
        chosen[index] = candidate;
        const next = value();
        if (next > bestValue + .5) { best = candidate; bestValue = next; }
      }
      chosen[index] = best;
      if (best !== current) improved = true;
    }
    if (!improved) break;
  }
  chosen.forEach((candidate, index) => { result[index].selectedVideoId = candidate?.video.id; });
}

/** Global bipartite assignment: maximize reliable unique choices first, then
 * their existing evidence scores. A chronological greedy choice can steal the
 * only exact take from a later, much more specific sentence.
 *
 * Silas, 03.10: take repetido "não deve acontecer". Cada CENA (não só cada id)
 * entra no máximo uma vez no plano: o mesmo take subido duas vezes ou duas
 * variações da mesma série contam como repetição. Trecho sem cena única fica
 * com o avatar e mantém as alternativas para a revisão. */
export function chooseSmartStockAssignments(segments: SmartStockSegment[], fullCoverage = false): SmartStockSegment[] {
  if (!segments.length) return [];
  const eligible = segments.map((segment) => segment.candidates.filter((candidate) => Number.isFinite(candidate.score) && candidate.score >= (fullCoverage ? 1 : 3)));
  const groupOf = visualGroups(eligible.flat().map((candidate) => candidate.video));
  const groups = [...new Set(eligible.flatMap((candidates) => candidates.map((candidate) => groupOf.get(candidate.video.id)!)))].sort();
  const columns = new Map(groups.map((group, index) => [group, index + 1]));
  const rows = segments.length;
  // One private dummy column per segment guarantees that "no safe take" is
  // always feasible. Forbidden pairs can never force an unrelated selection.
  const width = groups.length + rows;
  const maxScore = eligible.reduce((max, candidates) => candidates.reduce((best, candidate) => Math.max(best, candidate.score), max), 0);
  const uniqueBonus = maxScore * rows + 1;
  const forbidden = uniqueBonus * (rows + 1) + maxScore;
  // The best variant of each visual group per segment; the others add nothing.
  const evidence = eligible.map((candidates) => {
    const best = new Map<number, SmartStockCandidate>();
    for (const candidate of candidates) {
      const column = columns.get(groupOf.get(candidate.video.id)!)!;
      const prior = best.get(column);
      if (!prior || candidate.score > prior.score) best.set(column, candidate);
    }
    return best;
  });
  const cost = (row: number, column: number) => {
    if (column > groups.length) return 0;
    const candidate = evidence[row - 1].get(column);
    return candidate === undefined ? forbidden : -(uniqueBonus + candidate.score);
  };

  // Rectangular Hungarian algorithm. The catalog pool is sparse and bounded
  // upstream (tens of candidates/segment); no remote model or inference cost.
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
  for (let column = 1; column <= groups.length; column++) {
    const row = matchedRow[column];
    const candidate = row ? evidence[row - 1].get(column) : undefined;
    if (candidate) result[row - 1].selectedVideoId = candidate.video.id;
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
    const used = result.flatMap((segment) => segment.candidates.filter((candidate) => candidate.video.id === segment.selectedVideoId).map((candidate) => candidate.video));
    const alternative = current.candidates.find((candidate) => candidate.score >= selected.score - 6
      && candidate.video.id !== selected.video.id && !used.some((video) => stockFrameSameVisual(video, candidate.video))
      && group(candidate.video) !== group(selected.video));
    if (alternative) current.selectedVideoId = alternative.video.id;
  }
  // Duas cenas quase iguais perto uma da outra ("MANGUEIRA JATO FRACO E
  // FORTE" e "… DUPLO SENTIDO", "SEGURANDO PRÓSTATA INFLAMADA" e "… INCHADA")
  // parecem take repetido. Troca a de depois por uma alternativa livre quase
  // tão boa, diferente das vizinhas (até dois takes de distância).
  // Com ficha, a semelhança é da CENA ("idosa ninando boneca" × "idosa com
  // boneca no colo"), não do título genérico do catálogo.
  const sceneTokens = (video: StockFrameVideo) => new Set(meaningful(stockFrameVisualAudit(video.id)?.title || video.title).filter((token) => !/^\d+$/.test(token) && !['animacao', '3d', 'video', 'take'].includes(token)));
  const similar = (a: StockFrameVideo, b: StockFrameVideo) => {
    const ta = sceneTokens(a); const tb = sceneTokens(b);
    const shared = [...ta].filter((token) => tb.has(token)).length;
    return shared >= 2 && shared / Math.max(1, new Set([...ta, ...tb]).size) >= .5;
  };
  const chosenVideo = (segment: SmartStockSegment | undefined) => segment ? selectedSmartCandidate(segment)?.video : undefined;
  for (let index = 1; index < result.length; index++) {
    const current = result[index];
    const selected = selectedSmartCandidate(current);
    if (!selected) continue;
    const earlier = [chosenVideo(result[index - 1]), chosenVideo(result[index - 2])].filter((video): video is StockFrameVideo => !!video);
    if (!earlier.some((video) => similar(video, selected.video))) continue;
    const neighbors = [index - 2, index - 1, index + 1, index + 2].map((position) => chosenVideo(result[position])).filter((video): video is StockFrameVideo => !!video);
    const used = result.flatMap((segment) => segment.candidates.filter((candidate) => candidate.video.id === segment.selectedVideoId).map((candidate) => candidate.video));
    const alternative = current.candidates.find((candidate) => candidate.score >= selected.score - 5
      && candidate.score >= (fullCoverage ? 1 : 3)
      && !used.some((video) => stockFrameSameVisual(video, candidate.video))
      && !neighbors.some((video) => similar(candidate.video, video)));
    if (alternative) current.selectedVideoId = alternative.video.id;
  }
  // Dinamismo visual (Silas, 07.10): "não pode ser o mesmo formato de stock o
  // tempo todo". Com o plano sem repetição pronto, troca o que deixa o AD
  // monótono por alternativas quase tão boas de outras situações.
  diversifySmartPlan(result, fullCoverage ? 1 : 3);
  return result;
}

/** Last resort for unfilled full100 slots ONLY, after the caller has exhausted
 * specific and broad catalog searches. Normal ranking never invokes this. */
export function rankStockFrameGenericFallback(segment: SmartStockSegment, videos: StockFrameVideo[], limit = 8): SmartStockCandidate[] {
  const ranking = prepareRanking(segment);
  return videos.map((video) => memoScore(segment, video, ranking, 'generic'))
    .filter((candidate) => candidate.score >= 1)
    .sort((a, b) => b.score - a.score || a.video.id.localeCompare(b.video.id))
    .slice(0, Math.max(1, limit))
    .map((candidate) => ({ ...candidate, genericFallback: true,
      reasons: candidate.reasons.some((reason) => reason.startsWith('alternativa genérica')) ? candidate.reasons
        : ['alternativa genérica após esgotar a busca específica', ...candidate.reasons] }));
}

/** Alternativas do PACK do nicho da campanha (ex.: Prostata) para um trecho
 * sem cena específica suficiente. Só cenas do próprio pack, e todas as travas
 * de contexto continuam valendo (anatomia, sentido, receita, sexo, CTA). */
export function rankStockFramePackAlternatives(segment: SmartStockSegment, videos: StockFrameVideo[], limit = 12): SmartStockCandidate[] {
  if (!segment.campaignNicheId) return [];
  const ranking = prepareRanking(segment);
  return videos.filter((video) => video.nicheId === segment.campaignNicheId)
    .map((video) => memoScore(segment, video, ranking, 'pack'))
    .filter((candidate) => candidate.score >= 1)
    .sort((a, b) => b.score - a.score || a.video.id.localeCompare(b.video.id))
    .slice(0, Math.max(1, limit))
    .map((candidate) => ({ ...candidate, genericFallback: true }));
}

/** Nunca deixa um trecho sem alternativas: mantém as específicas (uma por
 * cena), completa com as genéricas seguras e depois com o pack do nicho até
 * existirem `minimum` opções livres — fora do take escolhido e de qualquer
 * cena já usada em outro trecho ou inserida à mão (`exclude`). */
export function fillSmartStockAlternatives<T extends SmartStockSegment>(segments: T[], options: {
  pool: StockFrameVideo[]; pack?: StockFrameVideo[]; minimum?: number; exclude?: StockFrameVideo[]; limit?: number;
}): T[] {
  const minimum = options.minimum ?? 6;
  const limit = options.limit ?? 30;
  const exclude = options.exclude || [];
  return segments.map((segment) => {
    const usedElsewhere = [...exclude, ...segments.filter((other) => other.id !== segment.id)
      .flatMap((other) => other.candidates.filter((candidate) => candidate.video.id === other.selectedVideoId).map((candidate) => candidate.video))];
    const list: SmartStockCandidate[] = [];
    const add = (candidate: SmartStockCandidate) => {
      if (list.length >= limit || list.some((current) => stockFrameSameVisual(current.video, candidate.video))) return;
      if (candidate.video.id !== segment.selectedVideoId && exclude.some((video) => stockFrameSameVisual(video, candidate.video))) return;
      list.push(candidate);
    };
    const selected = selectedSmartCandidate(segment);
    if (selected) add(selected);
    for (const candidate of segment.candidates) add(candidate);
    const free = () => list.filter((candidate) => candidate.video.id !== segment.selectedVideoId
      && !usedElsewhere.some((video) => stockFrameSameVisual(video, candidate.video))).length;
    const sources = [
      () => rankStockFrameGenericFallback(segment, options.pool, 40),
      () => rankStockFramePackAlternatives(segment, options.pack || options.pool, 60),
    ];
    for (const source of sources) {
      if (free() >= minimum) break;
      for (const candidate of source()) {
        if (free() >= minimum) break;
        add(candidate);
      }
    }
    return { ...segment, candidates: diverseOrder(list, segment.selectedVideoId) };
  });
}

/** Ordem das alternativas por relevância COM variedade: cada situação nova
 * (gente, médico, órgão, receita, tela…) sobe antes da 3ª variação da mesma.
 * O take escolhido fica primeiro; nada é descartado, só reordenado. */
function diverseOrder(list: SmartStockCandidate[], selectedId?: string): SmartStockCandidate[] {
  const ordered: SmartStockCandidate[] = [];
  const rest = [...list];
  const selectedIndex = rest.findIndex((candidate) => candidate.video.id === selectedId);
  if (selectedIndex >= 0) ordered.push(...rest.splice(selectedIndex, 1));
  const families = new Map<SceneFamily, number>();
  const series = new Map<string, number>();
  for (const candidate of ordered) {
    const family = prepareVideo(candidate.video).profile.family;
    families.set(family, (families.get(family) || 0) + 1);
    series.set(seriesKeyOf(candidate.video), (series.get(seriesKeyOf(candidate.video)) || 0) + 1);
  }
  while (rest.length) {
    let bestIndex = 0;
    let bestValue = -Infinity;
    for (let index = 0; index < rest.length; index++) {
      const candidate = rest[index];
      const family = prepareVideo(candidate.video).profile.family;
      const value = candidate.score - (families.get(family) || 0) * 6 - (series.get(seriesKeyOf(candidate.video)) || 0) * 9;
      if (value > bestValue) { bestValue = value; bestIndex = index; }
    }
    const [next] = rest.splice(bestIndex, 1);
    const family = prepareVideo(next.video).profile.family;
    families.set(family, (families.get(family) || 0) + 1);
    series.set(seriesKeyOf(next.video), (series.get(seriesKeyOf(next.video)) || 0) + 1);
    ordered.push(next);
  }
  return ordered;
}

/** Cobertura 100% sem repetir cena: um trecho que ficou sem take único é
 * absorvido pelo vizinho contíguo que já tem take (o take dele segue até o
 * fim do trecho), preferindo o vizinho cujo take dura o suficiente. */
export function absorbUnfilledSmartSegments(parts: StockFrameCopyPart[], segments: SmartStockSegment[]): SmartStockSegment[] {
  let current = segments.map((segment) => ({ ...segment }));
  const touching = (a: SmartStockSegment, b: SmartStockSegment) => a.anchor === b.anchor
    && (a.wordTo + 1 === b.wordFrom || b.wordTo + 1 === a.wordFrom);
  for (let guard = 0; guard < segments.length; guard++) {
    const index = current.findIndex((segment, position) => !segment.selectedVideoId
      && [current[position - 1], current[position + 1]].some((neighbor) => neighbor?.selectedVideoId && touching(neighbor, segment)));
    if (index < 0) break;
    const empty = current[index];
    const words = parts.find((part) => part.label === empty.anchor)?.text.match(/\S+/g) || [];
    const best = [index - 1, index + 1].filter((position) => current[position]?.selectedVideoId && touching(current[position], empty))
      .map((position) => {
        const neighbor = current[position];
        const from = Math.min(neighbor.wordFrom, empty.wordFrom);
        const to = Math.max(neighbor.wordTo, empty.wordTo);
        const targetSeconds = Math.round(Math.max(2.5, Math.min(10, (to - from + 1) / 2.35)) * 10) / 10;
        const video = selectedSmartCandidate(neighbor)?.video;
        const usable = video ? stockFrameUsableSeconds(video) : 0;
        return { position, from, to, targetSeconds, usable, fits: usable / .75 + .2 >= targetSeconds };
      })
      .sort((a, b) => Number(b.fits) - Number(a.fits) || b.usable - a.usable)[0];
    const neighbor = current[best.position];
    current[best.position] = { ...neighbor, wordFrom: best.from, wordTo: best.to,
      text: words.slice(best.from, best.to + 1).join(' '), targetSeconds: best.targetSeconds };
    current = current.filter((_, position) => position !== index);
  }
  return current;
}

/** O editor não força b-roll onde o catálogo não tem a cena. O plano de 30/60%
 * escolhe os trechos pela copy, antes de ver o catálogo; depois do ranking, um
 * trecho que só ganhou reserva genérica ("receita com quiabo" sem take de
 * quiabo → cérebro 3D qualquer) cede a vez a um trecho que ficou com o avatar
 * e tem cena forte — mantendo a cobertura pedida dentro da tolerância de 3%
 * que a aplicação confere. Os trechos de reposição vêm do mesmo fatiamento
 * (cobertura 100% no mesmo ritmo) e são ranqueados contra o mesmo catálogo. */
export function rebalanceSmartPlan(parts: StockFrameCopyPart[], planned: SmartStockSegment[], options: {
  coverage: SmartCoverage; pace: SmartPace; pool: StockFrameVideo[];
  campaign: Pick<SmartStockSegment, 'campaignText' | 'campaignNicheId' | 'campaignIngredients'>;
  exclude?: StockFrameVideo[];
}): SmartStockSegment[] {
  if (options.coverage === 100 || !planned.length || !options.pool.length) return planned;
  const total = parts.reduce((sum, part) => sum + (part.text.match(/\S+/g)?.length || 0), 0);
  const target = Math.round(total * options.coverage / 100);
  const tolerance = Math.max(1, Math.ceil(total * .03));
  const order = new Map(parts.map((part, index) => [part.label, index]));
  const length = (segment: SmartStockSegment) => segment.wordTo - segment.wordFrom + 1;
  const overlaps = (a: SmartStockSegment, b: SmartStockSegment) => a.anchor === b.anchor && a.wordFrom <= b.wordTo && b.wordFrom <= a.wordTo;
  const weakScore = (segment: SmartStockSegment) => {
    const selected = selectedSmartCandidate(segment);
    return !selected ? 0 : selected.genericFallback ? Math.min(selected.score, 10) : selected.score;
  };
  const weak = planned.filter((segment) => weakScore(segment) < 16).sort((a, b) => weakScore(a) - weakScore(b));
  if (!weak.length) return planned;
  let plan = [...planned];
  const spare = planSmartStockSegments(parts, { coverage: 100, pace: options.pace })
    .filter((segment) => !plan.some((item) => overlaps(item, segment)))
    .map((segment) => {
      const full = { ...segment, ...options.campaign };
      return { ...full, candidates: rankStockFrameVideos(full, options.pool, 12, false) };
    });
  let covered = plan.reduce((sum, segment) => sum + length(segment), 0);
  let changed = false;
  for (const slot of weak) {
    const taken = [...(options.exclude || []), ...plan.filter((segment) => segment !== slot)
      .flatMap((segment) => { const selected = selectedSmartCandidate(segment); return selected ? [selected.video] : []; })];
    const strength = (segment: SmartStockSegment) => Math.max(0, ...segment.candidates
      .filter((candidate) => !candidate.genericFallback && !taken.some((video) => stockFrameSameVisual(video, candidate.video)))
      .map((candidate) => candidate.score));
    const replacement = spare
      .filter((segment) => !plan.some((item) => item !== slot && overlaps(item, segment)) && strength(segment) >= 24
        && Math.abs(covered - length(slot) + length(segment) - target) <= tolerance)
      .sort((a, b) => strength(b) - strength(a))[0];
    if (!replacement || strength(replacement) <= weakScore(slot) + 8) continue;
    plan = [...plan.filter((segment) => segment !== slot), { ...replacement, selectedVideoId: undefined }];
    spare.splice(spare.indexOf(replacement), 1);
    covered += length(replacement) - length(slot);
    changed = true;
  }
  if (!changed) return planned;
  return plan.sort((a, b) => (order.get(a.anchor) ?? 0) - (order.get(b.anchor) ?? 0) || a.wordFrom - b.wordFrom);
}

export function selectedSmartCandidate(segment: SmartStockSegment): SmartStockCandidate | undefined {
  return segment.candidates.find((candidate) => candidate.video.id === segment.selectedVideoId);
}

/** Um trecho avulso da copy (ex.: bloco que ficou com o avatar) lido do mesmo
 * jeito que o plano lê, para sugerir takes ali sem abrir a biblioteca. Bloco
 * longo vira uma janela do tamanho de um take (até a primeira pausa). */
export function smartSegmentForRange(parts: StockFrameCopyPart[], anchor: string, from: number, to: number,
  campaign: Pick<SmartStockSegment, 'campaignText' | 'campaignNicheId' | 'campaignIngredients'> = {}): SmartStockSegment | undefined {
  const part = parts.find((item) => item.label === anchor);
  const words = part ? wordsOf(part.text) : [];
  if (!part || from < 0 || to < from || to >= words.length) return undefined;
  let end = to;
  if (to - from + 1 > 14) {
    const pause = words.slice(from + 4, from + 12).find((word) => /[.!?;:,]["')\]]*$/.test(word.text));
    end = pause ? pause.index : from + 9;
  }
  const text = words.slice(from, end + 1).map((word) => word.text).join(' ');
  let sentenceFrom = from;
  while (sentenceFrom > 0 && !words[sentenceFrom - 1].endSentence) sentenceFrom--;
  let sentenceTo = end;
  while (sentenceTo < words.length - 1 && !words[sentenceTo].endSentence) sentenceTo++;
  const contextText = words.slice(sentenceFrom, sentenceTo + 1).map((word) => word.text).join(' ');
  const semantics = semanticFields(text, contextText);
  return {
    id: `faixa:${anchor}:${from}-${end}`, anchor, wordFrom: from, wordTo: end, text, ...semantics, contextText,
    contextConcepts: conceptsOf(part.text).filter((concept) => !concept.startsWith('emocao-')),
    visualBeat: visualBeat(text, semantics.narrativeDirection), visualScore: 0,
    targetSeconds: Math.round(Math.max(2.2, (end - from + 1) / 2.35) * 10) / 10,
    ...campaign, candidates: [],
  };
}

/** Diagnóstico: o placar e os motivos de UM take para UM trecho, inclusive
 * quando ele é recusado (score -100). Usado pelos testes e pela auditoria. */
export function explainSmartStockScore(segment: SmartStockSegment, video: StockFrameVideo, fallback: false | 'generic' | 'pack' = false): SmartStockCandidate {
  return scoreVideo(segment, video, prepareRanking(segment), fallback);
}
