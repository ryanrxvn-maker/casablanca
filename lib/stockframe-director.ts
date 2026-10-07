/**
 * Direção de cena do Smart Stocks — o olho do editor sênior de ADs.
 *
 * O ranking lexical sabe se um take "fala do mesmo assunto"; ele não sabe que
 * tipo de IMAGEM o trecho pede. Silas, 07.10: copy de memória virou só cérebro
 * 3D — o conceito "memória" casava qualquer cérebro e o pack é 60% cérebro.
 * Um editor lê a fala e pensa na SITUAÇÃO: sintoma pede gente sofrendo,
 * autoridade pede médico/laboratório, mecanismo pede o órgão, melhora pede
 * gente bem, vilão pede dinheiro da indústria, CTA pede tela. E nunca põe a
 * mesma situação o tempo todo: alterna gente e animação, varia as cenas.
 *
 * Aqui só regras explícitas e baratas (sem modelo, sem custo): família visual
 * de cada take, intenção visual de cada trecho, persona da campanha e o
 * quanto um take serve àquele trecho. As travas de contexto continuam em
 * stockframe-smart.ts e sempre vencem.
 */
import type { StockFrameVideo } from './stockframe';
import type { StockFrameVisualAudit } from './stockframe-visual-audit';

export type SceneFamily =
  | 'anatomia' | 'orgao-real' | 'ciencia' | 'medico' | 'hospital'
  | 'pessoa-problema' | 'pessoa-bem' | 'pessoa-rotina' | 'familia'
  | 'receita' | 'remedio' | 'dinheiro' | 'tela' | 'natureza' | 'abstrato' | 'outro';
export type ScenePersona = 'idoso' | 'homem' | 'mulher' | 'jovem' | 'crianca' | 'casal' | 'gestante';
export type SceneProfile = {
  family: SceneFamily;
  /** Órgão/cérebro (3D ou real), gente, objeto ou tela: o que domina o quadro. */
  subject: 'orgao' | 'pessoa' | 'objeto' | 'tela' | 'outro';
  /** Filmagem de verdade (gente, objeto, lugar) × animação/3D/raio-x. */
  live: boolean;
  persona?: ScenePersona;
};
export type VisualIntent = {
  weights: Partial<Record<SceneFamily, number>>;
  /** A fala pede gente antes de órgão (sintoma, história, melhora, família). */
  humanFirst: boolean;
  /** A fala explica o mecanismo (órgão, toxina, neurônio): anatomia cabe. */
  mechanism: boolean;
  /** Clima pedido pela própria fala: perda/sintoma × melhora. */
  mood?: 'distress' | 'recovery';
  label: string;
};

export const SCENE_FAMILY_LABEL: Record<SceneFamily, string> = {
  anatomia: 'anatomia/3D', 'orgao-real': 'órgão real', ciencia: 'laboratório', medico: 'médico',
  hospital: 'hospital/cuidado', 'pessoa-problema': 'gente com o problema', 'pessoa-bem': 'gente bem',
  'pessoa-rotina': 'gente no dia a dia', familia: 'família', receita: 'receita/preparo', remedio: 'remédio',
  dinheiro: 'dinheiro/indústria', tela: 'tela/celular', natureza: 'natureza', abstrato: 'abstrato', outro: 'outra cena',
};

const PEOPLE_FAMILIES = new Set<SceneFamily>(['pessoa-problema', 'pessoa-bem', 'pessoa-rotina', 'familia', 'hospital']);
/** Famílias que atravessam nicho sem trazer sintoma/anatomia de outra doença. */
export const NEUTRAL_SCENE_FAMILIES = new Set<SceneFamily>(['medico', 'ciencia', 'dinheiro', 'remedio', 'tela', 'natureza']);

function normalize(value: string): string {
  return value.toLowerCase().replace(/ł/g, 'l').replace(/ß/g, 'ss').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

// "Animado" (empolgado) não é animação; só "animação/animada 3D".
const CG = /\b(?:3d|animac\w*|raio x|raiox|raio-x|ressonancia\w*|tomografia\w*|anatomi\w*|ilustrac\w*|render\w*|hologra\w*|cgi|maquete)\b/;
const ORGAN = /\b(?:cerebr\w*|neuroni\w*|neural|nervos[oa]s?|sistema nervoso|terminac\w* nervos\w*|ramificac\w*|prostat\w*|coracao|cardiac\w*|figado|rins?|renal|pancreas|intestin\w*|estomago|bexiga|arteria\w*|veias?|vasos? sanguine\w*|celulas?|dna|esqueleto|ossos?|cartilage\w*|retina|coclea|utero|ovario\w*|penis|testicul\w*|pulmo\w*|glandula\w*|tireoide|orgaos?|sinapse\w*|bacteria\w*|parasita\w*|microorganism\w*|microplastic\w*|corpo humano|corpo 3d)\b/;
const SCREEN = /\b(?:celular\w*|smartphone\w*|telefone\w*|computador\w*|notebook\w*|tablet\w*|rede social|redes sociais|instagram|tiktok|youtube|comentario\w*|likes?|notificac\w*|whatsapp|digitand\w*|navegand\w*|internet|reportagem|jornal\w*|televisao|noticiario)\b/;
const PROFESSIONAL = /\b(?:medic[oa]s?|doutor\w*|dr|urologista\w*|neurologista\w*|cardiologista\w*|geriatra\w*|enfermeir\w*|especialista\w*|nutricionista\w*|consulta\w*|consultorio\w*|jaleco\w*|estetoscopio)\b/;
const SCIENCE = /\b(?:laboratori\w*|cientista\w*|pesquisa\w*|pesquisador\w*|microscopi\w*|tubo de ensaio|experiment\w*|cobaia\w*|amostra\w*|analisand\w*|examinand\w*)\b/;
const HOSPITAL = /\b(?:hospita\w*|maca|uti|cadeira de rodas|asilo\w*|casa de repouso|internad\w*|internac\w*|acamad\w*|cama hospitalar|soro|fisioterap\w*|enfermaria|cuidador\w*|home care|ambulancia)\b/;
const PROBLEM = /\b(?:debilitad\w*|doente\w*|dificuldade\w*|insatisfeit\w*|alzheimer|demencia|esquec\w*|confus\w*|perdid[oa]s?|desorientad\w*|trist\w*|choran\w*|chorando|dor|dores|sofr\w*|preocupad\w*|cansad\w*|cansaco|exaust\w*|caind\w*|caiu|queda|problemas? de saude|com problemas?|fraco|fraca|fragil|deprimid\w*|depressao|desesperad\w*|ansios\w*|insonia|tontura|trem\w*|mancand\w*|inchad\w*|solidao|abandonad\w*|frustrad\w*|vergonha|envergonhad\w*|sem memoria|perdendo|nevoa)\b/;
const GOOD = /\b(?:feliz\w*|felicidade|sorri\w*|saudave\w*|com saude|danc\w*|correndo|corrida|exercit\w*|alegr\w*|ativ[oa]s?|comemor\w*|celebr\w*|energia|disposi\w*|brincand\w*|rindo|risada|bem estar|jovial|vitalidade|curtindo|aproveitand\w*|viajand\w*|passeand\w*|livre|satisfeit\w*|impressionad\w*|apaixonad\w*|realizad\w*|confiante\w*|orgulhos\w*|prazer)\b/;
const FAMILY = /\b(?:net[oa]s?|netinh\w*|familia\w*|filh[oa]s?|casal|casais|marido|esposa|abracad\w*|abrac\w*|avos)\b/;
const ROUTINE = /\b(?:comend\w*|cozinhand\w*|tomando|bebend\w*|dormind\w*|caminhand\w*|andando|lendo|dirigind\w*|convers\w*|sentad[oa]s?|olhando|trabalhand\w*|cuidand\w*|jardin\w*|varrend\w*|subindo|descendo|levantand\w*|acordand\w*|rotina|cafe da manha|almocand\w*|jantand\w*|assistind\w*|costurand\w*|rezand\w*|pescand\w*|chaves|oculos)\b/;
const MEDICATION = /\b(?:remedio\w*|medicament\w*|capsula\w*|comprimido\w*|pilula\w*|farmacia\w*|suplemento\w*|cartela\w*|seringa\w*|injec\w*|insulina)\b/;
const MONEY = /\b(?:dinheiro|notas de|cedulas?|dolar\w*|moedas?|lucro\w*|industria\w*|cofre\w*|conta bancaria|cartao de credito|pagament\w*|pagando|ganancia|empresari\w*|executiv\w*|corporac\w*|farmaceutic\w*|big pharma|bolsa de valores|grana)\b/;
const RECIPE = /\b(?:receita\w*|preparand\w*|preparo|mistur\w*|liquidific\w*|ingrediente\w*|cortand\w*|ralando|fervend\w*|panela\w*|chas?|infusao|suco\w*|batend\w*|tempero\w*|colher\w*|bacia)\b/;
const NATURE = /\b(?:planta\w*|folha\w*|erva\w*|arvore\w*|floresta\w*|natureza|horta\w*|raiz\w*|semente\w*)\b/;
const PERSON = /\b(?:idos\w*|velh\w*|vov\w*|avo|avos|senhor\w*|homem|homens|mulher\w*|pessoa\w*|casal|casais|familia\w*|crianca\w*|bebe\w*|menin[oa]s?|jovem|jovens|rapaz|moca|garot[oa]s?|net[oa]s?|filh[oa]s?|pai|mae|marido|esposa|paciente\w*|gestante\w*|gravida\w*|loira|morena|aposentad\w*|gente)\b/;

const ELDER = /\b(?:idos\w*|velh\w*|vov\w*|avo|avos|senhor\w*|aposentad\w*|terceira idade|anciao|ancia)\b/;
const COUPLE = /\b(?:casal|casais)\b/;
const CHILD = /\b(?:crianca\w*|bebe\w*|menin[oa]s?|garot[oa]s?|filhinh\w*)\b/;
const PREGNANT = /\b(?:gestante\w*|gravida\w*)\b/;
const WOMAN = /\b(?:mulher\w*|moca|loira|morena|ruiva|gorda|magra|garota|menina|dona de casa|esposa|namorada)\b/;
const MAN = /\b(?:homem|homens|rapaz|marido|gordo|careca|barbudo|namorado)\b/;
const YOUNG = /\b(?:jovem|jovens|adolescente\w*|universitari\w*)\b/;

function personaOf(text: string): ScenePersona | undefined {
  if (ELDER.test(text)) return 'idoso';
  if (PREGNANT.test(text)) return 'gestante';
  if (COUPLE.test(text) && YOUNG.test(text)) return 'jovem';
  if (COUPLE.test(text)) return 'casal';
  if (CHILD.test(text)) return 'crianca';
  if (YOUNG.test(text)) return 'jovem';
  if (WOMAN.test(text)) return 'mulher';
  if (MAN.test(text)) return 'homem';
  return undefined;
}

const profileCache = new WeakMap<StockFrameVideo, { key: string; profile: SceneProfile }>();

/** O que o take mostra, pela ficha visual conferida quando existe (ela
 * descreve a cena; o título do catálogo às vezes é só "VELHO DEBILITADO (17)"). */
export function sceneProfileOf(video: StockFrameVideo, audit?: StockFrameVisualAudit, recipe = false): SceneProfile {
  const key = `${audit?.title || ''}|${recipe ? 1 : 0}`;
  const cached = profileCache.get(video);
  if (cached?.key === key) return cached.profile;
  const smart = video.smartMetadata;
  // Com ficha conferida, ela descreve a cena; o título do catálogo pode mentir
  // ("VELHO DEBILITADO (10)" é uma idosa rindo feliz).
  const text = normalize([audit ? '' : video.title, audit?.title, audit?.beats.join(' '), video.subcategoryName,
    smart?.summary, smart?.subjects.join(' '), smart?.actions.join(' ')].filter(Boolean).join(' '));
  const beats = new Set(audit?.beats || []);
  const cg = CG.test(text) || !!audit?.flags.includes('3D') || beats.has('anatomia') || beats.has('celula');
  const organ = ORGAN.test(text) || beats.has('anatomia') || beats.has('celula');
  const person = PERSON.test(text) || beats.has('idoso') || beats.has('avatar');
  let family: SceneFamily;
  if (organ && cg) family = 'anatomia';
  // O órgão é o assunto do quadro: na mesa do laboratório, no vidro, ou na
  // mão de alguém ("MULHER SEGURANDO CEREBRO" mostra um cérebro, não a mulher).
  else if (organ && !SCREEN.test(text) && (!person || /\b(?:segurand\w*|analisand\w*|examinand\w*|mostrand\w*|laboratori\w*|vidro|real|maquete|aberto)\b/.test(text))) {
    family = SCIENCE.test(text) && !/\b(?:cerebr\w*|orgao\w*|prostat\w*|coracao|neuroni\w*)\b/.test(text) ? 'ciencia' : 'orgao-real';
  }
  // Só tela de verdade: a ficha marcava "entregador deixando caixa" como CTA,
  // e "deixando o link aqui embaixo" recebia a entrega da FedEx.
  else if (SCREEN.test(text)) family = 'tela';
  else if (MONEY.test(text) || beats.has('dinheiro') || beats.has('industria')) family = 'dinheiro';
  else if (MEDICATION.test(text) || beats.has('remedio')) family = 'remedio';
  else if (recipe || beats.has('receita') || [...beats].some((beat) => beat.startsWith('ing:')) || (RECIPE.test(text) && !PERSON.test(text))) family = 'receita';
  else if (PROFESSIONAL.test(text) || beats.has('medico')) family = 'medico';
  else if (SCIENCE.test(text)) family = 'ciencia';
  else if (person && (HOSPITAL.test(text) || beats.has('hospital'))) family = 'hospital';
  else if (person && (PROBLEM.test(text) || beats.has('doenca') || beats.has('dor') || beats.has('tristeza') || beats.has('cansaco') || beats.has('vergonha'))) family = 'pessoa-problema';
  else if (person && (FAMILY.test(text) || beats.has('familia'))) family = 'familia';
  else if (person && (GOOD.test(text) || beats.has('alegria') || beats.has('alivio') || beats.has('energia'))) family = 'pessoa-bem';
  else if (person) family = 'pessoa-rotina';
  else if (RECIPE.test(text)) family = 'receita';
  else if (NATURE.test(text) || beats.has('natural')) family = 'natureza';
  else if (cg || beats.has('abstrato')) family = 'abstrato';
  else family = 'outro';
  const subject: SceneProfile['subject'] = family === 'anatomia' || family === 'orgao-real' ? 'orgao'
    : family === 'tela' ? 'tela'
      : PEOPLE_FAMILIES.has(family) || family === 'medico' ? 'pessoa'
        : family === 'receita' || family === 'remedio' || family === 'dinheiro' || family === 'natureza' ? 'objeto' : 'outro';
  const profile: SceneProfile = { family, subject, live: !cg, persona: person ? personaOf(text) : undefined };
  profileCache.set(video, { key, profile });
  return profile;
}

// ── Intenção visual da fala ──────────────────────────────────────────────
const CTA_CUE = /\b(?:link|botao|clique\w*|clica\w*|clicar|toque|toca|materia|leitura|tela|abaixo|acess\w*|assist\w*|veja o video|ver o video|saiba mais)\b/;
const SOCIAL_CUE = /\b(?:ao redor do mundo|milhares|milhoes de pessoas|todo mundo|viral\w*|internet|redes sociais|comentari\w*|likes?|compartilh\w*|explod\w*)\b/;
// Só o vilão NOMEADO (indústria, lucro, remédio caro). "Antes que seja
// removido" fala da tela do CTA, não pede fábrica de remédio.
const VILLAIN_CUE = /\b(?:industria\w*|farmaceutic\w*|lucro\w*|lucrar|vend\w* (?:de )?(?:remedio|medicament)\w*|medicamentos? caros?|remedios? caros?|mentira\w*|escond\w*|ganancia)\b/;
const MEDICATION_CUE = /\b(?:remedio\w*|medicament\w*|pilula\w*|capsula\w*|comprimido\w*|farmacia\w*|receitad\w*|prescri\w*|azulzinho|viagra|cialis|sildenafil\w*|tadalafil\w*|finasterid\w*|dutasterid\w*|tansulosin\w*|tamsulosin\w*|metformin\w*|insulina|anti inflamatori\w*|antiinflamatori\w*|analgesic\w*|calmante\w*)\b/;
const AUTHORITY_CUE = /\b(?:medic[oa]s?|doutor\w*|dr|neurologista\w*|urologista\w*|cardiologista\w*|geriatra\w*|especialista\w*|cientista\w*|pesquisador\w*|estudo\w*|pesquisa\w*|universidade\w*|harvard|laboratorio\w*|descobert\w*|nobel|consulta\w*|protocolo)\b/;
const MECHANISM_CUE = /\b(?:cerebr\w*|neuroni\w*|toxina\w*|toxic\w*|placas?|ferrugem|enferruj\w*|metal|cadmio|aluminio|receptor\w*|celulas?|inflamac\w*|sangue|arteria\w*|circulac\w*|combustivel|microplastic\w*|acumulo|veneno|glandula\w*|prostat\w*|hormoni\w*|testosterona|insulina|glicose|cartilage\w*|nervo\w*|orgao\w*)\b/;
const RECIPE_CUE = /\b(?:receita\w*|quiabo\w*|ingrediente\w*|mistura\w*|combinac\w*|prepar\w*|ritual\w*|chas?|suco\w*|truque\w*|caseir\w*|colher\w*|fruta\w*|casca)\b/;
const PROBLEM_CUE = /\b(?:esquec\w*|confus\w*|perda de memoria|perd\w* (?:a |sua )?memoria|lapsos?|nevoa\w*|alzheimer|demencia|nao reconhec\w*|perdid[oa]s?|vag\w*|sofr\w*|dor|dores|debilit\w*|doente\w*|vergonha|peso para|vigiad\w*|dependen\w*|agressiv\w*|internad\w*|asilo|casa de repouso|grave\w*|pior\w*|falh\w*|esperanca|escuridao|independencia|cansad\w*|fraco|fraqueza|incomod\w*|problema\w*|sintoma\w*|frustr\w*|desconfort\w*|tristeza|trist\w*)\b/;
// "Você não perde apenas nomes e lembranças. Perde sua independência."
const LOSS_CUE = /\bperd\w* (?:apenas |so |tambem |ate |os |as |a |o |sua |seus |suas |seu )*(?:nomes|lembranc\w*|independencia|memoria|controle|movimentos?|forca|visao|audicao|pai|mae|marido|esposa|filh\w*|esperanca|vida|dignidade|autonomia)\b/;
const SEVERE_CUE = /\b(?:asilo|casa de repouso|internad\w*|hospital\w*|grave\w*|24 horas|vigiad\w*|ate o fim|morr\w*|morte|isolad\w*|agressiv\w*|nao reconhec\w*|vag\w*)\b/;
// Melhora DITA, não palavra solta: "perde nomes e lembranças" e "tentava ir
// sozinha" são a perda; "voltei a lembrar" e "dirijo sozinha" são a melhora.
const RELIEF_CUE = /\b(?:volt\w* a|recuper\w*|funcion\w* (?:novamente|de novo)|afiad\w*|clareza|livre|(?:dirij\w*|vou|saio|ando|moro|faco tudo|cozinho) sozinh[oa]|feliz\w*|alegr\w*|melhor\w*|lembr\w* (?:de novo|novamente|de tudo)|dirij\w*|faco minha|vou aonde|eu mesm[oa]|desaparec\w*|sumiu)\b/;
const AGE_CUE = /\b(?:\d{2,3} anos|idos\w*|aposentad\w*|terceira idade|velh\w*|avo|avos|netos?)\b/;
// "Um amigo meu" não pede cena de família.
const FAMILY_CUE = /\b(?:esposa|marido|filh[oa]s?|net[oa]s?|famil\w*|pai|mae|avo|avos|casal)\b/;
const MEAL_CUE = /\b(?:jantar|almoc\w*|cafe da manha|refeic\w*|comida|comer)\b/;
// "Faz tudo na sua cozinha" pede o preparo, não qualquer idoso em casa.
const KITCHEN_CUE = /\b(?:cozinha\w*)\b/;
const PEOPLE_CUE = /\b(?:pessoas|gente|brasileir\w*|idosos|ninguem|todos|voce)\b/;

function addWeight(weights: VisualIntent['weights'], family: SceneFamily, weight: number) {
  if ((weights[family] || 0) < weight) weights[family] = Math.round(weight * 100) / 100;
}

function cuesInto(weights: VisualIntent['weights'], text: string, factor: number,
  input: { direction: 'recovery' | 'distress' | 'neutral'; callToAction: boolean; localIngredients: number }): string[] {
  const labels: string[] = [];
  const add = (family: SceneFamily, weight: number) => addWeight(weights, family, weight * factor);
  if (input.callToAction || CTA_CUE.test(text)) { add('tela', 1); labels.push('chamada'); }
  if (SOCIAL_CUE.test(text)) { add('tela', .8); add('pessoa-bem', .5); add('familia', .4); labels.push('prova social'); }
  if (VILLAIN_CUE.test(text)) { add('dinheiro', 1); add('remedio', .75); labels.push('vilão'); }
  if (MEDICATION_CUE.test(text)) { add('remedio', 1); labels.push('remédio'); }
  if (AUTHORITY_CUE.test(text)) { add('medico', 1); add('ciencia', .9); add('hospital', .3); labels.push('autoridade'); }
  const mechanism = MECHANISM_CUE.test(text);
  if (mechanism) { add('anatomia', 1); add('orgao-real', .95); add('ciencia', .5); labels.push('mecanismo'); }
  // Fala que EXPLICA o mecanismo ("age na inflamação, limpa as toxinas") pede
  // o órgão; o "desincha" da mesma frase não a transforma em cena de melhora.
  const human = mechanism ? .4 : 1;
  if (input.localIngredients || RECIPE_CUE.test(text)) { add('receita', 1); add('natureza', .5); labels.push('receita'); }
  const relief = input.direction === 'recovery' || (RELIEF_CUE.test(text) && input.direction !== 'distress');
  if ((PROBLEM_CUE.test(text) || LOSS_CUE.test(text)) && !relief) {
    add('pessoa-problema', human); add('hospital', (SEVERE_CUE.test(text) ? 1 : .7) * human); add('familia', (FAMILY_CUE.test(text) ? .9 : .35) * human);
    labels.push('sintoma');
  }
  if (relief) { add('pessoa-bem', human); add('pessoa-rotina', .85 * human); add('familia', .6 * human); labels.push('melhora'); }
  if (AGE_CUE.test(text)) {
    if (relief || input.direction === 'recovery') add('pessoa-bem', .85);
    else if (input.direction === 'distress') add('pessoa-problema', .85);
    else { add('pessoa-rotina', .75); add('pessoa-bem', .6); add('pessoa-problema', .55); }
    labels.push('idade');
  }
  if (FAMILY_CUE.test(text)) { add('familia', 1); add('pessoa-rotina', .7); labels.push('família'); }
  if (MEAL_CUE.test(text)) { add('pessoa-rotina', .9); add('familia', .6); add('receita', .5); labels.push('refeição'); }
  if (KITCHEN_CUE.test(text)) { add('receita', .8); add('pessoa-rotina', .45); labels.push('cozinha'); }
  if (PEOPLE_CUE.test(text)) add('pessoa-rotina', .5);
  return labels;
}

/** O que a fala pede na tela. A frase inteira (contexto) completa um pedaço
 * curto da rajada ("inclusive você, soubessem disso") com peso menor. */
export function segmentVisualIntent(input: {
  spoken: string; context: string; direction: 'recovery' | 'distress' | 'neutral';
  callToAction: boolean; localIngredients: number;
}): VisualIntent {
  const spoken = normalize(input.spoken);
  const context = normalize(input.context);
  const weights: VisualIntent['weights'] = {};
  let labels = cuesInto(weights, spoken, 1, input);
  if (!Object.keys(weights).length || Object.values(weights).every((weight) => (weight || 0) < .6)) {
    labels = [...labels, ...cuesInto(weights, context, .6, { ...input, callToAction: false })];
  }
  if (!Object.keys(weights).length) {
    if (input.direction === 'distress') addWeight(weights, 'pessoa-problema', .5);
    else if (input.direction === 'recovery') addWeight(weights, 'pessoa-bem', .5);
    else addWeight(weights, 'pessoa-rotina', .45);
    addWeight(weights, 'anatomia', .3);
  }
  const mechanism = MECHANISM_CUE.test(spoken);
  const people = Math.max(...['pessoa-problema', 'pessoa-bem', 'pessoa-rotina', 'familia', 'hospital'].map((family) => weights[family as SceneFamily] || 0));
  const organ = Math.max(weights.anatomia || 0, weights['orgao-real'] || 0);
  // O clima vem só das palavras do trecho (sem o sentido herdado da frase) e
  // não vale para a explicação do mecanismo, que mostra o órgão doente.
  const ownLabels = mechanism ? [] : cuesInto({}, spoken, 1, { ...input, direction: 'neutral' });
  const mood = ownLabels.includes('sintoma') ? 'distress' : ownLabels.includes('melhora') ? 'recovery' : undefined;
  return { weights, humanFirst: !mechanism && people >= .6 && people >= organ, mechanism, mood, label: [...new Set(labels)].join(', ') || 'contexto' };
}

/** Persona da campanha: quem o público se vê na tela. Memória e próstata são
 * de idoso; uma copy que diz "tenho 78 anos" também. */
export function campaignPersonaOf(campaign: string): ScenePersona | undefined {
  const text = normalize(campaign);
  const ages = [...text.matchAll(/\b(\d{2,3}) anos\b/g)].map((match) => Number(match[1])).filter((age) => age >= 15 && age <= 110);
  if (ages.some((age) => age >= 55) || /\b(?:idos\w*|aposentad\w*|terceira idade|netos?|alzheimer|demencia|asilo|casa de repouso)\b/.test(text)) return 'idoso';
  if (/\b(?:gravidez|gestante\w*|gravida\w*)\b/.test(text)) return 'gestante';
  if (/\b(?:lipedema|menopausa|celulite)\b/.test(text)) return 'mulher';
  if (/\b(?:prostat\w*)\b/.test(text)) return 'idoso';
  if (/\b(?:erec\w*|eretil|impoten\w*|brox\w*|broch\w*)\b/.test(text)) return 'homem';
  return undefined;
}

/** 0–1: quanto a pessoa da cena é o público da campanha. */
export function personaMatch(campaign: ScenePersona | undefined, scene: ScenePersona | undefined): number {
  if (!campaign || !scene) return .85;
  if (campaign === scene) return 1;
  if (campaign === 'idoso') return scene === 'casal' ? .8 : scene === 'homem' || scene === 'mulher' ? .55 : .25;
  if (campaign === 'homem') return scene === 'idoso' || scene === 'casal' ? .85 : scene === 'mulher' ? .3 : .35;
  if (campaign === 'mulher') return scene === 'idoso' ? .7 : scene === 'casal' ? .7 : scene === 'homem' ? .3 : .6;
  if (campaign === 'gestante') return scene === 'mulher' ? .7 : scene === 'casal' ? .7 : .3;
  return .7;
}

const NAMED_PERSONA: [ScenePersona, RegExp][] = [
  ['mulher', /\b(?:mulher\w*|esposa|parceira|namorada|companheira|filha|mae|senhora)\b/],
  ['casal', /\b(?:casal|casais|esposa|marido|parceir\w*|namorad\w*)\b/],
  ['crianca', /\b(?:net[oa]s?|crianca\w*|filh[oa]s? pequen\w*|bebe\w*)\b/],
  ['idoso', /\b(?:idos\w*|velh\w*|avo|avos|aposentad\w*|\d{2} anos)\b/],
  ['homem', /\b(?:homem|homens|marido|pai)\b/],
  ['jovem', /\b(?:jovem|jovens|net[oa]s?|filh[oa]s?)\b/],
  ['gestante', /\b(?:gravid\w*|gestante\w*|bebe)\b/],
];

/** Pessoas que a própria fala cita: "minha esposa ficou impressionada" chama a
 * esposa para a tela mesmo num AD masculino. */
export function personasNamedIn(text: string): Set<ScenePersona> {
  const normalized = normalize(text);
  return new Set(NAMED_PERSONA.filter(([, pattern]) => pattern.test(normalized)).map(([persona]) => persona));
}

/** Citada na fala, a pessoa é bem-vinda ("minha esposa ficou impressionada"
 * num AD de ED) — mas só eleva até "aceitável", e num AD de idoso a "mulher que
 * precisava ser vigiada" É a narradora de 96 anos: mulher/homem/casal jovens
 * continuam fora; netos e crianças citados entram. */
export function namedPersonaWelcome(campaign: ScenePersona | undefined, scene: ScenePersona | undefined, named: Set<ScenePersona>): boolean {
  if (!scene || !named.has(scene)) return false;
  return !(campaign === 'idoso' && (scene === 'mulher' || scene === 'homem' || scene === 'casal' || scene === 'jovem'));
}

/** Quanto o take serve à SITUAÇÃO que a fala pede (0–1). Gente fora da persona
 * da campanha (jovem num AD de idoso) vale pouco — a não ser que venha do pack
 * da própria campanha, que já foi feito para ela. */
export function sceneIntentFit(intent: VisualIntent, profile: SceneProfile, persona: ScenePersona | undefined, sameNiche: boolean,
  named: Set<ScenePersona> = new Set()): { weight: number; personaOk: boolean; personaFit: number } {
  const base = intent.weights[profile.family] || 0;
  const people = PEOPLE_FAMILIES.has(profile.family);
  const matched = personaMatch(persona, profile.persona);
  const raw = namedPersonaWelcome(persona, profile.persona, named) ? Math.max(matched, .85) : matched;
  // O pack da campanha já é dela, mas uma moça na academia continua fora de
  // um AD de ED de 50+: dentro do pack, só o desencontro forte pesa.
  const fit = !people ? 1 : sameNiche ? (raw <= .35 ? raw : 1) : raw;
  if (!base) return { weight: 0, personaOk: fit >= .7, personaFit: fit };
  return { weight: Math.round(base * fit * 100) / 100, personaOk: fit >= .7, personaFit: fit };
}

export function isPeopleFamily(family: SceneFamily): boolean {
  return PEOPLE_FAMILIES.has(family);
}
