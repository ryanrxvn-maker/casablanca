'use client';

import { useEffect, useRef, useState } from 'react';
import { Ticker } from '@/components/landing/v3/kit';

// The original landing's two news bands, including their copy and motion.
const NEWS = [
  'Decupagem — o silêncio sai sozinho',
  'Camuflagem — duas trilhas no mesmo arquivo',
  'FakePrint — 41 modelos de print',
  'Legendas Automáticas — sua fala vira legenda animada',
  'Gerador de SRT — legenda palavra por palavra',
  'FakePrint — tela verde pronta pro chroma',
  'Lote — vários arquivos de uma vez',
  'Grátis — sem cartão pra começar',
];

const COLOPHON = [
  'Decupagem automática',
  'Camuflagem de áudio',
  'FakePrint · 41 modelos',
  'Gerador de SRT',
  'Lipsync Video to Video',
  'Compressor',
  'Downloader',
  'Mixer de velocidade',
];

export function NewsRibbon({ variant = 'news' }: { variant?: 'news' | 'colophon' }) {
  const [paused, setPaused] = useState(false);
  const ref = useRef<HTMLElement>(null);
  const colophon = variant === 'colophon';
  const tag = colophon ? 'Expediente' : 'Plantão';

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    let visible = false;
    const update = () => {
      node.dataset.running = visible && document.visibilityState === 'visible' ? 'true' : 'false';
    };
    const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; update(); });
    observer.observe(node);
    document.addEventListener('visibilitychange', update);
    return () => { observer.disconnect(); document.removeEventListener('visibilitychange', update); };
  }, []);

  return (
    <section
      ref={ref}
      aria-label={`Faixa de notícias: ${tag}`}
      className={`ae-news-ribbon ae-news-ribbon-${variant}`}
      data-running="false"
      data-paused={paused}
    >
      <Ticker tag={tag} items={colophon ? COLOPHON : NEWS} tone={colophon ? '#2a2534' : '#e0483f'} speed={colophon ? 54 : 42} />
      <button
        type="button"
        className="ae-news-pause"
        aria-label={`${paused ? 'Retomar' : 'Pausar'} faixa ${tag}`}
        aria-pressed={paused}
        onClick={() => setPaused(value => !value)}
      >
        <span aria-hidden="true">{paused ? '▶' : 'Ⅱ'}</span>
      </button>
    </section>
  );
}
