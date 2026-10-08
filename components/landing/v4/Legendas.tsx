'use client';

/**
 * Legendas — a seção-estrela da landing v4.
 *
 *   LegendasSection → player com vídeo + o MOTOR REAL das Legendas
 *                     Automáticas por cima, e a vitrine que o Silas escolheu
 *                     (07.10) em duas famílias: Virais e Simples. Clicar num
 *                     modelo troca a legenda do vídeo na hora.
 *   CopyFixSection  → "Corrigir legenda pela copy": a copy (lauda) atrás, a
 *                     legenda gerada na frente, e cada palavra errada vira a
 *                     da copy. O resultado NÃO é encenado: vem de
 *                     `correctBlocksByCopy`, a mesma função da ferramenta.
 *
 * Regra da correção (cobrança de 07.10): o texto fica NÍTIDO o tempo todo.
 * Nada de virar a palavra em 3D nem inclinar o painel; a troca é a palavra
 * velha saindo e a nova entrando por deslize, e a profundidade vem de
 * camadas, sombra e do voo da palavra.
 */

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Block } from '@/lib/typography/engine';
import { correctBlocksByCopy } from '@/lib/typography/copy-fix';
import { getPreset } from '@/lib/typography/presets';
import { Reveal, useInView, useReduced } from '../v3/kit';
import { isCalm, useCalm, usePointerField } from './fx';
import { loadPresetFonts, makeBlocks, useLegendaCanvas, type LegendaProgram } from './legenda';
import { SectionHead } from './ui';

const AMBER = '#ffb020';
const GOLD = '#ffd60a';
const RED = '#e0483f';
const OK = '#7ee0a1';

/* ══════════════════════ vitrine ══════════════════════ */

type Mode = 'virais' | 'simples';

/** A seleção do Silas (07.10). Keynote e Fade Limpo ficaram; Papo Amarelo é simples. */
const SHELF: Record<Mode, string[]> = {
  virais: [
    'titulo-ouro',
    'vermelho-sangue',
    'extensao-script',
    'automatico-arcoiris',
    'g-fumaca-anton',
    'manuscrito',
    'poster-stack',
  ],
  simples: ['keynote', 'fade-limpo', 'papo-amarelo', 'empilhado', 'g-caixa-chip', 'palavra-box', 'solo-box'],
};
const ALL_IDS = [...SHELF.virais, ...SHELF.simples];

/** O que o vídeo "fala" em cada família. */
const SCRIPT: Record<Mode, Block[]> = {
  virais: makeBlocks(['OLHA SÓ ISSO', 'A PALAVRA FORTE', 'GANHA DESTAQUE', 'SOZINHA', 'NO TEMPO DA FALA'], { per: 1650 }),
  simples: makeBlocks(['E foi aí que eu entendi', 'legenda boa é a que', 'acompanha a fala', 'sem roubar a cena.'], { per: 1900 }),
};

export function LegendasSection() {
  const [mode, setMode] = useState<Mode>('virais');
  const [pick, setPick] = useState<string>(SHELF.virais[0]);
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
      const list = SHELF[SHELF.virais.includes(cur) ? 'virais' : 'simples'];
      return list[(list.indexOf(cur) + 1) % list.length];
    });
  }, []);

  return (
    <section id="legendas" className="relative mx-auto mt-28 max-w-[1360px] px-5 md:mt-40 md:px-8">
      <div aria-hidden className="sec-glow" style={{ ['--g' as string]: 'rgba(255,214,10,0.10)' }} />
      <SectionHead
        tone={GOLD}
        tag="Legendas Automáticas"
        ask="Sua legenda ainda tem cara de amadora?"
        answer={['Legendas de', { mark: 'editor profissional,' }, 'escolhidas a dedo.']}
        lead="Sobe o vídeo e a sua fala vira legenda animada, palavra por palavra. Você só escolhe o estilo: as virais seguram o olho no anúncio, as simples acompanham a fala sem roubar a cena."
      />

      <div className="mt-12 grid grid-cols-1 items-start gap-10 lg:mt-16 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] lg:gap-14">
        <Reveal>
          <Player mode={mode} presetId={pick} onLoop={advance} />
        </Reveal>

        <Reveal delay={80}>
          <div>
            <ModeSwitch mode={mode} onChange={switchMode} />
            <Shelf mode={mode} pick={pick} onPick={choose} />
            <p className="mt-4 text-[13.5px] text-white/50">
              Clica num modelo e veja ele no vídeo na hora. A cor de cada um você troca no painel.
            </p>

            <ul className="mt-9 flex flex-col gap-5 border-t border-white/10 pt-7">
              {[
                ['A palavra forte se destaca sozinha', 'A ferramenta escolhe a palavra que pesa em cada frase e destaca do jeito do modelo. Sem clicar em nada.'],
                ['Você ajusta direto no vídeo', 'Arrasta, muda o tamanho, edita o texto e pinta uma palavra só, igual no CapCut.'],
                ['Sai em MP4, igual ao preview', 'O vídeo renderiza no seu navegador com a legenda queimada, do jeitinho que você viu.'],
              ].map(([t, d]) => (
                <li key={t} className="flex gap-4">
                  <span
                    aria-hidden
                    className="mt-[3px] grid h-7 w-7 shrink-0 place-items-center rounded-full"
                    style={{ background: `${GOLD}1f`, boxShadow: `inset 0 0 0 1px ${GOLD}55` }}
                  >
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                      <path d="M2.5 6.4l2.4 2.4L9.6 3.4" stroke={GOLD} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </span>
                  <span>
                    <span className="block text-[16.5px] font-bold tracking-[-0.01em] text-white" style={{ fontFamily: 'var(--font-tech)' }}>
                      {t}
                    </span>
                    <span className="mt-1 block text-[14.5px] leading-relaxed text-white/60">{d}</span>
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-8 border-l-2 pl-4 text-[13px] leading-relaxed text-white/50" style={{ borderColor: `${GOLD}66` }}>
              No Premium. A transcrição usa a sua chave da Groq ou da AssemblyAI, que você cadastra
              uma vez em Configurações. Prefere legendar no CapCut? O Gerador de SRT devolve o .srt
              alinhado à copy, palavra por palavra.
            </p>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

function ModeSwitch({ mode, onChange }: { mode: Mode; onChange: (m: Mode) => void }) {
  const opts: Array<[Mode, string]> = [
    ['virais', 'Virais'],
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
          className={
            'relative z-10 rounded-[9px] px-7 py-2.5 text-[14.5px] font-bold transition-colors duration-300 ' +
            (mode === m ? 'text-[#1b1206]' : 'text-white/60 hover:text-white')
          }
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
      <Link
        href="/register"
        className="more group relative grid aspect-[16/10] place-items-center rounded-[12px] text-center"
        style={{ ['--i' as string]: SHELF[mode].length }}
      >
        <span>
          <span className="block text-[14px] font-bold text-white" style={{ fontFamily: 'var(--font-tech)' }}>
            Ver todos
          </span>
          <span className="mt-0.5 block text-[12px] text-white/50 transition-colors group-hover:text-white/80">
            dentro da ferramenta →
          </span>
        </span>
        <style jsx>{`
          :global(.more) {
            box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.14);
            background: repeating-linear-gradient(135deg, rgba(255, 255, 255, 0.03) 0 8px, transparent 8px 16px);
            transition: box-shadow 0.3s ease, transform 0.35s cubic-bezier(0.32, 0.72, 0, 1);
            animation: more-in 0.55s cubic-bezier(0.16, 1, 0.3, 1) both;
            animation-delay: calc(var(--i) * 45ms);
          }
          :global(.more):hover {
            transform: translateY(-3px);
            box-shadow: inset 0 0 0 1px rgba(255, 214, 10, 0.55);
          }
          @keyframes more-in {
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
            :global(.more) {
              animation: none;
            }
          }
        `}</style>
      </Link>
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
    blocks: makeBlocks([preset.name.replace(' · ', ' ')], { start: 80, per: 2300 }),
    fontScale: 2.1,
    posY: 0.52,
  });
  useLegendaCanvas(canvasRef, progRef, { playing: hover || active, stillAt: 1900, fontIds: ALL_IDS, once: true });

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
  const calm = useCalm();
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

/* ══════════════════════ CORRIGIR PELA COPY ══════════════════════ */

/** A copy do anúncio (a "lauda"). */
const COPY =
  'Se você edita anúncio todo dia, presta atenção: uma palavra errada na legenda já faz o cliente devolver o vídeo.';

/** O que a transcrição devolveu: sem acento, sem pontuação e uma palavra comida. */
const ASR: Array<[number, number, string]> = [
  [300, 1700, 'se voce edita anuncio'],
  [1700, 3200, 'todo dia presta atencao'],
  [3200, 4800, 'uma palavra errada na legenda'],
  [4800, 6200, 'ja faz cliente devolver'],
  [6200, 7400, 'o video'],
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
  const paperRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const flyRef = useRef<HTMLDivElement | null>(null);
  const paperWordRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const tileRefs = useRef<(HTMLSpanElement | null)[]>([]);

  // Profundidade sem distorcer texto: as camadas só DESLIZAM com o mouse (a
  // lauda, mais longe, anda menos e pro lado oposto do painel).
  const onFrame = useCallback((x: number, y: number) => {
    const a = paperRef.current;
    const b = panelRef.current;
    if (a) a.style.translate = `${(-x * 10).toFixed(2)}px ${(-y * 8).toFixed(2)}px`;
    if (b) b.style.translate = `${(x * 14).toFixed(2)}px ${(y * 10).toFixed(2)}px`;
  }, []);
  usePointerField(zoneRef, onFrame, { ease: 0.08 });

  // reduced-motion: já mostra corrigido, parado
  useEffect(() => {
    if (!reduced) return;
    setPhase('done');
    setFixed(new Set(data.fixes.map((_, i) => i)));
  }, [reduced, data]);

  // a sequência: transcrito → clique → cada palavra voa da lauda e troca → pronto
  useEffect(() => {
    if (reduced || !inView) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const at = (ms: number, fn: () => void) => timers.push(setTimeout(fn, ms));
    let alive = true;

    setPhase('asr');
    setFixed(new Set());
    setLit(new Set());
    setPressed(false);

    const START = 1800;
    const GAP = 560;
    at(START - 380, () => setPressed(true));
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
      at(t + 600, () => setFixed((s) => new Set(s).add(i)));
    });
    const end = START + 250 + data.fixes.length * GAP + 800;
    at(end, () => setPhase('done'));
    // segura o resultado e recomeça (só se a pessoa ainda estiver olhando)
    at(end + 5600, () => {
      if (!alive || isCalm()) return;
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
      const my = Math.min(y0, y1) - 70;
      const anim = g.animate(
        [
          { transform: `translate(${x0}px, ${y0}px) translate(-50%, -50%)`, opacity: 0, boxShadow: '0 4px 10px -4px rgba(255,176,32,0.4)' },
          { transform: `translate(${x0}px, ${y0 - 10}px) translate(-50%, -50%)`, opacity: 1, offset: 0.15 },
          {
            transform: `translate(${mx}px, ${my}px) translate(-50%, -50%)`,
            opacity: 1,
            boxShadow: '0 30px 40px -14px rgba(255,176,32,0.55)',
            offset: 0.55,
          },
          { transform: `translate(${x1}px, ${y1}px) translate(-50%, -50%)`, opacity: 1, offset: 0.9 },
          { transform: `translate(${x1}px, ${y1}px) translate(-50%, -50%)`, opacity: 0 },
        ],
        { duration: 680, easing: 'cubic-bezier(.45,0,.25,1)', fill: 'forwards' },
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
      <div aria-hidden className="sec-glow" style={{ ['--g' as string]: 'rgba(255,176,32,0.09)' }} />
      <SectionHead
        tone={AMBER}
        tag="Corrigir legenda pela copy"
        align="center"
        size="xl"
        ask="Já entregou vídeo com legenda errada pro cliente?"
        answer={['Cola a copy. A legenda', { mark: 'se corrige sozinha.' }]}
        lead="A transcrição erra acento, nome e pontuação, e às vezes engole uma palavra. Com a copy colada, a ferramenta confere a legenda inteira, palavra por palavra, e troca o que estiver diferente. Sem mexer no tempo de nada."
      />

      <div ref={ref}>
        <div ref={zoneRef} className="cf-zone relative mt-14 md:mt-20">
          <div aria-hidden className="cf-floor" />
          <div className="relative grid grid-cols-1 items-center gap-6 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:gap-10">
            {/* a lauda (copy) */}
            <div ref={paperRef} className="cf-paper relative overflow-hidden rounded-[14px] p-6 md:p-8">
              <div className="flex items-baseline justify-between border-b border-black/15 pb-3">
                <span className="text-[24px] italic leading-none" style={{ fontFamily: 'var(--font-serif)', color: RED }}>
                  Lauda
                </span>
                <span className="text-[11px] font-semibold text-black/45" style={{ fontFamily: 'var(--font-mono)' }}>
                  COPY DO ANÚNCIO
                </span>
              </div>
              <p className="mt-5 text-[16px] leading-[2.1] text-[#1d1b16] md:text-[19px]" style={{ fontFamily: 'var(--font-mono)' }}>
                {data.copyTokens.map((tok, k) => (
                  <span key={k}>
                    <span
                      ref={(el) => {
                        paperWordRefs.current[k] = el;
                      }}
                      className={'cf-pw ' + (litCopy.has(k) ? 'is-lit' : '')}
                    >
                      {tok}
                    </span>{' '}
                  </span>
                ))}
              </p>
              {phase === 'fixing' && <span aria-hidden className="cf-beam" />}
            </div>

            {/* a legenda gerada */}
            <div ref={panelRef} className="cf-panel relative overflow-hidden rounded-[14px]">
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
                  {phase === 'fixing' && (errorsLeft > 0 ? `Corrigindo pela copy, faltam ${errorsLeft}` : 'Corrigindo pela copy')}
                  {phase === 'done' && 'Igual à copy'}
                </span>
              </div>

              <ol className="flex flex-col">
                {data.blocks.map((blk, bi) => (
                  <li key={blk.id} className="flex items-center gap-3 border-b border-white/[0.06] px-5 py-3.5 last:border-b-0 md:gap-5 md:px-6">
                    <span className="w-[66px] shrink-0 text-[11px] text-white/40 tabular-nums" style={{ fontFamily: 'var(--font-mono)' }}>
                      {fmt(blk.start)}
                    </span>
                    <span className="flex min-w-0 flex-wrap gap-x-[0.32em] gap-y-1">
                      {blk.words.map((wd, wi) => {
                        const fi = fixIndex.get(`${bi}:${wi}`);
                        if (fi === undefined)
                          return (
                            <span key={wi} className="cf-word text-white/90">
                              {wd.text}
                            </span>
                          );
                        const f = data.fixes[fi];
                        const isFixed = fixed.has(fi);
                        const longest = f.from.length >= f.to.length ? f.from : f.to;
                        return (
                          <span
                            key={wi}
                            ref={(el) => {
                              tileRefs.current[fi] = el;
                            }}
                            className={'cf-tile ' + (isFixed ? 'is-fixed' : '')}
                          >
                            <span aria-hidden className="cf-sizer">
                              {longest}
                            </span>
                            <span className="cf-from">{f.from}</span>
                            <span className="cf-to">
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

              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-white/10 px-5 py-4 md:px-6">
                <span
                  className={'cf-btn rounded-[11px] px-4 py-2.5 text-[12.5px] font-bold ' + (pressed ? 'is-pressed' : '')}
                  style={{ fontFamily: 'var(--font-tech)' }}
                >
                  Corrigir pela copy →
                </span>
                <span className={'cf-result text-[12.5px] font-semibold ' + (phase === 'done' ? 'is-on' : '')} style={{ fontFamily: 'var(--font-label)' }}>
                  {data.corrected} {data.corrected === 1 ? 'palavra corrigida' : 'palavras corrigidas'} e {data.added}{' '}
                  {data.added === 1 ? 'devolvida' : 'devolvidas'}. Blocos e tempos intactos.
                </span>
                {phase === 'done' && !reduced && (
                  <button
                    type="button"
                    onClick={() => setRun((r) => r + 1)}
                    className="rounded-[9px] px-2.5 py-1.5 text-[12px] font-semibold text-white/55 transition-colors hover:bg-white/[0.06] hover:text-white"
                    style={{ fontFamily: 'var(--font-label)' }}
                  >
                    Ver de novo
                  </button>
                )}
              </div>
            </div>
          </div>
          <div ref={flyRef} aria-hidden className="cf-fly pointer-events-none absolute inset-0 z-20" />
        </div>
      </div>

      <Reveal>
        <div className="mt-14 grid grid-cols-1 gap-x-8 gap-y-7 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ['Acento, nome e pontuação', 'Tudo volta escrito do jeito que está na copy.'],
            ['Palavra comida volta', 'O que a transcrição engoliu entra de novo, no lugar certo.'],
            ['Tempo intacto', 'Blocos, tempos e estilos não mudam. E o Ctrl+Z desfaz.'],
            ['Copy errada não passa', 'Se a copy não for desse vídeo, a ferramenta avisa antes de aplicar.'],
          ].map(([t, d]) => (
            <div key={t} className="border-t border-white/[0.12] pt-5">
              <h3 className="text-[16.5px] font-bold tracking-[-0.01em] text-white" style={{ fontFamily: 'var(--font-tech)' }}>
                {t}
              </h3>
              <p className="mt-1.5 text-[14px] leading-relaxed text-white/60">{d}</p>
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
        .cf-floor {
          position: absolute;
          left: -4%;
          right: -4%;
          bottom: -60px;
          height: 70%;
          background-image: linear-gradient(rgba(255, 176, 32, 0.12) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255, 176, 32, 0.12) 1px, transparent 1px);
          background-size: 56px 56px;
          transform: perspective(900px) rotateX(64deg);
          transform-origin: 50% 100%;
          -webkit-mask-image: radial-gradient(60% 70% at 50% 100%, #000, transparent);
          mask-image: radial-gradient(60% 70% at 50% 100%, #000, transparent);
          pointer-events: none;
        }
        .cf-paper {
          background-image: repeating-linear-gradient(
              180deg,
              transparent 0,
              transparent 39px,
              rgba(20, 20, 15, 0.05) 39px,
              rgba(20, 20, 15, 0.05) 40px
            ),
            linear-gradient(180deg, #f6f3ea, #ece7da);
          box-shadow: 0 1px 0 rgba(255, 255, 255, 0.7) inset, 0 40px 80px -36px rgba(0, 0, 0, 0.95), 0 0 0 1px rgba(0, 0, 0, 0.06);
          will-change: translate;
        }
        .cf-panel {
          background: linear-gradient(180deg, rgba(28, 26, 34, 0.97), rgba(14, 13, 18, 0.99));
          box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.1), 0 1px 0 rgba(255, 255, 255, 0.08) inset, 0 70px 120px -40px rgba(0, 0, 0, 0.95),
            0 0 90px -30px rgba(255, 176, 32, 0.28);
          will-change: translate;
        }
        .cf-pw {
          border-radius: 3px;
          transition: background-color 0.35s ease, box-shadow 0.35s ease;
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
          background: linear-gradient(180deg, transparent, rgba(255, 176, 32, 0.12) 70%, rgba(214, 120, 0, 0.5) 98%, transparent);
          animation: cf-beam ${(data.fixes.length * 560 + 600) / 1000}s linear forwards;
        }
        @keyframes cf-beam {
          from {
            transform: translateY(-70px);
          }
          to {
            transform: translateY(420px);
          }
        }
        .cf-word,
        .cf-tile {
          font-family: var(--font-tech);
          font-weight: 700;
          font-size: 17px;
          line-height: 1.55;
          letter-spacing: -0.01em;
        }
        @media (min-width: 768px) {
          .cf-word,
          .cf-tile {
            font-size: 21px;
          }
        }
        /* a palavra errada e a certa ocupam a MESMA célula (largura da maior):
           a linha não pula quando uma troca pela outra */
        .cf-tile {
          position: relative;
          display: inline-grid;
          white-space: nowrap;
          /* a troca acontece DENTRO da caixa da palavra: nada vaza nem sobrepõe */
          overflow: hidden;
          border-radius: 6px;
          margin: 0 -5px;
          padding: 0 5px;
        }
        .cf-sizer,
        .cf-from,
        .cf-to {
          grid-area: 1 / 1;
          padding: 0 5px;
          margin: 0 -5px;
          white-space: nowrap;
        }
        .cf-sizer {
          visibility: hidden;
        }
        .cf-from {
          color: #fff;
          text-decoration: underline wavy ${RED};
          text-decoration-thickness: 1.5px;
          text-underline-offset: 5px;
          background: rgba(224, 72, 63, 0.14);
          transition: opacity 0.16s ease, transform 0.18s cubic-bezier(0.5, 0, 0.75, 0);
        }
        .cf-to {
          color: #fff;
          background: rgba(126, 224, 161, 0.15);
          box-shadow: inset 0 0 0 1px rgba(126, 224, 161, 0.4);
          opacity: 0;
          transform: translate3d(0, 100%, 0);
          /* só começa depois que a palavra errada saiu inteira (0,18 s) */
          transition: opacity 0.2s ease 0.18s, transform 0.34s cubic-bezier(0.32, 0.72, 0, 1) 0.18s;
        }
        .cf-tile.is-fixed .cf-from {
          opacity: 0;
          transform: translate3d(0, -100%, 0);
        }
        .cf-tile.is-fixed .cf-to {
          opacity: 1;
          transform: none;
        }
        .cf-tile.is-fixed {
          animation: cf-flash 0.9s ease-out 0.2s;
        }
        @keyframes cf-flash {
          0% {
            box-shadow: 0 0 0 0 rgba(126, 224, 161, 0);
          }
          30% {
            box-shadow: 0 0 0 2px rgba(126, 224, 161, 0.75), 0 0 22px rgba(126, 224, 161, 0.45);
          }
          100% {
            box-shadow: 0 0 0 0 rgba(126, 224, 161, 0);
          }
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
          padding: 3px 10px;
          border-radius: 7px;
          font-family: var(--font-mono);
          font-size: 15px;
          font-weight: 700;
          color: #1b1206;
          background: linear-gradient(180deg, #ffe08a, #ffbe3d);
          white-space: nowrap;
          will-change: transform, opacity;
        }
        @media (prefers-reduced-motion: reduce) {
          .cf-from,
          .cf-to {
            transition: none;
          }
          .cf-tile.is-fixed {
            animation: none;
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
