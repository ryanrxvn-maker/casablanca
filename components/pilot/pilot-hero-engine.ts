/**
 * Motor WebGL do herói do Pilot (09.10). Sem React: o PilotHero só monta o
 * canvas e chama startPilotHero().
 *
 * A cena conta o Pilot numa imagem só:
 *   • um CÉREBRO de partículas — sulcos de verdade (linhas de nível de um
 *     ruído 3D na superfície), fissura entre hemisférios, sulco lateral,
 *     cerebelo e tronco — que gira devagar;
 *   • o lado de saída dele vira CÓDIGO: os neurônios daquele lado viram
 *     caracteres, e fluxos de caracteres voam até os projetores;
 *   • nos projetores, AVATARES reais (6 pessoas falando, recortadas quadro a
 *     quadro — public/pilot-hero/holo-atlas.mp4) se materializam em
 *     holograma: a resolução vai "compilando", sobem de baixo pra cima,
 *     ficam realistas, seguram e se desfazem de volta em código.
 *
 * Mouse: o cérebro vira pro cursor; os neurônios perto dele acendem e abrem
 * caminho; o chão acende embaixo; passar rápido por um holograma dá
 * interferência; parar em cima SEGURA o avatar (estabiliza); clique = pulso
 * no cérebro e o próximo avatar é gerado na hora.
 *
 * Custo: 1 canvas, 3 desenhos por quadro, tudo calculado na GPU (a CPU só
 * troca uniforms). 30 q/s parado, 60 com o mouse em cima, 15 com trabalho
 * pesado no Pilot (disparo/montagem/render); para com aba oculta, fora da tela
 * ou no modo descanso; reduced-motion = quadro parado.
 */

import { isCalm } from '@/components/landing/v4/fx';
import { keepAliveRefs } from '@/lib/tab-keepalive';

export type PilotHeroEngine = { destroy(): void };

const LIME: [number, number, number] = [0.8, 0.93, 0.47];

// ── shaders ──────────────────────────────────────────────────────────────────

const BG_VS = `attribute vec2 aP; void main(){ gl_Position = vec4(aP, 0.0, 1.0); }`;

const BG_FS = `
precision mediump float;
uniform vec2 uRes; uniform float uTime; uniform vec3 uMouse; uniform vec2 uPar; uniform float uDpr;
uniform vec2 uBrainC; uniform float uBrainS; uniform float uHorizon;
uniform vec4 uSlotA; uniform vec4 uSlotB; uniform vec2 uAct;
float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }

vec3 projector(vec2 fc, vec4 s, float act){
  vec3 c = vec3(0.0);
  vec2 base = vec2(s.x, s.y - s.w * 0.5 + 3.0 * uDpr);
  vec2 rr = vec2(s.z * 0.40, s.z * 0.07);
  vec2 d = (fc - base) / rr;
  float e = length(d);
  // disco de metal do emissor (aro claro em cima, escuro embaixo)
  float disc = 1.0 - smoothstep(0.92, 1.0, e);
  c += vec3(0.07, 0.075, 0.085) * disc * (0.55 + 0.45 * clamp(d.y * 0.5 + 0.5, 0.0, 1.0));
  // anel de LED
  float ring = exp(-pow((e - 0.96) * 8.0, 2.0));
  c += vec3(${LIME.join(', ')}) * ring * (0.18 + 0.9 * act);
  // cone de luz subindo até o rosto
  float h = (fc.y - base.y) / s.w;
  if (h > 0.0 && h < 1.05) {
    float hw = mix(rr.x * 0.92, s.z * 0.56, h);
    float dx = abs(fc.x - base.x) / hw;
    float cone = (1.0 - smoothstep(0.45, 1.0, dx)) * pow(1.0 - h / 1.05, 1.7);
    float rays = 0.72 + 0.28 * sin((fc.x - base.x) / hw * 16.0 + uTime * 1.1);
    c += vec3(0.45, 0.85, 1.0) * cone * rays * 0.15 * act;
  }
  // poça de luz no chão
  vec2 pq = d * vec2(0.5, 1.0);
  c += vec3(0.5, 0.88, 1.0) * exp(-dot(pq, pq) * 0.8) * 0.09 * act;
  return c;
}

void main(){
  vec2 fc = gl_FragCoord.xy;
  vec2 uv = fc / uRes;
  vec3 col = vec3(0.010, 0.012, 0.020) + vec3(0.010, 0.008, 0.020) * uv.y;

  // halo atrás do cérebro
  vec2 bq = (fc - uBrainC) / (uBrainS * vec2(1.9, 1.45));
  col += vec3(0.16, 0.10, 0.34) * exp(-dot(bq, bq) * 1.6) * 0.5;
  col += vec3(0.30, 0.42, 0.12) * exp(-dot(bq, bq) * 5.0) * 0.07;

  // chão em perspectiva (grade fina; acende onde o mouse está)
  if (fc.y < uHorizon) {
    float d = (uHorizon - fc.y) / uHorizon;
    float z = 1.0 / (d + 0.035);
    float gx = (fc.x - uRes.x * 0.5 + uPar.x * 16.0 * uDpr) / uRes.y * z * 0.9;
    float gz = z * 0.55 - uTime * 0.10;
    vec2 g = abs(fract(vec2(gx, gz)) - 0.5);
    float wx = 1.3 * z * 0.9 / uRes.y;
    float wz = 1.3 * 0.55 * z * z / uHorizon;
    float lx = smoothstep(0.5 - wx, 0.5, g.x) * (1.0 - smoothstep(0.1, 0.3, wx));
    float lz = smoothstep(0.5 - wz, 0.5, g.y) * (1.0 - smoothstep(0.1, 0.3, wz));
    float grid = max(lx, lz);
    float fade = smoothstep(0.0, 0.55, d);
    vec2 md = (fc - uMouse.xy) / (uRes.y * vec2(0.6, 0.32));
    float spot = uMouse.z * exp(-dot(md, md) * 2.0);
    vec3 gc = mix(vec3(0.26, 0.31, 0.40), vec3(${LIME.join(', ')}), spot);
    col += gc * grid * fade * (0.09 + 0.6 * spot);
    col += vec3(0.20, 0.24, 0.34) * exp(-d * 12.0) * 0.10;
    vec2 sq = (fc - vec2(uBrainC.x, uHorizon * 0.6)) / (uBrainS * vec2(1.1, 0.16));
    col += vec3(0.30, 0.22, 0.55) * exp(-dot(sq, sq)) * 0.09;
  }

  col += projector(fc, uSlotB, uAct.y) * 0.8;
  col += projector(fc, uSlotA, uAct.x);

  vec2 vq = (uv - 0.5) * vec2(0.9, 1.3);
  col *= 1.0 - 0.6 * dot(vq, vq);
  col += (hash(fc + fract(uTime) * 91.0) - 0.5) * 0.01;
  gl_FragColor = vec4(col, 1.0);
}
`;

const HOLO_VS = `
attribute vec2 aQ;
uniform vec2 uRes; uniform vec4 uRect;
varying vec2 vUv;
void main(){
  vUv = vec2(aQ.x, 1.0 - aQ.y);
  vec2 p = uRect.xy + (aQ - 0.5) * uRect.zw;
  gl_Position = vec4(p / uRes * 2.0 - 1.0, 0.0, 1.0);
}`;

const HOLO_FS = `
precision mediump float;
uniform sampler2D uVid; uniform vec2 uCell;
uniform float uTime, uReveal, uSolid, uDissolve, uGlitch, uHover, uSeed, uAlpha, uPxH;
varying vec2 vUv;
float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
void main(){
  vec2 uv = vUv;
  // interferência: fatias horizontais deslocadas
  float band = floor(uv.y * 26.0) + floor(uTime * 14.0) * 7.0;
  float g = step(1.0 - uGlitch * 0.4, hash(vec2(band, uSeed)));
  uv.x += (hash(vec2(band, uSeed + 3.1)) - 0.5) * 0.09 * g;
  // a resolução "compila" enquanto o avatar é gerado
  float blocks = mix(12.0, 220.0, uSolid * uSolid);
  vec2 q = (floor(uv * vec2(blocks, blocks * 1.25)) + 0.5) / vec2(blocks, blocks * 1.25);
  vec2 suv = clamp(mix(q, uv, smoothstep(0.85, 1.0, uSolid)), 0.003, 0.997);
  vec2 cuv = vec2((uCell.x + suv.x * 0.5) / 3.0, (uCell.y + suv.y) / 2.0);
  vec2 muv = cuv + vec2(1.0 / 6.0, 0.0);
  float ab = 0.002 + 0.012 * uGlitch + 0.005 * (1.0 - uSolid);
  vec3 col = vec3(texture2D(uVid, cuv + vec2(ab, 0.0)).r, texture2D(uVid, cuv).g, texture2D(uVid, cuv - vec2(ab, 0.0)).b);
  float m = texture2D(uVid, muv).r;
  // os quadros são close: a cabeça flutua num oval suave
  vec2 o = (uv - vec2(0.5, 0.46)) / vec2(0.53, 0.6);
  float ov = length(o);
  m *= 1.0 - smoothstep(0.7, 1.0, ov);
  m *= 1.0 - smoothstep(0.7, 1.0, uv.y); // o pescoço se desfaz no feixe do projetor
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  vec3 tint = vec3(0.55, 0.92, 1.0);
  vec3 holo = tint * (lum * 1.4 + 0.04);
  vec3 c = mix(holo, col * 1.04, 0.2 + 0.62 * uSolid);
  float sl = 0.8 + 0.2 * sin(uv.y * uPxH * 1.6 - uTime * 9.0);
  c *= mix(sl, 1.0, 0.5 * uSolid);
  float sweep = exp(-pow((fract(uv.y * 0.8 - uTime * 0.33) - 0.5) * 16.0, 2.0));
  c += tint * sweep * 0.1;
  // sobe do projetor (frente serrilhada e acesa)
  float y = 1.0 - uv.y;
  float jag = noise(vec2(uv.x * 22.0, uTime * 3.0)) * 0.06;
  float front = uReveal * 1.12 - 0.04;
  float vis = 1.0 - smoothstep(front - 0.02, front, y + jag);
  float edge = exp(-pow((y + jag - front) * 50.0, 2.0)) * (1.0 - step(0.999, uReveal));
  // se desfaz em partículas
  float dn = noise(uv * vec2(46.0, 58.0) + uSeed * 10.0) * 0.72 + noise(uv * 7.0 + uSeed) * 0.28;
  float keep = smoothstep(uDissolve - 0.015, uDissolve + 0.015, dn);
  float dEdge = (1.0 - smoothstep(0.0, 0.05, abs(dn - uDissolve))) * step(0.001, uDissolve);
  float rim = smoothstep(0.12, 0.5, m) * (1.0 - smoothstep(0.5, 0.95, m));
  float flick = 1.0 - (1.0 - uHover) * 0.14 * step(0.93, hash(vec2(floor(uTime * 20.0), uSeed)));
  vec3 lime = vec3(${LIME.join(', ')});
  c += tint * rim * 0.45;
  c += tint * smoothstep(0.5, 0.95, ov) * 0.55; // borda acesa (fresnel)
  float a = m * vis * keep * flick * uAlpha;
  float glow = (edge * 1.5 + dEdge * 1.3) * smoothstep(0.05, 0.4, m) * uAlpha;
  // alpha baixo enquanto é holograma (soma luz), alto quando solidifica (cobre o fundo)
  gl_FragColor = vec4(c * a * 0.94 + lime * glow, a * (0.22 + 0.6 * uSolid));
}`;

const PT_VS = `
attribute vec3 aPos; attribute vec4 aSeed;
uniform vec2 uRes; uniform float uTime; uniform mat3 uRot; uniform vec2 uBrainC; uniform float uBrainS;
uniform vec3 uMouse; uniform vec2 uPulse; uniform vec4 uSlotA; uniform vec4 uSlotB; uniform vec2 uGen;
uniform float uDpr; uniform vec2 uPar; uniform float uBoot;
varying vec4 vCol; varying float vGlyph;
float h1(float n){ return fract(sin(n) * 43758.5453); }
void main(){
  float kind = aSeed.w;
  float ph = aSeed.x;
  vec2 pos; float size; vec3 col; float alpha; float glyph = -1.0;
  vec3 lime = vec3(${LIME.join(', ')});
  if (kind < 2.5) {
    // montagem: cada neurônio chega de longe (atraso aleatório) e encaixa
    float bt = clamp((uBoot - ph * 0.9) / 1.1, 0.0, 1.0);
    bt = bt * bt * (3.0 - 2.0 * bt);
    vec3 far = normalize(vec3(h1(ph * 5.1), h1(ph * 9.7), h1(ph * 2.3)) - 0.5 + 0.001) * (1.8 + h1(ph * 4.4) * 1.4);
    vec3 r = uRot * mix(far, aPos, bt);
    float s = 3.0 / (3.0 - r.z);
    vec2 sp = uBrainC + r.xy * uBrainS * s;
    float front = clamp(r.z * 0.55 + 0.5, 0.0, 1.0);
    // o mouse acende e afasta os neurônios
    vec2 dm = sp - uMouse.xy;
    float R = 95.0 * uDpr;
    float ex = uMouse.z * exp(-dot(dm, dm) / (R * R));
    sp += normalize(dm + vec2(0.001)) * ex * 18.0 * uDpr;
    float tw = pow(max(0.0, sin(uTime * (0.6 + aSeed.y * 1.4) + ph * 80.0)), 24.0);
    float wave = uPulse.y * exp(-pow((length(aPos) - uPulse.x * 1.7) * 6.0, 2.0));
    vec3 base = mix(vec3(0.40, 0.33, 0.86), vec3(0.80, 0.93, 1.0), front);
    col = mix(base, lime, clamp(ex * 0.85 + wave * 0.7, 0.0, 0.9)) + lime * (tw * 0.7 + wave * 0.6);
    alpha = (kind < 0.5 ? 0.46 : 0.14) * (0.25 + 0.75 * front) + ex * 0.22 + tw * 0.4 + wave * 0.7;
    alpha *= 0.3 + 0.7 * bt;
    size = (kind < 0.5 ? 1.8 : 1.5) * s * uDpr * (1.0 + ex * 0.7 + tw * 0.8 + wave * 0.8);
    // o lado que olha pros projetores já é código
    float side = (sp.x - uBrainC.x) / uBrainS;
    float codeK = smoothstep(0.05, 0.95, side + (h1(ph * 71.0) - 0.5) * 0.55);
    if (kind < 0.5 && bt > 0.99 && h1(ph * 19.0) < codeK * 0.42) {
      glyph = floor(mod(h1(ph * 53.0) * 64.0 + floor(uTime * (2.0 + aSeed.y * 5.0)), 64.0));
      col = mix(vec3(0.55, 0.9, 1.0), lime, h1(ph * 3.0)) * (0.85 + ex + wave);
      alpha = (0.18 + 0.32 * front) + ex * 0.4;
      size = (6.5 + 2.5 * front) * uDpr * (1.0 + ex * 0.6);
    } else if (kind < 0.5) {
      alpha *= 1.0 - codeK * 0.55; // o lado que virou código fica mais ralo em neurônio
    }
    if (kind > 1.5) {
      // fluxo de código: sai do cérebro e voa até um projetor
      float spd = 0.22 + aSeed.y * 0.16;
      float life = fract(uTime * spd + ph);
      bool toA = aSeed.z < 0.58;
      vec4 slot = toA ? uSlotA : uSlotB;
      float gen = toA ? uGen.x : uGen.y;
      float t = clamp((life - 0.06) / 0.86, 0.0, 1.0);
      vec2 tgt = slot.xy + (vec2(h1(ph * 91.0), h1(ph * 37.0)) - 0.5) * slot.zw * vec2(0.62, 0.72);
      vec2 out_ = normalize(sp - uBrainC + vec2(0.001));
      vec2 p1 = sp + out_ * 70.0 * uDpr + vec2(0.0, (h1(ph * 13.0) - 0.5) * 90.0 * uDpr);
      vec2 p2 = tgt + vec2(-90.0 * uDpr, (h1(ph * 7.0) - 0.5) * 70.0 * uDpr);
      float it = 1.0 - t;
      vec2 bz = it * it * it * sp + 3.0 * it * it * t * p1 + 3.0 * it * t * t * p2 + t * t * t * tgt;
      bz.y += sin(t * 9.0 + ph * 30.0 + uTime * 2.0) * 6.0 * uDpr * (1.0 - t);
      // o mouse puxa o fluxo
      vec2 dmb = uMouse.xy - bz;
      bz += dmb * uMouse.z * 0.22 * exp(-dot(dmb, dmb) / (120.0 * 120.0 * uDpr * uDpr)) * (1.0 - t);
      float vis = gen * smoothstep(0.0, 0.1, life) * (1.0 - smoothstep(0.88, 1.0, life)) * smoothstep(2.0, 2.6, uBoot);
      sp = bz;
      glyph = floor(mod(h1(ph * 53.0) * 64.0 + floor(uTime * (6.0 + aSeed.y * 8.0)), 64.0));
      col = mix(lime, vec3(0.62, 0.95, 1.0), t);
      alpha = vis * (0.95 - 0.35 * t);
      size = mix(13.0, 8.0, t) * uDpr;
    }
    pos = sp;
  } else {
    // poeira de luz no ar (profundidade = paralaxe)
    float depth = aSeed.y;
    vec2 q = fract(vec2(h1(ph * 11.0), h1(ph * 23.0)) + vec2(uTime * 0.004 * (0.5 + depth), uTime * 0.012 * (0.3 + aSeed.z)));
    pos = q * uRes + uPar * (6.0 + depth * 22.0) * uDpr;
    size = (0.8 + depth * 1.8) * uDpr;
    col = vec3(0.75, 0.85, 1.0);
    alpha = (0.07 + depth * 0.2) * (0.5 + 0.5 * sin(uTime * 0.7 + ph * 40.0));
  }
  vGlyph = glyph;
  vCol = vec4(col * alpha, alpha);
  gl_PointSize = size;
  gl_Position = vec4(pos / uRes * 2.0 - 1.0, 0.0, 1.0);
}`;

const PT_FS = `
precision mediump float;
uniform sampler2D uAtlas;
varying vec4 vCol; varying float vGlyph;
void main(){
  vec2 pc = gl_PointCoord;
  float a;
  if (vGlyph >= 0.0) {
    vec2 cell = vec2(mod(vGlyph, 8.0), floor(vGlyph / 8.0));
    a = texture2D(uAtlas, (cell + pc) / 8.0).a;
  } else {
    float d = length(pc - 0.5);
    a = 1.0 - smoothstep(0.0, 0.5, d);
    a *= a;
  }
  gl_FragColor = vCol * a;
}`;

// ── geometria do cérebro ────────────────────────────────────────────────────

function makeNoise3(seed: number) {
  const perm: number[] = [];
  for (let i = 0; i < 256; i++) perm.push(i);
  let s = seed;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [perm[i], perm[j]] = [perm[j], perm[i]];
  }
  const p = new Uint8Array(512);
  for (let i = 0; i < 512; i++) p[i] = perm[i & 255];
  const G = [[1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0], [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1], [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1]];
  const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const grad = (h: number, x: number, y: number, z: number) => {
    const g = G[h % 12];
    return g[0] * x + g[1] * y + g[2] * z;
  };
  return (x: number, y: number, z: number) => {
    const X = Math.floor(x) & 255, Y = Math.floor(y) & 255, Z = Math.floor(z) & 255;
    x -= Math.floor(x); y -= Math.floor(y); z -= Math.floor(z);
    const u = fade(x), v = fade(y), w = fade(z);
    const A = p[X] + Y, AA = p[A] + Z, AB = p[A + 1] + Z, B = p[X + 1] + Y, BA = p[B] + Z, BB = p[B + 1] + Z;
    return lerp(
      lerp(lerp(grad(p[AA], x, y, z), grad(p[BA], x - 1, y, z), u), lerp(grad(p[AB], x, y - 1, z), grad(p[BB], x - 1, y - 1, z), u), v),
      lerp(lerp(grad(p[AA + 1], x, y, z - 1), grad(p[BA + 1], x - 1, y, z - 1), u), lerp(grad(p[AB + 1], x, y - 1, z - 1), grad(p[BB + 1], x - 1, y - 1, z - 1), u), v),
      w,
    );
  };
}

/**
 * Volumes do cérebro (centro xyz + raios xyz): a casca é a UNIÃO deles, então
 * as fissuras aparecem sozinhas onde um lobo encontra o outro.
 * x = lateral, y = cima, z = frente.
 */
const LOBES: readonly (readonly [number, number, number, number, number, number])[] = [
  [0, 0.08, -0.04, 0.64, 0.52, 0.86], // cérebro (parietal)
  [0, 0.0, 0.42, 0.6, 0.47, 0.5], // frontal
  [0, 0.03, -0.5, 0.55, 0.43, 0.46], // occipital
  [0.45, -0.25, 0.1, 0.27, 0.21, 0.5], // temporal direito
  [-0.45, -0.25, 0.1, 0.27, 0.21, 0.5], // temporal esquerdo
  [0, -0.42, -0.52, 0.45, 0.2, 0.3], // cerebelo
];
const CEREBELO = 5;

type Built = { pos: Float32Array; sd: Float32Array; count: number };

/** Pontos do cérebro + fluxos de código + poeira. Gerador: quem chama fatia o
 *  trabalho (~100 ms no total) em pedaços curtos, sem travar a página. */
function* buildPoints(nLine: number, nFill: number, nStream: number, nDust: number): Generator<void, Built, void> {
  const noise = makeNoise3(7);
  let seed = 1337;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const total = nLine + nFill + nStream + nDust;
  const pos = new Float32Array(total * 3);
  const sd = new Float32Array(total * 4);
  const surf: number[] = [];
  let i = 0;
  const put = (x: number, y: number, z: number, kind: number) => {
    pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
    sd[i * 4] = rnd(); sd[i * 4 + 1] = rnd(); sd[i * 4 + 2] = rnd(); sd[i * 4 + 3] = kind;
    i++;
  };
  const dir = (): [number, number, number] => {
    const u = rnd() * 2 - 1, t = rnd() * Math.PI * 2, r = Math.sqrt(1 - u * u);
    return [r * Math.cos(t), u, r * Math.sin(t)];
  };
  // distância normalizada ao QUADRADO até cada lobo (sem alocar: roda ~500 mil vezes)
  const d2 = new Float64Array(LOBES.length);
  const fill = (x: number, y: number, z: number) => {
    for (let k = 0; k < LOBES.length; k++) {
      const L = LOBES[k];
      const a = (x - L[0]) / L[3], b = (y - L[1]) / L[4], c = (z - L[2]) / L[5];
      d2[k] = a * a + b * b + c * c;
    }
  };
  const inside = (x: number, y: number, z: number) => {
    for (let k = 0; k < LOBES.length; k++) {
      const L = LOBES[k];
      const a = (x - L[0]) / L[3], b = (y - L[1]) / L[4], c = (z - L[2]) / L[5];
      if (a * a + b * b + c * c < 1) return true;
    }
    return false;
  };
  // raio da casca por direção (tabela; o raio vem de fora pra dentro = casca externa)
  const O = [0, -0.06, -0.02];
  const NA = 128, NP = 64;
  const lut = new Float32Array(NA * NP);
  const dirOf = (a: number, p: number) => {
    const th = (a / NA) * Math.PI * 2, ph = (p / (NP - 1)) * Math.PI;
    return [Math.sin(ph) * Math.cos(th), Math.cos(ph), Math.sin(ph) * Math.sin(th)];
  };
  for (let a = 0; a < NA; a++) {
    for (let p = 0; p < NP; p++) {
      const [dx, dy, dz] = dirOf(a, p);
      let lo = 0, hi = 1.4;
      for (let r = 1.4; r > 0; r -= 0.04) {
        if (inside(O[0] + dx * r, O[1] + dy * r, O[2] + dz * r)) { lo = r; hi = r + 0.04; break; }
      }
      for (let k = 0; k < 8; k++) {
        const m = (lo + hi) / 2;
        if (inside(O[0] + dx * m, O[1] + dy * m, O[2] + dz * m)) lo = m; else hi = m;
      }
      lut[a * NP + p] = lo;
    }
    if (a % 8 === 7) yield;
  }
  const radius = (th: number, ph: number) => {
    const fa = ((th / (Math.PI * 2)) * NA + NA) % NA, fp = (ph / Math.PI) * (NP - 1);
    const a0 = Math.floor(fa), p0 = Math.min(NP - 2, Math.floor(fp));
    const ta = fa - a0, tp = fp - p0, a1 = (a0 + 1) % NA;
    const v = (aa: number, pp: number) => lut[aa * NP + pp];
    return (v(a0, p0) * (1 - ta) + v(a1, p0) * ta) * (1 - tp) + (v(a0, p0 + 1) * (1 - ta) + v(a1, p0 + 1) * ta) * tp;
  };
  const sample = (): [number, number, number] | null => {
    const th = rnd() * Math.PI * 2, ph = Math.acos(rnd() * 2 - 1);
    const r = radius(th, ph);
    // densidade uniforme na casca: onde ela passa perto do centro, sobra ponto
    if (rnd() > (r * r) / 0.8) return null;
    const dx = Math.sin(ph) * Math.cos(th), dy = Math.cos(ph), dz = Math.sin(ph) * Math.sin(th);
    let x = O[0] + dx * r;
    const y = O[1] + dy * r, z = O[2] + dz * r;
    fill(x, y, z);
    let best = 0, second = 99;
    for (let k = 1; k < d2.length; k++) if (d2[k] < d2[best]) best = k;
    for (let k = 0; k < d2.length; k++) if (k !== best && d2[k] < second) second = d2[k];
    // fissura onde dois lobos se encontram (Sylvius, cerebelo) — vira vão
    if (best >= 3 && Math.sqrt(second) - Math.sqrt(d2[best]) < 0.05) return null;
    if (best === CEREBELO) {
      // folhas do cerebelo: linhas finas quase horizontais
      return Math.abs(Math.sin(y * 92 + noise(x * 4, y * 4, z * 4) * 3.5)) < 0.3 ? [x, y, z] : null;
    }
    if (Math.abs(x) < 0.055 && y > -0.12) return null; // fissura entre os hemisférios
    x += Math.sign(x) * 0.03;
    // giros: só as linhas de nível do ruído (desenham os sulcos)
    return Math.abs(noise(x * 6.6 + 11, y * 6.6, z * 6.6)) < 0.06 ? [x, y, z] : null;
  };
  const nStem = Math.round(nLine * 0.025);
  let guard = 0;
  while (surf.length / 3 < nLine - nStem && guard++ < 3_000_000) {
    const p = sample();
    if (p) surf.push(p[0], p[1], p[2]);
    if (guard % 1500 === 0) yield;
  }
  // tronco
  for (let k = 0; k < nStem; k++) {
    const t = rnd(), a = rnd() * Math.PI * 2;
    surf.push(Math.cos(a) * 0.09, -0.3 - t * 0.42, -0.22 - t * 0.08 + Math.sin(a) * 0.09);
  }
  for (let k = 0; k < surf.length; k += 3) put(surf[k], surf[k + 1], surf[k + 2], 0);
  for (let k = 0; k < nFill; k++) {
    const [dx, dy, dz] = dir();
    const r = Math.cbrt(rnd()) * 0.82;
    put(dx * 0.7 * r, Math.max(-0.2, dy * 0.6 * r), dz * 0.95 * r, 1);
  }
  const nSurf = surf.length / 3;
  for (let k = 0; k < nStream; k++) {
    const j = Math.floor(rnd() * nSurf) * 3;
    put(surf[j], surf[j + 1], surf[j + 2], 2);
  }
  for (let k = 0; k < nDust; k++) put(0, 0, 0, 3);
  return { pos, sd, count: i };
}

/** Atlas 8x8 de caracteres de código (branco + alpha). */
function drawGlyphs(fam: string): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const ctx = c.getContext('2d');
  if (!ctx) return c;
  const chars = Array.from('01{}[]()<>/=;:+*-&|!?#$%λΣΔπ∂∫√∞≡→ƒACDEFILNOPRSTXYaeiotx_~^.@01');
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `700 40px ${fam}`;
  for (let k = 0; k < 64; k++) ctx.fillText(chars[k % chars.length], (k % 8) * 64 + 32, Math.floor(k / 8) * 64 + 34);
  return c;
}

// ── layout ──────────────────────────────────────────────────────────────────

type Rect = [number, number, number, number]; // cx, cy, w, h (px do canvas, y pra cima)
type Layout = { brainC: [number, number]; brainS: number; horizon: number; slots: [Rect, Rect]; twoSlots: boolean };

function layoutFor(W: number, H: number): Layout {
  if (W / H >= 2.2) {
    const hA = H * 0.66, hB = H * 0.46;
    return {
      brainC: [W * 0.55, H * 0.52],
      brainS: Math.min(H * 0.4, W * 0.14),
      horizon: H * 0.34,
      slots: [[W * 0.882, H * 0.52, hA * 0.8, hA], [W * 0.742, H * 0.585, hB * 0.8, hB]],
      twoSlots: true,
    };
  }
  const hA = H * 0.6;
  return {
    brainC: [W * 0.4, H * 0.6],
    brainS: Math.min(H * 0.32, W * 0.2),
    horizon: H * 0.36,
    slots: [[W * 0.8, H * 0.56, hA * 0.8, hA], [W * 2, H * 2, 1, 1]],
    twoSlots: false,
  };
}

// ── motor ───────────────────────────────────────────────────────────────────

type Slot = { phase: 0 | 1 | 2 | 3; t: number; person: number; hover: number; glitch: number; seed: number; gen: number; act: number };
const DUR = [0.6, 1.7, 3.4, 1.1]; // espera, gera, segura, desfaz

export function startPilotHero(canvas: HTMLCanvasElement, opts: { atlas: string; poster: string }): PilotHeroEngine | null {
  const gl = canvas.getContext('webgl', { alpha: false, antialias: false, premultipliedAlpha: true, powerPreference: 'low-power' });
  if (!gl || gl.isContextLost()) return null;
  const screen = canvas.parentElement as HTMLElement;

  const compile = (type: number, src: string) => {
    const sh = gl.createShader(type);
    if (!sh) return null;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      console.warn('[pilot-hero] shader', gl.getShaderInfoLog(sh));
      return null;
    }
    return sh;
  };
  const program = (vs: string, fs: string) => {
    const v = compile(gl.VERTEX_SHADER, vs), f = compile(gl.FRAGMENT_SHADER, fs);
    if (!v || !f) return null;
    const p = gl.createProgram();
    if (!p) return null;
    gl.attachShader(p, v);
    gl.attachShader(p, f);
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      console.warn('[pilot-hero] link', gl.getProgramInfoLog(p));
      return null;
    }
    return p;
  };
  const bg = program(BG_VS, BG_FS);
  const holo = program(HOLO_VS, HOLO_FS);
  const pts = program(PT_VS, PT_FS);
  if (!bg || !holo || !pts) return null;
  const U = (p: WebGLProgram, names: string[]) => Object.fromEntries(names.map((n) => [n, gl.getUniformLocation(p, n)])) as Record<string, WebGLUniformLocation | null>;
  const ub = U(bg, ['uRes', 'uTime', 'uMouse', 'uPar', 'uDpr', 'uBrainC', 'uBrainS', 'uHorizon', 'uSlotA', 'uSlotB', 'uAct']);
  const uh = U(holo, ['uRes', 'uRect', 'uVid', 'uCell', 'uTime', 'uReveal', 'uSolid', 'uDissolve', 'uGlitch', 'uHover', 'uSeed', 'uAlpha', 'uPxH']);
  const up = U(pts, ['uRes', 'uTime', 'uRot', 'uBrainC', 'uBrainS', 'uMouse', 'uPulse', 'uSlotA', 'uSlotB', 'uGen', 'uDpr', 'uPar', 'uAtlas', 'uBoot']);

  // buffers
  const triBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, triBuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const quadBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
  const small = window.innerWidth < 768;
  const posBuf = gl.createBuffer();
  const sdBuf = gl.createBuffer();
  // o cérebro é calculado em fatias de ~6 ms; até lá a cena roda sem ele e,
  // quando fica pronto, os neurônios chegam voando e ele se monta (uBoot)
  let ptCount = 0;
  let bootT = -1;
  const building = small ? buildPoints(8000, 500, 560, 110) : buildPoints(17000, 1000, 1200, 240);
  let buildTimer = 0;
  const pump = () => {
    buildTimer = 0;
    if (dead) return;
    const t0 = performance.now();
    while (performance.now() - t0 < 6) {
      const r = building.next();
      if (r.done) {
        gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
        gl.bufferData(gl.ARRAY_BUFFER, r.value.pos, gl.STATIC_DRAW);
        gl.bindBuffer(gl.ARRAY_BUFFER, sdBuf);
        gl.bufferData(gl.ARRAY_BUFFER, r.value.sd, gl.STATIC_DRAW);
        ptCount = r.value.count;
        bootT = reduced.matches ? 9 : 0;
        if (!raf) draw();
        return;
      }
    }
    buildTimer = window.setTimeout(pump, 16);
  };
  const aBg = gl.getAttribLocation(bg, 'aP');
  const aQ = gl.getAttribLocation(holo, 'aQ');
  const aPos = gl.getAttribLocation(pts, 'aPos');
  const aSeed = gl.getAttribLocation(pts, 'aSeed');
  let enabled: number[] = [];
  const attribs = (list: [number, WebGLBuffer | null, number][]) => {
    for (const l of enabled) gl.disableVertexAttribArray(l);
    enabled = [];
    for (const [loc, buf, size] of list) {
      if (loc < 0) continue;
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
      enabled.push(loc);
    }
  };

  // texturas
  const glyphTex = gl.createTexture();
  const uploadGlyphs = (fam: string) => {
    gl.bindTexture(gl.TEXTURE_2D, glyphTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, drawGlyphs(fam));
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  };
  const monoVar = getComputedStyle(document.body).getPropertyValue('--font-mono').trim();
  uploadGlyphs('ui-monospace, Consolas, monospace');
  if (monoVar && document.fonts?.load) {
    document.fonts.load(`700 40px ${monoVar}`).then(() => { if (!dead) { uploadGlyphs(`${monoVar}, monospace`); if (!raf) draw(); } }).catch(() => {});
  }
  const vidTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, vidTex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, 1, 1, 0, gl.RGB, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0]));
  let hasVid = false; // já tem quadro do vídeo (senão o pôster)
  const poster = new Image();
  poster.onload = () => {
    if (dead || hasVid) return;
    gl.bindTexture(gl.TEXTURE_2D, vidTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, poster);
    if (!raf) draw();
  };
  poster.src = opts.poster;
  // O vídeo fica no DOM (2px, invisível): o Chrome pausa vídeo mudo que não está
  // na página/tela e a gente quer que ele pause JUNTO com o herói, não antes.
  const video = document.createElement('video');
  video.muted = true;
  video.loop = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.setAttribute('aria-hidden', 'true');
  video.style.cssText = 'position:absolute;left:0;bottom:0;width:2px;height:2px;opacity:0.01;pointer-events:none';
  video.src = opts.atlas;
  screen.appendChild(video);
  let vidDirty = true;
  type RVFC = (cb: () => void) => number;
  const rvfc = (video as unknown as { requestVideoFrameCallback?: RVFC }).requestVideoFrameCallback?.bind(video);
  const onVidFrame = () => {
    vidDirty = true;
    if (!dead && rvfc) rvfc(onVidFrame);
  };
  if (rvfc) rvfc(onVidFrame);

  // estado
  const dpr = Math.min(window.devicePixelRatio || 1, small ? 1.25 : 1.5);
  let W = 2, H = 2;
  let L = layoutFor(W, H);
  const fit = () => {
    const r = canvas.getBoundingClientRect();
    const w = Math.max(2, Math.round(r.width * dpr)), h = Math.max(2, Math.round(r.height * dpr));
    if (w !== canvas.width || h !== canvas.height) {
      canvas.width = w;
      canvas.height = h;
    }
    W = w; H = h;
    L = layoutFor(W, H);
  };
  fit();

  const order = [0, 3, 1, 4, 5, 2];
  let nextIdx = 0;
  const pick = (avoid: number) => {
    let p = order[nextIdx++ % order.length];
    if (p === avoid) p = order[nextIdx++ % order.length];
    return p;
  };
  const slots: Slot[] = [
    { phase: 1, t: 0.2, person: pick(-1), hover: 0, glitch: 0, seed: 1.7, gen: 1, act: 1 },
    { phase: 0, t: -1.8, person: pick(-1), hover: 0, glitch: 0, seed: 5.3, gen: 0, act: 0.2 },
  ];
  slots[1].person = slots[1].person === slots[0].person ? pick(slots[0].person) : slots[1].person;

  let simT = 12;
  let mx = W * 0.6, my = H * 0.5, tmx = mx, tmy = my, mOn = 0, tmOn = 0;
  let lastMx = 0, lastMy = 0, lastMt = 0, speed = 0;
  let parX = 0, parY = 0;
  let yaw = 1.2, pitch = 0.2;
  let pulseT = 9, pulseS = 0;
  let inside = false;
  let burst = 4;

  const rectOf = (k: number): Rect => {
    const s = slots[k], r = L.slots[k];
    const grow = 0.96 + 0.04 * Math.min(1, s.phase === 1 ? s.t / DUR[1] : 1) + 0.035 * s.hover;
    return [r[0] + parX * (k === 0 ? 14 : 9) * dpr, r[1] - parY * 6 * dpr, r[2] * grow, r[3] * grow];
  };
  const smooth = (a: number, b: number, x: number) => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  const look = (s: Slot) => {
    const t = s.t;
    switch (s.phase) {
      case 1: return { reveal: smooth(0, 1.25, t), solid: smooth(0.45, 1.7, t), dissolve: 0 };
      case 2: return { reveal: 1, solid: 1, dissolve: 0 };
      case 3: return { reveal: 1, solid: 1 - 0.55 * smooth(0, 0.6, t), dissolve: Math.pow(smooth(0, DUR[3], t), 0.8) };
      default: return { reveal: 0, solid: 0, dissolve: 0 };
    }
  };

  const step = (dt: number) => {
    simT += dt;
    mx += (tmx - mx) * Math.min(1, dt * 10);
    my += (tmy - my) * Math.min(1, dt * 10);
    mOn += (tmOn - mOn) * Math.min(1, dt * 5);
    speed *= Math.pow(0.02, dt);
    const nx = inside ? (mx / W) * 2 - 1 : 0, ny = inside ? (my / H) * 2 - 1 : 0;
    parX += (nx - parX) * Math.min(1, dt * 3);
    parY += (ny - parY) * Math.min(1, dt * 3);
    const tYaw = 1.2 + parX * 0.55 + Math.sin(simT * 0.23) * 0.2;
    const tPitch = 0.2 - parY * 0.24 + Math.sin(simT * 0.17) * 0.05;
    yaw += (tYaw - yaw) * Math.min(1, dt * 2.2);
    pitch += (tPitch - pitch) * Math.min(1, dt * 2.2);
    pulseT += dt;
    pulseS = Math.max(0, 1 - pulseT / 1.4);
    if (bootT >= 0 && bootT < 9) bootT += dt;
    burst -= dt;
    slots.forEach((s, k) => {
      if (k === 1 && !L.twoSlots) return;
      const [cx, cy, w, h] = rectOf(k);
      const over = inside && Math.abs(mx - cx) < w * 0.45 && Math.abs(my - cy) < h * 0.48;
      s.hover += ((over ? 1 : 0) - s.hover) * Math.min(1, dt * 6);
      const near = inside ? Math.exp(-((mx - cx) ** 2 + (my - cy) ** 2) / (w * w * 0.6)) : 0;
      let g = near * Math.min(1, speed / (1600 * dpr)) * (1 - s.hover * 0.7);
      if (burst < 0 && k === (Math.floor(simT) % 2)) { g = Math.max(g, 0.55); if (burst < -0.16) burst = 3 + Math.random() * 4; }
      s.glitch += (g - s.glitch) * Math.min(1, dt * 12);
      if (!(s.phase === 2 && s.hover > 0.5)) s.t += dt; // parar em cima segura o avatar
      if (s.t >= DUR[s.phase]) {
        s.t = 0;
        s.phase = ((s.phase + 1) % 4) as Slot['phase'];
        if (s.phase === 1) s.person = pick(slots[1 - k].person);
      }
      const gt = s.phase === 0 ? smooth(0, DUR[0], Math.max(0, s.t)) : s.phase === 1 ? 1 : s.phase === 2 ? 1 - 0.8 * smooth(0, 0.9, s.t) : 0.2 * (1 - s.t / DUR[3]);
      const at = s.phase === 0 ? 0.2 + 0.5 * smooth(0, DUR[0], Math.max(0, s.t)) : s.phase === 3 ? 0.85 - 0.6 * smooth(0, DUR[3], s.t) : s.phase === 1 ? 1 : 0.85;
      s.gen += (gt - s.gen) * Math.min(1, dt * 4);
      s.act += (at - s.act) * Math.min(1, dt * 5);
    });
  };

  const draw = () => {
    if (dead) return;
    if (vidDirty && video.readyState >= 2) {
      gl.bindTexture(gl.TEXTURE_2D, vidTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, video);
      hasVid = true;
      vidDirty = !rvfc;
    }
    gl.viewport(0, 0, W, H);
    const A = rectOf(0);
    const B: Rect = L.twoSlots ? rectOf(1) : [W * 3, H * 3, 1, 1];
    const brainC: [number, number] = [L.brainC[0] + parX * 7 * dpr, L.brainC[1] - parY * 5 * dpr];
    const mouse: [number, number, number] = [mx, my, mOn];

    // 1. fundo
    gl.disable(gl.BLEND);
    gl.useProgram(bg);
    attribs([[aBg, triBuf, 2]]);
    gl.uniform2f(ub.uRes, W, H);
    gl.uniform1f(ub.uTime, simT);
    gl.uniform3f(ub.uMouse, ...mouse);
    gl.uniform2f(ub.uPar, parX, parY);
    gl.uniform1f(ub.uDpr, dpr);
    gl.uniform2f(ub.uBrainC, ...brainC);
    gl.uniform1f(ub.uBrainS, L.brainS);
    gl.uniform1f(ub.uHorizon, L.horizon);
    gl.uniform4f(ub.uSlotA, ...A);
    gl.uniform4f(ub.uSlotB, ...B);
    gl.uniform2f(ub.uAct, slots[0].act, L.twoSlots ? slots[1].act : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // 2. hologramas (o de trás primeiro)
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(holo);
    attribs([[aQ, quadBuf, 2]]);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, vidTex);
    gl.uniform1i(uh.uVid, 0);
    gl.uniform2f(uh.uRes, W, H);
    gl.uniform1f(uh.uTime, simT);
    for (const k of L.twoSlots ? [1, 0] : [0]) {
      const s = slots[k];
      if (s.phase === 0) continue;
      const lk = look(s);
      const r = k === 0 ? A : B;
      gl.uniform4f(uh.uRect, ...r);
      gl.uniform2f(uh.uCell, s.person % 3, Math.floor(s.person / 3));
      gl.uniform1f(uh.uReveal, lk.reveal);
      gl.uniform1f(uh.uSolid, lk.solid);
      gl.uniform1f(uh.uDissolve, lk.dissolve);
      gl.uniform1f(uh.uGlitch, s.glitch);
      gl.uniform1f(uh.uHover, s.hover);
      gl.uniform1f(uh.uSeed, s.seed + s.person);
      gl.uniform1f(uh.uAlpha, k === 0 ? 1 : 0.8);
      gl.uniform1f(uh.uPxH, r[3]);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    // 3. cérebro + código + poeira (luz somada)
    if (!ptCount) return;
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.useProgram(pts);
    attribs([[aPos, posBuf, 3], [aSeed, sdBuf, 4]]);
    gl.bindTexture(gl.TEXTURE_2D, glyphTex);
    gl.uniform1i(up.uAtlas, 0);
    const cy = Math.cos(yaw), sy = Math.sin(yaw), cx = Math.cos(pitch), sx = Math.sin(pitch);
    gl.uniformMatrix3fv(up.uRot, false, [cy, sx * sy, -cx * sy, 0, cx, sx, sy, -sx * cy, cx * cy]);
    gl.uniform2f(up.uRes, W, H);
    gl.uniform1f(up.uTime, simT);
    gl.uniform2f(up.uBrainC, ...brainC);
    gl.uniform1f(up.uBrainS, L.brainS);
    gl.uniform3f(up.uMouse, ...mouse);
    gl.uniform2f(up.uPulse, pulseT, pulseS);
    gl.uniform4f(up.uSlotA, ...A);
    gl.uniform4f(up.uSlotB, ...B);
    gl.uniform2f(up.uGen, slots[0].gen, L.twoSlots ? slots[1].gen : 0);
    gl.uniform1f(up.uDpr, dpr);
    gl.uniform2f(up.uPar, parX, parY);
    gl.uniform1f(up.uBoot, bootT);
    gl.drawArrays(gl.POINTS, 0, ptCount);
  };

  // laço
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  let dead = false;
  let visible = true;
  let raf = 0;
  let lastDraw = 0;
  const live = () => !dead && visible && !reduced.matches && !isCalm();
  const tick = (now: number) => {
    raf = 0;
    if (!live()) return;
    const fps = keepAliveRefs() > 0 ? 15 : inside ? 60 : 30;
    if (now - lastDraw >= 1000 / fps - 3) {
      step(Math.min(0.1, lastDraw ? (now - lastDraw) / 1000 : 0.016));
      lastDraw = now;
      draw();
    }
    raf = requestAnimationFrame(tick);
  };
  const wake = () => {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    if (dead) return;
    if (live()) {
      lastDraw = 0;
      video.play().catch(() => {});
      raf = requestAnimationFrame(tick);
    } else {
      video.pause();
      if (reduced.matches) {
        // quadro parado: um avatar inteiro no projetor
        slots[0].phase = 2; slots[0].t = 0; slots[0].gen = 0.3; slots[0].act = 0.85;
      }
      draw();
    }
  };
  video.addEventListener('loadeddata', () => { vidDirty = true; if (!raf) draw(); });

  // mouse (as coordenadas do motor são px do canvas com y pra cima)
  const toLocal = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    return [(e.clientX - r.left) * dpr, (r.height - (e.clientY - r.top)) * dpr] as const;
  };
  const onMove = (e: PointerEvent) => {
    const [x, y] = toLocal(e);
    const now = performance.now();
    if (lastMt) {
      const v = Math.hypot(x - lastMx, y - lastMy) / Math.max(1, now - lastMt) * 1000;
      speed = Math.max(speed * 0.8, v);
    }
    lastMx = x; lastMy = y; lastMt = now;
    tmx = x; tmy = y;
    if (e.pointerType === 'mouse') { tmOn = 1; inside = true; }
  };
  const onLeave = () => { tmOn = 0; inside = false; lastMt = 0; };
  const onDown = (e: PointerEvent) => {
    const [x, y] = toLocal(e);
    pulseT = 0;
    // clique num holograma (ou em qualquer lugar): o avatar que está parado se
    // desfaz e o próximo é gerado
    let k = slots.findIndex((s, i) => { const [cx, cy, w, h] = rectOf(i); return (i === 0 || L.twoSlots) && Math.abs(x - cx) < w * 0.45 && Math.abs(y - cy) < h * 0.48; });
    if (k < 0) k = slots.reduce((b, s, i) => ((i === 0 || L.twoSlots) && s.phase === 2 && (b < 0 || s.t > slots[b].t) ? i : b), -1);
    if (k >= 0 && slots[k].phase === 2) { slots[k].phase = 3; slots[k].t = 0; slots[k].hover = 0; }
    if (!raf) wake();
  };
  screen.addEventListener('pointermove', onMove, { passive: true });
  screen.addEventListener('pointerleave', onLeave);
  screen.addEventListener('pointerdown', onDown);

  const ro = new ResizeObserver(() => { fit(); if (!raf) draw(); });
  ro.observe(canvas);
  const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; wake(); });
  io.observe(canvas);
  const mo = new MutationObserver(wake);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  document.addEventListener('visibilitychange', wake);
  reduced.addEventListener('change', wake);
  const onLost = (e: Event) => { e.preventDefault(); dead = true; canvas.style.opacity = '0'; video.pause(); };
  canvas.addEventListener('webglcontextlost', onLost);
  buildTimer = window.setTimeout(pump, 0);
  wake();

  return {
    destroy() {
      dead = true;
      if (raf) cancelAnimationFrame(raf);
      if (buildTimer) clearTimeout(buildTimer);
      ro.disconnect();
      io.disconnect();
      mo.disconnect();
      document.removeEventListener('visibilitychange', wake);
      reduced.removeEventListener('change', wake);
      screen.removeEventListener('pointermove', onMove);
      screen.removeEventListener('pointerleave', onLeave);
      screen.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('webglcontextlost', onLost);
      video.pause();
      video.removeAttribute('src');
      video.load();
      video.remove();
    },
  };
}
