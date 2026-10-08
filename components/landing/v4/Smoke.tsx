'use client';

/**
 * Smoke — fumaça de estúdio atrás do herói, num shader WebGL.
 *
 * Ruído fbm com "domain warp" subindo devagar; o mouse empurra e acende a
 * fumaça por onde passa (o rastro é o segmento entre a posição atual e uma
 * posição atrasada — dá a sensação de esteira sem framebuffer extra).
 *
 * Custo controlado de propósito (lição de 05.10, site pesado = runtime):
 *   • desenha em MEIA resolução (fumaça é borrada, ninguém vê a diferença);
 *   • 30 quadros/s, e só com o herói na tela, aba visível e fora do modo
 *     descanso (ae-calm);
 *   • reduced-motion = um quadro parado; sem WebGL = some (o fundo da página
 *     continua lá).
 */

import { useEffect, useRef } from 'react';
import { isCalm, pointerFxAllowed } from './fx';

const VERT = `attribute vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }`;

const FRAG = `
precision mediump float;
uniform vec2 u_res;
uniform float u_time;
uniform vec2 u_mouse;
uniform vec2 u_trail;
uniform float u_energy;
uniform float u_band;

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

  // distância até a esteira do mouse (segmento rastro → mouse)
  vec2 pa = p - tr, ba = m - tr;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-4), 0.0, 1.0);
  float d = length(pa - ba * h);
  float infl = exp(-d * d * 14.0) * u_energy;

  float t = u_time * 0.04;
  vec2 q = vec2(fbm(p * 1.5 + vec2(0.0, -t * 2.2)), fbm(p * 1.5 + vec2(5.2, 1.3) - vec2(t * 0.6, t * 1.6)));
  vec2 push = (p - m) * infl * 1.2;
  vec2 r = vec2(
    fbm(p * 1.5 + 2.4 * q + vec2(1.7, 9.2) + vec2(0.0, -t * 1.4) - push),
    fbm(p * 1.5 + 2.4 * q + vec2(8.3, 2.8) + vec2(t * 0.5, -t) - push)
  );
  float f = fbm(p * 1.4 + 2.8 * r);

  float smoke = smoothstep(0.26, 0.82, f);
  // mais fumaça embaixo e nas laterais, respiro no topo (onde fica o menu)
  float shapeHero = (1.0 - smoothstep(0.35, 1.08, uv.y)) * (0.72 + 0.28 * smoothstep(0.0, 0.45, abs(uv.x - 0.5)));
  // rodapé: fumaça curta, rente à base, subindo até ~metade da altura
  float shapeBand = (1.0 - smoothstep(0.02, 0.62, uv.y)) * (0.8 + 0.2 * smoothstep(0.0, 0.5, abs(uv.x - 0.5)));
  float shape = mix(shapeHero, shapeBand, u_band);
  smoke *= shape;
  float wisp = pow(smoke, 2.4);

  vec3 red = vec3(1.0, 0.26, 0.2);
  vec3 vio = vec3(0.56, 0.36, 1.0);
  vec3 tint = mix(red, vio, clamp(uv.x * 1.15 + (q.x - 0.5) * 0.8, 0.0, 1.0));
  vec3 col = tint * (0.55 + 0.7 * smoke) * (1.0 + 1.6 * infl);
  col += vec3(1.0, 0.94, 1.0) * wisp * (0.35 + 0.9 * infl);

  // alpha pré-multiplicado VÁLIDO: rgb nunca passa do alpha (senão estoura em branco)
  float a = clamp((smoke * 0.54 + wisp * 0.22 + infl * smoke * 0.6) * (1.0 + 0.55 * u_band), 0.0, 0.85);
  gl_FragColor = vec4(clamp(col, 0.0, 1.0) * a, a);
}
`;

export function Smoke({
  className = '',
  band = false,
}: {
  className?: string;
  /** fumaça curta rente à base (rodapé) em vez da do herói */
  band?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext('webgl', { premultipliedAlpha: true, alpha: true, antialias: false, powerPreference: 'low-power' });
    // Sem WebGL (ou contexto perdido) o canvas fica INVISÍVEL: ele só aparece
    // depois do primeiro quadro desenhado com sucesso.
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
    const uBand = gl.getUniformLocation(prog, 'u_band');

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const mouseOn = pointerFxAllowed();
    // mouse em coordenadas do canvas (0..1, y pra cima), suavizado
    let mx = 0.62, my = 0.45, tx = mx, ty = my, trx = mx, try_ = my;
    let energy = 0, energyT = 0;
    let visible = true;
    let raf = 0;
    let last = 0;
    const t0 = performance.now() - 12000; // começa com a fumaça já "andando"

    const resize = () => {
      const r = canvas.getBoundingClientRect();
      const scale = window.innerWidth < 768 ? 0.42 : 0.5;
      const w = Math.max(2, Math.round(r.width * scale));
      const h = Math.max(2, Math.round(r.height * scale));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        gl.viewport(0, 0, w, h);
      }
    };

    const draw = (now: number) => {
      resize();
      mx += (tx - mx) * 0.12;
      my += (ty - my) * 0.12;
      trx += (mx - trx) * 0.035;
      try_ += (my - try_) * 0.035;
      energy += (energyT - energy) * 0.06;
      energyT *= 0.985;
      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.uniform1f(uTime, (now - t0) / 1000);
      gl.uniform2f(uMouse, mx, my);
      gl.uniform2f(uTrail, trx, try_);
      gl.uniform1f(uEnergy, energy);
      gl.uniform1f(uBand, band ? 1 : 0);
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
      if (now - last >= 1000 / 30 - 3) {
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
      if (e.pointerType !== 'mouse') return;
      const r = canvas.getBoundingClientRect();
      if (r.width <= 0) return;
      tx = (e.clientX - r.left) / r.width;
      ty = 1 - (e.clientY - r.top) / r.height;
      energyT = Math.min(1, energyT + 0.08);
    };

    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      wake();
    });
    io.observe(canvas);
    const mo = new MutationObserver(wake);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    document.addEventListener('visibilitychange', wake);
    reduced.addEventListener('change', wake);
    if (mouseOn) window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('resize', wake, { passive: true });
    wake();

    return () => {
      if (raf) cancelAnimationFrame(raf);
      io.disconnect();
      mo.disconnect();
      document.removeEventListener('visibilitychange', wake);
      reduced.removeEventListener('change', wake);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('resize', wake);
      canvas.removeEventListener('webglcontextlost', onLost);
      // NÃO descarta o contexto aqui: no dev o React monta o efeito duas
      // vezes, e um contexto perdido deixava o canvas pintando branco.
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [band]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className={'pointer-events-none ' + className}
      style={{ opacity: 0, transition: 'opacity 1.2s ease' }}
    />
  );
}
