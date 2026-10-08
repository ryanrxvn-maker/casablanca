/**
 * RECORTE DO AVATAR (fundo removido) pro formato REACT — 07.10.
 *
 * O React é o take em tela cheia com o avatar pequeno no canto de baixo, SEM
 * o fundo dele. Aqui roda a segmentação de pessoa do MediaPipe (o mesmo CDN
 * do detector de rosto, zero crédito, tudo no navegador) quadro a quadro, só
 * nas janelas React.
 *
 * O que faz o recorte parecer de verdade e não "adesivo tremendo":
 * - a máscara é calculada numa régua pequena (~512px de altura) e AMPLIADA
 *   com suavização — a borda sai macia, sem serrilhado;
 * - SUAVIZAÇÃO NO TEMPO (média móvel 65/35): o contorno não ferve de um
 *   quadro pro outro. Quando o vídeo pula (corte, outra janela), zera;
 * - curva na borda (smoothstep): o que o modelo tem dúvida vira meio
 *   transparente em vez de um degrau duro;
 * - a polaridade da máscara é CONFERIDA no primeiro quadro (cantos de cima são
 *   fundo, o miolo é a pessoa) — versões do modelo divergem nisso, e uma
 *   máscara invertida apagaria a pessoa e deixaria o fundo.
 *
 * Nunca lança: modelo que não carrega devolve `null` e o render cai pro card
 * arredondado no canto (o avatar continua aparecendo, com fundo).
 */

const MEDIAPIPE_CDN = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
/** Modelo de várias classes (cabelo, pele, roupa…): contorno de cabelo e
 *  ombro bem melhor que o selfie simples. O fundo é a classe 0. */
const MODELO_MULTICLASSE =
  'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite';
/** Reserva leve (~250KB) se o de várias classes não abrir. */
const MODELO_SELFIE =
  'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite';

/** altura da régua de trabalho da máscara (px) */
const ALTURA_TRABALHO = 512;

export type RecortadorAvatar = {
  /**
   * O avatar do quadro `src` SEM FUNDO, desenhado em `outW`×`outH` (canvas
   * com alfa). `t` é o instante do vídeo principal: um salto reinicia a
   * suavização no tempo. `null` quando o quadro não deu pra segmentar (o
   * caller desenha o card de reserva).
   */
  recortar: (
    src: CanvasImageSource,
    srcW: number,
    srcH: number,
    t: number,
    outW: number,
    outH: number,
  ) => HTMLCanvasElement | null;
  /** a SOMBRA do último recorte (silhueta preta borrada, régua pequena) —
   *  desenhada ampliada por baixo do avatar; barata, ao contrário de um
   *  shadowBlur do canvas em resolução cheia a cada quadro */
  sombra: () => HTMLCanvasElement | null;
  /** qual modelo carregou (log/diagnóstico) */
  modelo: 'multiclasse' | 'selfie';
  fechar: () => void;
};

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/**
 * Probabilidade de PESSOA por pixel a partir das máscaras de confiança.
 * Puro (testável): `masks` são os Float32Array do segmentador.
 */
export function probabilidadeDePessoa(
  masks: Float32Array[],
  modelo: 'multiclasse' | 'selfie',
): Float32Array | null {
  if (!masks.length || !masks[0]?.length) return null;
  const n = masks[0].length;
  const out = new Float32Array(n);
  if (masks.length >= 2) {
    // classe 0 = fundo nos dois modelos quando há mais de uma máscara
    const fundo = masks[0];
    for (let i = 0; i < n; i++) out[i] = 1 - fundo[i];
    return out;
  }
  // uma máscara só (selfie): o sentido é conferido por quem chama
  out.set(masks[0]);
  void modelo;
  return out;
}

/**
 * A máscara está de cabeça pra baixo? Os dois cantos de CIMA são fundo num
 * avatar falando; o miolo (onde fica o rosto/peito) é a pessoa. Devolve
 * `null` quando o quadro não decide (ex.: pessoa encostada nos cantos).
 */
export function mascaraInvertida(p: Float32Array, w: number, h: number): boolean | null {
  if (!(w > 4) || !(h > 4) || p.length < w * h) return null;
  const media = (x0: number, y0: number, x1: number, y1: number) => {
    let s = 0;
    let c = 0;
    for (let y = Math.floor(y0 * h); y < Math.ceil(y1 * h); y++) {
      for (let x = Math.floor(x0 * w); x < Math.ceil(x1 * w); x++) {
        s += p[y * w + x];
        c++;
      }
    }
    return c ? s / c : 0.5;
  };
  const cantos = (media(0, 0, 0.12, 0.1) + media(0.88, 0, 1, 0.1)) / 2;
  const miolo = media(0.4, 0.35, 0.6, 0.65);
  if (Math.abs(miolo - cantos) < 0.25) return null;
  return cantos > miolo;
}

export async function criarRecortadorAvatar(timeoutMs = 25_000): Promise<RecortadorAvatar | null> {
  if (typeof window === 'undefined' || typeof document === 'undefined') return null;
  const tentar = async (): Promise<RecortadorAvatar | null> => {
    const mod = await import(/* webpackIgnore: true */ `${MEDIAPIPE_CDN}/vision_bundle.mjs`);
    const vision = await mod.FilesetResolver.forVisionTasks(`${MEDIAPIPE_CDN}/wasm`);
    const abrir = async (url: string, delegate: 'GPU' | 'CPU') =>
      mod.ImageSegmenter.createFromOptions(vision, {
        baseOptions: { modelAssetPath: url, delegate },
        runningMode: 'IMAGE',
        outputCategoryMask: false,
        outputConfidenceMasks: true,
      });
    let seg: any = null;
    let modelo: 'multiclasse' | 'selfie' = 'multiclasse';
    for (const [url, nome] of [[MODELO_MULTICLASSE, 'multiclasse'], [MODELO_SELFIE, 'selfie']] as const) {
      for (const delegate of ['GPU', 'CPU'] as const) {
        try {
          seg = await abrir(url, delegate);
          modelo = nome;
          console.log(`[avatar-recorte] segmentador ${nome} (${delegate}) pronto`);
          break;
        } catch (e) {
          console.warn(`[avatar-recorte] ${nome}/${delegate} não abriu:`, e);
        }
      }
      if (seg) break;
    }
    if (!seg) return null;
    return montarRecortador(seg, modelo);
  };
  try {
    return await Promise.race([
      tentar(),
      new Promise<null>((res) => setTimeout(() => res(null), timeoutMs)),
    ]);
  } catch (e) {
    console.warn('[avatar-recorte] MediaPipe indisponível — React vai com o card de reserva:', e);
    return null;
  }
}

function montarRecortador(seg: any, modelo: 'multiclasse' | 'selfie'): RecortadorAvatar {
  const trabalho = document.createElement('canvas');
  const tctx = trabalho.getContext('2d', { willReadFrequently: true })!;
  const mascara = document.createElement('canvas');
  const mctx = mascara.getContext('2d')!;
  // borda macia e sombra feitas na RÉGUA PEQUENA (~512px): borrar a imagem
  // em resolução cheia a cada quadro custava mais que a segmentação
  const suave = document.createElement('canvas');
  const vctx = suave.getContext('2d')!;
  const sombraC = document.createElement('canvas');
  const octx = sombraC.getContext('2d')!;
  let temSombra = false;
  const saida = document.createElement('canvas');
  const sctx = saida.getContext('2d')!;
  let anterior: Float32Array | null = null;
  let ultimoT = -1e9;
  let invertida: boolean | null = modelo === 'multiclasse' ? false : null;
  let fechado = false;
  let falhasSeguidas = 0;

  const recortar: RecortadorAvatar['recortar'] = (src, srcW, srcH, t, outW, outH) => {
    if (fechado || !(srcW > 0) || !(srcH > 0) || !(outW > 0) || !(outH > 0)) return null;
    if (falhasSeguidas >= 8) return null; // o segmentador morreu: card de reserva até o fim
    const h = Math.min(ALTURA_TRABALHO, Math.round(srcH));
    const w = Math.max(2, Math.round((srcW / srcH) * h));
    if (trabalho.width !== w || trabalho.height !== h) {
      trabalho.width = w;
      trabalho.height = h;
      mascara.width = w;
      mascara.height = h;
      suave.width = w;
      suave.height = h;
      sombraC.width = w;
      sombraC.height = h;
      anterior = null;
    }
    try {
      tctx.drawImage(src, 0, 0, srcW, srcH, 0, 0, w, h);
      let p: Float32Array | null = null;
      seg.segment(trabalho, (res: any) => {
        const masks: Float32Array[] = (res?.confidenceMasks || []).map((m: any) => m.getAsFloat32Array());
        p = probabilidadeDePessoa(masks, modelo);
      });
      if (!p || (p as Float32Array).length < w * h) {
        falhasSeguidas++;
        temSombra = false;
        return null;
      }
      const prob = p as Float32Array;
      if (invertida === null) {
        const inv = mascaraInvertida(prob, w, h);
        if (inv !== null) invertida = inv;
      }
      if (invertida) for (let i = 0; i < prob.length; i++) prob[i] = 1 - prob[i];
      // suavização no tempo — zera num salto (corte, outra janela)
      const continuo = anterior && anterior.length === prob.length && Math.abs(t - ultimoT) < 0.2;
      if (continuo) {
        const a = anterior!;
        for (let i = 0; i < prob.length; i++) prob[i] = prob[i] * 0.65 + a[i] * 0.35;
      }
      anterior = prob;
      ultimoT = t;
      const img = mctx.createImageData(w, h);
      const d = img.data;
      for (let i = 0, j = 3; i < prob.length; i++, j += 4) {
        d[j - 3] = 255;
        d[j - 2] = 255;
        d[j - 1] = 255;
        d[j] = Math.round(smoothstep(0.3, 0.72, prob[i]) * 255);
      }
      mctx.putImageData(img, 0, 0);
      vctx.globalCompositeOperation = 'copy';
      vctx.filter = 'blur(0.7px)';
      vctx.drawImage(mascara, 0, 0);
      vctx.filter = 'none';
      // sombra: a silhueta em preto, bem borrada
      octx.globalCompositeOperation = 'copy';
      octx.filter = `blur(${Math.max(3, h * 0.012).toFixed(1)}px)`;
      octx.drawImage(mascara, 0, 0);
      octx.filter = 'none';
      octx.globalCompositeOperation = 'source-in';
      octx.fillStyle = '#000';
      octx.fillRect(0, 0, w, h);
      octx.globalCompositeOperation = 'source-over';
      temSombra = true;
      if (saida.width !== Math.round(outW) || saida.height !== Math.round(outH)) {
        saida.width = Math.round(outW);
        saida.height = Math.round(outH);
      }
      sctx.globalCompositeOperation = 'copy';
      sctx.imageSmoothingEnabled = true;
      sctx.imageSmoothingQuality = 'high';
      sctx.drawImage(src, 0, 0, srcW, srcH, 0, 0, saida.width, saida.height);
      sctx.globalCompositeOperation = 'destination-in';
      // borda macia: a máscara já suavizada, ampliada com interpolação
      sctx.drawImage(suave, 0, 0, saida.width, saida.height);
      sctx.globalCompositeOperation = 'source-over';
      falhasSeguidas = 0;
      return saida;
    } catch (e) {
      falhasSeguidas++;
      if (falhasSeguidas === 1) console.warn('[avatar-recorte] quadro não segmentou:', e);
      temSombra = false;
      return null;
    }
  };

  return {
    recortar,
    sombra: () => (temSombra && !fechado ? sombraC : null),
    modelo,
    fechar: () => {
      if (fechado) return;
      fechado = true;
      anterior = null;
      try { seg.close?.(); } catch { /* já fechado */ }
    },
  };
}
