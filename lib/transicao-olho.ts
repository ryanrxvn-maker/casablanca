/**
 * TRANSIÇÃO "PISCAR" (08.10) — as PÁLPEBRAS desenhadas no quadro.
 *
 * Silas: *"essa que parece um olho piscando, bate certinho com o SFX de click
 * do mouse"*. Por cima do vídeo entram duas pálpebras pretas que fecham em
 * forma de AMÊNDOA (o olho), o corte acontece com o olho fechado e elas abrem
 * no take novo. Quanto do olho está aberto em cada instante vem de
 * `aberturaDoOlho` (pilot-inserts.ts); aqui mora só a geometria e o desenho.
 *
 * Um módulo só, usado pelo render (export.ts) E pelo projeto editável
 * (pilot-projeto-run.ts, que grava a piscada quadro a quadro em PNG): o que o
 * CapCut/Premiere mostram é o mesmo desenho do vídeo do Pilot.
 */

/** Os cantos do olho ficam um pouco FORA do quadro: a amêndoa ocupa a largura toda. */
const CANTO_REL = 0.62;
/** Força das alças da curva — o "redondo" da pálpebra. */
const ALCA_REL = 0.42;

/** Ponto da curva de cima (cúbica de Bézier) no parâmetro s ∈ [0,1], com
 *  meia-altura `h` no centro. y negativo = acima do centro. */
function pontoDaPalpebra(s: number, R: number, h: number): { x: number; y: number } {
  const k = (4 / 3) * h; // com esta alça, a altura no meio (s=0.5) é exatamente h
  const u = 1 - s;
  const x = u * u * u * -R + 3 * u * u * s * (-R * ALCA_REL) + 3 * u * s * s * (R * ALCA_REL) + s * s * s * R;
  const y = 3 * u * u * s * -k + 3 * u * s * s * -k;
  return { x, y };
}

/**
 * A meia-altura da abertura com o olho TODO aberto: a menor que ainda deixa
 * os quatro cantos do quadro descobertos (com folga). Assim, quando a
 * abertura chega a 1, nenhum pixel está tapado e a transição some sem "estalo".
 */
export function meiaAlturaMaxima(W: number, H: number): number {
  const R = W * CANTO_REL;
  // altura relativa da curva (h = 1) na borda lateral do quadro (x = ±W/2)
  let rel = 0;
  for (let i = 0; i <= 400; i++) {
    const p = pontoDaPalpebra(i / 400, R, 1);
    if (Math.abs(p.x) <= W / 2) {
      rel = Math.abs(p.y);
      break;
    }
  }
  if (!(rel > 0)) rel = 0.3;
  return (H / 2 / rel) * 1.06;
}

/**
 * O contorno da ABERTURA (a amêndoa por onde se vê o vídeo) com `abertura`
 * (0..1), em px do quadro: os pontos da pálpebra de cima, da esquerda pra
 * direita, e os da de baixo, da direita pra esquerda.
 */
export function contornoDoOlho(W: number, H: number, abertura: number, passos = 48): Array<{ x: number; y: number }> {
  const a = Math.min(1, Math.max(0, abertura));
  const cx = W / 2;
  const cy = H / 2;
  const R = W * CANTO_REL;
  const h = meiaAlturaMaxima(W, H) * a;
  const cima: Array<{ x: number; y: number }> = [];
  for (let i = 0; i <= passos; i++) {
    const p = pontoDaPalpebra(i / passos, R, h);
    cima.push({ x: cx + p.x, y: cy + p.y });
  }
  const baixo = cima.slice().reverse().map((p) => ({ x: p.x, y: cy + (cy - p.y) }));
  return [...cima, ...baixo];
}

/**
 * Desenha as pálpebras com o olho `abertura` aberto (1 = nada na tela, 0 =
 * quadro todo preto). A borda é macia (sombra) e o miolo escurece um pouco
 * conforme o olho fecha — é o que faz ler "olho" e não "máscara".
 */
export function desenharPalpebras(ctx: CanvasRenderingContext2D, W: number, H: number, abertura: number): void {
  const a = Math.min(1, Math.max(0, abertura));
  if (a >= 0.999) return;
  ctx.save();
  if (a <= 0.001) {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
    return;
  }
  // penumbra dentro do olho: a luz diminui junto com a abertura
  ctx.fillStyle = `rgba(0,0,0,${(0.28 * (1 - a)).toFixed(3)})`;
  ctx.fillRect(0, 0, W, H);
  const contorno = contornoDoOlho(W, H, a);
  ctx.beginPath();
  // o quadro inteiro MENOS a amêndoa (regra par-ímpar)
  ctx.rect(-W, -H, W * 3, H * 3);
  ctx.moveTo(contorno[0].x, contorno[0].y);
  for (let i = 1; i < contorno.length; i++) ctx.lineTo(contorno[i].x, contorno[i].y);
  ctx.closePath();
  ctx.fillStyle = '#000';
  // borda macia da pálpebra, proporcional ao quadro
  ctx.shadowColor = 'rgba(0,0,0,0.95)';
  ctx.shadowBlur = Math.max(4, H * 0.022);
  ctx.fill('evenodd');
  ctx.restore();
}
