import Link from 'next/link';
import { notFound } from 'next/navigation';
import { SiteHeader } from '@/components/redesign/SiteHeader';
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Revisão do redesign', robots: { index: false, follow: false } };
export default function DesignReview() {
  if (process.env.NODE_ENV !== 'development') notFound();
  const sections = [
    { title: 'Páginas públicas', links: [['Início', '/'], ['Planos', '/planos'], ['Recursos', '/recursos'], ['Termos de uso', '/termos'], ['Assinatura e cancelamento', '/politica']] },
    { title: 'Acesso', links: [['Entrar', '/login'], ['Criar conta', '/register'], ['Recuperar senha', '/forgot-password']] },
    { title: 'Área de edição', links: [['Início do estúdio', '/dev/redesign/hub'], ['Botões e estados', '/dev/redesign/controles'], ['Histórico', '/dev/redesign/historico'], ['Calculadora', '/dev/redesign/calculadora'], ['Famous Hey', '/dev/redesign/famous-hey'], ['FakePrint', '/dev/redesign/fakepass'], ['Legendas Automáticas', '/dev/redesign/tipografia'], ['Decupagem', '/dev/redesign/decupagem'], ['Camuflagem', '/dev/redesign/camuflagem'], ['Lipsync', '/dev/redesign/lipsync'], ['Gerador de SRT', '/dev/redesign/copy-srt'], ['Compressor', '/dev/redesign/compressor'], ['Downloader', '/dev/redesign/downloader'], ['Normalizador', '/dev/redesign/normalizador'], ['Mixer de Velocidade', '/dev/redesign/acelerador'], ['Dividir áudios', '/dev/redesign/audio-split']] },
  ];
  return <main><SiteHeader compact/><div className="ae-container ae-section"><div className="ae-section-heading"><h2>O novo Auto Edit.<br/><span>Preview para revisão.</span></h2><p>Versão local. As telas internas usam os componentes reais, sem simular uma conta autenticada. Geração, pagamento e acesso continuam sujeitos às regras existentes.</p></div>{sections.map(section=><section className="ae-review-group" key={section.title}><h3>{section.title}</h3><div>{section.links.map(([name,href])=><Link href={href} key={href}>{name}<span aria-hidden>↗</span></Link>)}</div></section>)}</div></main>;
}
