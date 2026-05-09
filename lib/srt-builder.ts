/**
 * SRT builder — alinha copy original com timestamps de transcricao
 * (AssemblyAI ou Groq Whisper). Algoritmo compartilhado entre
 * /api/copy-srt/match e /api/mind-ads/transcribe-srt.
 */

export type Word = {
  text: string;
  start: number; // millis
  end: number;   // millis
};

/**
 * Algoritmo:
 *   1. Tokeniza copy preservando pontuacao
 *   2. Mapping linear: palavra i da copy → palavra j..k do transcript
 *   3. Agrupa em legendas (max 7 palavras OU 4s OU pontuacao final)
 *   4. Formata como SRT (HH:MM:SS,mmm)
 */
export function buildSrtFromCopyAndWords(copy: string, words: Word[]): string {
  const copyTokens = copy
    .replace(/\s+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0);

  if (copyTokens.length === 0 || words.length === 0) return '';

  const N = copyTokens.length;
  const M = words.length;

  const startTimes: number[] = [];
  const endTimes: number[] = [];
  for (let i = 0; i < N; i++) {
    const j = Math.floor((i * M) / N);
    const k = Math.max(j, Math.floor(((i + 1) * M) / N) - 1);
    startTimes.push(words[Math.min(j, M - 1)].start);
    endTimes.push(words[Math.min(k, M - 1)].end);
  }

  type Subtitle = { start: number; end: number; text: string };
  const subs: Subtitle[] = [];
  let group: number[] = [];
  let groupStart = startTimes[0];

  function flush() {
    if (group.length === 0) return;
    const text = group.map((idx) => copyTokens[idx]).join(' ');
    const end = endTimes[group[group.length - 1]];
    subs.push({ start: groupStart, end, text });
    group = [];
  }

  for (let i = 0; i < N; i++) {
    if (group.length === 0) groupStart = startTimes[i];
    group.push(i);

    const tok = copyTokens[i];
    const endsSentence = /[.!?]$/.test(tok);
    const groupDur = (endTimes[i] - groupStart) / 1000;

    if (group.length >= 7 || groupDur >= 4 || endsSentence) {
      flush();
    }
  }
  flush();

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
