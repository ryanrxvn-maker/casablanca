export type FlowPromptMode = 'image-video' | 'video-only';
export type FlowPromptRequest = {
  excerpt: string;
  context?: string;
  mode: FlowPromptMode;
  aspectRatio: '9:16' | '16:9';
  durationSeconds?: number;
};
export type FlowPromptSuggestion = {
  imagePrompt?: string;
  videoPrompt: string;
  explanation: string;
  strategy: 'medical-3d' | 'product-macro' | 'human-story' | 'cinematic-metaphor';
  source: 'claude' | 'local';
};

const MEDICAL = /(?:m[eé]dic|sa[uú]de|doen|sangue|c[eé]lula|c[eé]rebro|cora[cç][aã]o|f[ií]gado|rim|intestin|horm[oô]n|art[eé]ria|veia|inflama|gordura|nervo|m[uú]sculo|pele|bexiga|pr[oó]stata|raspagem|procedimento|tratamento|sintoma)/i;
const PRODUCT = /(?:produto|frasco|pote|c[aá]psula|comprimido|ingrediente|creme|s[eé]rum|caixinha|embalagem|receita|mistur|colher|gota|dose|suplemento)/i;
const HUMAN = /(?:homem|mulher|pessoa|voc[eê]|fam[ií]lia|m[aã]e|pai|casal|medo|vergonha|dor|al[ií]vio|feliz|cansad|acord|dorm|caminh|cozinha|banheiro|casa)/i;

export function flowPromptStrategy(text: string): FlowPromptSuggestion['strategy'] {
  if (MEDICAL.test(text)) return 'medical-3d';
  if (PRODUCT.test(text)) return 'product-macro';
  if (HUMAN.test(text)) return 'human-story';
  return 'cinematic-metaphor';
}

function clean(value: string, max: number): string {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

/** Resposta local segura: mantém o botão útil até quando o provedor de texto
 * estiver indisponível. Não gera mídia e não consome créditos do Google Flow. */
export function localFlowPrompt(input: FlowPromptRequest): FlowPromptSuggestion {
  const excerpt = clean(input.excerpt, 4000);
  const strategy = flowPromptStrategy(`${excerpt} ${clean(input.context || '', 8000)}`);
  const aspect = input.aspectRatio === '16:9' ? 'cinematic horizontal 16:9 composition' : 'vertical 9:16 composition for a premium social ad';
  const duration = Math.max(4, Math.min(10, Math.round(input.durationSeconds || 8)));
  const negative = 'No visible text, no captions, no subtitles, no labels, no logos, no watermark, no UI, no deformed anatomy, no synthetic AI look.';
  const subject = strategy === 'medical-3d'
    ? `a medically accurate 3D visualization that translates this idea into anatomy: “${excerpt}”`
    : strategy === 'product-macro'
      ? `a believable premium product-action scene inspired by: “${excerpt}”`
      : strategy === 'human-story'
        ? `an authentic human micro-story that visually expresses: “${excerpt}”`
        : `a grounded cinematic visual metaphor for: “${excerpt}”`;
  const look = strategy === 'medical-3d'
    ? 'high-end medical documentary CGI, anatomically coherent translucent tissues, restrained clinical colors, volumetric light, physically based rendering'
    : 'ultra-realistic live action, natural skin and materials, subtle imperfections, documentary authenticity, physically correct light, premium commercial cinematography';
  const imagePrompt = `${subject}. ${look}. One decisive story moment with a clear subject and readable depth, ${aspect}, 35mm lens, controlled shallow depth of field, natural motivated lighting, fine surface texture, cinematic color separation. ${negative}`;
  const videoPrompt = `${subject}. ${look}. ${duration}-second single continuous shot: begin with a clear establishing detail, reveal the cause through one physically plausible action, end on a strong visual consequence. Smooth restrained camera push-in with subtle parallax, 35mm lens, stable subject identity, coherent hands and objects, natural motion blur, ${aspect}. ${negative}`;
  const explanation = strategy === 'medical-3d'
    ? `O take transforma “${excerpt}” em uma animação médica 3D clara: começa situando a anatomia, revela o mecanismo por dentro e termina mostrando sua consequência. A câmera avança com suavidade, a anatomia permanece coerente e nada aparece escrito na imagem.`
    : strategy === 'product-macro'
      ? `O take mostra “${excerpt}” como uma ação de produto filmada de perto: primeiro apresenta os materiais, depois acompanha o preparo ou uso e termina no resultado visual. Luz, textura e movimento parecem captados por uma equipe real, sem rótulos ou textos legíveis.`
      : strategy === 'human-story'
        ? `O take encena “${excerpt}” como um momento humano real: começa situando a pessoa e o ambiente, acompanha uma ação simples e termina na reação que comunica a ideia. A câmera é discreta, a luz é natural e a cena não contém textos nem legendas.`
        : `O take traduz “${excerpt}” em uma metáfora cinematográfica fácil de entender: estabelece um detalhe, desenvolve uma ação física e conclui com uma imagem forte. O movimento de câmera é contido, o visual é realista e não há textos ou legendas.`;
  return { ...(input.mode === 'image-video' ? { imagePrompt } : {}), videoPrompt, explanation, strategy, source: 'local' };
}

export function parseFlowPrompt(value: unknown, input: FlowPromptRequest): FlowPromptSuggestion | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  const videoPrompt = clean(String(candidate.videoPrompt || ''), 7000);
  const imagePrompt = clean(String(candidate.imagePrompt || ''), 7000);
  const explanation = clean(String(candidate.explanation || ''), 1800);
  const strategy = candidate.strategy;
  if (videoPrompt.length < 80 || (input.mode === 'image-video' && imagePrompt.length < 80)) return null;
  if (!['medical-3d', 'product-macro', 'human-story', 'cinematic-metaphor'].includes(String(strategy))) return null;
  const guard = ' No visible text, no captions, no subtitles, no logos, no watermark.';
  const ensureGuard = (prompt: string) => /no visible text/i.test(prompt) ? prompt : `${prompt}${guard}`;
  const safeExplanation = explanation.length >= 40 ? explanation : localFlowPrompt(input).explanation;
  return { ...(input.mode === 'image-video' ? { imagePrompt: ensureGuard(imagePrompt) } : {}), videoPrompt: ensureGuard(videoPrompt), explanation: safeExplanation, strategy: strategy as FlowPromptSuggestion['strategy'], source: 'claude' };
}
