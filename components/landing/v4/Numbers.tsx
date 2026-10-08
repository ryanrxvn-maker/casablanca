'use client';

/**
 * Números da edição — os quatro que o site pode afirmar, todos vindos da
 * fonte (lib/numeros-do-site + a lista da suíte). Contam do zero quando
 * aparecem; o HTML do servidor já traz o número final (crawler e reduced-motion
 * leem certo).
 */

import { useEffect, useRef } from 'react';
import { FAKEPRINT_MODELOS, LEGENDAS_MODELOS } from '@/lib/numeros-do-site';
import { reducedMotion } from '../v3/kit';
import { FERRAMENTAS_NO_AR } from './Rest';

const ITEMS: Array<{ n: number; pre?: string; label: string }> = [
  { n: LEGENDAS_MODELOS, label: 'modelos de legenda animada' },
  { n: FAKEPRINT_MODELOS, label: 'modelos de print no FakePrint' },
  { n: FERRAMENTAS_NO_AR, label: 'ferramentas no ar hoje' },
  { n: 0, pre: 'R$ ', label: 'pra começar, sem cartão' },
];

export function NumbersBand() {
  return (
    <section aria-label="Números do Auto Edit" className="mx-auto mt-20 max-w-[1360px] px-5 md:mt-28 md:px-8">
      <div className="grid grid-cols-2 gap-y-10 lg:grid-cols-4">
        {ITEMS.map((it, i) => (
          <div key={it.label} className={'px-0 lg:px-8 ' + (i > 0 ? 'lg:border-l lg:border-white/10' : 'lg:pl-0')}>
            <Count n={it.n} pre={it.pre} />
            <p className="mt-3 max-w-[18ch] text-[14.5px] leading-snug text-white/55">{it.label}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function Count({ n, pre = '' }: { n: number; pre?: string }) {
  const ref = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || n === 0 || reducedMotion() || typeof IntersectionObserver === 'undefined') return;
    let raf = 0;
    let done = false;
    const run = () => {
      const t0 = performance.now();
      const dur = 1400;
      const step = (now: number) => {
        const k = Math.min(1, (now - t0) / dur);
        const e = 1 - Math.pow(1 - k, 4);
        el.textContent = pre + Math.round(n * e).toLocaleString('pt-BR');
        if (k < 1) raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    };
    const io = new IntersectionObserver(
      ([e]) => {
        if (!e.isIntersecting || done) return;
        done = true;
        io.disconnect();
        run();
      },
      { threshold: 0.6 },
    );
    // começa do zero só se ainda não está na tela (sem piscar o número final)
    const r = el.getBoundingClientRect();
    if (r.top > window.innerHeight) el.textContent = pre + '0';
    io.observe(el);
    return () => {
      io.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [n, pre]);

  return (
    <span
      ref={ref}
      className="block text-[56px] font-extrabold leading-none tracking-[-0.04em] text-white tabular-nums md:text-[84px]"
      style={{ fontFamily: 'var(--font-tech)' }}
    >
      {pre}
      {n.toLocaleString('pt-BR')}
    </span>
  );
}
