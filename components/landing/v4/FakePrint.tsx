'use client';

/**
 * FakePrint — a redação da landing v4.
 *
 * Em cima: pergunta + resposta e o plantão (TelejornalCard, a peça que o
 * Silas aprovou), girando de leve com o mouse. Embaixo: a MESA, com prints de
 * verdade exportados pelo próprio FakePrint (PNG baixado da ferramenta, não
 * desenho), espalhados em profundidade.
 *
 * O CONTEÚDO dos prints fala do próprio Auto Edit (pedido de 08.10: "dois
 * marketings ao mesmo tempo"). Por isso o texto da seção diz que são prints DE
 * EXEMPLO montados no FakePrint: ninguém pode ler isso como depoimento real. O mouse mexe a mesa; passar em cima
 * de um print traz ele pra frente.
 *
 * Regra de copy da v3 continua: o que tem cara de notícia fala SÓ de FakePrint.
 */

import { useCallback, useRef } from 'react';
import { Reveal } from '../v3/kit';
import { TelejornalCard } from '../v3/scenes';
import { usePointerField } from './fx';
import { SectionHead } from './ui';

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

/** Composição da mesa (desktop). No celular vira uma fileira que rola de lado. */
const PRINTS: Print[] = [
  { src: '/landing/fp2-comentarios.webp', alt: 'Comentários de exemplo num post do Instagram elogiando o Auto Edit', x: 1, y: 6, w: 18, rot: -5, z: 0.45, ratio: '540/868' },
  { src: '/landing/fp2-whatsapp.webp', alt: 'Conversa de exemplo no WhatsApp indicando o Auto Edit', x: 20, y: 1, w: 15, rot: 3, z: 1, ratio: '540/1090' },
  { src: '/landing/fp2-caixinha.webp', alt: 'Caixinha de pergunta de exemplo perguntando qual ferramenta faz as legendas', x: 35, y: 34, w: 13.5, rot: -4, z: 0.6, ratio: '540/959' },
  { src: '/landing/fp2-tweet.webp', alt: 'Post de exemplo no X sobre o Auto Edit', x: 47, y: 0, w: 27, rot: 3, z: 0.8, ratio: '720/606' },
  { src: '/landing/fp2-live.webp', alt: 'Live de exemplo no TikTok com comentários sobre o Auto Edit', x: 62, y: 44, w: 13, rot: 4, z: 0.65, ratio: '540/960' },
  { src: '/landing/fp2-notificacao.webp', alt: 'Notificação de exemplo do WhatsApp de uma cliente', x: 80, y: 8, w: 15, rot: -5, z: 0.5, ratio: '540/1090' },
];

export function FakePrintSection() {
  return (
    <section id="fakeprint" className="relative mx-auto mt-28 max-w-[1360px] px-5 md:mt-40 md:px-8">
      <div aria-hidden className="sec-glow" style={{ ['--g' as string]: 'rgba(224,72,63,0.11)' }} />
      <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:gap-14">
        <div>
          <SectionHead
            tone={RED}
            tag="FakePrint"
            size="md"
            ask="Precisa de uma notícia pro seu criativo ficar crível?"
            answer={['Manchete de', { mark: 'telejornal' }, 'profissional, pronta em segundos.']}
            lead="Você escreve a manchete e o FakePrint monta o telejornal em tela verde, pra você jogar o seu vídeo por trás na edição. E não é só notícia: tem conversa de WhatsApp, comentários, story, post, notificação, live e site de notícia."
          />
          <Reveal delay={120}>
            <ul className="mt-8 flex flex-col gap-3.5">
              {[
                'O print muda enquanto você digita, e o que você vê é o PNG que baixa',
                'Telejornal, site e live saem prontos pro chroma key',
                'Também sai em vídeo: reações subindo na live e, no Premium, relógio andando no telejornal',
              ].map((b) => (
                <li key={b} className="flex items-start gap-3">
                  <span aria-hidden className="mt-[9px] block h-[6px] w-[6px] shrink-0 rounded-full" style={{ background: RED }} />
                  <span className="text-[15.5px] leading-relaxed text-white/80">{b}</span>
                </li>
              ))}
            </ul>
            <p className="mt-7 border-l-2 pl-4 text-[13.5px] leading-relaxed text-white/50" style={{ borderColor: `${RED}66` }}>
              Prints de rede social são grátis. Telejornais e sites de notícia ficam no Premium: no
              Free você vê a prévia.
            </p>
          </Reveal>
        </div>

        <Reveal delay={100}>
          <TiltCard>
            <TelejornalCard />
          </TiltCard>
          <p className="mt-4 text-[12.5px] text-white/45">
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
    <div className="mt-24 md:mt-32">
      <SectionHead
        tone={RED}
        ask="Quer ver como fica de verdade?"
        answer={['Tudo isso', { mark: 'saiu do FakePrint.' }]}
        lead={
          <>
            Prints de exemplo, montados e exportados no FakePrint, sem retoque.{' '}
            <span className="hidden md:inline">Passa o mouse pra ver de perto.</span>
            <span className="md:hidden">Arrasta pro lado pra ver todos.</span>
          </>
        }
      />

      <div style={{ filter: 'saturate(1.39)' }}>
        {/* desktop: mesa em profundidade */}
        <div ref={zoneRef} className="desk relative mt-12 hidden md:block">
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
            <div key={p.src} className="shrink-0 snap-center" style={{ height: 320, aspectRatio: p.ratio }}>
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
    </div>
  );
}
