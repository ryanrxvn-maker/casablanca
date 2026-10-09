'use client';

/**
 * PilotSmoke — a fumaça da landing (mesmo shader de ruído com "domain warp"),
 * adaptada pra ser o FUNDO de uma ferramenta de trabalho:
 *
 *   • forma de página: sobe da base e abraça as laterais, com respiro no miolo
 *     (é ali que mora o conteúdo, a leitura não pode brigar com a fumaça);
 *   • o mouse empurra a fumaça e ACENDE o rastro na cor do Pilot (lime);
 *   • custo menor que o da landing: 38% da resolução, 30 quadros/s, e cai pra
 *     15 quadros/s enquanto o Pilot segura trabalho pesado (disparo, montagem,
 *     render por reprodução) — a GPU fica pra quem está trabalhando;
 *   • para de vez com a aba oculta, fora da tela ou no modo descanso (ae-calm);
 *     reduced-motion = um quadro parado; sem WebGL = some sem deixar rastro.
 *
 * Arquivo próprio (e não o Smoke.tsx da landing) de propósito: a pasta da
 * landing tem guarda que proíbe citar ferramenta interna, e a landing não
 * precisa carregar nada do Pilot.
 */

import { memo, useEffect, useRef } from 'react';
import { isCalm, pointerFxAllowed } from '@/components/landing/v4/fx';
import { keepAliveRefs } from '@/lib/tab-keepalive';

const VERT = `attribute vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }`;

const FRAG = `
precision mediump float;
uniform vec2 u_res;
uniform float u_time;
uniform vec2 u_mouse;
uniform vec2 u_trail;
uniform float u_energy;
uniform vec3 u_colA;
uniform vec3 u_colB;
uniform vec3 u_ign;
uniform float u_gain;
uniform float u_sat;

float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p){
  float v = 0.0, a = 0.5;
  mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 5; i++) { v += a * noise(p); p = m * p; a *= 0.5; }
  return v;
}

void main(){
  vec2 uv = gl_FragCoord.xy / u_res;
  float asp = u_res.x / u_res.y;
  vec2 p = vec2(uv.x * asp, uv.y);
  vec2 m = vec2(u_mouse.x * asp, u_mouse.y);
  vec2 tr = vec2(u_trail.x * asp, u_trail.y);

  // esteira do mouse (segmento rastro -> mouse)
  vec2 pa = p - tr, ba = m - tr;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-4), 0.0, 1.0);
  float d = length(pa - ba * h);
  float infl = exp(-d * d * 11.0) * u_energy;

  float t = u_time * 0.035;
  vec2 q = vec2(fbm(p * 1.3 + vec2(0.0, -t * 2.2)), fbm(p * 1.3 + vec2(5.2, 1.3) - vec2(t * 0.6, t * 1.6)));
  vec2 push = (p - m) * infl * 1.2;
  vec2 r = vec2(
    fbm(p * 1.3 + 2.4 * q + vec2(1.7, 9.2) + vec2(0.0, -t * 1.4) - push),
    fbm(p * 1.3 + 2.4 * q + vec2(8.3, 2.8) + vec2(t * 0.5, -t) - push)
  );
  float f = fbm(p * 1.25 + 2.8 * r);
  float smoke = smoothstep(0.27, 0.84, f);

  // sobe da base, abraça as laterais, respira no miolo e no topo
  float base = 1.0 - smoothstep(0.0, 0.8, uv.y);
  float side = smoothstep(0.14, 0.5, abs(uv.x - 0.5));
  float shape = clamp(base * 0.95 + side * 0.72 * (1.0 - 0.45 * smoothstep(0.5, 1.0, uv.y)) + 0.1, 0.0, 1.0);
  // some suave rente à barra do topo (sem linha dura onde o canvas começa)
  shape *= 1.0 - smoothstep(0.82, 1.0, uv.y);
  smoke *= shape;
  float wisp = pow(smoke, 2.4);

  vec3 tint = mix(u_colA, u_colB, clamp(uv.x * 1.1 + (q.x - 0.5) * 0.9 - 0.05, 0.0, 1.0));
  tint = mix(tint, u_ign, clamp(infl * 1.5, 0.0, 0.85));
  vec3 col = tint * (0.5 + 0.7 * smoke) * (1.0 + 1.3 * infl);
  col += vec3(1.0, 0.97, 1.0) * wisp * (0.3 + 0.8 * infl);
  // a mesma dessaturação que o site aplica no conteúdo (saturate .72 no
  // escuro); u_sat = 1 no claro
  col = mix(vec3(dot(col, vec3(0.2126, 0.7152, 0.0722))), col, u_sat);

  // alpha pré-multiplicado VÁLIDO: rgb nunca passa do alpha
  float a = clamp((smoke * 0.5 + wisp * 0.2 + infl * smoke * 0.55) * u_gain, 0.0, 0.8);
  gl_FragColor = vec4(clamp(col, 0.0, 1.0) * a, a);
}
`;

type RGB = readonly [number, number, number];

/** Paleta: A (esquerda) -> B (direita), e a cor que acende no rastro do mouse. */
const PALETA: { a: RGB; b: RGB; ign: RGB } = {
  // as mesmas duas cores da fumaça da landing (vermelho -> violeta)...
  a: [1.0, 0.26, 0.2],
  b: [0.56, 0.36, 1.0],
  // ...e o rastro do mouse acende no lime do Pilot
  ign: [0.8, 0.93, 0.47],
};

function PilotSmokeImpl({
  className = '',
  strength = 1,
  ignite = PALETA.ign,
}: {
  className?: string;
  /** multiplica a opacidade (a página inicial usa uma fumaça mais suave) */
  strength?: number;
  /** cor que acende no rastro do mouse (Pilot = lime) */
  ignite?: RGB;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext('webgl', { premultipliedAlpha: true, alpha: true, antialias: false, powerPreference: 'low-power' });
    if (!gl || gl.isContextLost()) return;
    let shown = false;
    let dead = false;
    const onLost = (e: Event) => {
      e.preventDefault();
      dead = true;
      canvas.style.opacity = '0';
    };
    canvas.addEventListener('webglcontextlost', onLost);

    const compile = (type: number, src: string) => {
      const sh = gl.createShader(type);
      if (!sh) return null;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      return gl.getShaderParameter(sh, gl.COMPILE_STATUS) ? sh : null;
    };
    const vs = compile(gl.VERTEX_SHADER, VERT);
    const fs = compile(gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) return;
    const prog = gl.createProgram();
    if (!prog) return;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const uRes = gl.getUniformLocation(prog, 'u_res');
    const uTime = gl.getUniformLocation(prog, 'u_time');
    const uMouse = gl.getUniformLocation(prog, 'u_mouse');
    const uTrail = gl.getUniformLocation(prog, 'u_trail');
    const uEnergy = gl.getUniformLocation(prog, 'u_energy');
    const uGain = gl.getUniformLocation(prog, 'u_gain');
    const uSat = gl.getUniformLocation(prog, 'u_sat');
    gl.uniform3fv(gl.getUniformLocation(prog, 'u_colA'), PALETA.a as unknown as number[]);
    gl.uniform3fv(gl.getUniformLocation(prog, 'u_colB'), PALETA.b as unknown as number[]);
    gl.uniform3fv(gl.getUniformLocation(prog, 'u_ign'), ignite as unknown as number[]);

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const mouseOn = pointerFxAllowed();
    let mx = 0.7, my = 0.3, tx = mx, ty = my, trx = mx, try_ = my;
    let energy = 0, energyT = 0;
    let visible = true;
    let raf = 0;
    let last = 0;
    let rect = canvas.getBoundingClientRect();
    const t0 = performance.now() - 15000; // já começa "andando"

    const fit = () => {
      rect = canvas.getBoundingClientRect();
      const scale = window.innerWidth < 768 ? 0.3 : 0.38;
      const w = Math.max(2, Math.round(rect.width * scale));
      const h = Math.max(2, Math.round(rect.height * scale));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        gl.viewport(0, 0, w, h);
      }
    };
    fit();

    const draw = (now: number) => {
      mx += (tx - mx) * 0.12;
      my += (ty - my) * 0.12;
      trx += (mx - trx) * 0.035;
      try_ += (my - try_) * 0.035;
      energy += (energyT - energy) * 0.06;
      energyT *= 0.985;
      const light = document.documentElement.getAttribute('data-theme') === 'light';
      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.uniform1f(uTime, (now - t0) / 1000);
      gl.uniform2f(uMouse, mx, my);
      gl.uniform2f(uTrail, trx, try_);
      gl.uniform1f(uEnergy, energy);
      gl.uniform1f(uGain, (light ? 0.55 : 1) * strength);
      gl.uniform1f(uSat, light ? 1 : 0.72);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (!shown && gl.getError() === gl.NO_ERROR) {
        shown = true;
        canvas.style.opacity = '1';
      }
    };

    const live = () => !dead && visible && !reduced.matches && !isCalm();
    const tick = (now: number) => {
      raf = 0;
      if (!live()) return;
      // Trabalho pesado na aba (disparo/montagem/render): meia cadência.
      const fps = keepAliveRefs() > 0 ? 15 : 30;
      if (now - last >= 1000 / fps - 3) {
        last = now;
        draw(now);
      }
      raf = requestAnimationFrame(tick);
    };
    const wake = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      if (dead) return;
      if (live()) raf = requestAnimationFrame(tick);
      else draw(performance.now());
    };

    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse' || rect.width <= 0) return;
      tx = (e.clientX - rect.left) / rect.width;
      ty = 1 - (e.clientY - rect.top) / rect.height;
      energyT = Math.min(1, energyT + 0.07);
    };

    const ro = new ResizeObserver(() => {
      fit();
      if (!raf) draw(performance.now());
    });
    ro.observe(canvas);
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      wake();
    });
    io.observe(canvas);
    const mo = new MutationObserver(wake);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme'] });
    document.addEventListener('visibilitychange', wake);
    reduced.addEventListener('change', wake);
    if (mouseOn) window.addEventListener('pointermove', onMove, { passive: true });
    wake();

    return () => {
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      mo.disconnect();
      document.removeEventListener('visibilitychange', wake);
      reduced.removeEventListener('change', wake);
      window.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('webglcontextlost', onLost);
      // NÃO descarta o contexto: no dev o React monta o efeito duas vezes e um
      // contexto perdido deixava o canvas pintando branco (lição da landing).
    };
    // strength/ignite são fixos por uso (constantes de quem chama): recriar o
    // WebGL por causa deles seria só custo
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className={'pointer-events-none ' + className}
      style={{ opacity: 0, transition: 'opacity 1.4s ease' }}
    />
  );
}

/** Memo: a página do Pilot re-renderiza muito; a fumaça não tem por que ir junto. */
export const PilotSmoke = memo(PilotSmokeImpl);
