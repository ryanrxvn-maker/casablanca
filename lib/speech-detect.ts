/**
 * CASABLANCA — Detector de FALA (o motor da Decupagem)
 *
 * POR QUE ESTE ARQUIVO EXISTE
 * ───────────────────────────
 * O detector antigo (`detectSilences` em audio-engine) decidia tudo por ENERGIA:
 * janela de 20 ms, RMS abaixo de um threshold = silêncio. Só que respiração, ar e
 * ruído de boca têm energia de sobra (−40 a −30 dBFS) e o threshold era capado em
 * −34 dBFS — então respiração NUNCA era silêncio. Pior: ela partia a pausa em duas,
 * e cada metade perdia só as bordas. Medido em material real (gravação humana de
 * 48 s): o detector antigo removia 3% do arquivo; sobravam 28 s de não-fala.
 *
 * COMO ESTE DECIDE
 * ────────────────
 * O que separa voz de respiração não é volume, é PERIODICIDADE: voz tem F0 (as
 * pregas vocais vibram, a onda se repete); respiração/ar/estalo é ruído, não se
 * repete. Por frame de 10 ms medimos:
 *
 *   rms         → energia (piso de segurança: não confundir voz baixa com ruído alto)
 *   periodicity → pico da autocorrelação normalizada na faixa de F0 humano (70–400 Hz)
 *   voiceRatio  → fração da energia entre 300–3400 Hz
 *   hfRatio     → fração da energia acima de 2,2 kHz  ← a FORMA da consoante surda
 *   hfDb        → nível absoluto dessa banda aguda    ← e o NÍVEL dela
 *   zcr         → cruzamentos por zero (0–1)
 *
 * Medido nos mesmos arquivos: fala vozeada fica em periodicity 0.70–0.87, respiração
 * em 0.35–0.39 — a fronteira é larga e estável. A decisão usa histerese (entra em fala
 * com critério forte, continua com critério fraco), fecha buracos curtos e descarta
 * ilhas curtas (estalo isolado).
 *
 * ⛔ O DEFEITO DE 24.08 — "INTERNET" VIRAVA "INTERNE"
 * ──────────────────────────────────────────────────
 * Consoante surda (/p/ /t/ /k/ /s/ /f/ /ʃ/) NÃO TEM F0 — por definição as pregas não
 * vibram. E a energia dela é 20–35 dB abaixo do pico da voz. Resultado: `periodicity`
 * ≈ 0 e o escape que existia (`fricative`) exigia `speechRef − 12 dB`, um patamar que
 * um /t/ final nunca alcança. A máscara desligava no fim da vogal e o /t/ de "interneT"
 * caía no intervalo cortado, junto com a pausa que vinha depois. Auditado por ASR num
 * arquivo real: "responses" saiu do corte como "response".
 *
 * ⚠ E apertar o limiar de energia PIORA — mais ataque/cauda cai abaixo dele.
 *
 * O CONSERTO — TRÊS CAMADAS, E A ÚLTIMA É UMA GARANTIA
 * ────────────────────────────────────────────────────
 * 1. A régua da consoante surda é o CHIADO LOCAL, não a voz, e não um número fixo.
 *    Um /s/ está 25 dB abaixo da vogal mas bem acima do fundo da sala, com a energia
 *    jogada pro agudo (hfRatio 0,8–1,0 medido em material real; vogal fica em 0,02).
 *    O fundo é medido por percentil DESLIZANTE (±2 s), porque o mesmo motor vê piso
 *    −100 dB num bruto e −41 dB numa gravação de sala. Com um teto: em montado do
 *    Pilot (quase tudo fala) o percentil sobe até a voz e apagaria a consoante.
 *
 * 2. Fora do núcleo vozeado, entram na fala DUAS coisas, por portas diferentes —
 *    porque consoante e respiração são as duas ruído, e o que as separa é ONDE
 *    estão e quão inequívocas são (medido: o /s/ de "horaS" começa 1 frame depois
 *    do núcleo com hfRatio 0,98–1,00; a respiração que sobrava começava 21 frames
 *    depois, com 0,43–0,63):
 *      (a) a CADEIA colada ao núcleo, que aceita ruído ambíguo — é a sílaba se
 *          completando, e atravessa o vale da transição e a oclusão muda;
 *      (b) a sibilante INEQUÍVOCA solta, longe do núcleo — é o /s/ que ficou no
 *          MEIO de um intervalo e estava sendo cortado inteiro.
 *    Em ambas vale o mesmo relógio: fala é EVENTO (começa, dura 30–600 ms, acaba);
 *    chiado, trilha e respiração longa são ESTADO, não acabam, e continuam
 *    cortáveis. Sem esse relógio, trilha alta no meio de uma pausa de 3 s virava
 *    "sílaba" e a pausa inteira deixava de ser cortada.
 *
 * 3. GUARDA-CORPO no corte (`planSpeechCut`): antes de remover, as BORDAS do
 *    intervalo são reexaminadas com um critério independente da máscara, e o corte
 *    recua enquanto o frame encostado na fala ainda parecer fala. Se depois disso
 *    não sobrar pedaço que valha, o corte é RECUSADO — "não dá pra cortar aqui sem
 *    comer palavra" é uma resposta legítima. Por isso o plano pode PROMETER
 *    `audit.speechRemovedSec === 0`: não é estimativa, é o invariante que os testes
 *    cobram e que a ferramenta mostra pro cliente.
 *
 * Auditado por ASR (faster-whisper word-level) em 10 arquivos reais — bruto de
 * gravação humana, gravação com trilha alta e montados do HeyGen: o motor anterior
 * partia 8 palavras (horas→hora, minutos→minuto, acessos→acesso, responses→response);
 * este partiu ZERO, com o mesmo material e a mesma intensidade.
 *
 * O CORTE
 * ───────
 * Cada intervalo de não-fala com duração ≥ `minGap` vira uma pausa de `keepSilence`
 * segundos — e a pausa que sobrevive é a janela MAIS SILENCIOSA do intervalo, então
 * a respiração que estava ali sai junto. Cortes curtos demais são ignorados: no vídeo,
 * cada corte é um jump cut, e picotar de 20 em 20 ms deixaria a imagem tremendo.
 *
 * Roda inteiro no browser, sem dependência: FFT radix-2 própria, sinal decimado pra
 * ~11 kHz (a voz cabe folgada) — ~1 s de CPU pra 1 min de áudio.
 */

export type Segment = { start: number; end: number };

export type SpeechDetectConfig = {
  /** dB abaixo da fala de referência: piso pra ENTRAR em fala */
  enterOffsetDb: number;
  /** dB abaixo da fala de referência: piso pra CONTINUAR em fala (histerese) */
  exitOffsetDb: number;
  /** dB abaixo da fala: acima disso, energia alta na banda de voz já conta como fala (fricativa) */
  loudOffsetDb: number;
  /** periodicidade mínima pra ENTRAR em fala */
  periodicityEnter: number;
  /** periodicidade mínima pra CONTINUAR em fala */
  periodicityStay: number;
  /** fração mínima de energia em 300–3400 Hz pra aceitar fricativa sem F0 */
  voiceRatioMin: number;
  /** fecha buracos de não-fala menores que isso (segundos) */
  closeHolesSec: number;
  /** descarta trechos de fala menores que isso (segundos) */
  minSpeechSec: number;
  /** margem intocada em cada borda da fala (segundos) — base dos dois pads abaixo */
  edgePadSec: number;
  /** folga fixa DEPOIS da fala (cauda de vogal decaindo).
   *  Pequena de propósito: quem protege a palavra é a análise (a cadeia da
   *  consoante e o guarda-corpo), não uma margem cega. Cada 10 ms a mais aqui
   *  custa 10 ms em CADA corte — num vídeo de 70 s com 38 cortes, os pads de
   *  0,02+0,02 seguravam 1,5 s de pausa sem nenhum ganho de segurança medível
   *  (a invasão de palavra ficou igual com 0,01). */
  padTailSec: number;
  /** folga fixa ANTES da fala (ataque) */
  padAttackSec: number;
  /** piso absoluto do intervalo que vale cortar (segundos). O mínimo REAL sai do
   *  keepSilence escolhido (ver planSpeechCut): pedir uma pausa curta tem que
   *  alcançar pausas curtas, senão o controle "não faz nada" em áudio bem falado. */
  minGapSec: number;
  /** não corta pedaço menor que isso — evita jump cut à toa (segundos) */
  minCutSec: number;

  // ── consoante surda (/p/ /t/ /k/ /s/ /f/ /ʃ/): a régua é o CHIADO LOCAL ──────
  // ⚠ Medido nos 5 arquivos do estudo: um limiar global NÃO serve. O mesmo motor
  // vê piso −100 dB num bruto com silêncio digital e −41 dB numa gravação de sala
  // — e nos montados do Pilot o "gap" mais fundo é 20 dB mais alto que no bruto.
  // Por isso todo limiar abaixo é medido contra o piso DESLIZANTE (±2 s), não
  // contra um número fixo nem contra o nível da voz.
  /** dB da BANDA AGUDA acima do piso agudo local — a assinatura do /s/ e do /t/ */
  obstruentHfOverFloorDb: number;
  /** teto: frame mais de X dB abaixo da VOZ do arquivo não é consoante, é ruído.
   *  Sem isto, num bruto com silêncio digital (piso −100 dB) qualquer respiração
   *  fica 40 dB acima do piso e passava por consoante — a decupagem caía de 14%
   *  pra 9% guardando respiração. Medido: cauda de palavra vive em −31 dB com a
   *  voz em −15; respiração, em −60 ou menos. */
  obstruentMaxBelowSpeechDb: number;
  /** TETO da fração da energia que tem que estar no agudo. É o critério de FORMA,
   *  e sem ele o de nível sozinho mente: num bruto com silêncio digital a cauda de
   *  uma vogal decaindo (−40 dB) também fica "muito acima do piso" e virava
   *  consoante — engordando a fala em 4,8 s e comendo 14 cortes. */
  obstruentHfRatioMin: number;
  /** quantas vezes mais agudo que a VOZ do arquivo o frame precisa ser. O teto
   *  acima sozinho não serve: num áudio com grave forte no fundo, o /s/ de
   *  "certoS" acendia a banda aguda em +14 dB e mesmo assim ficava em hfRatio
   *  0,10 — porque o grave dominava a energia total. O que importa é o CONTRASTE
   *  com a voz do próprio material (ali a vogal fica em 0,005). */
  obstruentHfOverVoice: number;
  /** piso absoluto do critério de forma, pra ele nunca virar "qualquer coisa" */
  obstruentHfRatioFloor: number;
  /** duração MÁXIMA de um evento de fala (segundos). Run mais longo que isto não
   *  é consoante nem sílaba: é chiado, respiração longa ou trilha — ESTADO, e
   *  continua cortável. */
  eventMaxSec: number;
  /** duração MÍNIMA de um evento (segundos) — abaixo disso é estalo/clique */
  eventMinSec: number;
  /** quando a cadeia colada ao núcleo NÃO para dentro do teto, ela deixou de ser
   *  sílaba e virou chiado/respiração longa: protege só isto (segundos). */
  chainSustainedSec: number;
  /** hfRatio que torna a consoante INEQUÍVOCA — o que basta pra ela ser
   *  protegida longe do núcleo. Medido: /s/ e /ʃ/ reais dão 0,75–1,00; a
   *  respiração que estava sendo poupada indevidamente não passa de 0,63. */
  strongHfRatioMin: number;
  /** dB abaixo da voz: um frame tão alto quanto a fala é fala, mesmo sem F0
   *  (sílaba grave, nasal, voz rouca). Sem isto um trecho a 2 dB da voz saiu no
   *  corte só porque a periodicidade dele estava em 0,40. */
  loudEventBelowSpeechDb: number;
  /** VALE tolerado dentro da consoante (segundos).
   *  Sem isto a proteção não chega na consoante: entre a vogal e o /s/ existem
   *  1–3 frames de transição que não são nem um nem outro, e a PLOSIVA tem até
   *  80 ms de oclusão MUDA antes do estouro — a busca contígua morria no vale e
   *  o /t/ continuava caindo no corte. Medido no sinal de teste: vogal termina em
   *  0,88 s, o /s/ começa em 0,90 s. */
  obstruentBridgeSec: number;
  /** meia-janela do piso deslizante (segundos) */
  localFloorWindowSec: number;
  /** TETO do piso deslizante, em dB abaixo da voz. Num montado do Pilot (quase
   *  tudo fala, sem pausa nenhuma) o percentil de fundo sobe até o nível da voz
   *  e o /s/ de "acessos" ficava ABAIXO do próprio piso — a mesma
   *  armadilha que já tinha derrubado o threshold de entrada. */
  floorMaxBelowSpeechDb: number;
  /** idem pro piso da banda aguda (o agudo da voz vozeada é mais fraco) */
  hfFloorMaxBelowSpeechDb: number;

  // ── guarda-corpo do corte ────────────────────────────────────────────────────
  /** janela nas bordas do intervalo onde o corte é reexaminado (segundos).
   *  CURTA de propósito: a máscara já fez a análise fina com o discriminador
   *  completo; aqui é só o cinto de segurança do que está colado na fala. Com
   *  janela longa ele vira redundância agressiva e come a decupagem (medido:
   *  0,30 s derrubava o material humano de 12,5% pra 9,5% de remoção). */
  guardWindowSec: number;
  /** periodicidade que já basta pra proteger um frame no guarda-corpo */
  guardPeriodicity: number;
  /** dB acima do piso local pra voz de baixa energia ainda ser protegida */
  guardVoiceOverFloorDb: number;
};

export const DEFAULT_SPEECH_CONFIG: SpeechDetectConfig = {
  enterOffsetDb: -30,
  exitOffsetDb: -34,
  loudOffsetDb: -12,
  periodicityEnter: 0.55,
  periodicityStay: 0.5,
  voiceRatioMin: 0.3,
  closeHolesSec: 0.18,
  minSpeechSec: 0.1,
  edgePadSec: 0.01,
  padTailSec: 0.01,
  padAttackSec: 0.01,
  minGapSec: 0.11,
  minCutSec: 0.05,

  obstruentHfOverFloorDb: 11,
  obstruentMaxBelowSpeechDb: 38,
  obstruentHfRatioMin: 0.35,
  obstruentHfOverVoice: 40,
  obstruentHfRatioFloor: 0.12,
  eventMaxSec: 0.6,
  eventMinSec: 0.03,
  chainSustainedSec: 0.06,
  strongHfRatioMin: 0.7,
  loudEventBelowSpeechDb: 8,
  obstruentBridgeSec: 0.08,
  localFloorWindowSec: 2,
  floorMaxBelowSpeechDb: 18,
  hfFloorMaxBelowSpeechDb: 32,

  guardWindowSec: 0.08,
  guardPeriodicity: 0.45,
  guardVoiceOverFloorDb: 6,
};

const FRAME_MS = 10;
const WINDOW_MS = 32;
const TARGET_RATE = 11025; // a voz cabe folgada; 4× menos CPU que 44.1k
/** fronteira do "agudo": acima daqui mora a consoante surda, não a vogal */
const HF_HZ = 2200;

// ---------- FFT (radix-2, in-place) ---------------------------------------

function fft(re: Float32Array, im: Float32Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len >> 1; k++) {
        const ar = re[i + k];
        const ai = im[i + k];
        const br = re[i + k + (len >> 1)] * cr - im[i + k + (len >> 1)] * ci;
        const bi = re[i + k + (len >> 1)] * ci + im[i + k + (len >> 1)] * cr;
        re[i + k] = ar + br;
        im[i + k] = ai + bi;
        re[i + k + (len >> 1)] = ar - br;
        im[i + k + (len >> 1)] = ai - bi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

// ---------- Features por frame --------------------------------------------

export type FrameFeatures = {
  /** dBFS por frame */
  db: Float32Array;
  /** RMS linear por frame */
  rms: Float32Array;
  /** pico da autocorrelação normalizada (0–1) */
  periodicity: Float32Array;
  /** fração da energia em 300–3400 Hz */
  voiceRatio: Float32Array;
  /** fração da energia acima de 2,2 kHz — assinatura de consoante surda */
  hfRatio: Float32Array;
  /** nível ABSOLUTO da banda acima de 2,2 kHz, em dB — comparado ao piso LOCAL
   *  é o que separa um /s/ (10–25 dB acima do chiado da sala) do próprio chiado */
  hfDb: Float32Array;
  /** cruzamentos por zero, normalizado (0–1) — a outra assinatura da surda */
  zcr: Float32Array;
  /** duração de cada frame, em segundos (no tempo ORIGINAL) */
  frameSec: number;
  count: number;
};

/** Decima por média de `factor` amostras (passa-baixa simples + downsample). */
function decimate(data: Float32Array, factor: number): Float32Array {
  if (factor <= 1) return data;
  const n = Math.floor(data.length / factor);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    const b = i * factor;
    for (let k = 0; k < factor; k++) s += data[b + k];
    out[i] = s / factor;
  }
  return out;
}

export function extractFeatures(channel: Float32Array, sampleRate: number): FrameFeatures {
  const factor = Math.max(1, Math.round(sampleRate / TARGET_RATE));
  const x = decimate(channel, factor);
  const sr = sampleRate / factor;

  const hop = Math.max(1, Math.round((FRAME_MS / 1000) * sr));
  const win = Math.max(8, Math.round((WINDOW_MS / 1000) * sr));
  const count = Math.max(0, Math.floor((x.length - win) / hop) + 1);

  const db = new Float32Array(count);
  const rms = new Float32Array(count);
  const periodicity = new Float32Array(count);
  const voiceRatio = new Float32Array(count);
  const hfRatio = new Float32Array(count);
  const hfDb = new Float32Array(count);
  const zcr = new Float32Array(count);
  if (count === 0) {
    return { db, rms, periodicity, voiceRatio, hfRatio, hfDb, zcr, frameSec: FRAME_MS / 1000, count };
  }

  const hann = new Float32Array(win);
  for (let i = 0; i < win; i++) hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (win - 1));

  const nSpec = nextPow2(win);
  const nAuto = nextPow2(win * 2);
  const sre = new Float32Array(nSpec);
  const sim = new Float32Array(nSpec);
  const are = new Float32Array(nAuto);
  const aim = new Float32Array(nAuto);
  const frame = new Float32Array(win);

  const binHz = sr / nSpec;
  const loBin = Math.max(1, Math.floor(300 / binHz));
  const hiBin = Math.min(nSpec >> 1, Math.ceil(3400 / binHz));
  const hfBin = Math.max(1, Math.floor(HF_HZ / binHz));
  const lagMin = Math.max(2, Math.floor(sr / 400)); // F0 até 400 Hz
  const lagMax = Math.min(win - 1, Math.ceil(sr / 70)); // F0 a partir de 70 Hz

  for (let f = 0; f < count; f++) {
    const base = f * hop;
    let sum = 0;
    let mean = 0;
    for (let i = 0; i < win; i++) {
      const v = x[base + i] * hann[i];
      frame[i] = v;
      sum += v * v;
      mean += v;
    }
    mean /= win;
    const r = Math.sqrt(sum / win);
    rms[f] = r;
    db[f] = 20 * Math.log10(r + 1e-12);

    // cruzamentos por zero no frame CRU (sem janela: a janela zera as pontas e
    // inventaria cruzamento). /s/ e /t/ cruzam muito; vogal cruza pouco.
    let cross = 0;
    let prev = x[base] - mean;
    for (let i = 1; i < win; i++) {
      const cur = x[base + i] - mean;
      if ((prev < 0 && cur >= 0) || (prev >= 0 && cur < 0)) cross++;
      prev = cur;
    }
    zcr[f] = cross / (win - 1);

    // espectro → razão de energia na banda de voz e no agudo
    sre.fill(0); sim.fill(0);
    sre.set(frame.subarray(0, win));
    fft(sre, sim);
    let total = 0;
    let band = 0;
    let high = 0;
    for (let k = 1; k <= nSpec >> 1; k++) {
      const p = sre[k] * sre[k] + sim[k] * sim[k];
      total += p;
      if (k >= loBin && k <= hiBin) band += p;
      if (k >= hfBin) high += p;
    }
    voiceRatio[f] = total > 0 ? band / total : 0;
    hfRatio[f] = total > 0 ? high / total : 0;
    // normalizado pelo mesmo divisor do RMS: vira dB comparável com `db`
    hfDb[f] = 10 * Math.log10(high / (win * win) + 1e-24);

    // autocorrelação (via FFT) do frame sem DC → periodicidade
    are.fill(0); aim.fill(0);
    for (let i = 0; i < win; i++) are[i] = frame[i] - mean;
    fft(are, aim);
    for (let k = 0; k < nAuto; k++) {
      const pr = are[k] * are[k] + aim[k] * aim[k];
      are[k] = pr;
      aim[k] = 0;
    }
    // IFFT = conj(FFT(conj)) / n — como o espectro é real, basta FFT e dividir
    fft(are, aim);
    const ac0 = are[0] / nAuto;
    let best = 0;
    if (ac0 > 1e-12) {
      for (let lag = lagMin; lag <= lagMax; lag++) {
        const v = are[lag] / nAuto;
        if (v > best) best = v;
      }
      periodicity[f] = Math.max(0, Math.min(1, best / ac0));
    } else {
      periodicity[f] = 0;
    }
  }

  return { db, rms, periodicity, voiceRatio, hfRatio, hfDb, zcr, frameSec: hop / sr, count };
}

// ---------- Máscara de fala ------------------------------------------------

function percentile(sorted: Float32Array, p: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))));
  return sorted[i];
}

/**
 * Piso DESLIZANTE: o percentil `p` de `v` numa janela de ±`halfN` frames.
 *
 * Existe porque não há piso único num arquivo: o chiado muda de trecho pra trecho
 * (o avatar respira, entra trilha, muda a cena) e um número global vira mentira
 * — a lição que já tinha aparecido em "pausa é QUEDA, não silêncio". Calculado a
 * cada `stride` frames e repetido no meio (250 ms de resolução chega de sobra pra
 * uma medida de fundo, e derruba o custo pra ~2 M operações num vídeo de 2 min).
 */
function slidingFloor(v: Float32Array, count: number, halfN: number, p: number, stride: number): Float32Array {
  const out = new Float32Array(count);
  if (count === 0) return out;
  const buf = new Float64Array(Math.min(count, 2 * halfN + 1));
  for (let c = 0; c < count; c += stride) {
    const a = Math.max(0, c - halfN);
    const b = Math.min(count, c + halfN + 1);
    const m = b - a;
    for (let i = 0; i < m; i++) buf[i] = v[a + i];
    const win = buf.subarray(0, m).sort();
    const q = win[Math.min(m - 1, Math.max(0, Math.round(p * (m - 1))))];
    for (let i = c; i < Math.min(count, c + stride); i++) out[i] = q;
  }
  return out;
}

/**
 * O detector de CONSOANTE SURDA, usado nos dois guardas (máscara e corte).
 *
 * `isObstruent` = tem energia acima do chiado local E brilho no agudo acima do
 * chiado agudo local. As duas condições juntas são o que separa um /s/ de uma
 * respiração: respiração levanta a energia total mas é grave e lenta; o /s/ e o
 * /t/ levantam justamente a banda acima de 2,2 kHz.
 */
export type ObstruentProbe = {
  isObstruent: (i: number) => boolean;
  floorDb: Float32Array;
  hfFloorDb: Float32Array;
};

export function makeObstruentProbe(f: FrameFeatures, cfg: SpeechDetectConfig, speechRefDb: number): ObstruentProbe {
  const halfN = Math.max(1, Math.round(cfg.localFloorWindowSec / f.frameSec));
  const stride = Math.max(1, Math.round(0.25 / f.frameSec));
  const floorDb = slidingFloor(f.db, f.count, halfN, 0.1, stride);
  const hfFloorDb = slidingFloor(f.hfDb, f.count, halfN, 0.1, stride);
  // TETO: o piso local nunca pode encostar na voz (ver floorMaxBelowSpeechDb)
  const floorCap = speechRefDb - cfg.floorMaxBelowSpeechDb;
  const hfFloorCap = speechRefDb - cfg.hfFloorMaxBelowSpeechDb;
  for (let i = 0; i < f.count; i++) {
    if (floorDb[i] > floorCap) floorDb[i] = floorCap;
    if (hfFloorDb[i] > hfFloorCap) hfFloorDb[i] = hfFloorCap;
  }
  const tooWeakDb = speechRefDb - cfg.obstruentMaxBelowSpeechDb;
  // hfRatio típico da VOZ deste arquivo (mediana nos frames mais fortes, que são
  // vogais): é a régua do critério de forma — ver obstruentHfOverVoice.
  const fortes: number[] = [];
  for (let i = 0; i < f.count; i++) if (f.db[i] >= speechRefDb - 6) fortes.push(f.hfRatio[i]);
  fortes.sort((a, b) => a - b);
  const hfVoz = fortes.length ? fortes[Math.floor(fortes.length / 2)] : 0.02;
  const hfRatioMin = Math.min(
    cfg.obstruentHfRatioMin,
    Math.max(cfg.obstruentHfRatioFloor, hfVoz * cfg.obstruentHfOverVoice),
  );
  // ⚠ NÃO exigir também energia TOTAL acima do piso local: a consoante surda é
  // mais fraca que a vogal fraca, então num material justo ela fica ABAIXO do
  // próprio piso de energia — medido no /s/ de "mesmoS" (db −44,0 contra piso
  // local −43,8), que assim caía no corte apesar de ter 23 dB de contraste no
  // agudo. Quem decide aqui é a banda aguda; a energia total só serve pra
  // descartar o que é fraco demais pra ser audível (tooWeakDb).
  const isObstruent = (i: number) =>
    i >= 0 && i < f.count &&
    f.db[i] >= tooWeakDb &&
    f.hfRatio[i] >= hfRatioMin &&
    f.hfDb[i] >= hfFloorDb[i] + cfg.obstruentHfOverFloorDb;
  return { isObstruent, floorDb, hfFloorDb };
}

export type SpeechMask = {
  mask: Uint8Array;
  /** nível da FALA do arquivo (mediana do que está acima do p75), em dBFS */
  speechRefDb: number;
  /** nível do ROOM TONE do arquivo, em dBFS — a régua da consoante surda */
  noiseFloorDb: number;
};

/**
 * Marca cada frame como fala (true) ou não-fala (false).
 *
 * Duas passadas: a primeira acha o NÚCLEO VOZEADO (o que tem F0); a segunda mede o
 * room tone com os frames que sobraram e ESTICA cada núcleo pelas consoantes surdas
 * coladas nele — que é onde moram o ataque e a cauda das palavras.
 */
export function detectSpeechMask(
  f: FrameFeatures,
  cfg: SpeechDetectConfig = DEFAULT_SPEECH_CONFIG,
): SpeechMask {
  const n = f.count;
  const mask = new Uint8Array(n);
  if (n === 0) return { mask, speechRefDb: -100, noiseFloorDb: -100 };

  const sorted = Float32Array.from(f.db).sort();
  const p75 = percentile(sorted, 0.75);
  const p05 = percentile(sorted, 0.05);
  // referência = mediana do que está acima do p75 (a FALA do arquivo, não o ruído)
  const strong: number[] = [];
  for (let i = 0; i < n; i++) if (f.db[i] > p75) strong.push(f.db[i]);
  strong.sort((a, b) => a - b);
  const speechRef = strong.length ? strong[Math.floor(strong.length / 2)] : sorted[sorted.length - 1];

  // O piso de ruído (p05) levanta o threshold pra não confundir chiado com voz.
  // MAS num áudio que é quase todo fala (típico: uma parte de avatar falando sem
  // parar) o p05 é a própria voz — sem o teto abaixo, o threshold subia ACIMA da
  // fala e o arquivo inteiro virava "não-fala" (0 segmentos → o Pilot mantinha a
  // parte sem cortar nada). Por isso o threshold nunca passa de speechRef − 6 dB.
  const enterDb = Math.min(Math.max(speechRef + cfg.enterOffsetDb, p05 + 6), speechRef - 6);
  const exitDb = Math.min(Math.max(speechRef + cfg.exitOffsetDb, p05 + 3), speechRef - 9);
  const loudDb = speechRef + cfg.loudOffsetDb;

  let on = false;
  for (let i = 0; i < n; i++) {
    const voicedEnter = f.periodicity[i] >= cfg.periodicityEnter && f.db[i] >= enterDb;
    const voicedStay = f.periodicity[i] >= cfg.periodicityStay && f.db[i] >= exitDb;
    // fricativa/plosiva: sem F0, mas energia alta concentrada na banda da voz
    const fricative = f.db[i] >= loudDb && f.voiceRatio[i] >= cfg.voiceRatioMin;
    if (!on && (voicedEnter || fricative)) on = true;
    else if (on && !(voicedStay || fricative)) on = false;
    mask[i] = on ? 1 : 0;
  }

  // ── piso de ruído do arquivo (só pro laudo; a decisão usa o piso LOCAL) ─────
  const outside: number[] = [];
  for (let i = 0; i < n; i++) if (!mask[i]) outside.push(f.db[i]);
  outside.sort((a, b) => a - b);
  const floorRaw = outside.length >= 10 ? outside[Math.floor(0.1 * (outside.length - 1))] : p05;
  const noiseFloor = Math.min(floorRaw, speechRef - 10);

  // ── EVENTOS de fala que o núcleo vozeado não pega ──────────────────────────
  // A consoante surda não tem F0 e é fraca; uma sílaba grave/nasal pode ter
  // periodicidade baixa e ainda ser alta como a voz. As duas caem fora do núcleo
  // — e foi assim que um /s/ inteiro ("respostaS") ficou NO MEIO de um intervalo
  // e virou corte.
  //
  // A pergunta que separa consoante de respiração NÃO é o timbre: as duas são
  // ruído. É ONDE ela está e QUÃO inequívoca ela é. Medido no material real:
  //
  //   /s/ de "horaS"    → começa 1 frame depois do núcleo, hfRatio 0,98–1,00
  //   respiração        → começa 21 frames (0,21 s) depois, hfRatio 0,43–0,63
  //
  // Daí as duas portas de entrada:
  //   (a) CADEIA — a partir da borda do núcleo, anda enquanto houver "parece
  //       fala", atravessando o vale da transição e a oclusão muda da plosiva.
  //       É a sílaba se completando, então aceita ruído ambíguo.
  //   (b) SOLTO — longe do núcleo só entra sibilante INEQUÍVOCA (hfRatio alto),
  //       porque ali um /s/ pode estar isolado por uma oclusão longa, mas
  //       respiração não pode entrar de carona.
  //
  // Sem (b), um /s/ no meio do intervalo era cortado. Sem o limite de (a), a
  // respiração emendava na palavra seguinte por uma corrente de pontes e a pausa
  // inteira deixava de ser cortada.
  const eventN = Math.max(1, Math.round(cfg.eventMaxSec / f.frameSec));
  const minEventN = Math.max(1, Math.round(cfg.eventMinSec / f.frameSec));
  const bridgeN = Math.max(0, Math.round(cfg.obstruentBridgeSec / f.frameSec));
  const sustainedN = Math.max(1, Math.round(cfg.chainSustainedSec / f.frameSec));
  const { isObstruent } = makeObstruentProbe(f, cfg, speechRef);
  const loudDbGuard = speechRef - cfg.loudEventBelowSpeechDb;
  const core = Uint8Array.from(mask); // o núcleo vozeado, antes dos eventos

  /** ambíguo: só vale colado ao núcleo (cauda/ataque de palavra) */
  const pareceFala = (i: number) => !core[i] && (isObstruent(i) || f.db[i] >= loudDbGuard);
  /** inequívoco: sibilante forte, vale sozinha em qualquer lugar */
  const sibilante = (i: number) => !core[i] && isObstruent(i) && f.hfRatio[i] >= cfg.strongHfRatioMin;

  const ev = new Uint8Array(n);
  for (let i = 0; i < n; ) {
    if (!core[i]) { i++; continue; }
    let j = i;
    while (j < n && core[j]) j++;
    // (a1) cauda: anda pra frente a partir do fim do núcleo
    let k = j;
    let last = j;
    let holes = 0;
    while (k < n && !core[k] && k - j < eventN) {
      if (pareceFala(k)) { last = k + 1; holes = 0; }
      else if (++holes > bridgeN) break;
      k++;
    }
    // Encostou no teto sem parar? Então não é sílaba se completando, é chiado
    // ou respiração LONGA emendando na fala — cauda de palavra acaba sozinha.
    // Nesse caso protege só a folga mínima e o resto continua cortável.
    const stopTail = last - j >= eventN ? Math.min(last, j + sustainedN) : last;
    for (let t = j; t < stopTail; t++) ev[t] = 1;
    // (a2) ataque: anda pra trás a partir do início do núcleo
    let a = i - 1;
    let first = i;
    holes = 0;
    while (a >= 0 && !core[a] && i - 1 - a < eventN) {
      if (pareceFala(a)) { first = a; holes = 0; }
      else if (++holes > bridgeN) break;
      a--;
    }
    const startAttack = i - first >= eventN ? Math.max(first, i - sustainedN) : first;
    for (let t = startAttack; t < i; t++) ev[t] = 1;
    i = j;
  }
  // (b) sibilante solta — delimitada, senão é chiado contínuo.
  // ⚠ Fechar o buraco ANTES de medir o comprimento é o que impede a fraude do
  // ruído: chiado de banda larga também dá hfRatio alto, e um run de 1 s dele
  // flutua o bastante pra se PARTIR em pedaços de meio segundo — cada um
  // passando pelo teto de duração como se fosse um /s/. Fechado, ele volta a
  // ser um bloco só, longo, e cai fora.
  const sib = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (sibilante(i)) sib[i] = 1;
  for (let i = 0; i < n; ) {
    if (sib[i]) { i++; continue; }
    let j = i;
    while (j < n && !sib[j]) j++;
    if (i > 0 && j < n && j - i <= bridgeN) sib.fill(1, i, j);
    i = j;
  }
  for (let i = 0; i < n; ) {
    if (!sib[i]) { i++; continue; }
    let j = i;
    while (j < n && sib[j]) j++;
    const len = j - i;
    if (len >= minEventN && len <= eventN) ev.fill(1, i, j);
    i = j;
  }
  for (let i = 0; i < n; i++) if (ev[i]) mask[i] = 1;
  // fecha buracos curtos (fricativa no meio da palavra não vira corte)
  const closeN = Math.round(cfg.closeHolesSec / f.frameSec);
  for (let i = 0; i < n; ) {
    if (!mask[i]) {
      let j = i;
      while (j < n && !mask[j]) j++;
      if (i > 0 && j < n && j - i <= closeN) mask.fill(1, i, j);
      i = j;
    } else i++;
  }
  // Descarta ilhas curtas de "fala" (estalo isolado) — MAS nunca uma ilha que é
  // consoante detectada.
  //
  // ⚠ Este passo era um furo na garantia: consoante surda É curta por natureza
  // (um /t/ tem 40–60 ms), então uma que ficasse isolada do núcleo caía aqui,
  // saía da máscara e voltava a ser cortável — sem sequer aparecer no laudo,
  // porque `speechRemovedSec` conta a máscara DEPOIS deste passo.
  const minSpeechN = Math.round(cfg.minSpeechSec / f.frameSec);
  for (let i = 0; i < n; ) {
    if (mask[i]) {
      let j = i;
      while (j < n && mask[j]) j++;
      let ehConsoante = false;
      for (let t = i; t < j && !ehConsoante; t++) if (ev[t]) ehConsoante = true;
      if (j - i < minSpeechN && !ehConsoante) mask.fill(0, i, j);
      i = j;
    } else i++;
  }

  return { mask, speechRefDb: speechRef, noiseFloorDb: noiseFloor };
}

// ---------- Planejamento do corte -----------------------------------------

/**
 * O laudo do corte. `speechRemovedSec` é a GARANTIA da ferramenta: o guarda-corpo
 * recua toda borda que ainda pareça fala, então esse número é 0,000 — e é isso que
 * a UI mostra e o teste cobra. `savedSec` é a prova de que a proteção trabalhou:
 * quanto de ataque/cauda de palavra teria ido embora sem ela.
 */
export type CutAudit = {
  /** fala protegida nas bordas: o que o corte comeria e não comeu (segundos) */
  savedSec: number;
  /** fala que sobrou DENTRO do removido — o invariante: tem que ser 0 */
  speechRemovedSec: number;
  /** cortes que o guarda-corpo recusou por inteiro (não sobrou pedaço seguro) */
  refusedCuts: number;
  /** menor folga entre um corte e o frame de fala mais próximo (segundos) */
  minMarginSec: number;
  noiseFloorDb: number;
  speechRefDb: number;
  /** true quando nenhuma fala foi removida (o normal) */
  ok: boolean;
};

export type CutPlan = {
  /** trechos a MANTER, em segundos */
  segments: Segment[];
  /** trechos removidos, em segundos */
  removed: Segment[];
  totalSec: number;
  keptSec: number;
  /** quantas pausas foram encurtadas */
  cuts: number;
  speechRefDb: number;
  /** laudo do guarda-corpo — ver CutAudit */
  audit: CutAudit;
};

/**
 * Monta o plano de corte de um AudioBuffer.
 * `keepSilence` = quanto de pausa FICA no lugar de cada intervalo cortado.
 */
export function planSpeechCut(
  buffer: { getChannelData(ch: number): Float32Array; sampleRate: number; duration: number; length: number },
  keepSilence = 0.08,
  cfgIn?: Partial<SpeechDetectConfig>,
): CutPlan {
  const cfg: SpeechDetectConfig = { ...DEFAULT_SPEECH_CONFIG, ...(cfgIn || {}) };
  const total = buffer.duration || buffer.length / buffer.sampleRate;
  const f = extractFeatures(buffer.getChannelData(0), buffer.sampleRate);
  const { mask, speechRefDb, noiseFloorDb } = detectSpeechMask(f, cfg);
  const emptyAudit: CutAudit = {
    savedSec: 0, speechRemovedSec: 0, refusedCuts: 0, minMarginSec: 0,
    noiseFloorDb, speechRefDb, ok: true,
  };
  if (f.count === 0) {
    return { segments: [{ start: 0, end: total }], removed: [], totalSec: total, keptSec: total, cuts: 0, speechRefDb, audit: emptyAudit };
  }

  const fs = f.frameSec;
  const padTailN = Math.max(0, Math.round(Math.max(cfg.padTailSec, cfg.edgePadSec) / fs));
  const padAttackN = Math.max(0, Math.round(Math.max(cfg.padAttackSec, cfg.edgePadSec) / fs));
  const keepN = Math.max(1, Math.round(keepSilence / fs));
  const guardN = Math.max(1, Math.round(cfg.guardWindowSec / fs));
  const bridgeN = Math.max(0, Math.round(cfg.obstruentBridgeSec / fs));
  // O intervalo mínimo que vale cortar ACOMPANHA o keepSilence: pra sobrar a pausa
  // pedida ainda é preciso caber as duas bordas intocadas + um corte que valha a
  // pena. Sem isso, o controle da UI não alcançava as pausas curtas — o usuário
  // arrastava de 0.50 até 0.01 e a duração mal mudava em áudio bem falado.
  // A pausa entregue é `keepSilence` NO TOTAL — as folgas das bordas fazem parte
  // dela, não se somam a ela.
  //
  // ⚠ Isto era uma promessa quebrada: quem punha 0,05 no controle recebia 0,05 de
  // pausa MAIS 0,02+0,02 de folga = 0,07 em cada corte. Num vídeo de 70 s com 30
  // pausas, 0,6 s a mais de silêncio que ninguém pediu — e a sensação, correta, de
  // que "dava pra decupar um pouco mais no 0,05".
  const keepInnerN = Math.max(1, keepN - padTailN - padAttackN);
  const minGapSec = Math.max(cfg.minGapSec, keepSilence + cfg.minCutSec);
  const minGapN = Math.round(minGapSec / fs);
  const minCutN = Math.max(1, Math.round(cfg.minCutSec / fs));

  // ── o critério DURO do guarda-corpo ────────────────────────────────────────
  // Independente da máscara de propósito: se a máscara errar, isto ainda segura.
  // Vale só nas BORDAS do intervalo (perto da fala) — no miolo do gap está a
  // respiração, que a gente QUER remover.
  const probe = makeObstruentProbe(f, cfg, speechRefDb);
  const looksLikeSpeech = (i: number) => {
    if (i < 0 || i >= f.count) return false;
    // voz de baixa energia (fim de frase que morre) — periodicidade já entrega
    if (f.periodicity[i] >= cfg.guardPeriodicity && f.db[i] >= probe.floorDb[i] + cfg.guardVoiceOverFloorDb) return true;
    // consoante surda: o mesmo detector da máscara, medido contra o chiado local
    return probe.isObstruent(i);
  };

  let savedN = 0;
  let refused = 0;
  let minMarginN = Infinity;

  const drops: Array<[number, number]> = [];
  for (let i = 0; i < f.count; ) {
    if (mask[i]) { i++; continue; }
    let j = i;
    while (j < f.count && !mask[j]) j++;
    const gapLen = j - i;
    if (gapLen >= minGapN) {
      // borda esquerda: recua enquanto o frame colado na fala ainda parecer fala
      // (cauda de palavra — o /t/ de "interneT" mora exatamente aqui)
      let a = i;
      const capA = Math.min(j, i + guardN);
      {
        let k = i;
        let holes = 0;
        while (k < capA) {
          if (looksLikeSpeech(k)) { a = k + 1; holes = 0; }
          else if (++holes > bridgeN) break;
          k++;
        }
      }
      // Protegeu a janela INTEIRA? Então não é cauda de palavra: cauda acaba,
      // chiado de fundo não. Volta pro início do intervalo — a folga fixa
      // (padTail, somada logo abaixo) continua valendo, e a fala de verdade que
      // estivesse aqui já teria sido marcada pela máscara. Sem esta linha, um
      // material com chiado perde ~1 ponto percentual de decupagem à toa.
      if (a - i >= guardN) a = i;
      const savedTail = a - i;
      a += padTailN;
      // borda direita: mesma coisa, do outro lado (ataque da próxima palavra)
      let b = j;
      const capB = Math.max(a, j - guardN);
      {
        let k = j;
        let holes = 0;
        while (k > capB) {
          if (looksLikeSpeech(k - 1)) { b = k - 1; holes = 0; }
          else if (++holes > bridgeN) break;
          k--;
        }
      }
      if (j - b >= guardN) b = j;
      const savedAttack = j - b;
      b -= padAttackN;

      if (b - a > keepInnerN) {
        savedN += savedTail + savedAttack;
        // a pausa que sobrevive é a janela mais silenciosa do intervalo:
        // é assim que a respiração some junto com o silêncio.
        let bestOff = 0;
        let run = 0;
        for (let k = 0; k < keepInnerN && a + k < b; k++) run += f.rms[a + k];
        let bestSum = run;
        for (let k = a + keepInnerN; k < b; k++) {
          run += f.rms[k] - f.rms[k - keepInnerN];
          if (run < bestSum) { bestSum = run; bestOff = k - keepInnerN - a + 1; }
        }
        const qa = a + bestOff;
        const qb = qa + keepInnerN;
        let cut = 0;
        if (qa - a >= minCutN) { drops.push([a, qa]); cut++; }
        if (b - qb >= minCutN) { drops.push([qb, b]); cut++; }
        if (cut === 0) refused++;
        else minMarginN = Math.min(minMarginN, a - i, j - b);
      } else {
        // depois de proteger as bordas não sobrou pausa que valha: não corta.
        // "Não dá pra cortar aqui sem comer palavra" é uma resposta legítima.
        refused++;
      }
    }
    i = j;
  }

  drops.sort((a, b) => a[0] - b[0]);
  const segments: Segment[] = [];
  const removed: Segment[] = [];
  let cursor = 0;
  for (const [a, b] of drops) {
    const aSec = a * fs;
    const bSec = b * fs;
    if (aSec > cursor) segments.push({ start: cursor, end: aSec });
    removed.push({ start: aSec, end: bSec });
    cursor = bSec;
  }
  if (cursor < total) segments.push({ start: cursor, end: total });

  // ── conferência final: sobrou fala dentro do que vai ser removido? ─────────
  // Roda sobre o resultado, não sobre a intenção. Se der > 0 algo escapou dos
  // dois guardas e a UI tem que dizer isso em vez de entregar calado.
  let speechRemovedN = 0;
  for (const [a, b] of drops) {
    for (let k = a; k < b; k++) if (mask[k]) speechRemovedN++;
  }

  const clean = segments.filter((s) => s.end - s.start > 0.02).map((s) => ({ start: s.start, end: Math.min(s.end, total) }));
  const keptSec = clean.reduce((n, s) => n + (s.end - s.start), 0);
  const audit: CutAudit = {
    savedSec: savedN * fs,
    speechRemovedSec: speechRemovedN * fs,
    refusedCuts: refused,
    minMarginSec: Number.isFinite(minMarginN) ? Math.max(0, minMarginN) * fs : 0,
    noiseFloorDb,
    speechRefDb,
    ok: speechRemovedN === 0,
  };
  return { segments: clean, removed, totalSec: total, keptSec, cuts: drops.length, speechRefDb, audit };
}
