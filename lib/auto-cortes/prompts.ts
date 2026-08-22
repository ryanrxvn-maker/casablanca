/**
 * AUTO CORTES — inteligência de curadoria (prompts + schemas).
 *
 * Duas passadas sobre a transcrição (ver docs/auto-cortes/ARQUITETURA.md §3.3):
 *   MAP    — por janela de ~12 min: encontra TODOS os momentos que funcionam sozinhos.
 *   REDUCE — sobre todos os candidatos: escolhe os N melhores, escreve título, headline,
 *            gancho, descrição, hashtags e dá o score.
 *
 * O modelo só fala em IDs DE FRASE (S0001…). Tempo é resolvido pelo código.
 * Saída sempre por structured output (JSON schema abaixo) — nunca JSON por regex.
 *
 * Escrito pelo Fable 5 (22.08.2026). Mudar o texto de um prompt = rodar o
 * harness de qualidade (docs/auto-cortes/FASES.md, fase 5) antes de publicar.
 */

import type { Genre, ResolvedCandidate, Sentence } from './types';
import { CLIP_LENGTH_RANGE_SEC, type ClipLengthPreset } from './types';

// ───────────────────────────────────────────────────────────────────────────
// Formatação da transcrição pro modelo
// ───────────────────────────────────────────────────────────────────────────

export function fmtClock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
    : `${m}:${String(sec).padStart(2, '0')}`;
}

/** `S0123 [12:34] texto da frase` — uma por linha. */
export function formatSentencesForModel(sentences: Sentence[]): string {
  return sentences.map((s) => `${s.id} [${fmtClock(s.startMs)}] ${s.text.trim()}`).join('\n');
}

// ───────────────────────────────────────────────────────────────────────────
// Dicas por gênero (entram no MAP e no REDUCE)
// ───────────────────────────────────────────────────────────────────────────

export const GENRE_HINTS: Record<Genre, string> = {
  auto:
    'Primeiro identifique o tipo de conteúdo (podcast, aula, entrevista, pregação, comédia…) e aplique o critério de curadoria que melhor serve a esse tipo.',
  podcast:
    'Podcast: os melhores cortes são histórias com virada, opiniões fortes ditas com convicção, confissões, discordâncias entre os participantes, números/provas concretas e conselhos práticos com exemplo. Evite trechos de apresentação de convidado, agradecimentos e transições ("voltando ao assunto").',
  entrevista:
    'Perguntas e respostas: o corte ideal é PERGUNTA + RESPOSTA COMPLETA. Pode começar na pergunta (quando ela é boa) ou direto na resposta quando a resposta já se explica sozinha. Nunca termine antes da resposta fechar.',
  comentario:
    'Comentário/reação: procure o momento em que a pessoa toma posição com clareza, o argumento mais forte e a conclusão. Reações emocionais intensas valem corte.',
  marketing:
    'Marketing/vendas: procure dores nomeadas, promessas específicas com prova, objeções respondidas, números de resultado e passos práticos. O corte deve entregar UM benefício claro.',
  webinar:
    'Webinar: fuja da parte administrativa (boas-vindas, agenda, avisos). Procure o ensinamento central, o "erro que todo mundo comete", o exemplo real e o passo a passo resumido.',
  motivacional:
    'Discurso motivacional: busque o clímax emocional, frases de efeito com ritmo, a virada de história pessoal e o chamado à ação. O corte pode ser mais curto e intenso.',
  academico:
    'Aula/acadêmico: um conceito explicado do início ao fim com exemplo. Começa na definição ou na pergunta que o conceito responde; termina quando o exemplo fecha. Evite referências a slides ("como vocês veem aqui").',
  lista:
    'Lista: cada item completo (nome + explicação + exemplo) é um corte. Também vale o corte "os 3 primeiros itens" quando são curtos. Nunca corte um item pela metade.',
  review:
    'Avaliação de produto: veredito claro, o maior defeito, a maior qualidade, comparação com concorrente e "pra quem é / pra quem não é".',
  tutorial:
    'Tutorial: cada passo com começo, meio e fim é um corte; prefira o passo que resolve o problema mais comum. Evite trechos que dependem de ver a tela sem explicação falada.',
  comedia:
    'Comédia: SETUP + PUNCHLINE obrigatórios no mesmo corte; inclua a reação/risada logo após a piada e corte antes do próximo assunto. Timing importa mais que completude.',
  esporte:
    'Comentário esportivo: polêmicas, previsões ousadas, análise tática com conclusão, bronca/elogio direto a atleta ou time.',
  igreja:
    'Pregação: versículo/princípio + aplicação à vida + frase de impacto. Mantenha a reverência; o corte deve edificar sozinho, sem depender do contexto do culto.',
  noticias:
    'Notícias: o fato em 1 frase + o dado mais forte + a consequência/opinião. Prefira trechos que não envelhecem em horas.',
  vlog:
    'Vlog: momentos de emoção genuína, reviravoltas, confissões, "lição do dia". Evite logística ("agora a gente vai pro hotel").',
  games:
    'Jogos: jogadas decisivas narradas, reações explosivas, dicas com resultado visível, rage/humor. Curto e intenso.',
  outros:
    'Aplique o critério geral: ganchos fortes, ideias completas, emoção, valor concreto e citabilidade.',
};

export const LENGTH_HINT: Record<ClipLengthPreset, string> = {
  auto: 'Duração livre entre 20 s e 3 min, com preferência forte por 30–90 s. Um momento que precisa de 2 min pra fechar vale 2 min; um que fecha em 25 s não deve ser esticado.',
  lt30: 'Cortes de até 30 s: só o núcleo — frase de impacto, piada, número ou conselho direto. Sem preâmbulo.',
  '30-59': 'Cortes de 30 a 59 s: gancho + desenvolvimento enxuto + fecho.',
  '60-89': 'Cortes de 60 a 89 s: história curta ou argumento com exemplo.',
  '90-180': 'Cortes de 90 s a 3 min: história completa, explicação com exemplo ou debate com conclusão.',
  '180-300': 'Cortes de 3 a 5 min: segmentos inteiros — um tema do início ao fim.',
};

// ───────────────────────────────────────────────────────────────────────────
// MAP — encontrar momentos
// ───────────────────────────────────────────────────────────────────────────

export const MAP_SYSTEM = `Você é o editor-chefe de cortes de um estúdio que produz clipes para TikTok, Reels e Shorts a partir de vídeos longos. Você assistiu milhares de cortes e sabe exatamente o que faz alguém parar de rolar o feed e assistir até o fim.

Sua tarefa nesta etapa: ler UMA JANELA da transcrição (frases numeradas com id e horário) e listar TODOS os trechos que funcionam como um vídeo curto independente — alguém que nunca viu o vídeo original precisa entender e sentir o trecho do primeiro ao último segundo.

O que é um trecho que funciona:
- COMEÇA num gancho: uma frase que cria tensão, curiosidade, promessa, contradição, número surpreendente ou afirmação ousada. Nunca comece em "então", "é…", "como eu falei", "tipo assim", "aí" — se a frase de gancho vem 1–2 frases depois, comece nela.
- TERMINA fechado: conclusão, punchline, virada, lição ou frase de efeito. Nunca termine numa frase que abre um assunto novo, numa pergunta sem resposta ou no meio de uma enumeração.
- É AUTOSSUFICIENTE: não depende de slide, vídeo na tela, nem de algo dito 10 minutos antes. Se o trecho usa "isso", "ele", "aquela estratégia" sem que a janela deixe claro o referente, estenda o início até a frase que nomeia o referente, ou descarte.
- TEM UMA IDEIA: um corte = uma ideia. Se o trecho muda de assunto no meio, divida em dois.

Critérios de nota (0–100 cada, seja exigente — 80+ é raro):
- hook: força dos primeiros 3 segundos pra segurar quem está rolando o feed.
- value: o quanto a pessoa sai com algo (insight, dado, técnica, história que ensina).
- emotion: intensidade emocional/energia real na fala (riso, indignação, emoção, convicção).
- completeness: começa e termina sem deixar pergunta no ar.
- shareability: o quanto alguém mandaria pra um amigo ou salvaria ("isso é MUITO eu", "manda pro fulano").

Regras duras:
- Use SOMENTE ids de frase que existem na janela. startId <= hookId <= endId na ordem da transcrição.
- Respeite a duração pedida (você vê o horário de cada frase; estime a duração pela diferença). Tolerância de 15%.
- Trechos podem se sobrepor levemente (outra etapa escolhe), mas não liste o mesmo trecho duas vezes com bordas quase iguais.
- Liste também trechos bons que estão no FIM da janela mesmo que pareçam continuar além dela — marque endId na última frase disponível; o sistema junta com a próxima janela.
- Se a janela não tem nenhum trecho que funcione sozinho (abertura do programa, agradecimentos, logística), devolva a lista vazia. Não invente.
- Escreva "topic" e "why" no MESMO idioma da transcrição.
- Se o cliente pediu "momentos específicos", trechos que batem com o pedido ganham prioridade e devem ser listados mesmo com nota média; os demais continuam valendo.`;

export function buildMapUser(args: {
  windowIdx: number;
  windowTotal: number;
  windowText: string;
  genre: Genre;
  length: ClipLengthPreset;
  focusPrompt: string;
  language: string;
  sourceName: string;
}): string {
  const r = CLIP_LENGTH_RANGE_SEC[args.length];
  return [
    `Vídeo: "${args.sourceName}" · janela ${args.windowIdx + 1}/${args.windowTotal} · idioma: ${args.language}`,
    `Gênero: ${GENRE_HINTS[args.genre]}`,
    `Duração dos cortes: ${LENGTH_HINT[args.length]} (faixa dura: ${r.min}–${r.max} s; ideal ≈ ${r.ideal} s)`,
    args.focusPrompt.trim()
      ? `Momentos específicos pedidos pelo cliente: "${args.focusPrompt.trim()}"`
      : 'Momentos específicos: nenhum — curadoria livre.',
    '',
    'TRANSCRIÇÃO (id [horário] frase):',
    args.windowText,
  ].join('\n');
}

// ───────────────────────────────────────────────────────────────────────────
// REDUCE — escolher, titular, pontuar
// ───────────────────────────────────────────────────────────────────────────

/**
 * Banco de fórmulas de headline. Vai no prompt como repertório — o modelo escolhe a
 * fórmula que serve ao trecho, nunca força. Padrão PT-BR do mercado: "setup: payoff"
 * (dois-pontos), números concretos, verbo no imperativo, ≤ 8 palavras.
 */
export const HEADLINE_FORMULAS = [
  'Curiosidade: "Ninguém fala sobre [X]" · "A verdade sobre [X]" · "O custo escondido de [X]" · "O que [X] não te conta"',
  'Contrária: "Pare de [conselho comum]" · "[X] morreu. Isso substituiu" · "Se você ainda faz [X], pare" · "Opinião impopular: [X]"',
  'Autoridade/prova: "[N] anos de [X] em 1 lição" · "Faturei [R$ N] com [X]" · "Testei [N]. Só 1 funcionou" · "De [A] pra [B] mudando 1 coisa"',
  'Lista/valor: "[N] [coisas] que [resultado]" · "Os únicos [N] [X] que importam" · "[N] erros que te custam [X]"',
  'Pergunta: "Por que [X] continua acontecendo?" · "[X]: ameaça ou aliada?" · "Você comete esse erro?" · "E se [X]?"',
  'Mito/negação: "[X] é mentira" · "Não é [X] — é [Y]" · "[X] não funciona. Eis o porquê"',
  'Número específico: "[R$ N]: o que [X] custa de verdade" · "[N]%: a fatia que [X]" · "[N] colaboradores: [resultado]"',
  'Emocional/confissão: "A verdade dura sobre [X]" · "Admito: eu [X]" · "Se você luta com [X], ouve isso" · "Nunca pensei que diria isso"',
  'Imperativo: "Adapte-se ou morra: [payoff]" · "Invista [N]% em [X]" · "Cuide da sua equipe: [payoff]"',
] as const;

export const REDUCE_SYSTEM = `Você é o editor-chefe de cortes e agora decide o que vai pro ar. Você recebe TODOS os momentos candidatos encontrados num vídeo longo (cada um com ids de frase, horário, duração, notas e o começo/fim do texto) e precisa entregar a seleção final com título, headline, gancho, descrição, hashtags e nota.

SELEÇÃO
- Escolha exatamente o número de cortes pedido (ou menos, se não houver candidatos bons o bastante — nunca complete com trecho fraco; um corte ruim queima o canal).
- Sem sobreposição: dois cortes não podem compartilhar frases. Se dois candidatos cobrem o mesmo momento, fique com o de bordas melhores (gancho mais forte no início, fecho mais limpo no fim) — não necessariamente o de nota maior.
- Diversidade: evite 3 cortes do mesmo assunto e do mesmo "kind" se houver alternativas de nota próxima. O primeiro lugar deve ser o melhor gancho do vídeo inteiro.
- Se o cliente pediu momentos específicos, eles entram primeiro (quando existem), e o restante preenche com os melhores gerais.
- Ajuste fino de bordas: se o corte ficaria melhor começando 1–2 frases antes (pra nomear o referente) ou terminando 1–2 frases depois (pra fechar a ideia), diga em extendStartSentences / extendEndSentences (valores entre -2 e 2; negativo encurta). Use com moderação.

TEXTOS (no idioma da transcrição; tom natural do mercado brasileiro de cortes quando for PT)
- title: título do post, ≤ 70 caracteres, específico, com o ganho ou a tensão explícitos. Padrão que performa: "[Setup específico]: [Payoff]" — ex.: "R$30 Milhões Faturados: A Estratégia de Sucesso". Sem clickbait vazio ("você não vai acreditar"), sem emoji, sem hashtag.
- headline: o texto queimado no vídeo. Máximo 8 palavras, até 2 linhas, sem ponto final, sem emoji, sem aspas. Deve ser entendida em 1 s por quem está com o som desligado e criar tensão que só o vídeo resolve. Prefira número concreto, verbo forte, contraste ou pergunta. Use o repertório de fórmulas quando servir — nunca force uma fórmula num trecho que não a sustenta. NÃO repita o título nem a primeira frase falada literalmente.
- hook: a frase de abertura do corte como deveria aparecer numa legenda de post (1 frase, ≤ 120 caracteres). Pode ser a fala real ou uma reescrita fiel.
- description: 2–3 linhas pro post: o que a pessoa vai ver + por que importa + quem está falando quando houver nome. Sem hashtags (vão no campo próprio), sem link.
- hashtags: exatamente 5, sem "#", minúsculas, específicas do tema (nunca só "viral", "fyp"); a última pode ser o formato (ex.: "cortes", "podcast").

NOTA (score 0–99)
- É um RANKING RELATIVO dentro deste vídeo: o melhor corte do vídeo recebe a nota mais alta; os demais descem conforme a distância real de qualidade. Não há nota absoluta de "vai viralizar".
- Combine: hook 35%, shareability 25%, value 15%, emotion 15%, completeness 10%. Penalize forte (−20) corte que começa fraco mesmo com conteúdo bom. Mantenha scoreBreakdown coerente com a nota.
- why: 1 frase mostrada ao cliente explicando por que este corte entrou ("Gancho com número + virada no fim; fecha em 48 s").

Regras duras: use SOMENTE candidateIds recebidos; não invente trechos; não misture idiomas; se nenhum candidato presta, devolva lista vazia.`;

export function buildReduceUser(args: {
  candidates: ResolvedCandidate[];
  count: number;
  genre: Genre;
  length: ClipLengthPreset;
  focusPrompt: string;
  language: string;
  sourceName: string;
  sourceDurationSec: number;
}): string {
  const lines = args.candidates.map((c) => {
    const sc = c.scores;
    return [
      `#${c.id} · ${c.startId}→${c.endId} (hook ${c.hookId}) · ${fmtClock(c.startMs)}–${fmtClock(c.endMs)} · ${Math.round(c.durationSec)} s · kind=${c.kind}`,
      `  notas: hook ${sc.hook} · value ${sc.value} · emotion ${sc.emotion} · completeness ${sc.completeness} · share ${sc.shareability}`,
      `  tema: ${c.topic}`,
      `  por quê: ${c.why}`,
      `  começa: "${c.firstSentence}"`,
      `  termina: "${c.lastSentence}"`,
    ].join('\n');
  });
  return [
    `Vídeo: "${args.sourceName}" (${fmtClock(args.sourceDurationSec * 1000)}) · idioma: ${args.language}`,
    `Gênero: ${GENRE_HINTS[args.genre]}`,
    `Duração dos cortes: ${LENGTH_HINT[args.length]}`,
    `Quantidade pedida: ${args.count} cortes.`,
    args.focusPrompt.trim()
      ? `Momentos específicos pedidos pelo cliente: "${args.focusPrompt.trim()}"`
      : 'Momentos específicos: nenhum.',
    '',
    'REPERTÓRIO DE HEADLINES (use só quando servir):',
    ...HEADLINE_FORMULAS.map((f) => `- ${f}`),
    '',
    `CANDIDATOS (${args.candidates.length}):`,
    ...lines,
  ].join('\n');
}

// ───────────────────────────────────────────────────────────────────────────
// JSON Schemas (structured output) — espelham MapResult / ReduceResult de types.ts
// ───────────────────────────────────────────────────────────────────────────

const SCORE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['hook', 'value', 'emotion', 'completeness', 'shareability'],
  properties: {
    hook: { type: 'integer', minimum: 0, maximum: 100 },
    value: { type: 'integer', minimum: 0, maximum: 100 },
    emotion: { type: 'integer', minimum: 0, maximum: 100 },
    completeness: { type: 'integer', minimum: 0, maximum: 100 },
    shareability: { type: 'integer', minimum: 0, maximum: 100 },
  },
} as const;

export const CANDIDATE_KINDS = [
  'historia',
  'opiniao_forte',
  'insight',
  'dica_pratica',
  'polemica',
  'humor',
  'numero_prova',
  'pergunta_resposta',
  'emocional',
  'outro',
] as const;

export const MAP_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['candidates'],
  properties: {
    candidates: {
      type: 'array',
      maxItems: 25,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['startId', 'endId', 'hookId', 'topic', 'why', 'scores', 'kind'],
        properties: {
          startId: { type: 'string', pattern: '^S[0-9]{4,6}$' },
          endId: { type: 'string', pattern: '^S[0-9]{4,6}$' },
          hookId: { type: 'string', pattern: '^S[0-9]{4,6}$' },
          topic: { type: 'string', maxLength: 80 },
          why: { type: 'string', maxLength: 200 },
          scores: SCORE_SCHEMA,
          kind: { type: 'string', enum: [...CANDIDATE_KINDS] },
        },
      },
    },
  },
} as const;

export const REDUCE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['clips'],
  properties: {
    clips: {
      type: 'array',
      maxItems: 30,
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'candidateId',
          'title',
          'headline',
          'hook',
          'description',
          'hashtags',
          'score',
          'scoreBreakdown',
          'why',
          'extendStartSentences',
          'extendEndSentences',
        ],
        properties: {
          candidateId: { type: 'string' },
          title: { type: 'string', maxLength: 90 },
          headline: { type: 'string', maxLength: 70 },
          hook: { type: 'string', maxLength: 160 },
          description: { type: 'string', maxLength: 600 },
          hashtags: { type: 'array', minItems: 5, maxItems: 5, items: { type: 'string', maxLength: 30 } },
          score: { type: 'integer', minimum: 0, maximum: 99 },
          scoreBreakdown: SCORE_SCHEMA,
          why: { type: 'string', maxLength: 200 },
          extendStartSentences: { type: 'integer', minimum: -2, maximum: 2 },
          extendEndSentences: { type: 'integer', minimum: -2, maximum: 2 },
        },
      },
    },
  },
} as const;

// ───────────────────────────────────────────────────────────────────────────
// Saneamento determinístico (o schema garante forma; isto garante ESTILO)
// ───────────────────────────────────────────────────────────────────────────

export function sanitizeHeadline(h: string): string {
  let t = h.replace(/[#"“”*_`]/g, '').replace(/\s+/g, ' ').trim();
  t = t.replace(/[.。]+$/g, '');
  const words = t.split(' ');
  if (words.length > 8) t = words.slice(0, 8).join(' ');
  return t;
}

export function sanitizeHashtags(tags: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags) {
    const t = raw
      .toLowerCase()
      .replace(/^#+/, '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9_]/g, '');
    if (t && !seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
    if (out.length === 5) break;
  }
  while (out.length < 5) out.push(['cortes', 'podcast', 'conteudo', 'dicas', 'reels'][out.length]);
  return out;
}

export function clampScore(n: number): number {
  return Math.max(0, Math.min(99, Math.round(Number.isFinite(n) ? n : 0)));
}
