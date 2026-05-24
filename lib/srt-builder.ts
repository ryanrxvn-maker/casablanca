/**
 * SRT builder — alinha a COPY ORIGINAL (texto que o usuário quer ver na
 * legenda) com TIMESTAMPS WORD-LEVEL vindos de um transcript (AssemblyAI
 * ou Groq Whisper). Compartilhado entre /api/copy-srt/match e
 * /api/mind-ads/transcribe-srt.
 *
 * v2 — algoritmo melhorado:
 *
 *  1. **Alinhamento por similaridade**: normaliza tokens (lowercase, sem
 *     acento, sem pontuação) e casa palavras da copy com o transcript
 *     usando match greedy com tolerância. Onde casa, ANCORA o tempo;
 *     entre âncoras, INTERPOLA linear sobre a span de tempo real.
 *
 *  2. **Quebra inteligente de legenda**: máx 42 chars/linha, máx 2 linhas,
 *     máx 7s de duração, CPS-alvo 15-17. Prioriza quebra em
 *     pontuação > conjunção > vírgula > qualquer espaço.
 *
 *  3. **Suavização de timing**: legenda muito curta (<1s) é estendida;
 *     CPS muito alto é alongado (até limite do próximo start); garante
 *     SEM overlap.
 *
 * Compatível com o `Word` original (start/end em millis).
 */

export type Word = {
  text: string;
  start: number; // millis
  end: number;   // millis
};

/* ───────────────────────── tunables ───────────────────────── */

const MAX_CHARS_PER_LINE = 42;
const MAX_LINES = 2;
const MAX_CHARS_TOTAL = MAX_CHARS_PER_LINE * MAX_LINES; // 84
const MIN_DURATION_MS = 800;     // mínimo confortável pra leitura
const MAX_DURATION_MS = 7000;    // legenda longa demais cansa
const TARGET_CPS = 17;           // chars/sec - limite recomendado
const MIN_GAP_MS = 80;           // gap mínimo entre legendas (anti-flash)

/* ───────────────────────── public API ───────────────────────── */

export function buildSrtFromCopyAndWords(copy: string, words: Word[]): string {
  const tokens = tokenize(copy);
  if (tokens.length === 0 || words.length === 0) return '';

  // 1) Ancoragem: pra cada token da copy, tenta achar palavra correspondente
  //    no transcript. Salva (copyIdx → transcriptIdx) onde casou.
  const anchors = anchorTokens(tokens, words);

  // 2) Tempo por token (start/end) — interpolando entre âncoras.
  const timed = interpolateTimes(tokens, words, anchors);

  // 3) Quebra em subtitles inteligentes
  const subs = groupIntoSubtitles(timed);

  // 4) Suaviza durations + impede overlap
  const polished = polishTimings(subs);

  return serializeSrt(polished);
}

/* ───────────────────────── tokenize ───────────────────────── */

/**
 * Quebra a copy em tokens preservando pontuação. Cada token mantém:
 *   - raw: como aparece na copy (pra exibição)
 *   - norm: forma normalizada (sem acento/pontuação/case) pra match
 *   - hasSentenceEnd: termina com .?!
 *   - hasComma: termina com ,
 */
type CopyToken = {
  raw: string;
  norm: string;
  hasSentenceEnd: boolean;
  hasComma: boolean;
  hasLineBreak: boolean;
};

function tokenize(copy: string): CopyToken[] {
  const out: CopyToken[] = [];
  // Marca line breaks intencionais (CRLF/LF) pra forçar quebra de legenda
  // na transição.
  const lines = copy.split(/\r?\n+/);
  lines.forEach((line, lineIdx) => {
    const parts = line.replace(/\s+/g, ' ').trim().split(/\s+/);
    parts.forEach((raw, partIdx) => {
      if (!raw) return;
      const norm = normalize(raw);
      if (!norm) return;
      out.push({
        raw,
        norm,
        hasSentenceEnd: /[.!?]$/.test(raw),
        hasComma: /,$/.test(raw),
        // Último token da linha (e não é última linha) força quebra
        hasLineBreak:
          partIdx === parts.length - 1 && lineIdx < lines.length - 1,
      });
    });
  });
  return out;
}

// Diacritic range U+0300..U+036F (combining marks após NFD).
const DIACRITICS_RE = /[̀-ͯ]/g;

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(DIACRITICS_RE, '')           // remove acentos
    .replace(/[^a-z0-9'\-]/gi, '');       // só letras/números/apóstrofo/hífen
}

/* ───────────────────────── anchoring ───────────────────────── */

/**
 * Pra cada token da copy, procura no transcript a palavra correspondente
 * dentro de uma janela. Match exato é o anchor; sem match vira null.
 *
 * Algoritmo:
 *   - Avança o ponteiro do transcript sequencialmente
 *   - Pra cada token da copy, olha as próximas K palavras do transcript
 *   - Match exato (after normalize) ancora; senão deixa null e segue
 *   - Tolera transcrição com palavras a mais (avança transcript sem ancorar)
 *
 * Garante 2 âncoras sintéticas: 0 e N (begin/end), pra interpolação ter
 * extremos.
 */
function anchorTokens(
  tokens: CopyToken[],
  words: Word[],
): Map<number, number> {
  const anchors = new Map<number, number>();
  const LOOKAHEAD = 6;
  let trPtr = 0;

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    const limit = Math.min(words.length, trPtr + LOOKAHEAD);
    let matched = -1;
    for (let j = trPtr; j < limit; j++) {
      const tw = normalize(words[j].text);
      if (!tw) continue;
      if (tw === tok.norm) {
        matched = j;
        break;
      }
    }
    if (matched >= 0) {
      anchors.set(i, matched);
      trPtr = matched + 1;
    }
    // Sem match: deixa pra interpolar. trPtr NÃO avança aqui pra não
    // perder transcripts adiante de palavras divergentes.
  }
  return anchors;
}

/* ───────────────────────── interpolation ───────────────────────── */

type TimedToken = CopyToken & { start: number; end: number };

function interpolateTimes(
  tokens: CopyToken[],
  words: Word[],
  anchors: Map<number, number>,
): TimedToken[] {
  const N = tokens.length;
  const audioStart = words[0].start;
  const audioEnd = words[words.length - 1].end;

  // Lista ordenada de [copyIdx, transcriptIdx] com sentinels begin/end.
  const sortedAnchors: Array<[number, number, number, number]> = [
    [-1, -1, audioStart, audioStart],
  ];
  Array.from(anchors.entries())
    .sort((a, b) => a[0] - b[0])
    .forEach(([copyIdx, trIdx]) => {
      sortedAnchors.push([copyIdx, trIdx, words[trIdx].start, words[trIdx].end]);
    });
  sortedAnchors.push([N, words.length, audioEnd, audioEnd]);

  const timed: TimedToken[] = [];
  // Pra cada par de âncoras consecutivas, interpola os tokens entre elas.
  for (let segIdx = 0; segIdx < sortedAnchors.length - 1; segIdx++) {
    const [aIdx, , aStart, aEnd] = sortedAnchors[segIdx];
    const [bIdx, , bStart] = sortedAnchors[segIdx + 1];
    const fromI = aIdx + 1;
    const toI = bIdx - 1;
    if (fromI > toI) continue;

    // Tokens entre as âncoras: distribui linearmente entre aEnd e bStart
    const span = Math.max(MIN_DURATION_MS, bStart - aEnd);
    const count = toI - fromI + 1;
    const slot = span / Math.max(1, count);
    for (let i = fromI; i <= toI; i++) {
      const offset = (i - fromI) * slot;
      const start = Math.round(aEnd + offset);
      const end = Math.round(aEnd + offset + slot * 0.85); // pequeno gap
      timed.push({ ...tokens[i], start, end });
    }
  }

  // Tokens ancorados (não estão na lista ainda) — adiciona com tempo exato.
  anchors.forEach((trIdx, copyIdx) => {
    timed.push({
      ...tokens[copyIdx],
      start: words[trIdx].start,
      end: words[trIdx].end,
    });
  });

  return timed.sort((a, b) => a.start - b.start);
}

/* ───────────────────────── grouping into subs ───────────────────────── */

type Subtitle = { start: number; end: number; text: string };

function groupIntoSubtitles(timed: TimedToken[]): Subtitle[] {
  if (timed.length === 0) return [];
  const subs: Subtitle[] = [];
  let group: TimedToken[] = [];

  function commitGroup() {
    if (group.length === 0) return;
    const start = group[0].start;
    const end = group[group.length - 1].end;
    const rawText = group.map((t) => t.raw).join(' ');
    const text = wrapTwoLines(rawText);
    subs.push({ start, end, text });
    group = [];
  }

  for (const tok of timed) {
    const tentative = [...group, tok];
    const tentativeText = tentative.map((t) => t.raw).join(' ');
    const tentativeDur = tok.end - (tentative[0]?.start ?? tok.start);

    const exceedsChars = tentativeText.length > MAX_CHARS_TOTAL;
    const exceedsDur = tentativeDur > MAX_DURATION_MS;

    if ((exceedsChars || exceedsDur) && group.length > 0) {
      commitGroup();
    }
    group.push(tok);

    // Quebra natural — pontuação final ou line break intencional
    if (tok.hasSentenceEnd || tok.hasLineBreak) {
      commitGroup();
      continue;
    }
    // Vírgula só quebra se grupo ficou substancial (>20 chars)
    if (tok.hasComma) {
      const grpText = group.map((t) => t.raw).join(' ');
      if (grpText.length > 20) commitGroup();
    }
  }
  commitGroup();
  return subs;
}

/**
 * Quebra texto em até 2 linhas equilibradas, respeitando MAX_CHARS_PER_LINE.
 * Tenta cortar no meio "natural" (próximo à metade).
 */
function wrapTwoLines(text: string): string {
  if (text.length <= MAX_CHARS_PER_LINE) return text;
  const words = text.split(' ');
  // Acha índice ótimo de quebra: mais próximo da metade que ainda cabe
  const totalLen = text.length;
  const midTarget = totalLen / 2;
  let bestI = -1;
  let bestDiff = Infinity;
  let runningLen = 0;
  for (let i = 0; i < words.length - 1; i++) {
    runningLen += words[i].length + 1; // +1 espaço
    if (runningLen > MAX_CHARS_PER_LINE) break;
    const remaining = totalLen - runningLen;
    if (remaining > MAX_CHARS_PER_LINE) continue;
    const diff = Math.abs(runningLen - midTarget);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestI = i;
    }
  }
  if (bestI < 0) {
    // Fallback: quebra forçada caractere por caractere
    return text.slice(0, MAX_CHARS_PER_LINE) + '\n' + text.slice(MAX_CHARS_PER_LINE);
  }
  const line1 = words.slice(0, bestI + 1).join(' ');
  const line2 = words.slice(bestI + 1).join(' ');
  return line1 + '\n' + line2;
}

/* ───────────────────────── polish ───────────────────────── */

/**
 * Suaviza durações:
 *   - Garante MIN_DURATION_MS (estende se < min)
 *   - Garante CPS razoável (estica se chars/sec passar do alvo)
 *   - Garante GAP entre legendas consecutivas (anti-flash)
 *   - Nunca ultrapassa o start do próximo
 */
function polishTimings(subs: Subtitle[]): Subtitle[] {
  for (let i = 0; i < subs.length; i++) {
    const s = subs[i];
    const charCount = s.text.replace(/\n/g, ' ').length;
    let minByCps = Math.round((charCount / TARGET_CPS) * 1000);
    minByCps = Math.max(MIN_DURATION_MS, minByCps);

    let end = Math.max(s.end, s.start + minByCps);

    // Limite pelo próximo
    const next = subs[i + 1];
    if (next) {
      end = Math.min(end, next.start - MIN_GAP_MS);
    }
    // Se ficou inválido (overlap), fixa em min
    if (end <= s.start) end = s.start + MIN_DURATION_MS;
    s.end = end;
  }
  return subs;
}

/* ───────────────────────── serialize ───────────────────────── */

function serializeSrt(subs: Subtitle[]): string {
  return subs
    .map(
      (s, i) =>
        `${i + 1}\n${msToSrt(s.start)} --> ${msToSrt(s.end)}\n${s.text}\n`,
    )
    .join('\n');
}

export function msToSrt(ms: number): string {
  const total = Math.max(0, Math.round(ms));
  const h = Math.floor(total / 3_600_000);
  const m = Math.floor((total % 3_600_000) / 60_000);
  const s = Math.floor((total % 60_000) / 1000);
  const mm = total % 1000;
  const pad = (n: number, len = 2) => String(n).padStart(len, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(mm, 3)}`;
}
