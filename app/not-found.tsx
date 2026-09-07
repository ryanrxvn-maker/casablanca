import Link from 'next/link';
import { SiteHeader } from '@/components/redesign/SiteHeader';
import { SiteFooter } from '@/components/redesign/SiteFooter';
import { RabbitAura } from '@/components/redesign/RabbitAura';

/**
 * 404 — pagina nao encontrada.
 *
 * Mantém a estética DARKO LAB com o coelho e wordmark, e oferece
 * um caminho de volta pras ferramentas (ou login se nao autenticado).
 */
export default function NotFound() {
  return (
    <main className="ae-status-page">
      <SiteHeader compact />
      <section className="ae-container ae-status-content">
        <RabbitAura tier={0} hue="#c084fc" glow="rgba(167,139,250,.45)" />
        <p className="ae-eyebrow">PÁGINA 404</p>
        <h1>Não encontramos esta página.</h1>
        <p>O endereço pode ter mudado. Volte ao início ou encontre a ferramenta que procura no estúdio.</p>
        <div className="ae-control-examples"><Link href="/" className="ae-button">Voltar ao início <span aria-hidden>↗</span></Link><Link href="/tools" className="ae-text-link">Abrir o estúdio <span aria-hidden>→</span></Link></div>
      </section>
      <SiteFooter />
    </main>
  );
}
