'use client';

/**
 * Áudio — bento de duas peças: Remover Silêncios (o corte) e Camuflagem (a
 * trilha protegida). Cada peça com a cena animada que já existia na v3 e copy
 * curta. Plano real escrito em cada uma.
 */

import { useRef } from 'react';
import { Reveal } from '../v3/kit';
import { CamuflagemScene, DecupagemScene } from '../v3/scenes';
import { useSpotlight } from './fx';

const LIME = '#c8d684';
const TEAL = '#3ec7bb';

export function AudioSection() {
  return (
    <section id="audio" className="relative mx-auto mt-28 max-w-[1360px] px-5 md:mt-40 md:px-8">
      <Reveal>
        <h2 className="section-title max-w-[18ch] text-[40px] leading-[1.02] md:text-[58px]">
          O áudio resolvido{' '}
          <span className="text-editorial italic text-white/70">enquanto você cuida do resto.</span>
        </h2>
      </Reveal>

      <div className="mt-12 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.12fr)_minmax(0,0.88fr)]">
        <Reveal>
          <Cell
            tone={LIME}
            tag="Remover Silêncios"
            title="O silêncio sai. A fala fica."
            lead="Sobe o áudio ou o vídeo e recebe de volta sem tempo morto e sem respiro esticado no meio da frase, com a voz já nivelada."
            bullets={['Vários arquivos na mesma fila', 'Dois locutores no mesmo volume', 'Nenhuma sílaba comida na entrada da frase']}
            note="Áudio no Free, vídeo no Premium. Roda no seu navegador, e arquivo grande é dividido e remontado num arquivo só."
            scene={<DecupagemScene />}
          />
        </Reveal>
        <Reveal delay={90}>
          <Cell
            tone={TEAL}
            tag="Camuflagem de Áudio"
            title="Duas trilhas no mesmo arquivo."
            lead="Quem assiste ouve o seu áudio. A transcrição automática das plataformas lê a trilha que você deixou por baixo, ou silêncio, no modo mudo."
            bullets={['Até 10 pares por vez', 'Sai em MP4, MP3 ou WAV', 'Descamuflar devolve qualquer camada']}
            note="No Premium. No fim, a ferramenta escuta o arquivo pronto do jeito que a plataforma escuta e mostra um selo por plataforma. Sem selo verde, não publique."
            scene={<CamuflagemScene />}
          />
        </Reveal>
      </div>
    </section>
  );
}

function Cell({
  tone,
  tag,
  title,
  lead,
  bullets,
  note,
  scene,
}: {
  tone: string;
  tag: string;
  title: string;
  lead: string;
  bullets: string[];
  note: string;
  scene: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  useSpotlight(ref);
  return (
    <div ref={ref} className="cell relative flex h-full flex-col overflow-hidden rounded-[16px] p-6 md:p-8" style={{ ['--tone' as string]: tone }}>
      <span
        className="inline-flex w-fit items-center gap-2 rounded-full border px-3 py-1 text-[12.5px] font-semibold"
        style={{ fontFamily: 'var(--font-label)', color: tone, borderColor: `${tone}4d`, background: `${tone}12` }}
      >
        <span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ background: tone }} />
        {tag}
      </span>
      <h3 className="mt-4 text-[28px] font-extrabold leading-[1.08] tracking-[-0.02em] text-white md:text-[34px]" style={{ fontFamily: 'var(--font-tech)' }}>
        {title}
      </h3>
      <p className="mt-3 max-w-[54ch] text-[15px] leading-[1.7] text-white/[0.62]">{lead}</p>
      <ul className="mt-5 flex flex-wrap gap-2">
        {bullets.map((b) => (
          <li key={b} className="rounded-full border border-white/[0.12] bg-white/[0.03] px-3 py-1.5 text-[13px] text-white/80">
            {b}
          </li>
        ))}
      </ul>
      <div className="mt-7 flex flex-1 flex-col justify-center">{scene}</div>
      <p className="mt-6 text-[13px] leading-relaxed text-white/[0.48]">{note}</p>
      <style jsx>{`
        .cell {
          background: radial-gradient(120% 80% at 0% 0%, color-mix(in srgb, var(--tone) 9%, transparent), transparent 60%),
            linear-gradient(180deg, rgb(var(--bg-softer)), rgb(var(--bg-soft)));
          box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.08);
        }
        .cell::before {
          content: '';
          position: absolute;
          inset: 0;
          border-radius: inherit;
          padding: 1px;
          background: radial-gradient(320px circle at var(--sx, -40%) var(--sy, -40%), color-mix(in srgb, var(--tone) 70%, transparent), transparent 70%);
          -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
          -webkit-mask-composite: xor;
          mask-composite: exclude;
          pointer-events: none;
        }
      `}</style>
    </div>
  );
}
