'use client';

/**
 * HubFooter — rodapé da página inicial logada (/tools), 09.10.
 *
 * Mesma família do rodapé da landing (fio de luz no topo, colunas, o nome
 * gigante cortado pela borda), mas com uma peça própria: o "Auto Edit"
 * gigante é FEITO DE FUMAÇA. Um shader WebGL desenha a fumaça da landing
 * (vermelho → violeta) subindo da base e, dentro das letras, a mesma fumaça
 * mais densa e acesa — o nome está sempre se mexendo. O mouse empurra a
 * fumaça e acende as letras por onde passa; o fio de luz do topo acompanha o
 * cursor.
 *
 * Escuro no tema escuro; no claro vira papel claro com o nome em TINTA
 * colorida (luz não aparece em fundo claro), sombra macia e fio de vidro.
 *
 * Custo (regras de 05.10): 30 quadros/s e SÓ com o rodapé na tela, aba
 * visível e fora do modo descanso; resolução reduzida (fumaça é borrada);
 * reduced-motion = quadro parado; sem WebGL = o nome em vidro (CSS), nada
 * quebra. O mouse escreve variáveis só nos próprios elementos.
 */

import Link from 'next/link';
import { useEffect, useRef } from 'react';
import { DarkoLogo } from '@/components/DarkoLogo';
import { isCalm, pointerFxAllowed, useMagnetic } from '@/components/landing/v4/fx';
import { whatsappUrl } from '@/lib/help-chat';

const VERT = `attribute vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }`;

const FRAG = `
precision mediump float;
uniform vec2 u_res;
uniform float u_time;
uniform vec2 u_mouse;
uniform vec2 u_trail;
uniform float u_energy;
uniform sampler2D u_text;
uniform vec4 u_mark; // retângulo do nome em px do canvas (x0, y0, x1, y1), y pra cima
uniform float u_light; // tema claro: a fumaça vira TINTA (luz some em fundo claro)

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
  float infl = exp(-d * d * 10.0) * u_energy;

  // a mesma fumaça da landing (ruído com domain warp subindo devagar)
  float t = u_time * 0.04;
  vec2 q = vec2(fbm(p * 1.5 + vec2(0.0, -t * 2.2)), fbm(p * 1.5 + vec2(5.2, 1.3) - vec2(t * 0.6, t * 1.6)));
  vec2 push = (p - m) * infl * 1.2;
  vec2 r = vec2(
    fbm(p * 1.5 + 2.4 * q + vec2(1.7, 9.2) + vec2(0.0, -t * 1.4) - push),
    fbm(p * 1.5 + 2.4 * q + vec2(8.3, 2.8) + vec2(t * 0.5, -t) - push)
  );
  float f = fbm(p * 1.4 + 2.8 * r);

  vec3 red = vec3(1.0, 0.26, 0.2);
  vec3 vio = vec3(0.56, 0.36, 1.0);
  vec3 tint = mix(red, vio, clamp(uv.x * 1.15 + (q.x - 0.5) * 0.8, 0.0, 1.0));

  // fora das letras: fumaça curta subindo da base
  float band = (1.0 - smoothstep(0.0, 0.62, uv.y)) * (0.78 + 0.22 * smoothstep(0.0, 0.5, abs(uv.x - 0.5)));
  float sOut = smoothstep(0.26, 0.82, f) * band;
  float wisp = pow(sOut, 2.4);
  vec3 colOut = tint * (0.55 + 0.7 * sOut) * (1.0 + 1.6 * infl) + vec3(1.0, 0.94, 1.0) * wisp * (0.35 + 0.9 * infl);
  float aOut = clamp(sOut * 0.42 + wisp * 0.2 + infl * sOut * 0.6, 0.0, 0.75);

  // dentro das letras: fumaça mais densa e acesa (o nome é feito dela)
  float txt = texture2D(u_text, uv).a * step(u_mark.y, gl_FragCoord.y);
  // efeitos de borda medidos pelo tamanho do nome (no celular ele é bem menor)
  float U = max(0.35, (u_mark.w - u_mark.y) / 180.0);
  vec2 px = U / u_res;
  vec2 px1 = 1.0 / u_res;
  float halo = 0.0;
  for (int i = 0; i < 8; i++) {
    float an = float(i) * 0.7853982;
    halo += texture2D(u_text, uv + vec2(cos(an), sin(an)) * px * 9.0).a;
  }
  halo = halo / 8.0 * step(u_mark.y, gl_FragCoord.y);
  float dens = smoothstep(0.15, 0.75, f);
  // as letras somem pra baixo (como o nome em vidro da landing)
  float down = smoothstep(u_mark.y, u_mark.y + (u_mark.w - u_mark.y) * 0.62, gl_FragCoord.y);
  vec3 colIn = mix(tint * 1.1, vec3(0.98, 0.94, 1.0), clamp(dens * dens * 0.6 + infl * 0.6, 0.0, 0.9)) * (0.45 + 1.0 * dens + 1.3 * infl);
  float aIn = clamp(0.24 + 0.76 * dens + infl * 0.7, 0.0, 1.0) * mix(0.2, 1.0, down);
  // fio de luz na borda de cima de cada letra (vidro)
  float topEdge = clamp(txt - texture2D(u_text, uv + vec2(0.0, max(px.y * 3.0, px1.y * 1.5))).a, 0.0, 1.0) * down;
  // aro de luz em volta das letras
  float rim = clamp(halo - txt, 0.0, 1.0) * (0.25 + 0.75 * down);

  vec3 col;
  float a;
  if (u_light < 0.5) {
    col = mix(colOut * aOut, colIn * aIn, txt) + vio * rim * (0.22 + 0.9 * infl) + vec3(1.0, 0.95, 1.0) * topEdge * (0.35 + 0.6 * infl);
    a = clamp(mix(aOut, aIn, txt) + rim * (0.14 + 0.5 * infl) + topEdge * 0.35, 0.0, 1.0);
  } else {
    // claro: as mesmas cores em tom de tinta, sombra macia embaixo das letras
    // e fio de vidro branco em cima; o mouse deixa a tinta mais viva
    vec3 ink = mix(vec3(0.8, 0.17, 0.2), vec3(0.38, 0.21, 0.88), clamp(uv.x * 1.15 + (q.x - 0.5) * 0.8, 0.0, 1.0));
    float aO = clamp(sOut * 0.26 + infl * sOut * 0.4, 0.0, 0.42);
    vec3 cI = mix(ink * 0.5, ink * 1.12, dens);
    cI = mix(cI, mix(ink, vec3(1.0, 0.42, 0.72), 0.32) * 1.15, clamp(infl * 0.85, 0.0, 0.85));
    float aI = clamp(0.52 + 0.48 * dens + infl * 0.3, 0.0, 1.0) * mix(0.22, 1.0, down);
    float sh = 0.0;
    for (int i = 0; i < 8; i++) {
      float an = float(i) * 0.7853982;
      sh += texture2D(u_text, uv + vec2(-2.0 * px.x, 9.0 * px.y) + vec2(cos(an), sin(an)) * px * 7.0).a;
    }
    sh = sh / 8.0 * step(u_mark.y, gl_FragCoord.y) * (1.0 - txt) * down * 0.24;
    float edge = topEdge * 0.75;
    float glow = rim * infl * 0.3;
    col = mix(ink * aO, cI * aI, txt) + vec3(0.16, 0.08, 0.28) * sh + vec3(1.0) * edge + ink * glow;
    a = clamp(mix(aO, aI, txt) + sh + edge + glow, 0.0, 1.0);
  }
  gl_FragColor = vec4(min(col, vec3(a)), a);
}
`;

function useFooterSmoke(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  markRef: React.RefObject<HTMLDivElement | null>,
  wordRef: React.RefObject<HTMLSpanElement | null>,
  rootRef: React.RefObject<HTMLElement | null>,
) {
  useEffect(() => {
    const canvas = canvasRef.current, mark = markRef.current, word = wordRef.current, root = rootRef.current;
    if (!canvas || !mark || !word || !root) return;
    const gl = canvas.getContext('webgl', { premultipliedAlpha: true, alpha: true, antialias: false, powerPreference: 'low-power' });
    if (!gl || gl.isContextLost()) return;
    let dead = false;
    let shown = false;
    const onLost = (e: Event) => {
      e.preventDefault();
      dead = true;
      canvas.style.opacity = '0';
      delete root.dataset.gl;
    };
    canvas.addEventListener('webglcontextlost', onLost);

    const compile = (type: number, src: string) => {
      const sh = gl.createShader(type);
      if (!sh) return null;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      return gl.getShaderParameter(sh, gl.COMPILE_STATUS) ? sh : null;
    };
    const vs = compile(gl.VERTEX_SHADER, VERT), fs = compile(gl.FRAGMENT_SHADER, FRAG);
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
    const U = (n: string) => gl.getUniformLocation(prog, n);
    const uRes = U('u_res'), uTime = U('u_time'), uMouse = U('u_mouse'), uTrail = U('u_trail'), uEnergy = U('u_energy'), uMark = U('u_mark'), uLight = U('u_light');
    gl.uniform1i(U('u_text'), 0);

    // o nome vira uma máscara (textura) no mesmo tamanho do canvas
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const textCanvas = document.createElement('canvas');
    let markPx: [number, number, number, number] = [0, 0, 0, 0];
    let scale = 1;

    const layout = () => {
      const r = canvas.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return;
      scale = Math.min(window.devicePixelRatio || 1, 1.5) * (window.innerWidth < 768 ? 0.6 : 0.8);
      const w = Math.max(2, Math.round(r.width * scale)), h = Math.max(2, Math.round(r.height * scale));
      canvas.width = w;
      canvas.height = h;
      gl.viewport(0, 0, w, h);
      // onde o nome mora (mesma conta do CSS do nome em vidro)
      const mr = mark.getBoundingClientRect();
      const x0 = (mr.left - r.left) * scale, x1 = (mr.right - r.left) * scale;
      const yTop = (mr.top - r.top) * scale, yBot = (mr.bottom - r.top) * scale;
      markPx = [x0, h - yBot, x1, h - yTop];
      textCanvas.width = w;
      textCanvas.height = h;
      const ctx = textCanvas.getContext('2d');
      if (!ctx) return;
      const cs = getComputedStyle(word);
      const size = parseFloat(cs.fontSize) * scale;
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.font = `${cs.fontWeight} ${size}px ${cs.fontFamily}`;
      const ls = parseFloat(cs.letterSpacing);
      if (!Number.isNaN(ls) && 'letterSpacing' in ctx) (ctx as unknown as { letterSpacing: string }).letterSpacing = `${ls * scale}px`;
      ctx.fillText(word.textContent || 'Auto Edit', (x0 + x1) / 2, yTop + size * 0.78);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, textCanvas);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    };

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const mouseOn = pointerFxAllowed();
    let mx = 0.5, my = 0.35, tx = mx, ty = my, trx = mx, try_ = my;
    let energy = 0, energyT = 0;
    let visible = false;
    let raf = 0;
    let last = 0;
    const t0 = performance.now() - 14000;

    const draw = (now: number) => {
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
      gl.uniform4f(uMark, ...markPx);
      gl.uniform1f(uLight, document.documentElement.getAttribute('data-theme') === 'light' ? 1 : 0);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (!shown && gl.getError() === gl.NO_ERROR) {
        shown = true;
        canvas.style.opacity = '1';
        root.dataset.gl = 'on'; // o nome em vidro (fallback) sai de cena
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
      else if (visible) draw(performance.now());
    };

    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      const r = canvas.getBoundingClientRect();
      if (r.width <= 0) return;
      tx = (e.clientX - r.left) / r.width;
      ty = 1 - (e.clientY - r.top) / r.height;
      energyT = Math.min(1, energyT + 0.09);
    };

    // a fonte do nome precisa estar carregada antes de virar máscara
    const fam = getComputedStyle(word).fontFamily;
    const ready = document.fonts?.load ? document.fonts.load(`400 100px ${fam}`).catch(() => []) : Promise.resolve([]);
    ready.then(() => {
      if (dead) return;
      layout();
      wake();
    });
    const ro = new ResizeObserver(() => {
      layout();
      if (!raf) wake();
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
    if (mouseOn) root.addEventListener('pointermove', onMove, { passive: true });

    return () => {
      dead = true;
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      mo.disconnect();
      document.removeEventListener('visibilitychange', wake);
      reduced.removeEventListener('change', wake);
      root.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('webglcontextlost', onLost);
      // NÃO descarta o contexto (no dev o React monta o efeito duas vezes)
    };
  }, [canvasRef, markRef, wordRef, rootRef]);
}

/** Fio de luz do topo: um ponto mais aceso acompanha o cursor (variável só no fio). */
function useLineFollow(rootRef: React.RefObject<HTMLElement | null>, lineRef: React.RefObject<HTMLSpanElement | null>) {
  useEffect(() => {
    const root = rootRef.current, line = lineRef.current;
    if (!root || !line || !pointerFxAllowed()) return;
    let raf = 0, x = 0;
    const flush = () => {
      raf = 0;
      const r = line.getBoundingClientRect();
      if (r.width > 0) line.style.setProperty('--lx', `${(((x - r.left) / r.width) * 100).toFixed(1)}%`);
    };
    const onMove = (e: PointerEvent) => {
      x = e.clientX;
      line.dataset.on = 'true';
      if (!raf) raf = requestAnimationFrame(flush);
    };
    const onLeave = () => {
      delete line.dataset.on;
    };
    root.addEventListener('pointermove', onMove, { passive: true });
    root.addEventListener('pointerleave', onLeave);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      root.removeEventListener('pointermove', onMove);
      root.removeEventListener('pointerleave', onLeave);
    };
  }, [rootRef, lineRef]);
}

const COLS: Array<{ title: string; links: Array<{ label: string; href: string; ext?: boolean }> }> = [
  {
    title: 'Estúdio',
    links: [
      { label: 'Início', href: '/tools' },
      { label: 'Histórico', href: '/tools/historico' },
      { label: 'Recursos', href: '/recursos' },
    ],
  },
  {
    title: 'Conta',
    links: [
      { label: 'Planos', href: '/planos' },
      { label: 'Configurações', href: '/configuracoes' },
      { label: 'Trocar senha', href: '/trocar-senha' },
    ],
  },
  {
    title: 'Legal',
    links: [
      { label: 'Termos de uso', href: '/termos' },
      { label: 'Assinatura e cancelamento', href: '/politica' },
    ],
  },
];

export function HubFooter() {
  const rootRef = useRef<HTMLElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const markRef = useRef<HTMLDivElement | null>(null);
  const wordRef = useRef<HTMLSpanElement | null>(null);
  const lineRef = useRef<HTMLSpanElement | null>(null);
  const topRef = useRef<HTMLButtonElement | null>(null);
  useFooterSmoke(canvasRef, markRef, wordRef, rootRef);
  useLineFollow(rootRef, lineRef);
  useMagnetic(topRef, 0.3);

  const toTop = () => {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
  };

  return (
    <footer ref={rootRef} className="hf relative isolate -mb-16 mt-20 overflow-hidden md:mt-28">
      <span ref={lineRef} aria-hidden className="hf-line" />
      <canvas ref={canvasRef} aria-hidden className="hf-gl" />

      <div className="relative mx-auto grid max-w-[1100px] grid-cols-2 gap-x-6 gap-y-10 px-5 pt-16 md:grid-cols-[1.7fr_1fr_1fr_1fr] md:gap-12 md:px-8 md:pt-20">
        <div className="col-span-2 md:col-span-1">
          <div className="flex items-center gap-3">
            <DarkoLogo size={32} />
            <span className="hf-brand">Auto Edit</span>
          </div>
          <p className="hf-motto mt-5">Ligue a fila e vá dormir.</p>
          <div className="mt-7 flex flex-wrap items-center gap-3">
            <a
              href={whatsappUrl('Oi! Preciso de ajuda com o Auto Edit.')}
              target="_blank"
              rel="noopener noreferrer"
              className="hf-pill hf-pill--wa"
            >
              <span aria-hidden className="hf-pill-ico">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="#fff">
                  <path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm5.3 14.2c-.2.6-1.3 1.2-1.8 1.2-.5.1-1 .2-3.3-.7-2.8-1.1-4.6-4-4.7-4.2-.1-.2-1.1-1.5-1.1-2.9s.7-2 1-2.3c.3-.3.6-.3.8-.3h.6c.2 0 .4 0 .6.5l.9 2.1c.1.2.1.4 0 .6l-.3.5-.4.5c-.1.1-.3.3-.1.6.2.3.8 1.3 1.7 2.1 1.2 1 2.1 1.3 2.4 1.5.3.1.5.1.6-.1l.9-1.1c.2-.3.4-.2.7-.1l2 1c.3.1.5.2.5.3.1.2.1.7-.1 1.3Z" />
                </svg>
              </span>
              Falar com o suporte
            </a>
            <a
              href="https://www.instagram.com/darkoautoedit/"
              target="_blank"
              rel="noopener noreferrer"
              className="hf-pill"
            >
              <span aria-hidden className="hf-pill-ico hf-pill-ico--ig">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2">
                  <rect x="3.5" y="3.5" width="17" height="17" rx="5" />
                  <circle cx="12" cy="12" r="4" />
                  <circle cx="17.4" cy="6.6" r="1.1" fill="#fff" stroke="none" />
                </svg>
              </span>
              @darkoautoedit
            </a>
          </div>
        </div>
        {COLS.map((c) => (
          <div key={c.title}>
            <div className="hf-col-title">{c.title}</div>
            <nav className="flex flex-col gap-2.5">
              {c.links.map((l) => (
                <Link key={l.label} href={l.href} className="hf-link">
                  {l.label}
                </Link>
              ))}
            </nav>
          </div>
        ))}
      </div>

      {/* o nome gigante, feito de fumaça (WebGL); sem WebGL fica o nome em vidro */}
      <div ref={markRef} aria-hidden className="hf-mark">
        <span ref={wordRef} className="hf-word">
          Auto Edit
        </span>
      </div>

      <div className="hf-bar relative">
        <div className="mx-auto flex max-w-[1100px] flex-col items-start justify-between gap-3 px-5 py-5 pr-24 md:flex-row md:items-center md:px-8 md:pr-28">
          <p className="hf-copy">
            Auto Edit © {new Date().getFullYear()} · <span className="hf-corp">DarkoCorporation</span>
          </p>
          <button ref={topRef} type="button" onClick={toTop} className="hf-top group">
            Voltar ao topo
            <span aria-hidden className="hf-top-ico">
              <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                <path d="M6 10V2m0 0L2.5 5.5M6 2l3.5 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
          </button>
        </div>
      </div>

      <style jsx>{`
        .hf {
          background:
            radial-gradient(70% 60% at 50% 115%, rgba(167, 139, 250, 0.12), transparent 70%),
            linear-gradient(180deg, rgba(9, 9, 11, 0) 0, #09090b 120px);
        }

        .hf-line {
          position: absolute;
          inset: 0 0 auto 0;
          height: 1px;
          background: linear-gradient(90deg, transparent, rgba(224, 72, 63, 0.7) 25%, rgba(196, 181, 253, 0.8) 60%, transparent);
          box-shadow: 0 0 22px 1px rgba(196, 181, 253, 0.25);
        }
        /* ponto aceso que segue o cursor no fio */
        .hf-line::after {
          content: '';
          position: absolute;
          top: -1px;
          left: var(--lx, 50%);
          width: 260px;
          height: 3px;
          translate: -50% 0;
          border-radius: 99px;
          background: radial-gradient(closest-side, #fff, rgba(232, 214, 255, 0.85) 35%, transparent);
          filter: drop-shadow(0 0 10px rgba(196, 181, 253, 0.9));
          opacity: 0;
          transition: opacity 0.4s ease;
        }
        .hf-line[data-on='true']::after {
          opacity: 1;
        }
        .hf-gl {
          position: absolute;
          inset: 0;
          z-index: -1;
          width: 100%;
          height: 100%;
          pointer-events: none;
          opacity: 0;
          transition: opacity 1.2s ease;
        }
        .hf-brand {
          font-family: var(--font-serif);
          font-size: 24px;
          line-height: 1;
          color: #fff;
        }
        .hf-copy {
          font-size: 12.5px;
          color: rgba(255, 255, 255, 0.45);
        }
        .hf-motto {
          max-width: 22ch;
          font-family: var(--font-serif);
          font-style: italic;
          font-size: 26px;
          line-height: 1.15;
          color: rgba(255, 255, 255, 0.78);
        }
        .hf-pill {
          display: inline-flex;
          min-height: 42px;
          align-items: center;
          gap: 10px;
          border-radius: 11px;
          padding: 0 16px 0 10px;
          font-family: var(--font-label);
          font-size: 13.5px;
          font-weight: 600;
          color: rgba(255, 255, 255, 0.8);
          background: rgba(255, 255, 255, 0.03);
          box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.14);
          transition: color 0.2s ease, box-shadow 0.2s ease, transform 0.2s ease;
        }
        .hf-pill:hover {
          color: #fff;
          box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.32), 0 10px 30px -14px rgba(196, 181, 253, 0.6);
          transform: translateY(-1px);
        }
        .hf-pill-ico {
          display: grid;
          width: 24px;
          height: 24px;
          place-items: center;
          border-radius: 7px;
          background: linear-gradient(135deg, #3ddc84, #128c4a);
        }
        .hf-pill-ico--ig {
          background: linear-gradient(45deg, #feda75, #fa7e1e 30%, #d62976 55%, #962fbf 80%, #4f5bd5);
        }
        .hf-col-title {
          margin-bottom: 16px;
          font-family: var(--font-label);
          font-size: 12px;
          font-weight: 600;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: rgba(255, 255, 255, 0.42);
        }
        :global(.hf-link) {
          position: relative;
          width: fit-content;
          font-size: 14px;
          color: rgba(255, 255, 255, 0.66);
          transition: color 0.2s ease;
        }
        :global(.hf-link)::after {
          content: '';
          position: absolute;
          left: 0;
          right: 0;
          bottom: -3px;
          height: 1px;
          background: linear-gradient(90deg, #e0483f, #c4b5fd);
          transform: scaleX(0);
          transform-origin: right;
          transition: transform 0.35s cubic-bezier(0.2, 0.7, 0.2, 1);
        }
        :global(.hf-link):hover {
          color: #fff;
        }
        :global(.hf-link):hover::after {
          transform: scaleX(1);
          transform-origin: left;
        }
        .hf-mark {
          position: relative;
          margin-top: 56px;
          height: clamp(86px, 15.5vw, 236px);
          overflow: hidden;
          user-select: none;
        }
        .hf-word {
          position: absolute;
          left: 50%;
          top: 0;
          transform: translateX(-50%);
          white-space: nowrap;
          font-family: var(--font-serif);
          font-weight: 400;
          font-size: clamp(120px, 22vw, 340px);
          line-height: 0.86;
          letter-spacing: -0.03em;
          /* sem WebGL: o nome em vidro, sumindo pra baixo */
          color: rgba(255, 255, 255, 0.12);
          -webkit-mask-image: linear-gradient(to bottom, #000 30%, transparent 92%);
          mask-image: linear-gradient(to bottom, #000 30%, transparent 92%);
          transition: color 0.8s ease;
        }
        .hf[data-gl='on'] .hf-word {
          color: transparent;
        }
        .hf-bar {
          border-top: 1px solid rgba(255, 255, 255, 0.1);
          background: rgba(8, 8, 10, 0.72);
        }
        .hf-corp {
          font-family: var(--font-tech);
          font-size: 10.5px;
          font-weight: 600;
          letter-spacing: 0.22em;
          text-transform: uppercase;
          color: rgba(255, 255, 255, 0.38);
        }
        .hf-top {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          font-family: var(--font-label);
          font-size: 12.5px;
          font-weight: 600;
          color: rgba(255, 255, 255, 0.55);
          transition: color 0.2s ease;
        }
        .hf-top:hover {
          color: #fff;
        }
        .hf-top-ico {
          display: grid;
          width: 26px;
          height: 26px;
          place-items: center;
          border-radius: 99px;
          box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.16);
          transition: transform 0.3s ease, box-shadow 0.3s ease;
        }
        .hf-top:hover .hf-top-ico {
          transform: translateY(-2px);
          box-shadow: inset 0 0 0 1px rgba(196, 181, 253, 0.6), 0 0 18px rgba(196, 181, 253, 0.45);
        }
        /* ── tema claro: papel claro, tinta escura, a fumaça vira tinta colorida ── */
        :global(html[data-theme='light']) .hf {
          background:
            radial-gradient(70% 60% at 50% 115%, rgba(139, 108, 250, 0.16), transparent 70%),
            linear-gradient(180deg, rgba(250, 249, 246, 0) 0, rgba(250, 249, 246, 0.6) 140px, rgba(247, 246, 242, 0.92) 100%);
        }
        :global(html[data-theme='light']) .hf-line {
          background: linear-gradient(90deg, transparent, rgba(200, 50, 45, 0.55) 25%, rgba(110, 80, 230, 0.6) 60%, transparent);
          box-shadow: 0 1px 0 rgba(255, 255, 255, 0.8);
        }
        :global(html[data-theme='light']) .hf-line::after {
          background: radial-gradient(closest-side, #6d4dff, rgba(125, 92, 255, 0.55) 40%, transparent);
          filter: drop-shadow(0 0 8px rgba(109, 77, 255, 0.55));
        }
        :global(html[data-theme='light']) .hf-brand {
          color: #15151a;
        }
        :global(html[data-theme='light']) .hf-motto {
          color: rgba(21, 21, 26, 0.78);
        }
        :global(html[data-theme='light']) .hf-pill {
          color: #26262c;
          background: rgba(255, 255, 255, 0.7);
          box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.12), 0 1px 2px rgba(0, 0, 0, 0.06);
        }
        :global(html[data-theme='light']) .hf-pill:hover {
          color: #0b0b0e;
          box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.24), 0 12px 28px -14px rgba(109, 77, 255, 0.55);
        }
        :global(html[data-theme='light']) .hf-col-title {
          color: rgba(21, 21, 26, 0.5);
        }
        :global(html[data-theme='light'] .hf-link) {
          color: rgba(21, 21, 26, 0.74);
        }
        :global(html[data-theme='light'] .hf-link:hover) {
          color: #0b0b0e;
        }
        :global(html[data-theme='light']) .hf-word {
          color: rgba(21, 21, 26, 0.1);
        }
        :global(html[data-theme='light']) .hf[data-gl='on'] .hf-word {
          color: transparent;
        }
        :global(html[data-theme='light']) .hf-bar {
          border-top-color: rgba(0, 0, 0, 0.1);
          background: rgba(255, 255, 255, 0.5);
        }
        :global(html[data-theme='light']) .hf-copy {
          color: rgba(21, 21, 26, 0.58);
        }
        :global(html[data-theme='light']) .hf-corp {
          color: rgba(21, 21, 26, 0.45);
        }
        :global(html[data-theme='light']) .hf-top {
          color: rgba(21, 21, 26, 0.64);
        }
        :global(html[data-theme='light']) .hf-top:hover {
          color: #0b0b0e;
        }
        :global(html[data-theme='light']) .hf-top-ico {
          box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.18);
        }
        :global(html[data-theme='light']) .hf-top:hover .hf-top-ico {
          box-shadow: inset 0 0 0 1px rgba(109, 77, 255, 0.55), 0 0 16px rgba(109, 77, 255, 0.3);
        }
        @media (prefers-reduced-motion: reduce) {
          .hf-line::after,
          :global(.hf-link)::after {
            transition: none;
          }
        }
      `}</style>
    </footer>
  );
}
