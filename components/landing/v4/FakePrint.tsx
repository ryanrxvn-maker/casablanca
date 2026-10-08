'use client';

/**
 * FakePrint — a redação da landing v4.
 *
 * Em cima: a copy e o plantão (TelejornalCard, a peça que o Silas aprovou),
 * agora girando de leve com o mouse. Embaixo: a MESA — prints de verdade,
 * exportados pelo próprio FakePrint (PNG baixado da ferramenta, não desenho),
 * espalhados em profundidade. O mouse mexe a mesa; passar em cima de um print
 * traz ele pra frente.
 *
 * Regra de copy da landing v3 continua: o que tem cara de notícia fala SÓ de
 * FakePrint.
 */

import { useCallback, useRef } from 'react';
import { FAKEPRINT_MODELOS } from '@/lib/numeros-do-site';
import { Reveal } from '../v3/kit';
import { TelejornalCard } from '../v3/scenes';
import { usePointerField } from './fx';

const RED = '#e0483f';

type Print = {
  src: string;
  alt: string;
  /** posição/tamanho em % da mesa; z = profundidade (parallax) */
  x: number;
  y: number;
  w: number;
  rot: number;
  z: number;
  ratio: string;
};

/** Composição da mesa (desktop). No celular vira uma fileira que rola. */
const PRINTS: Print[] = [
  { src: '/landing/fp-zoom.webp', alt: 'Reunião do Zoom com os quadros em tela verde', x: 1, y: 22, w: 34, rot: -5, z: 0.35, ratio: '16/9' },
  { src: '/landing/fp-whatsapp.webp', alt: 'Conversa de WhatsApp', x: 28, y: 3, w: 15, rot: 4, z: 1, ratio: '540/1090' },
  { src: '/landing/fp-caixinha.webp', alt: 'Caixinha de pergunta do story', x: 40.5, y: 36, w: 13.5, rot: -4, z: 0.55, ratio: '540/959' },
  { src: '/landing/fp-tweet.webp', alt: 'Post no X', x: 51, y: 5, w: 27, rot: 3, z: 0.8, ratio: '720/515' },
  { src: '/landing/fp-live-tiktok.webp', alt: 'Live do TikTok', x: 63, y: 44, w: 13, rot: 3, z: 0.65, ratio: '540/960' },
  { src: '/landing/fp-notificacao.webp', alt: 'Notificação na tela de bloqueio', x: 80, y: 14, w: 15, rot: -5, z: 0.45, ratio: '540/1090' },
];

export function FakePrintSection() {
  return (
    <section id="fakeprint" className="relative mx-auto mt-28 max-w-[1360px] px-5 md:mt-40 md:px-8">
      <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:gap-14">
        <Reveal>
          <span
            className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[12.5px] font-semibold"
            style={{ fontFamily: 'var(--font-label)', color: '#ff8a80', borderColor: `${RED}55`, background: `${RED}14` }}
          >
            <span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ background: RED }} />
            FakePrint
          </span>
          <h2 className="section-title mt-5 text-[40px] leading-[1.02] md:text-[58px]">
            A manchete do seu criativo,{' '}
            <span className="text-editorial italic text-white/70">pronta pra ilha.</span>
          </h2>
          <p className="mt-5 max-w-[56ch] text-[16px] leading-[1.7] text-white/[0.62]">
            São {FAKEPRINT_MODELOS} modelos: stories, conversas, posts, notificação, lives,
            reunião, telejornais e sites de notícia. Tudo que não é notícia é grátis. Nos
            telejornais e sites, o Free vê a prévia, e a edição e a exportação ficam no Premium.
          </p>
          <ul className="mt-7 flex flex-col gap-3.5">
            {[
              'Prévia ao vivo: o print muda a cada tecla, e o que você vê é o PNG que baixa',
              'Tela verde no que é cena: telejornal, site e live prontos pro chroma key',
              'Vídeo animado: reações subindo na live e, no Premium, relógio andando no telejornal',
            ].map((b) => (
              <li key={b} className="flex items-start gap-3">
                <span aria-hidden className="mt-[9px] block h-[5px] w-[5px] shrink-0 rounded-full" style={{ background: RED }} />
                <span className="text-[15px] leading-relaxed text-white/[0.82]">{b}</span>
              </li>
            ))}
          </ul>
          <p className="mt-7 border-l-2 pl-4 text-[13.5px] leading-relaxed text-white/50" style={{ borderColor: `${RED}66` }}>
            A barra de status do celular é editável até a bateria: 63% às 21:47 conta uma
            história, 100% às 9:00 conta outra.
          </p>
        </Reveal>

        <Reveal delay={100}>
          <TiltCard>
            <TelejornalCard />
          </TiltCard>
          <p className="mt-4 text-[12.5px] text-white/[0.42]">
            Telejornal do FakePrint, no Premium: o gráfico sai em tela verde e o seu vídeo entra por trás.
          </p>
        </Reveal>
      </div>

      <Desk />
    </section>
  );
}

/** O plantão gira alguns graus seguindo o mouse em cima dele. */
function TiltCard({ children }: { children: React.ReactNode }) {
  const zoneRef = useRef<HTMLDivElement | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const onFrame = useCallback((x: number, y: number) => {
    const c = cardRef.current;
    if (c) c.style.transform = `rotateY(${(x * 6).toFixed(3)}deg) rotateX(${(-y * 5).toFixed(3)}deg)`;
  }, []);
  usePointerField(zoneRef, onFrame, { ease: 0.1 });
  return (
    <div ref={zoneRef} style={{ perspective: '1400px' }}>
      <div ref={cardRef} style={{ transformStyle: 'preserve-3d', willChange: 'transform' }}>
        {children}
      </div>
    </div>
  );
}

function Desk() {
  const zoneRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);

  // Parallax: cada print anda proporcional à profundidade dele.
  const onFrame = useCallback((x: number, y: number) => {
    PRINTS.forEach((p, i) => {
      const el = itemRefs.current[i];
      if (!el) return;
      el.style.translate = `${(x * 26 * p.z).toFixed(2)}px ${(y * 18 * p.z).toFixed(2)}px`;
    });
  }, []);
  usePointerField(zoneRef, onFrame, { ease: 0.08, global: true });

  return (
    <Reveal>
      <div className="mt-20 md:mt-24" style={{ filter: 'saturate(1.39)' }}>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <h3 className="max-w-[24ch] text-[26px] font-extrabold leading-[1.1] tracking-[-0.02em] text-white md:text-[34px]" style={{ fontFamily: 'var(--font-tech)' }}>
            A mesa de quem faz criativo.
            <span className="block text-editorial font-normal italic text-white/65">Tudo isso saiu do FakePrint.</span>
          </h3>
          <p className="max-w-[40ch] text-[13.5px] leading-relaxed text-white/50">
            Prints exportados pela ferramenta, sem retoque.{' '}
            <span className="hidden md:inline">Passa o mouse pra ver de perto.</span>
            <span className="md:hidden">Arrasta pro lado pra ver todos.</span>
          </p>
        </div>

        {/* desktop: mesa em profundidade */}
        <div ref={zoneRef} className="desk relative mt-10 hidden md:block">
          {PRINTS.map((p, i) => (
            <div
              key={p.src}
              ref={(el) => {
                itemRefs.current[i] = el;
              }}
              className="desk-item absolute"
              style={{ left: `${p.x}%`, top: `${p.y}%`, width: `${p.w}%`, zIndex: Math.round(p.z * 10) }}
            >
              <div className="desk-card" style={{ ['--rot' as string]: `${p.rot}deg`, aspectRatio: p.ratio }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.src} alt={p.alt} loading="lazy" decoding="async" className="h-full w-full object-cover" />
              </div>
            </div>
          ))}
        </div>

        {/* celular: fileira que rola de lado */}
        <div className="desk-row -mx-5 mt-8 flex snap-x snap-mandatory gap-4 overflow-x-auto px-5 pb-4 md:hidden">
          {PRINTS.map((p) => (
            <div key={p.src} className="shrink-0 snap-center" style={{ height: 300, aspectRatio: p.ratio }}>
              <div className="desk-card h-full" style={{ ['--rot' as string]: '0deg' }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.src} alt={p.alt} loading="lazy" decoding="async" className="h-full w-full object-cover" />
              </div>
            </div>
          ))}
        </div>
      </div>

      <style jsx>{`
        .desk {
          aspect-ratio: 16 / 7.4;
        }
        .desk-item {
          will-change: translate;
        }
        .desk-card {
          overflow: hidden;
          border-radius: 12px;
          background: #0c0c10;
          transform: rotate(var(--rot));
          box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.12), 0 30px 60px -28px rgba(0, 0, 0, 0.95),
            0 10px 22px -12px rgba(0, 0, 0, 0.7);
          transition: transform 0.55s cubic-bezier(0.32, 0.72, 0, 1), box-shadow 0.4s ease;
        }
        .desk-item:hover {
          z-index: 30 !important;
        }
        .desk-item:hover .desk-card {
          transform: rotate(0deg) scale(1.08) translateY(-8px);
          box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.22), 0 50px 90px -30px rgba(0, 0, 0, 0.95),
            0 0 50px -16px rgba(224, 72, 63, 0.35);
        }
        .desk-row {
          scrollbar-width: none;
        }
        .desk-row::-webkit-scrollbar {
          display: none;
        }
        @media (prefers-reduced-motion: reduce) {
          .desk-card {
            transition: none;
          }
        }
      `}</style>
    </Reveal>
  );
}
