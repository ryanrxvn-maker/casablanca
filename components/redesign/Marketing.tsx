'use client';
import Link from 'next/link';
import { SmokeText } from '@/components/SmokeText';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { BreakingCard, LegendasScene } from '@/components/landing/v3/scenes';

/** Original media; playback is limited to visible, active previews. */
export function ProductVideo({ name, className = '', controls = true }: { name: string; className?: string; controls?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    let visible = false;
    const update = () => { if (visible && !reduced.matches && document.visibilityState === 'visible') void video.play().catch(() => {}); else video.pause(); };
    const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; update(); }, { threshold: 0.15 });
    observer.observe(video); reduced.addEventListener('change', update); document.addEventListener('visibilitychange', update);
    return () => { observer.disconnect(); reduced.removeEventListener('change', update); document.removeEventListener('visibilitychange', update); video.pause(); };
  }, [name]);
  return <video key={name} ref={ref} className={'ae-video ' + className} src={`/hero/${name}.mp4`} poster={`/hero/${name}.jpg`} muted loop playsInline preload="metadata" controls={controls} aria-label={name === 'famous-hey' ? 'Demonstração original do Famous Hey' : 'Demonstração original do FakePrint'} />;
}
export function ProductDemo() {
  const [tab, setTab] = useState(0);
  const names = ['FakePrint', 'Legendas', 'Famous Hey'];
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  return <div className="ae-product-demo"><div className="ae-demo-tabs" role="tablist" aria-label="Demonstrações das ferramentas">{names.map((name, index) => <button key={name} ref={el => { buttons.current[index] = el; }} type="button" role="tab" id={`ae-demo-tab-${index}`} aria-controls={`ae-demo-panel-${index}`} aria-selected={tab === index} tabIndex={tab === index ? 0 : -1} onClick={() => setTab(index)} onKeyDown={event => {
    let next = index;
    if (event.key === 'ArrowRight') next = (index + 1) % names.length;
    else if (event.key === 'ArrowLeft') next = (index + names.length - 1) % names.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = names.length - 1;
    else return;
    event.preventDefault(); setTab(next); buttons.current[next]?.focus();
  }}>{name}</button>)}</div><div className="ae-demo-panel" role="tabpanel" id={`ae-demo-panel-${tab}`} aria-labelledby={`ae-demo-tab-${tab}`}>
    {tab === 0 ? <BreakingCard /> : tab === 1 ? <LegendasScene /> : <ProductVideo name="famous-hey" />}
  </div><div className="ae-demo-caption"><span>{tab === 0 ? 'Sua manchete, no seu vídeo.' : tab === 1 ? 'Cada palavra no tempo certo.' : 'Da imagem ao take pronto.'}</span><span aria-hidden>↗</span></div></div>;
}
export function HomeHero() {
  return <section className="ae-container ae-hero"><div className="ae-hero-copy"><p className="ae-eyebrow">SUÍTE DE EDIÇÃO DE VÍDEO</p><h1><SmokeText text="Edite mais." /><br /><span className="ae-headline-accent"><SmokeText text="Repita menos." /></span></h1><p className="ae-hero-description">Do corte às legendas, organize sua edição em um só lugar. Menos tarefas repetitivas. Mais tempo para criar.</p><div className="ae-hero-actions"><Link href="/register" className="ae-button" data-ripple>Criar conta grátis<span aria-hidden>↗</span></Link><a href="#suite" className="ae-text-link">Conhecer a suíte<span aria-hidden>↓</span></a></div><p className="ae-hero-assurance"><span aria-hidden />Comece grátis, sem cartão.</p></div><ProductDemo /></section>;
}
export function Reveal({ children, className = '' }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = ref.current;
    if (!node || window.matchMedia('(prefers-reduced-motion: reduce)').matches || !('IntersectionObserver' in window)) return;
    const observer = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) { node.classList.add('ae-enter'); observer.disconnect(); } }, { threshold: 0.08 });
    observer.observe(node); return () => observer.disconnect();
  }, []);
  return <div ref={ref} className={'ae-reveal ' + className}>{children}</div>;
}
