/**
 * lib/lipsync-chunk-plan — a CONTA da divisão do Lipsync Video to Video.
 *
 * Pura (sem ffmpeg, sem DOM): recebe os pacotes do vídeo de rosto, as pausas
 * do áudio e a duração, e devolve ONDE cortar. Quem corta de verdade é o
 * lib/lipsync-pipeline. Separado pra ser testável no node.
 *
 * Por que existe (07.10): o motor tem teto de TEMPO por geração (~180s) e o
 * nosso storage tem teto de TAMANHO (~50MB). Até aqui só o ÁUDIO era dividido;
 * o rosto ia INTEIRO pra todo trecho. Um rosto de 3:54 / 88MB nunca cabia no
 * upload — a pré-produção gastava minutos comprimindo e o disparo morria antes
 * de chegar no motor. Agora o rosto é dividido NOS MESMOS pontos do áudio, e
 * cada trecho respeita os dois tetos por construção.
 */

/** Teto de cada trecho (s). O motor aceita ~180s por geração — 10s de folga. */
export const MAX_SEG_SEC = 170;
/** Janela (±s) em volta do ponto ideal onde a gente procura pausa/keyframe. */
export const CUT_WINDOW_SEC = 15;
/** Duração-alvo de um trecho: mesmo com o corte deslizando a janela inteira
 *  pros dois lados, nenhum trecho passa de MAX_SEG_SEC. */
export const TARGET_SEG_SEC = MAX_SEG_SEC - 2 * CUT_WINDOW_SEC;
/** Trecho mínimo — nunca sobra um caco de 2s no fim. */
export const MIN_SEG_SEC = 8;
/** Em CÓPIA, aceitar trechos de até ~30s antes de desistir pro re-encode:
 *  um rosto de celular a 10 Mbps só cabe em trechos de ~36s, e N gerações a
 *  mais custam bem menos que re-encodar minutos de 1080p no navegador. */
export const MIN_COPY_SEG_SEC = 30;
/** Bytes de vídeo por trecho COPIADO. O storage corta ~50MB e a pré-produção
 *  mira 44MB; o índice do mp4 soma uns KB por cima disto. */
export const COPY_SEG_BUDGET = 43 * 1024 * 1024;
/** O rosto precisa cobrir o áudio (com essa tolerância) pra ser dividido
 *  junto. Mais curto que isso = clipe de LOOP: vai inteiro, como sempre foi. */
export const FACE_COVER_TOLERANCE_SEC = 1.5;

export type Packet = { t: number; size: number; key: boolean };
export type Silence = { start: number; end: number };
export type FaceInfo = { codec: string; width: number; height: number; packets: Packet[]; durationSec: number };

/**
 * `copy`   = corta em KEYFRAME sem re-encode (segundos, zero perda).
 * `encode` = re-encoda cada trecho (fonte que não dá pra copiar).
 * `cuts`   = pontos de corte (s), sem o 0 e sem o fim.
 * `faceEnd`= onde o rosto para (s) quando ele é bem mais longo que o áudio;
 *            null = vai até o fim do arquivo.
 */
export type FacePlan = { mode: 'copy' | 'encode'; cuts: number[]; faceEnd: number | null };

/**
 * Lê a saída do muxer `framecrc` do ffmpeg (`-c copy -f framecrc`): um pacote
 * por linha, SEM decodificar nada — é instantâneo até em vídeo de 300MB.
 *   #tb 0: 1/15360
 *   #codec_id 0: hevc
 *   #dimensions 0: 1080x1920
 *   0,          0,          0,      512,    56102, 0xf5741b13
 *   0,        512,       1024,      512,     8123, 0x1a2b3c4d, F=0x0
 * Pacote SEM `F=` é keyframe (o muxer só escreve as flags quando elas não são
 * exatamente "KEY"). Com `F=`, o bit 0x1 ainda diz se é keyframe.
 */
export function parseFramecrc(text: string): FaceInfo {
  let tbNum = 0;
  let tbDen = 0;
  let codec = '';
  let width = 0;
  let height = 0;
  const packets: Packet[] = [];
  let end = 0;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#')) {
      const tb = /^#tb 0:\s*(\d+)\/(\d+)/.exec(line);
      if (tb) { tbNum = +tb[1]; tbDen = +tb[2]; continue; }
      const cd = /^#codec_id 0:\s*(\S+)/.exec(line);
      if (cd) { codec = cd[1].toLowerCase(); continue; }
      const dm = /^#dimensions 0:\s*(\d+)x(\d+)/.exec(line);
      if (dm) { width = +dm[1]; height = +dm[2]; }
      continue;
    }
    const f = line.split(',').map((s) => s.trim());
    if (f.length < 6 || f[0] !== '0' || !tbDen) continue;
    const dts = Number(f[1]);
    let pts = Number(f[2]);
    // AV_NOPTS_VALUE sai como um int64 enorme e negativo → usa o dts.
    if (!Number.isFinite(pts) || pts < -1e15) pts = dts;
    const dur = Number(f[3]);
    const size = Number(f[4]);
    if (!Number.isFinite(pts) || !Number.isFinite(size)) continue;
    const flags = f.find((x) => x.startsWith('F='));
    const key = flags ? (parseInt(flags.slice(2), 16) & 1) === 1 : true;
    const t = (pts * tbNum) / tbDen;
    packets.push({ t, size, key });
    const e = ((pts + (Number.isFinite(dur) ? dur : 0)) * tbNum) / tbDen;
    if (e > end) end = e;
  }
  return { codec, width, height, packets, durationSec: end };
}

/** 0 se `t` cai dentro de uma pausa; senão a distância (s) até a pausa mais perto. */
export function pauseDistance(t: number, silences: Silence[]): number {
  let best = Infinity;
  for (const s of silences) {
    if (t >= s.start && t <= s.end) return 0;
    best = Math.min(best, Math.abs(t - s.start), Math.abs(t - s.end));
  }
  return best;
}

/** Bytes de vídeo entre [a, b) somando os pacotes reais. */
export function bytesBetween(packets: Packet[], a: number, b: number): number {
  let sum = 0;
  for (const p of packets) if (p.t >= a - 1e-6 && p.t < b - 1e-6) sum += p.size;
  return sum;
}

/**
 * Escolhe `n - 1` cortes, um perto de cada ponto ideal (k·dur/n). Com `keys`
 * só vale cortar EM keyframe (modo cópia); sem `keys` qualquer instante vale
 * (modo re-encode, onde o corte cai no MEIO da pausa). Entre os candidatos
 * vence o que está numa pausa da fala — a costura some — e, empatado, o mais
 * perto do ideal. Devolve null se não há candidato válido.
 */
function pickCuts(n: number, audioSec: number, keys: number[] | null, silences: Silence[]): number[] | null {
  const cuts: number[] = [];
  let prev = 0;
  for (let k = 1; k < n; k++) {
    const ideal = (k * audioSec) / n;
    const lo = Math.max(prev + MIN_SEG_SEC, ideal - CUT_WINDOW_SEC);
    const hi = Math.min(prev + MAX_SEG_SEC, ideal + CUT_WINDOW_SEC, audioSec - MIN_SEG_SEC);
    if (hi < lo) return null;
    let cands: number[];
    if (keys) {
      cands = keys.filter((t) => t >= lo && t <= hi);
    } else {
      cands = silences.map((s) => (s.start + s.end) / 2).filter((t) => t >= lo && t <= hi);
      if (!cands.length) cands = [Math.min(hi, Math.max(lo, ideal))];
    }
    if (!cands.length) return null;
    const score = (t: number) => Math.min(pauseDistance(t, silences), 6) + 0.05 * Math.abs(t - ideal);
    const best = cands.reduce((a, b) => (score(b) < score(a) ? b : a));
    cuts.push(best);
    prev = best;
  }
  if (audioSec - prev > MAX_SEG_SEC) return null;
  return cuts;
}

/**
 * O plano inteiro. `copyable` = o vídeo pode ir por cópia (h264/hevc em
 * mp4/mov). Tenta o MENOR número de trechos que respeita tempo E tamanho em
 * cópia; se nenhum serve (bitrate absurdo, GOP gigante), cai pro re-encode.
 */
export function planFaceCuts(p: {
  face: FaceInfo;
  silences: Silence[];
  audioSec: number;
  copyable: boolean;
}): FacePlan {
  const { face, silences, audioSec } = p;
  const nMin = Math.max(2, Math.ceil(audioSec / TARGET_SEG_SEC));
  const faceSec = face.durationSec;
  const keys = Array.from(new Set(face.packets.filter((x) => x.key).map((x) => x.t))).sort((a, b) => a - b);

  if (p.copyable && keys.length >= 2) {
    // Rosto bem mais longo que o áudio: para no 1º keyframe depois do fim da
    // fala (o resto nunca seria usado e só pesaria o último trecho).
    let faceEnd: number | null = null;
    if (faceSec > audioSec + 2) {
      const k = keys.find((t) => t >= audioSec + 0.5);
      if (k !== undefined && k < faceSec - 0.5) faceEnd = k;
    }
    const nMax = Math.max(nMin + 8, Math.ceil(audioSec / MIN_COPY_SEG_SEC));
    for (let n = nMin; n <= nMax; n++) {
      const cuts = pickCuts(n, audioSec, keys, silences);
      if (!cuts) continue;
      const bounds = [0, ...cuts, faceEnd ?? Infinity];
      let fits = true;
      for (let i = 0; i < bounds.length - 1; i++) {
        if (bytesBetween(face.packets, bounds[i], bounds[i + 1]) > COPY_SEG_BUDGET) { fits = false; break; }
      }
      // O último trecho de ROSTO (que pode ir além do áudio até o keyframe
      // seguinte) também não passa do teto de tempo.
      const lastFace = (faceEnd ?? faceSec) - cuts[cuts.length - 1];
      if (fits && lastFace <= MAX_SEG_SEC) return { mode: 'copy', cuts, faceEnd };
    }
  }

  const cuts = pickCuts(nMin, audioSec, null, silences)
    // Nunca deveria acontecer (a conta garante candidato), mas sem plano não há
    // disparo: corta no ideal.
    ?? Array.from({ length: nMin - 1 }, (_, i) => ((i + 1) * audioSec) / nMin);
  return { mode: 'encode', cuts, faceEnd: faceSec > audioSec + 2 ? audioSec + 0.5 : null };
}

/** O rosto cobre o áudio inteiro? (senão é clipe de loop e vai inteiro.) */
export function faceCoversAudio(faceSec: number, audioSec: number): boolean {
  return faceSec > 0 && faceSec >= audioSec - FACE_COVER_TOLERANCE_SEC;
}
