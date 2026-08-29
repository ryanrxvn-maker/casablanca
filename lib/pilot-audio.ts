/**
 * ÁUDIO POR AVATAR no ClickUp Pilot.
 *
 * Três responsabilidades, todas a serviço do disparo com áudio upado:
 *
 *  1. COMPARAR o áudio com a copy do Docs (compararCopyComAudio): o ASR do
 *     próprio HeyGen (fast_asr, devolvido pelo uploadAudio) vira um diff
 *     palavra-a-palavra contra a copy. NUNCA bloqueia o disparo — só acusa,
 *     dizendo exatamente O QUE difere ("na copy: X · no áudio: Y").
 *
 *  2. PONTOS DE CORTE alinhados ao texto (pontosDeCorteDoAudio): o áudio de um
 *     avatar é UM arquivo, mas o disparo em Avatar III sai em N takes (mesma
 *     divisão da copy). O corte cai na FRONTEIRA entre os textos dos takes,
 *     achada pelas palavras do ASR — e ajustada pra PAUSA mais funda por perto,
 *     então nenhuma fala é cortada no meio (é a régua da ferramenta Dividir
 *     áudios, só que guiada pela copy). Sem ASR, cai na proporção de texto.
 *
 *  3. DIVIDIR de fato (dividirAudioPorPartes): decodifica, corta nos pontos
 *     (com snap de pausa) e assa um WAV por take. Avatar IV/V não passa aqui —
 *     o plano já colapsou o slot em take único e o arquivo vai inteiro.
 */

import {
  decodeAudioRobust,
  detectSilences,
  encodeWAV,
  type SilenceRegion,
} from './audio-engine';

/* ═══════════════ ASR (HeyGen fast_asr) — shape defensivo ═══════════════ */

export type PalavraAsr = { texto: string; inicio: number; fim: number };

/** Normaliza o array `words` do fast_asr do HeyGen. O shape varia
 *  ({word|text|w, start|start_time|begin_time, end|end_time}) — cobre todos e
 *  descarta entrada sem tempo. Ordena por início. */
export function normalizarPalavrasAsr(raw: unknown[] | null | undefined): PalavraAsr[] {
  if (!Array.isArray(raw)) return [];
  const out: PalavraAsr[] = [];
  for (const w of raw as Array<Record<string, unknown>>) {
    if (!w || typeof w !== 'object') continue;
    const texto = String((w.word ?? w.text ?? w.w ?? '') || '').trim();
    const inicio = Number(w.start ?? w.start_time ?? w.begin_time ?? w.begin ?? NaN);
    const fim = Number(w.end ?? w.end_time ?? w.finish_time ?? NaN);
    if (!texto || !Number.isFinite(inicio) || !Number.isFinite(fim) || fim < inicio) continue;
    out.push({ texto, inicio, fim });
  }
  out.sort((a, b) => a.inicio - b.inicio);
  return out;
}

/* ═══════════════ Diff copy × áudio (palavra a palavra) ═══════════════ */

/** Tokeniza pra comparação: minúsculas, sem acento, sem pontuação. Números
 *  ficam (10 ≠ 100 importa). */
export function normTokens(s: string): string[] {
  return String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    // hífen/travessão viram espaço ANTES de remover pontuação (guarda-chuva → 2 tokens)
    .replace(/[-–—]/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

export type TrechoDiff = {
  tipo: 'faltou-no-audio' | 'sobrou-no-audio' | 'trocado';
  /** O que a copy diz nesse trecho (vazio quando só sobrou no áudio). */
  copy?: string;
  /** O que o áudio diz nesse trecho (vazio quando faltou no áudio). */
  audio?: string;
};

export type DiffCopyAudio = {
  igual: boolean;
  /** 0..1 — 2·LCS / (len(copy)+len(audio)). */
  similaridade: number;
  trechos: TrechoDiff[];
  resumo: string;
};

/** Diff palavra-a-palavra (LCS) entre a copy do Docs e o texto que o ASR ouviu
 *  no áudio. Trechos adjacentes de remoção+inserção viram um "trocado" só —
 *  é o formato que o olho lê ("na copy: sem pílula · no áudio: sem cápsula"). */
export function compararCopyComAudio(copy: string, asrText: string): DiffCopyAudio {
  const a = normTokens(copy);
  const b = normTokens(asrText);
  if (a.length === 0 && b.length === 0) {
    return { igual: true, similaridade: 1, trechos: [], resumo: 'Sem texto pra comparar.' };
  }
  // LCS por programação dinâmica. Guarda de tamanho: copy de AD tem centenas de
  // palavras, nunca dezenas de milhares — mas se vier um monstro, degrada com
  // clareza em vez de travar a aba.
  const MAX = 4000;
  const at = a.slice(0, MAX);
  const bt = b.slice(0, MAX);
  const n = at.length;
  const m = bt.length;
  const dp: Uint16Array[] = new Array(n + 1);
  for (let i = 0; i <= n; i++) dp[i] = new Uint16Array(m + 1);
  for (let i = 1; i <= n; i++) {
    const ai = at[i - 1];
    const row = dp[i];
    const prev = dp[i - 1];
    for (let j = 1; j <= m; j++) {
      row[j] = ai === bt[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], row[j - 1]);
    }
  }
  // Backtrack → operações
  type Op = { t: 'igual' | 'del' | 'ins'; w: string };
  const ops: Op[] = [];
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    if (at[i - 1] === bt[j - 1]) {
      ops.push({ t: 'igual', w: at[i - 1] });
      i--; j--;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      ops.push({ t: 'del', w: at[i - 1] });
      i--;
    } else {
      ops.push({ t: 'ins', w: bt[j - 1] });
      j--;
    }
  }
  while (i > 0) { ops.push({ t: 'del', w: at[--i] }); }
  while (j > 0) { ops.push({ t: 'ins', w: bt[--j] }); }
  ops.reverse();

  // Agrupa runs de del/ins em trechos legíveis.
  const trechos: TrechoDiff[] = [];
  let delRun: string[] = [];
  let insRun: string[] = [];
  const flush = () => {
    if (delRun.length === 0 && insRun.length === 0) return;
    if (delRun.length && insRun.length) {
      trechos.push({ tipo: 'trocado', copy: delRun.join(' '), audio: insRun.join(' ') });
    } else if (delRun.length) {
      trechos.push({ tipo: 'faltou-no-audio', copy: delRun.join(' ') });
    } else {
      trechos.push({ tipo: 'sobrou-no-audio', audio: insRun.join(' ') });
    }
    delRun = [];
    insRun = [];
  };
  for (const op of ops) {
    if (op.t === 'igual') { flush(); continue; }
    if (op.t === 'del') delRun.push(op.w);
    else insRun.push(op.w);
  }
  flush();

  const lcs = dp[n][m];
  const similaridade = (2 * lcs) / (at.length + bt.length || 1);
  const igual = trechos.length === 0;
  let resumo: string;
  if (igual) {
    resumo = 'O áudio bate com a copy do Docs, palavra por palavra.';
  } else {
    const faltas = trechos.filter((t) => t.tipo === 'faltou-no-audio').length;
    const sobras = trechos.filter((t) => t.tipo === 'sobrou-no-audio').length;
    const trocas = trechos.filter((t) => t.tipo === 'trocado').length;
    const partes: string[] = [];
    if (trocas) partes.push(`${trocas} trecho${trocas === 1 ? '' : 's'} diferente${trocas === 1 ? '' : 's'}`);
    if (faltas) partes.push(`${faltas} da copy que não está${faltas === 1 ? '' : 'ão'} no áudio`);
    if (sobras) partes.push(`${sobras} do áudio que não está${sobras === 1 ? '' : 'ão'} na copy`);
    resumo = `Áudio ≠ copy: ${partes.join(', ')} (${Math.round(similaridade * 100)}% igual).`;
  }
  return { igual, similaridade, trechos, resumo };
}

/* ═══════════════ Pontos de corte guiados pela copy ═══════════════ */

/** Score de match entre uma janela de palavras do ASR e os tokens de um take —
 *  usado pra achar a fronteira mais provável. Interno, exportado só pro teste. */
export function _fronteiraPorTokens(
  tokensPorParte: string[][],
  palavras: PalavraAsr[],
): number[] {
  // Índice-alvo por proporção de palavras da copy, refinado depois pela pausa.
  const total = palavras.length;
  const contagens = tokensPorParte.map((t) => Math.max(1, t.length));
  const soma = contagens.reduce((s, c) => s + c, 0);
  const alvos: number[] = [];
  let acc = 0;
  for (let i = 0; i < contagens.length - 1; i++) {
    acc += contagens[i];
    alvos.push(Math.min(total - 1, Math.max(1, Math.round((acc / soma) * total))));
  }
  return alvos;
}

/** Calcula os N-1 tempos de corte (segundos) pra dividir o áudio de um avatar
 *  nos N takes da copy.
 *
 *  Com ASR: fronteira-alvo por proporção de palavras + procura, numa janela ao
 *  redor do alvo, o MAIOR gap entre fim de uma palavra e início da seguinte —
 *  o corte cai no meio dessa pausa (nunca dentro de fala ouvida).
 *  Sem ASR: proporção de caracteres do texto × duração (o chamador ainda faz
 *  snap de pausa no sinal via dividirAudioPorPartes).
 */
export function pontosDeCorteDoAudio(
  partTexts: string[],
  duracaoSec: number,
  palavras?: PalavraAsr[] | null,
): number[] {
  const n = partTexts.length;
  if (n <= 1 || duracaoSec <= 0) return [];
  const ws = normalizarPalavrasAsr(palavras as unknown[] | null | undefined);

  if (ws.length >= n * 2) {
    const tokensPorParte = partTexts.map(normTokens);
    const alvos = _fronteiraPorTokens(tokensPorParte, ws);
    const cortes: number[] = [];
    let minIdx = 1; // fronteiras nunca se cruzam
    for (const alvo of alvos) {
      const janela = Math.max(3, Math.round(ws.length * 0.12));
      const lo = Math.max(minIdx, alvo - janela);
      const hi = Math.min(ws.length - 1, alvo + janela);
      let melhorIdx = Math.min(Math.max(alvo, minIdx), ws.length - 1);
      let melhorGap = -1;
      for (let k = lo; k <= hi; k++) {
        const gap = ws[k].inicio - ws[k - 1].fim;
        // Distância do alvo desempata: gap ganha, mas um gap só 10% maior não
        // compensa fugir pro outro lado do texto.
        const penalidade = Math.abs(k - alvo) / Math.max(1, janela) * 0.08;
        const score = gap - penalidade;
        if (score > melhorGap) {
          melhorGap = score;
          melhorIdx = k;
        }
      }
      const t = (ws[melhorIdx - 1].fim + ws[melhorIdx].inicio) / 2;
      cortes.push(Math.min(duracaoSec - 0.05, Math.max(0.05, t)));
      minIdx = melhorIdx + 1;
    }
    // Monotônico por garantia (janelas podem encostar em áudio muito curto).
    for (let k = 1; k < cortes.length; k++) {
      if (cortes[k] <= cortes[k - 1]) cortes[k] = Math.min(duracaoSec - 0.05, cortes[k - 1] + 0.2);
    }
    return cortes;
  }

  // Fallback sem ASR: proporção de caracteres falados.
  const pesos = partTexts.map((t) => Math.max(1, normTokens(t).join(' ').length));
  const somaPesos = pesos.reduce((s, p) => s + p, 0);
  const cortes: number[] = [];
  let acc = 0;
  for (let k = 0; k < n - 1; k++) {
    acc += pesos[k];
    cortes.push((acc / somaPesos) * duracaoSec);
  }
  return cortes;
}

/** Ajusta um tempo de corte pra PAUSA detectada mais próxima (meio da pausa).
 *  Sem pausa num raio de `raioSec`, mantém o tempo (melhor cortar no alvo do
 *  texto do que arrastar o corte pra longe). Exportado pro teste. */
export function _snapNaPausa(t: number, pausas: SilenceRegion[], raioSec = 1.6): number {
  let melhor = t;
  let melhorDist = raioSec;
  for (const p of pausas) {
    const meio = (p.start + p.end) / 2;
    // Corte DENTRO da pausa já está seguro — só centraliza.
    if (t >= p.start && t <= p.end) return meio;
    const dist = Math.min(Math.abs(t - p.start), Math.abs(t - p.end));
    if (dist < melhorDist) {
      melhorDist = dist;
      melhor = meio;
    }
  }
  return melhor;
}

/* ═══════════════ Divisão de verdade (browser — AudioBuffer) ═══════════════ */

function fatiarBuffer(buffer: AudioBuffer, fromSample: number, toSample: number): AudioBuffer {
  const len = Math.max(1, toSample - fromSample);
  const out = new AudioBuffer({
    length: len,
    numberOfChannels: buffer.numberOfChannels,
    sampleRate: buffer.sampleRate,
  });
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    out.copyToChannel(buffer.getChannelData(ch).subarray(fromSample, toSample), ch);
  }
  return out;
}

export type ParteDeAudio = { file: File; duracaoSec: number; label: string };

/** Divide o áudio de um avatar nos takes da copy, sem cortar fala.
 *
 *  - 1 take só → devolve o ARQUIVO ORIGINAL intacto (sem reencode).
 *  - N takes → corta nas fronteiras do texto (ASR quando disponível) com snap
 *    pra pausa detectada no sinal, e assa um WAV por take.
 */
export async function dividirAudioPorPartes(
  file: File | Blob,
  partes: Array<{ label: string; text: string }>,
  palavras?: PalavraAsr[] | null,
): Promise<ParteDeAudio[]> {
  const nome = (file as File).name || 'audio';
  if (partes.length <= 1) {
    const f = file instanceof File ? file : new File([file], nome, { type: file.type || 'audio/mpeg' });
    return [{ file: f, duracaoSec: 0, label: partes[0]?.label || 'AUDIO' }];
  }
  const buffer = await decodeAudioRobust(file as File, () => {});
  const cortesBase = pontosDeCorteDoAudio(partes.map((p) => p.text), buffer.duration, palavras);
  const pausas = detectSilences(buffer);
  const temAsr = normalizarPalavrasAsr(palavras as unknown[] | null | undefined).length > 0;
  // Com ASR o corte já caiu num gap entre palavras — o snap só centraliza se
  // uma pausa detectada envolver o ponto. Sem ASR, o snap é quem protege a fala.
  const cortes = cortesBase.map((t) => _snapNaPausa(t, pausas, temAsr ? 0.6 : 1.6));
  for (let k = 1; k < cortes.length; k++) {
    if (cortes[k] <= cortes[k - 1] + 0.05) cortes[k] = Math.min(buffer.duration - 0.05, cortes[k - 1] + 0.2);
  }
  const sr = buffer.sampleRate;
  const out: ParteDeAudio[] = [];
  let prev = 0;
  for (let k = 0; k < partes.length; k++) {
    const fim = k < cortes.length ? Math.min(buffer.length, Math.max(prev + 1, Math.round(cortes[k] * sr))) : buffer.length;
    const fatia = fatiarBuffer(buffer, prev, fim);
    const blob = encodeWAV(fatia);
    out.push({
      file: new File([blob], `${nome.replace(/\.[^.]+$/, '')}_${k + 1}.wav`, { type: 'audio/wav' }),
      duracaoSec: fatia.duration,
      label: partes[k].label,
    });
    prev = fim;
  }
  return out;
}
