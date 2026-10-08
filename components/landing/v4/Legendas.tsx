'use client';

/**
 * Legendas — a seção-estrela da landing v4.
 *
 *   LegendasSection → player com vídeo + o MOTOR REAL das Legendas
 *                     Automáticas por cima, e a vitrine curada em duas
 *                     famílias: Dinâmicas (anúncio) e Simples (acompanhar a
 *                     fala). Clicar num modelo troca a legenda do vídeo na
 *                     hora, como na ferramenta.
 *   CopyFixSection  → "Corrigir legenda pela copy" em cena 3D: a lauda (a
 *                     copy) atrás, a legenda gerada na frente, e cada palavra
 *                     errada virando a da copy. O resultado NÃO é encenado:
 *                     vem de `correctBlocksByCopy`, a mesma função que a
 *                     ferramenta roda — contagens incluídas.
 */

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Block } from '@/lib/typography/engine';
import { correctBlocksByCopy } from '@/lib/typography/copy-fix';
import { getPreset } from '@/lib/typography/presets';
import { LEGENDAS_MODELOS } from '@/lib/numeros-do-site';
import { Reveal, useInView, useReduced } from '../v3/kit';
import { isCalm, useCalm, usePointerField } from './fx';
import { loadPresetFonts, makeBlocks, useLegendaCanvas, type LegendaProgram } from './legenda';

const AMBER = '#ffb020';
const GOLD = '#ffd60a';
const RED = '#e0483f';
const OK = '#7ee0a1';

/* ══════════════════════ vitrine curada ══════════════════════ */

type Mode = 'dinamicas' | 'simples';

/**
 * A curadoria da landing: modelos escolhidos olhando o motor renderizar
 * (folha de contato, 07.10). Dinâmicas = o que segura o olho em anúncio.
 * Simples = o que acompanha a fala sem roubar a cena.
 */
const SHELF: Record<Mode, string[]> = {
  dinamicas: [
    'vermelho-sangue',
    'titulo-ouro',
    'glitch-viral',
    'verde-dinheiro',
    'ouro-fumaca',
    'presets-3d',
    'extensao-script',
    'neon-tube',
  ],
  simples: [
    'keynote',
    'oswald-clean',
    'fade-limpo',
    'editorial-destaque',
    'karaoke-fill',
    'palavra-box',
    'caixa-branca',
    'marca-texto',
  ],
};
const ALL_IDS = [...SHELF.dinamicas, ...SHELF.simples];

/** O roteiro que o vídeo "fala" em cada família. */
const SCRIPT: Record<Mode, Block[]> = {
  dinamicas: makeBlocks(['OLHA SÓ ISSO', 'A PALAVRA FORTE', 'GANHA DESTAQUE', 'SOZINHA', 'NO TEMPO DA FALA'], { per: 1650 }),
  simples: makeBlocks(['E foi aí que eu entendi', 'legenda boa é a que', 'acompanha a fala', 'sem roubar a cena.'], { per: 1900 }),
};

export function LegendasSection() {
  const [mode, setMode] = useState<Mode>('dinamicas');
  const [pick, setPick] = useState<string>(SHELF.dinamicas[0]);
  const userPicked = useRef(false);

  const choose = (id: string) => {
    userPicked.current = true;
    setPick(id);
  };
  const switchMode = (m: Mode) => {
    if (m === mode) return;
    setMode(m);
    setPick(SHELF[m][0]);
    userPicked.current = false;
  };
  // sem clique da pessoa, o player passa pelos modelos da família, um por volta
  const advance = useCallback(() => {
    if (userPicked.current) return;
    setPick((cur) => {
      const list = SHELF[SHELF.dinamicas.includes(cur) ? 'dinamicas' : 'simples'];
      return list[(list.indexOf(cur) + 1) % list.length];
    });
  }, []);

  return (
    <section id="legendas" className="relative mx-auto mt-28 max-w-[1360px] px-5 md:mt-40 md:px-8">
      <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] lg:gap-16">
        {/* player */}
        <Reveal className="order-2 lg:order-1">
          <Player mode={mode} presetId={pick} onLoop={advance} />
        </Reveal>

        {/* texto + vitrine */}
        <div className="order-1 lg:order-2">
          <Reveal>
            <ToolTag tone={GOLD} label="Legendas Automáticas" />
            <h2 className="section-title mt-5 text-[40px] leading-[1.02] md:text-[58px]">
              Legenda de editor profissional.
              <span className="mt-1 block text-editorial italic text-white/70" style={{ paddingBottom: '0.08em' }}>
                Escolhida a dedo.
              </span>
            </h2>
            <p className="mt-5 max-w-[56ch] text-[16px] leading-[1.7] text-white/[0.62]">
              São {LEGENDAS_MODELOS} modelos e nenhum é o mesmo com outra cor: cada um muda
              na fonte, na composição ou no efeito. Os dinâmicos seguram o olho no anúncio.
              Os simples acompanham a fala sem roubar a cena.
            </p>
          </Reveal>

          <Reveal delay={80}>
            <div className="mt-8">
              <ModeSwitch mode={mode} onChange={switchMode} />
              <Shelf mode={mode} pick={pick} onPick={choose} />
              <p className="mt-4 text-[13px] text-white/45">
                Clica num modelo e ele entra no vídeo. A cor de cada um você troca no painel.
              </p>
            </div>
          </Reveal>
        </div>
      </div>

      {/* o que a ferramenta faz, em três linhas */}
      <Reveal>
        <div className="mt-16 grid grid-cols-1 gap-x-10 gap-y-7 border-t border-white/10 pt-9 md:grid-cols-3">
          {[
            ['A palavra forte se destaca sozinha', 'O motor escolhe a palavra que pesa em cada frase e aplica o destaque do modelo, sem clique.'],
            ['Você ajusta no preview', 'Arrasta, redimensiona, edita o texto e muda a cor de uma palavra só. Tudo direto no vídeo, como no CapCut.'],
            ['O MP4 sai igual ao preview', 'Preview e exportação usam o mesmo motor, e o vídeo renderiza no seu navegador.'],
          ].map(([t, d]) => (
            <div key={t}>
              <h3 className="text-[16.5px] font-bold tracking-[-0.01em] text-white" style={{ fontFamily: 'var(--font-tech)' }}>
                {t}
              </h3>
              <p className="mt-2 text-[14px] leading-relaxed text-white/[0.58]">{d}</p>
            </div>
          ))}
        </div>
        <p className="mt-8 max-w-[90ch] border-l-2 pl-4 text-[13px] leading-relaxed text-white/50" style={{ borderColor: `${GOLD}66` }}>
          No Premium. A transcrição usa a sua chave da Groq ou da AssemblyAI, cadastrada em
          Configurações. Prefere legendar no CapCut? O Gerador de SRT devolve o .srt alinhado à
          copy, palavra por palavra.
        </p>
      </Reveal>
    </section>
  );
}

function ToolTag({ tone, label }: { tone: string; label: string }) {
  return (
    <span
      className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[12.5px] font-semibold"
      style={{ fontFamily: 'var(--font-label)', color: tone, borderColor: `${tone}4d`, background: `${tone}12` }}
    >
      <span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ background: tone }} />
      {label}
    </span>
  );
}

function ModeSwitch({ mode, onChange }: { mode: Mode; onChange: (m: Mode) => void }) {
  const opts: Array<[Mode, string]> = [
    ['dinamicas', 'Dinâmicas'],
    ['simples', 'Simples'],
  ];
  return (
    <div role="tablist" aria-label="Família de legendas" className="ms relative inline-grid grid-cols-2 rounded-[12px] p-1">
      <span aria-hidden className="ms-thumb" style={{ transform: mode === 'simples' ? 'translateX(100%)' : 'none' }} />
      {opts.map(([m, label]) => (
        <button
          key={m}
          role="tab"
          aria-selected={mode === m}
          onClick={() => onChange(m)}
          className={'relative z-10 rounded-[9px] px-6 py-2.5 text-[14px] font-bold transition-colors duration-300 ' + (mode === m ? 'text-[#1b1206]' : 'text-white/60 hover:text-white')}
          style={{ fontFamily: 'var(--font-label)' }}
        >
          {label}
        </button>
      ))}
      <style jsx>{`
        .ms {
          background: rgba(255, 255, 255, 0.04);
          box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.1);
        }
        .ms-thumb {
          position: absolute;
          top: 4px;
          bottom: 4px;
          left: 4px;
          width: calc(50% - 4px);
          border-radius: 9px;
          background: linear-gradient(180deg, #ffe27a, ${GOLD});
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.6), 0 6px 18px -8px rgba(255, 214, 10, 0.7);
          transition: transform 0.45s cubic-bezier(0.32, 0.72, 0, 1);
        }
      `}</style>
    </div>
  );
}

function Shelf({ mode, pick, onPick }: { mode: Mode; pick: string; onPick: (id: string) => void }) {
  return (
    <div key={mode} className="mt-5 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
      {SHELF[mode].map((id, i) => (
        <Chip key={id} id={id} index={i} active={pick === id} onPick={onPick} />
      ))}
    </div>
  );
}

/** Um modelo da vitrine: o NOME dele escrito no próprio estilo, pelo motor. */
function Chip({ id, index, active, onPick }: { id: string; index: number; active: boolean; onPick: (id: string) => void }) {
  const preset = getPreset(id);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [hover, setHover] = useState(false);
  const progRef = useRef<LegendaProgram>({
    presetId: id,
    blocks: makeBlocks([preset.name], { start: 80, per: 2300 }),
    fontScale: 2.1,
    posY: 0.52,
  });
  useLegendaCanvas(canvasRef, progRef, { playing: hover || active, stillAt: 1900, fontIds: ALL_IDS });

  return (
    <button
      onClick={() => onPick(id)}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
      aria-pressed={active}
      aria-label={`Usar o modelo ${preset.name}`}
      className={'chip group relative overflow-hidden rounded-[12px] text-left ' + (active ? 'is-active' : '')}
      style={{ ['--i' as string]: index, filter: 'saturate(1.39)' }}
    >
      <span
        aria-hidden
        className="chip-bg absolute inset-0"
        style={{ backgroundPosition: `${(index * 37) % 100}% ${30 + ((index * 23) % 40)}%` }}
      />
      <span className="relative block aspect-[16/10]">
        <canvas ref={canvasRef} aria-hidden className="absolute inset-0 h-full w-full" />
      </span>
      <style jsx>{`
        .chip {
          box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.1);
          transition: transform 0.35s cubic-bezier(0.32, 0.72, 0, 1), box-shadow 0.3s ease;
          animation: chip-in 0.55s cubic-bezier(0.16, 1, 0.3, 1) both;
          animation-delay: calc(var(--i) * 45ms);
        }
        .chip:hover {
          transform: translateY(-3px);
          box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.25), 0 14px 30px -16px rgba(0, 0, 0, 0.9);
        }
        .chip.is-active {
          box-shadow: inset 0 0 0 2px ${GOLD}, 0 0 0 4px rgba(255, 214, 10, 0.14), 0 14px 30px -16px rgba(0, 0, 0, 0.9);
        }
        .chip-bg {
          background-image: url('/landing/legendas-ugc.jpg');
          background-size: 260%;
          filter: brightness(0.42) saturate(0.85);
          transition: filter 0.4s ease;
        }
        .chip:hover .chip-bg,
        .chip.is-active .chip-bg {
          filter: brightness(0.55) saturate(0.95);
        }
        @keyframes chip-in {
          from {
            opacity: 0;
            transform: translateY(10px) scale(0.97);
          }
          to {
            opacity: 1;
            transform: none;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .chip {
            animation: none;
          }
        }
      `}</style>
    </button>
  );
}

function Player({ mode, presetId, onLoop }: { mode: Mode; presetId: string; onLoop: () => void }) {
  const { ref, inView } = useInView<HTMLDivElement>(0.2);
  const reduced = useReduced();
  const vidRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const progRef = useRef<LegendaProgram>({ presetId, blocks: SCRIPT[mode], fontScale: 1.3, posY: 0.7 });
  const { repaint } = useLegendaCanvas(canvasRef, progRef, {
    playing: inView,
    stillAt: 160 + 1650 * 2 + 1200,
    fontIds: ALL_IDS,
    onLoop,
  });

  useEffect(() => {
    progRef.current = { ...progRef.current, presetId, blocks: SCRIPT[mode] };
    repaint();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presetId, mode]);

  const calm = useCalm();
  useEffect(() => {
    const v = vidRef.current;
    if (!v) return;
    if (inView && !reduced && !calm) {
      const p = v.play();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } else v.pause();
  }, [inView, reduced, calm]);

  const name = getPreset(presetId).name;

  return (
    <div ref={ref} className="relative mx-auto w-full max-w-[560px]">
      <div
        aria-hidden
        className="pointer-events-none absolute -inset-12 -z-10 opacity-80 blur-3xl"
        style={{
          background:
            'radial-gradient(50% 45% at 30% 20%, rgba(255,214,10,0.16), transparent 70%), radial-gradient(45% 45% at 80% 85%, rgba(167,139,250,0.18), transparent 70%)',
        }}
      />
      <div className="pl-frame relative aspect-[4/5] overflow-hidden rounded-[16px] bg-black" style={{ filter: 'saturate(1.39)' }}>
        <video
          ref={vidRef}
          src="/landing/legendas-ugc.mp4"
          poster="/landing/legendas-ugc.jpg"
          muted
          loop
          playsInline
          preload="none"
          aria-hidden
          className="absolute inset-0 h-full w-full object-cover"
          style={{ objectPosition: '50% 22%' }}
        />
        <div aria-hidden className="absolute inset-0" style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.38), transparent 42%)' }} />
        <canvas ref={canvasRef} aria-hidden className="absolute inset-0 h-full w-full" />

        <div className="absolute inset-x-0 top-0 flex items-center justify-between p-4">
          <span
            className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-black/55 px-3 py-1.5 text-[12px] font-semibold text-white"
            style={{ fontFamily: 'var(--font-label)' }}
          >
            <span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ background: GOLD }} />
            {name}
          </span>
          <span
            className="rounded-full border border-white/15 bg-black/45 px-3 py-1.5 text-[11.5px] font-semibold text-white/75"
            style={{ fontFamily: 'var(--font-label)' }}
          >
            Motor real da ferramenta
          </span>
        </div>
      </div>
      <style jsx>{`
        .pl-frame {
          box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.12), 0 50px 100px -40px rgba(0, 0, 0, 0.95);
        }
      `}</style>
    </div>
  );
}

/* ══════════════════════ CORRIGIR PELA COPY (cena 3D) ══════════════════════ */

/** A copy do anúncio — a "lauda". */
const COPY =
  'Ninguém te conta isso, mas a Mariana vendeu o primeiro bolo de pote pelo WhatsApp sem gastar um real com anúncio. Olha só como ela fez.';

/** O que a transcrição devolveu: acento, nome, pontuação e uma palavra comida. */
const ASR: Array<[number, number, string]> = [
  [400, 1900, 'Ninguem te conta isso'],
  [1900, 3600, 'mas a Mariane vendeu'],
  [3600, 5200, 'o primeiro bolo de pote'],
  [5200, 6800, 'pelo whatsapp sem gastar'],
  [6800, 8100, 'real com anuncio'],
  [8100, 9400, 'olha so como ela fez'],
];

type Fix = { b: number; w: number; from: string; to: string; copyIdx: number[]; added: boolean };

/** Roda a função REAL e devolve o que mudou, palavra por palavra. */
function computeFix() {
  const blocks: Block[] = ASR.map(([s, e, t], i) => {
    const ws = t.split(' ');
    const per = (e - s) / ws.length;
    return {
      id: 'cf' + i,
      start: s,
      end: e,
      words: ws.map((text, k) => ({ text, start: Math.round(s + k * per), end: Math.round(s + (k + 1) * per) })),
    };
  });
  const res = correctBlocksByCopy(blocks, COPY);
  const copyTokens = COPY.split(/\s+/);
  const norm = (s: string) =>
    s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
  const fixes: Fix[] = [];
  let cursor = 0;
  res.blocks.forEach((blk, bi) =>
    blk.words.forEach((wd, wi) => {
      const before = blocks[bi].words[wi].text;
      const parts = wd.text.split(' ');
      // acha na copy o(s) token(s) que deram origem à palavra corrigida
      const idx: number[] = [];
      for (const p of parts) {
        let j = cursor;
        while (j < copyTokens.length && norm(copyTokens[j]) !== norm(p)) j++;
        if (j < copyTokens.length) {
          idx.push(j);
          cursor = j + 1;
        }
      }
      if (wd.text !== before) {
        fixes.push({ b: bi, w: wi, from: before, to: wd.text, copyIdx: idx, added: parts.length > before.split(' ').length });
      }
    }),
  );
  return { blocks, fixes, corrected: res.corrected, added: res.added, copyTokens };
}

const fmt = (ms: number) => {
  const s = ms / 1000;
  return `00:${String(Math.floor(s)).padStart(2, '0')},${Math.floor((s % 1) * 10)}`;
};

type Phase = 'asr' | 'fixing' | 'done';

export function CopyFixSection() {
  const data = useMemo(computeFix, []);
  const { ref, inView } = useInView<HTMLDivElement>(0.25);
  const reduced = useReduced();
  const [phase, setPhase] = useState<Phase>('asr');
  const [fixed, setFixed] = useState<Set<number>>(() => new Set());
  const [lit, setLit] = useState<Set<number>>(() => new Set());
  const [pressed, setPressed] = useState(false);
  const [run, setRun] = useState(0);

  const zoneRef = useRef<HTMLDivElement | null>(null);
  const rigRef = useRef<HTMLDivElement | null>(null);
  const flyRef = useRef<HTMLDivElement | null>(null);
  const paperWordRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const tileRefs = useRef<(HTMLSpanElement | null)[]>([]);

  const onFrame = useCallback((x: number, y: number) => {
    const rig = rigRef.current;
    if (rig) rig.style.transform = `rotateX(${(10 - y * 4).toFixed(3)}deg) rotateY(${(-8 + x * 6).toFixed(3)}deg)`;
  }, []);
  usePointerField(zoneRef, onFrame, { ease: 0.08 });

  // reduced-motion: já mostra corrigido, parado
  useEffect(() => {
    if (!reduced) return;
    setPhase('done');
    setFixed(new Set(data.fixes.map((_, i) => i)));
  }, [reduced, data]);

  // a sequência: transcrito → clique → cada palavra voa da lauda e vira → pronto
  useEffect(() => {
    if (reduced || !inView) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const at = (ms: number, fn: () => void) => timers.push(setTimeout(fn, ms));
    let alive = true;

    setPhase('asr');
    setFixed(new Set());
    setLit(new Set());
    setPressed(false);

    const START = 1700;
    const GAP = 430;
    at(START - 350, () => setPressed(true));
    at(START, () => {
      setPressed(false);
      setPhase('fixing');
    });
    data.fixes.forEach((f, i) => {
      const t = START + 250 + i * GAP;
      at(t, () => {
        setLit((s) => new Set(s).add(i));
        fly(i, f);
      });
      at(t + 520, () => setFixed((s) => new Set(s).add(i)));
    });
    const end = START + 250 + data.fixes.length * GAP + 700;
    at(end, () => setPhase('done'));
    // segura o resultado e recomeça (só se a pessoa ainda estiver olhando)
    at(end + 5200, () => {
      if (!alive) return;
      if (isCalm()) return;
      setRun((r) => r + 1);
    });

    function fly(i: number, f: Fix) {
      const layer = flyRef.current;
      const src = paperWordRefs.current[f.copyIdx[f.copyIdx.length - 1] ?? -1];
      const dst = tileRefs.current[i];
      if (!layer || !src || !dst || typeof layer.animate !== 'function') return;
      const L = layer.getBoundingClientRect();
      const a = src.getBoundingClientRect();
      const b = dst.getBoundingClientRect();
      const x0 = a.left + a.width / 2 - L.left;
      const y0 = a.top + a.height / 2 - L.top;
      const x1 = b.left + b.width / 2 - L.left;
      const y1 = b.top + b.height / 2 - L.top;
      const g = document.createElement('span');
      g.className = 'cf-ghost';
      g.textContent = f.copyIdx.map((k) => data.copyTokens[k]).join(' ') || f.to;
      layer.appendChild(g);
      const mx = (x0 + x1) / 2;
      const my = Math.min(y0, y1) - 46;
      const anim = g.animate(
        [
          { transform: `translate(${x0}px, ${y0}px) translate(-50%, -50%) scale(0.9)`, opacity: 0 },
          { transform: `translate(${x0}px, ${y0 - 8}px) translate(-50%, -50%) scale(1)`, opacity: 1, offset: 0.14 },
          { transform: `translate(${mx}px, ${my}px) translate(-50%, -50%) scale(1.08)`, opacity: 1, offset: 0.55 },
          { transform: `translate(${x1}px, ${y1}px) translate(-50%, -50%) scale(1)`, opacity: 0.9, offset: 0.92 },
          { transform: `translate(${x1}px, ${y1}px) translate(-50%, -50%) scale(0.96)`, opacity: 0 },
        ],
        { duration: 620, easing: 'cubic-bezier(.45,0,.25,1)', fill: 'forwards' },
      );
      anim.onfinish = () => g.remove();
      anim.oncancel = () => g.remove();
    }

    return () => {
      alive = false;
      timers.forEach(clearTimeout);
      flyRef.current?.replaceChildren();
    };
  }, [reduced, inView, run, data]);

  const fixIndex = useMemo(() => {
    const m = new Map<string, number>();
    data.fixes.forEach((f, i) => m.set(`${f.b}:${f.w}`, i));
    return m;
  }, [data]);
  const litCopy = useMemo(() => {
    const s = new Set<number>();
    lit.forEach((i) => data.fixes[i]?.copyIdx.forEach((k) => s.add(k)));
    return s;
  }, [lit, data]);
  const errorsLeft = data.fixes.length - fixed.size;

  return (
    <section id="corrigir" className="relative mx-auto mt-28 max-w-[1360px] px-5 md:mt-40 md:px-8">
      <Reveal>
        <div className="mx-auto max-w-[860px] text-center">
          <ToolTag tone={AMBER} label="Corrigir legenda pela copy" />
          <h2 className="section-title mt-5 text-[44px] leading-[1] md:text-[76px]">
            A copy manda.
            <span className="mt-1 block text-editorial italic text-white/70" style={{ paddingBottom: '0.08em' }}>
              A legenda obedece.
            </span>
          </h2>
          <p className="mx-auto mt-6 max-w-[60ch] text-[16.5px] leading-[1.7] text-white/[0.62]">
            A transcrição erra acento, nome e pontuação, e às vezes engole uma palavra. Você
            cola a copy e a legenda inteira é corrigida por ela, palavra por palavra, sem
            mexer em bloco nem em tempo. Você confere em segundos, em vez de caçar erro bloco por bloco.
          </p>
        </div>
      </Reveal>

      <div ref={ref}>
        <div ref={zoneRef} className="cf-zone relative mt-14 md:mt-20">
          <div className="cf-persp">
            <div ref={rigRef} className="cf-rig grid grid-cols-1 items-center gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-10">
              {/* a lauda (copy) */}
              <div className="cf-paper relative overflow-hidden rounded-[14px] p-6 md:p-8">
                <div className="flex items-baseline justify-between border-b border-black/15 pb-3">
                  <span className="text-[22px] italic leading-none" style={{ fontFamily: 'var(--font-serif)', color: RED }}>
                    Lauda
                  </span>
                  <span className="text-[11px] font-semibold text-black/45" style={{ fontFamily: 'var(--font-mono)' }}>
                    COPY DO ANÚNCIO
                  </span>
                </div>
                <p className="cf-copy mt-5 text-[16px] leading-[2.1] text-[#1d1b16] md:text-[19px]" style={{ fontFamily: 'var(--font-mono)' }}>
                  {data.copyTokens.map((tok, k) => (
                    <span key={k}>
                      <span ref={(el) => { paperWordRefs.current[k] = el; }} className={'cf-pw ' + (litCopy.has(k) ? 'is-lit' : '')}>
                        {tok}
                      </span>{' '}
                    </span>
                  ))}
                </p>
                <div className="mt-6 flex items-center justify-between border-t border-black/15 pt-3 text-[11px] text-black/45" style={{ fontFamily: 'var(--font-mono)' }}>
                  <span>{data.copyTokens.length} palavras</span>
                  <span>texto colado pelo editor</span>
                </div>
                {phase === 'fixing' && <span aria-hidden className="cf-beam" />}
              </div>

              {/* a legenda gerada */}
              <div className="cf-panel relative overflow-hidden rounded-[14px]">
                <div className="flex items-center justify-between gap-3 border-b border-white/10 px-5 py-3.5 md:px-6">
                  <span className="text-[14px] font-bold text-white" style={{ fontFamily: 'var(--font-tech)' }}>
                    Legenda gerada
                  </span>
                  <span
                    className="cf-status inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-semibold"
                    data-phase={phase}
                    style={{ fontFamily: 'var(--font-label)' }}
                  >
                    {phase === 'asr' && `Transcrição: ${data.fixes.length} palavras pra arrumar`}
                    {phase === 'fixing' && (errorsLeft > 0 ? `Corrigindo pela copy… faltam ${errorsLeft}` : 'Corrigindo pela copy…')}
                    {phase === 'done' && 'Igual à copy'}
                  </span>
                </div>

                <ol className="flex flex-col">
                  {data.blocks.map((blk, bi) => (
                    <li key={blk.id} className="flex items-center gap-3 border-b border-white/[0.06] px-5 py-3 last:border-b-0 md:gap-4 md:px-6">
                      <span className="w-[96px] shrink-0 text-[11px] text-white/[0.38] tabular-nums" style={{ fontFamily: 'var(--font-mono)' }}>
                        {fmt(blk.start)}
                      </span>
                      <span className="flex min-w-0 flex-wrap gap-x-1.5 gap-y-1">
                        {blk.words.map((wd, wi) => {
                          const fi = fixIndex.get(`${bi}:${wi}`);
                          if (fi === undefined)
                            return (
                              <span key={wi} className="cf-word text-white/[0.88]">
                                {wd.text}
                              </span>
                            );
                          const f = data.fixes[fi];
                          const isFixed = fixed.has(fi);
                          return (
                            <span key={wi} ref={(el) => { tileRefs.current[fi] = el; }} className={'cf-tile ' + (isFixed ? 'is-fixed' : '')}>
                              <span className="cf-face cf-front">{f.from}</span>
                              <span className="cf-face cf-back">
                                {f.added ? (
                                  <>
                                    {f.to.split(' ')[0]} <em className="cf-added">{f.to.split(' ').slice(1).join(' ')}</em>
                                  </>
                                ) : (
                                  f.to
                                )}
                              </span>
                            </span>
                          );
                        })}
                      </span>
                    </li>
                  ))}
                </ol>

                <div className="flex flex-wrap items-center gap-3 border-t border-white/10 px-5 py-4 md:px-6">
                  <span
                    className={'cf-btn rounded-[11px] px-4 py-2.5 text-[12.5px] font-bold ' + (pressed ? 'is-pressed' : '')}
                    style={{ fontFamily: 'var(--font-tech)' }}
                  >
                    Corrigir pela copy →
                  </span>
                  <span
                    className={'cf-result text-[12.5px] font-semibold ' + (phase === 'done' ? 'is-on' : '')}
                    style={{ fontFamily: 'var(--font-label)' }}
                  >
                    {data.corrected} {data.corrected === 1 ? 'palavra corrigida' : 'palavras corrigidas'} e {data.added}{' '}
                    {data.added === 1 ? 'devolvida' : 'devolvidas'}. Blocos e tempos intactos.
                  </span>
                  {phase === 'done' && !reduced && (
                    <button
                      type="button"
                      onClick={() => setRun((r) => r + 1)}
                      className="ml-auto rounded-[9px] px-2.5 py-1.5 text-[12px] font-semibold text-white/55 transition-colors hover:bg-white/[0.06] hover:text-white"
                      style={{ fontFamily: 'var(--font-label)' }}
                    >
                      Ver de novo
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
          <div ref={flyRef} aria-hidden className="cf-fly pointer-events-none absolute inset-0 z-20" />
        </div>
      </div>

      <Reveal>
        <div className="mt-14 grid grid-cols-1 gap-x-8 gap-y-7 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ['Grafia, acento e pontuação', 'Palavra escrita errado volta com a grafia da copy, vírgula e ponto inclusos.'],
            ['Palavra engolida volta', 'O que a transcrição comeu entra de novo, no bloco certo.'],
            ['Tempo intocado', 'Blocos, tempos e estilos ficam onde estavam. E o Ctrl+Z desfaz.'],
            ['Copy errada não passa', 'Se a copy colada não for desse vídeo, ele avisa em vez de aplicar.'],
          ].map(([t, d], i) => (
            <div key={t} className="border-t border-white/[0.12] pt-5">
              <span className="text-[12px] text-white/35 tabular-nums" style={{ fontFamily: 'var(--font-mono)' }}>
                {String(i + 1).padStart(2, '0')}
              </span>
              <h3 className="mt-2 text-[16.5px] font-bold tracking-[-0.01em] text-white" style={{ fontFamily: 'var(--font-tech)' }}>
                {t}
              </h3>
              <p className="mt-1.5 text-[14px] leading-relaxed text-white/[0.58]">{d}</p>
            </div>
          ))}
        </div>
        <div className="mt-10 flex flex-wrap items-center gap-4">
          <Link href="/register" className="btn-primary !rounded-[12px] !px-6 !text-[14.5px]">
            Criar conta grátis
          </Link>
          <span className="text-[13px] text-white/45">As Legendas Automáticas são do plano Premium.</span>
        </div>
      </Reveal>

      <style jsx>{`
        .cf-persp {
          perspective: 1800px;
          perspective-origin: 50% 30%;
        }
        .cf-rig {
          transform-style: preserve-3d;
          transform: rotateX(10deg) rotateY(-8deg);
          will-change: transform;
        }
        .cf-paper {
          background: linear-gradient(180deg, #f6f3ea, #ece7da);
          transform: translateZ(-70px) rotateY(6deg);
          box-shadow: 0 1px 0 rgba(255, 255, 255, 0.7) inset, 0 50px 90px -40px rgba(0, 0, 0, 0.95),
            0 0 0 1px rgba(0, 0, 0, 0.06);
          background-image: repeating-linear-gradient(
              180deg,
              transparent 0,
              transparent 31px,
              rgba(20, 20, 15, 0.05) 31px,
              rgba(20, 20, 15, 0.05) 32px
            ),
            linear-gradient(180deg, #f6f3ea, #ece7da);
        }
        .cf-panel {
          transform: translateZ(60px);
          background: linear-gradient(180deg, rgba(28, 26, 34, 0.96), rgba(14, 13, 18, 0.98));
          box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.1), 0 1px 0 rgba(255, 255, 255, 0.08) inset,
            0 60px 110px -40px rgba(0, 0, 0, 0.95), 0 0 80px -30px rgba(255, 176, 32, 0.25);
        }
        .cf-pw {
          border-radius: 3px;
          transition: background-color 0.35s ease, color 0.35s ease, box-shadow 0.35s ease;
        }
        .cf-pw.is-lit {
          background: rgba(255, 196, 0, 0.42);
          box-shadow: 0 0 0 2px rgba(255, 196, 0, 0.42);
        }
        .cf-beam {
          position: absolute;
          left: 0;
          right: 0;
          top: 0;
          height: 70px;
          background: linear-gradient(180deg, transparent, rgba(255, 176, 32, 0.14) 70%, rgba(214, 120, 0, 0.55) 98%, transparent);
          animation: cf-beam ${(data.fixes.length * 430 + 500) / 1000}s linear forwards;
        }
        @keyframes cf-beam {
          from {
            transform: translateY(-70px);
          }
          to {
            transform: translateY(620px);
          }
        }
        .cf-word,
        .cf-tile {
          font-family: var(--font-tech);
          font-weight: 700;
          font-size: 16px;
          line-height: 1.5;
          letter-spacing: -0.01em;
        }
        @media (min-width: 768px) {
          .cf-word,
          .cf-tile {
            font-size: 20px;
          }
        }
        .cf-tile {
          display: inline-grid;
          transform-style: preserve-3d;
          transition: transform 0.7s cubic-bezier(0.32, 0.72, 0, 1);
        }
        .cf-tile.is-fixed {
          transform: rotateX(180deg);
        }
        .cf-face {
          grid-area: 1 / 1;
          backface-visibility: hidden;
          -webkit-backface-visibility: hidden;
          border-radius: 5px;
          padding: 0 4px;
          margin: 0 -4px;
          white-space: nowrap;
        }
        .cf-front {
          color: #fff;
          text-decoration: underline wavy ${RED};
          text-decoration-thickness: 1.5px;
          text-underline-offset: 5px;
          background: rgba(224, 72, 63, 0.12);
        }
        .cf-back {
          transform: rotateX(180deg);
          color: #fff;
          background: rgba(126, 224, 161, 0.14);
          box-shadow: inset 0 0 0 1px rgba(126, 224, 161, 0.35);
        }
        .cf-added {
          font-style: normal;
          color: ${OK};
          text-decoration: underline;
          text-decoration-color: ${OK};
          text-underline-offset: 4px;
        }
        .cf-status {
          transition: background-color 0.4s ease, color 0.4s ease;
        }
        .cf-status[data-phase='asr'] {
          color: #ff9a92;
          background: rgba(224, 72, 63, 0.14);
        }
        .cf-status[data-phase='fixing'] {
          color: ${AMBER};
          background: rgba(255, 176, 32, 0.14);
        }
        .cf-status[data-phase='done'] {
          color: ${OK};
          background: rgba(126, 224, 161, 0.13);
        }
        .cf-btn {
          color: #ffd27a;
          border: 1px solid rgba(255, 176, 32, 0.7);
          background: linear-gradient(180deg, rgba(255, 176, 32, 0.26), rgba(255, 176, 32, 0.1));
          box-shadow: 0 0 16px rgba(255, 159, 10, 0.2), 0 2px 0 rgba(0, 0, 0, 0.16);
          transition: transform 0.15s ease, box-shadow 0.15s ease;
        }
        .cf-btn.is-pressed {
          transform: translateY(1px) scale(0.97);
          box-shadow: inset 0 2px 5px rgba(0, 0, 0, 0.35), 0 0 26px rgba(255, 159, 10, 0.45);
        }
        .cf-result {
          color: ${OK};
          opacity: 0;
          transform: translateY(4px);
          transition: opacity 0.5s ease, transform 0.5s cubic-bezier(0.16, 1, 0.3, 1);
        }
        .cf-result.is-on {
          opacity: 1;
          transform: none;
        }
        .cf-fly :global(.cf-ghost) {
          position: absolute;
          left: 0;
          top: 0;
          padding: 2px 8px;
          border-radius: 6px;
          font-family: var(--font-mono);
          font-size: 14px;
          font-weight: 700;
          color: #1b1206;
          background: linear-gradient(180deg, #ffe08a, #ffbe3d);
          box-shadow: 0 10px 24px -8px rgba(255, 176, 32, 0.7);
          white-space: nowrap;
          will-change: transform, opacity;
        }
        @media (max-width: 1023px) {
          .cf-rig,
          .cf-paper,
          .cf-panel {
            transform: none;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .cf-rig,
          .cf-paper,
          .cf-panel {
            transform: none;
          }
          .cf-tile {
            transition: none;
          }
        }
      `}</style>
    </section>
  );
}

/** Carrega as fontes da vitrine cedo (o player e a vitrine aparecem juntos). */
export function preloadLegendaFonts() {
  void loadPresetFonts(ALL_IDS);
}
