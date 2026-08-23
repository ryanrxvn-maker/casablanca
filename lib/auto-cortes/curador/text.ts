/**
 * AUTO CORTES · CURADOR LOCAL — camada de texto (PURA).
 *
 * Normalização, tokenização e leitura de "fatos" (número, dinheiro, tempo,
 * porcentagem). Nada aqui toca DOM, rede, ffmpeg, `Date.now()` ou
 * `Math.random()` — mesma entrada, mesma saída, sempre.
 *
 * Ver docs/auto-cortes/CURADOR-LOCAL.md.
 */

// ───────────────────────────────────────────────────────────────────────────
// Normalização
// ───────────────────────────────────────────────────────────────────────────

/** minúscula + sem acento (NFD). É a forma canônica de comparação. */
export function foldCase(s: string): string {
  return (s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/**
 * Forma pra casar FRASE FEITA: minúscula, sem acento, tudo que não é letra ou
 * dígito vira espaço, e a string sai com espaço nas bordas — assim
 * `" pare de "` casa `"Pare de fazer isso"` mas não casa `"comparem"`.
 */
export function normalizeForMatch(s: string): string {
  const t = foldCase(s)
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return t ? ` ${t} ` : ' ';
}

/** Tokens (letras/dígitos) já normalizados. */
export function tokenize(s: string): string[] {
  const t = foldCase(s);
  const out: string[] = [];
  for (const raw of t.split(/[^a-z0-9]+/)) {
    if (raw) out.push(raw);
  }
  return out;
}

/** Primeiro token normalizado da frase ('' se vazia). */
export function firstToken(s: string): string {
  const t = tokenize(s);
  return t.length > 0 ? t[0] : '';
}

/** Último token normalizado da frase ('' se vazia). */
export function lastToken(s: string): string {
  const t = tokenize(s);
  return t.length > 0 ? t[t.length - 1] : '';
}

const FINAL_PUNCT = /[.!?…]+["'”’)\]]*\s*$/;

/** Termina em pontuação FINAL (mesmo critério de `transcript.ts`). */
export function endsWithFinalPunct(s: string): boolean {
  return FINAL_PUNCT.test((s ?? '').trim());
}

/** Pergunta de verdade (tem '?' no fim). */
export function isQuestionText(s: string): boolean {
  return /\?["'”’)\]]*\s*$/.test((s ?? '').trim());
}

/** Quantas exclamações a frase tem (sinal de ênfase no texto do ASR). */
export function countExclamations(s: string): number {
  const m = (s ?? '').match(/!/g);
  return m ? m.length : 0;
}

/** Tira pontuação final (headline não leva ponto). */
export function stripTrailingPunct(s: string): string {
  return (s ?? '').replace(/[\s.,;:!…]+$/g, '').trim();
}

/** Primeira letra maiúscula, resto intocado (não estraga sigla nem nome). */
export function capitalizeFirst(s: string): string {
  const t = (s ?? '').trim();
  if (!t) return '';
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** Colapsa espaço e corta em `max` caracteres numa fronteira de palavra. */
export function clampChars(s: string, max: number): string {
  const t = (s ?? '').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const sp = cut.lastIndexOf(' ');
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,;:.\-–—]+$/g, '');
}

// ───────────────────────────────────────────────────────────────────────────
// Números por extenso (PT · EN · ES)
// ───────────────────────────────────────────────────────────────────────────

/**
 * "um/uma/one/uno" ficam DE FORA de propósito: são artigo na maior parte das
 * frases e disparariam "tem número" no vídeo inteiro.
 */
export const NUM_WORDS: ReadonlySet<string> = new Set([
  // pt
  'dois', 'duas', 'tres', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove', 'dez',
  'onze', 'doze', 'treze', 'catorze', 'quatorze', 'quinze', 'dezesseis', 'dezessete',
  'dezoito', 'dezenove', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta',
  'setenta', 'oitenta', 'noventa', 'cem', 'cento', 'duzentos', 'trezentos',
  'quatrocentos', 'quinhentos', 'seiscentos', 'setecentos', 'oitocentos',
  'novecentos', 'mil', 'milhao', 'milhoes', 'bilhao', 'bilhoes', 'trilhao',
  'dobro', 'triplo', 'metade', 'primeiro', 'segundo', 'terceiro',
  // en
  'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven',
  'twelve', 'fifteen', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy',
  'eighty', 'ninety', 'hundred', 'thousand', 'million', 'billion', 'half', 'double',
  // es
  'ciento', 'doscientos', 'quinientos', 'millon', 'millones', 'mitad', 'doble',
]);

/** Multiplicadores de escala — "trinta MIL", "dois MILHÕES". */
export const BIG_NUM_WORDS: ReadonlySet<string> = new Set([
  'mil', 'milhao', 'milhoes', 'bilhao', 'bilhoes', 'trilhao',
  'thousand', 'million', 'billion',
  'millon', 'millones',
]);

/** Unidades de tempo (pra "6 anos", "3 meses"). */
export const TIME_UNITS: ReadonlySet<string> = new Set([
  'ano', 'anos', 'mes', 'meses', 'dia', 'dias', 'hora', 'horas', 'minuto', 'minutos',
  'semana', 'semanas', 'segundo', 'segundos', 'decada', 'decadas',
  'year', 'years', 'month', 'months', 'day', 'days', 'hour', 'hours', 'minute',
  'minutes', 'week', 'weeks', 'decade', 'decades',
  'ano', 'anos', 'dia', 'dias',
]);

/** Substantivos que fazem uma quantidade virar manchete ("3 erros"). */
export const COUNTABLE_NOUNS: ReadonlySet<string> = new Set([
  'erro', 'erros', 'passo', 'passos', 'dica', 'dicas', 'motivo', 'motivos',
  'razao', 'razoes', 'coisa', 'coisas', 'regra', 'regras', 'jeito', 'jeitos',
  'forma', 'formas', 'tipo', 'tipos', 'nivel', 'niveis', 'fase', 'fases',
  'pessoa', 'pessoas', 'cliente', 'clientes', 'aluno', 'alunos', 'funcionario',
  'funcionarios', 'colaborador', 'colaboradores', 'lojas', 'loja',
  'mistakes', 'steps', 'tips', 'reasons', 'things', 'rules', 'people', 'clients',
  'errores', 'pasos', 'consejos', 'razones', 'cosas', 'reglas', 'personas',
]);

const MONEY_WORDS: ReadonlySet<string> = new Set([
  'reais', 'real', 'dolares', 'dolar', 'euros', 'euro', 'brl', 'usd', 'eur',
  'dollars', 'dollar', 'pounds', 'pesos',
]);

/** Token é número (dígito ou por extenso)? */
export function isNumericToken(t: string): boolean {
  return /^\d[\d.,]*$/.test(t) || NUM_WORDS.has(t);
}

// ───────────────────────────────────────────────────────────────────────────
// Fatos
// ───────────────────────────────────────────────────────────────────────────

export type Facts = {
  /** tem algarismo cru ("30", "2026") */
  hasDigit: boolean;
  /** tem número (algarismo OU por extenso) */
  hasNumber: boolean;
  /** tem escala grande (mil/milhão/bilhão) */
  hasBigNumber: boolean;
  hasMoney: boolean;
  hasPercent: boolean;
  /** quantidade + unidade de tempo ("6 anos") */
  hasTimeQty: boolean;
  /** quantidade + substantivo contável ("3 erros") */
  hasCountQty: boolean;
};

export const NO_FACTS: Facts = {
  hasDigit: false,
  hasNumber: false,
  hasBigNumber: false,
  hasMoney: false,
  hasPercent: false,
  hasTimeQty: false,
  hasCountQty: false,
};

/**
 * ANO não é dado: "em dois mil e dezenove" e "em 2019" viravam "dois mil" na
 * manchete. Mascarar antes de ler os fatos resolve nos dois formatos.
 */
const YEAR_RE =
  /(?:19|20)\d{2}|dois\s+mil(?:\s+e\s+[a-zà-ÿ]+)?|mil\s+(?:novecentos|oitocentos)(?:\s+e\s+[a-zà-ÿ]+)*|two\s+thousand(?:\s+and\s+[a-z]+)?/gi;

export function maskYears(text: string): string {
  return (text ?? '').replace(YEAR_RE, (m) => ' '.repeat(m.length));
}

const MONEY_SYMBOL_RE = /(?:r\$|us\$|u\$|\$|€|£)\s?\d/i;
const PERCENT_RE = /\d\s*%|\bpor\s?cento\b|\bporcento\b|\bpercent\b|\bpor\s?ciento\b/i;

/** Lê os fatos de um texto (uma frase ou o corte inteiro). */
export function readFacts(text: string): Facts {
  const raw = maskYears(text ?? '');
  const folded = foldCase(raw);
  const toks = tokenize(raw);

  let hasDigit = false;
  let hasNumber = false;
  let hasBigNumber = false;
  let hasMoney = MONEY_SYMBOL_RE.test(folded);
  let hasTimeQty = false;
  let hasCountQty = false;

  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    const numeric = isNumericToken(t);
    if (/^\d/.test(t)) hasDigit = true;
    if (numeric) hasNumber = true;
    if (BIG_NUM_WORDS.has(t)) hasBigNumber = true;
    if (MONEY_WORDS.has(t)) hasMoney = true;
    if (!numeric) continue;
    // olha até 2 tokens à frente ("trinta milhões DE REAIS", "seis anos")
    for (let k = 1; k <= 3 && i + k < toks.length; k++) {
      const nx = toks[i + k];
      if (TIME_UNITS.has(nx)) {
        hasTimeQty = true;
        break;
      }
      if (COUNTABLE_NOUNS.has(nx)) {
        hasCountQty = true;
        break;
      }
      if (MONEY_WORDS.has(nx)) {
        hasMoney = true;
        break;
      }
      if (!BIG_NUM_WORDS.has(nx) && nx !== 'de' && nx !== 'e' && nx !== 'of') break;
    }
  }

  return {
    hasDigit,
    hasNumber,
    hasBigNumber,
    hasMoney,
    hasPercent: PERCENT_RE.test(folded),
    hasTimeQty,
    hasCountQty,
  };
}

/** União de dois conjuntos de fatos (corte = soma das frases). */
export function mergeFacts(a: Facts, b: Facts): Facts {
  return {
    hasDigit: a.hasDigit || b.hasDigit,
    hasNumber: a.hasNumber || b.hasNumber,
    hasBigNumber: a.hasBigNumber || b.hasBigNumber,
    hasMoney: a.hasMoney || b.hasMoney,
    hasPercent: a.hasPercent || b.hasPercent,
    hasTimeQty: a.hasTimeQty || b.hasTimeQty,
    hasCountQty: a.hasCountQty || b.hasCountQty,
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Extração do "dado" pra headline (`"<dado>: <payoff>"`)
// ───────────────────────────────────────────────────────────────────────────

// Fonte dos números por extenso NO TEXTO ORIGINAL (com acento) — a headline
// tem que sair escrita como a pessoa falou, não normalizada.
// ORDEM IMPORTA em toda alternância: a mais LONGA vem primeiro, senão "mil"
// casa dentro de "milhões" e "dois milhões" sai da headline como "dois mil".
const NUM_SRC =
  '\\d[\\d.,]*|dezenove|dezoito|dezessete|dezesseis|quinze|treze|doze|onze|dez|' +
  'dois|duas|tr[êe]s|quatro|cinco|seis|sete|oito|nove|' +
  'vinte|trinta|quarenta|cinquenta|cinq[üu]enta|sessenta|setenta|oitenta|noventa|' +
  'cento|cem|duzentos|trezentos|quinhentos|' +
  'milh[õo]es|milh[ãa]o|bilh[õo]es|bilh[ãa]o|mil|' +
  'twenty|thirty|fifty|hundred|thousand|million|billion|' +
  'three|seven|eight|four|five|nine|two|six|ten|' +
  'ciento|millones|mill[óo]n';
const SCALE_SRC = 'mil|milh[ãa]o|milh[õo]es|bilh[ãa]o|bilh[õo]es|thousand|million|billion|mill[óo]n|millones';
const TIME_SRC =
  'anos?|meses|m[êe]s|dias?|horas?|minutos?|semanas?|d[ée]cadas?|' +
  'years?|months?|days?|hours?|minutes?|weeks?|a[ñn]os?';
const COUNT_SRC =
  'erros?|passos?|dicas?|motivos?|raz[õo]es|coisas?|regras?|jeitos?|n[íi]veis|n[íi]vel|' +
  'fases?|clientes?|alunos?|funcion[áa]rios?|colaboradores?|lojas?|' +
  'mistakes|steps|tips|reasons|things|rules|clients';
const MONEY_SRC = 'reais|d[óo]lares|euros|dollars|pesos';

/** Regexes em ORDEM DE FORÇA — o 1º que casar vira o "dado" da headline. */
const FACT_PATTERNS: RegExp[] = [
  // R$ 30 milhões · US$ 1,2 milhão
  new RegExp(`(?:R\\$|US\\$|U\\$|\\$|€|£)\\s?\\d[\\d.,]*(?:\\s+(?:${SCALE_SRC})\\b)?`, 'i'),
  // trinta milhões de reais · 200 mil dólares
  new RegExp(`\\b(?:${NUM_SRC})\\b(?:\\s+(?:${SCALE_SRC})\\b)?(?:\\s+de)?\\s+(?:${MONEY_SRC})\\b`, 'i'),
  // 47% · quarenta por cento
  new RegExp(`\\b(?:${NUM_SRC})\\s?%|\\b(?:${NUM_SRC})\\b\\s+por\\s?cento\\b`, 'i'),
  // 3 erros · cinco passos
  new RegExp(`\\b(?:${NUM_SRC})\\b\\s+(?:${COUNT_SRC})\\b`, 'i'),
  // trinta milhões (escala sem unidade) — vem antes de tempo: dado mais forte
  new RegExp(`\\b(?:${NUM_SRC})\\b\\s+(?:${SCALE_SRC})\\b`, 'i'),
  // seis anos · 18 meses
  new RegExp(`\\b(?:${NUM_SRC})\\b\\s+(?:${TIME_SRC})\\b`, 'i'),
];

/**
 * O dado mais forte dito no texto, na grafia original ("R$ 30 milhões",
 * "seis anos", "47%"). `null` quando não há dado — e aí a headline usa outro
 * molde. NUNCA inventa: só recorta o que está escrito.
 */
export function extractFactPhrase(text: string): string | null {
  const t = maskYears(text ?? '').replace(/\s+/g, ' ');
  if (!t) return null;
  for (const re of FACT_PATTERNS) {
    const m = re.exec(t);
    if (m && m[0]) {
      const found = m[0].replace(/\s+/g, ' ').trim();
      if (found.length >= 2 && found.length <= 40) return found;
    }
  }
  return null;
}
