'use client';
import Link from 'next/link';
import { SmokeText } from '@/components/SmokeText';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { DarkoLogo } from '@/components/DarkoLogo';

export function Wordmark() {
  return <Link href="/" className="ae-wordmark" aria-label="Auto Edit, início"><DarkoLogo size={36} /><span><SmokeText text="Auto Edit" /></span></Link>;
}
export function SiteHeader({ compact = false }: { compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const [activeSection, setActiveSection] = useState('');
  const pathname = usePathname();
  const menuButton = useRef<HTMLButtonElement>(null);
  const links = [{ href: '/#suite', label: 'Ferramentas' }, { href: '/#como', label: 'Como funciona' }, { href: '/planos', label: 'Planos' }, { href: '/recursos', label: 'Recursos' }];
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') { setOpen(false); menuButton.current?.focus(); } };
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [open]);
  useEffect(() => {
    setActiveSection(''); setOpen(false);
    if (pathname !== '/' || compact) return;
    const sections = ['suite', 'como'].map(id => document.getElementById(id)).filter((node): node is HTMLElement => node !== null);
    const observer = new IntersectionObserver(entries => {
      const incoming = entries.find(entry => entry.isIntersecting);
      if (incoming) setActiveSection(incoming.target.id);
      else setActiveSection(current => entries.some(entry => entry.target.id === current) ? '' : current);
    }, { rootMargin: '-20% 0px -50% 0px' });
    sections.forEach(section => observer.observe(section));
    return () => observer.disconnect();
  }, [pathname, compact]);
  const currentLink = (href: string): 'page' | 'location' | undefined => href === pathname ? 'page' : activeSection && href === '/#' + activeSection ? 'location' : undefined;
  return <header className="ae-header"><div className="ae-container ae-header-inner"><Wordmark />
    {!compact && <nav className="ae-desktop-nav" aria-label="Navegação principal">{links.map(link => <Link key={link.href} href={link.href} aria-current={currentLink(link.href)}>{link.label}</Link>)}</nav>}
    <div className="ae-header-actions"><Link className="ae-login-link" href={compact ? '/' : '/login'}>{compact ? 'Voltar ao início' : 'Entrar'}</Link>
    {!compact && <><Link className="ae-button ae-button-small" data-ripple href="/register">Criar conta grátis<span aria-hidden>↗</span></Link><button ref={menuButton} type="button" className="ae-menu-button" aria-expanded={open} aria-controls="ae-mobile-menu" onClick={() => setOpen(!open)} aria-label={open ? 'Fechar menu' : 'Abrir menu'}><span /><span /></button></>}
    </div></div>
    {!compact && open && <nav id="ae-mobile-menu" className="ae-mobile-nav" aria-label="Menu móvel">{links.map(link => <Link key={link.href} href={link.href} aria-current={currentLink(link.href)} onClick={() => setOpen(false)}>{link.label}</Link>)}<Link href="/login" onClick={() => setOpen(false)}>Entrar</Link></nav>}
    {!compact && <span className="ae-reading-line" aria-hidden />}
  </header>;
}
