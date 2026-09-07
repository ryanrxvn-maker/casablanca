import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Brand } from '@/components/Brand';
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Revisão do redesign', robots: { index: false, follow: false } };
export default function DesignReview() {
  if (process.env.NODE_ENV !== 'development') notFound();
  const sections = [
    { title: 'Páginas públicas', links: [['Início', '/'], ['Planos', '/planos'], ['Recursos', '/recursos'], ['Termos de uso', '/termos'], ['Assinatura e cancelamento', '/politica']] },
    { title: 'Acesso', links: [['Entrar', '/login'], ['Criar conta', '/register'], ['Recuperar senha', '/forgot-password']] },
    { title: 'Área de edição', links: [['Início do estúdio', '/dev/redesign/hub'], ['Botões e estados', '/dev/redesign/controles'], ['Histórico', '/dev/redesign/historico'], ['Calculadora', '/dev/redesign/calculadora'], ['Famous Hey', '/dev/redesign/famous-hey'], ['FakePrint', '/dev/redesign/fakepass'], ['Legendas Automáticas', '/dev/redesign/tipografia'], ['Decupagem', '/dev/redesign/decupagem'], ['Camuflagem', '/dev/redesign/camuflagem'], ['Lipsync', '/dev/redesign/lipsync'], ['Gerador de SRT', '/dev/redesign/copy-srt'], ['Compressor', '/dev/redesign/compressor'], ['Downloader', '/dev/redesign/downloader'], ['Normalizador', '/dev/redesign/normalizador'], ['Mixer de Velocidade', '/dev/redesign/acelerador'], ['Dividir áudios', '/dev/redesign/audio-split']] },
  ];
  return <main className="mx-auto max-w-[1100px] px-5 py-8"><Brand href="/" /><h1 className="hero-title mt-10">Visual original. Botões refinados.</h1><p className="mt-4 text-text-muted">Prévia local com os componentes reais. As regras de acesso e processamento continuam iguais.</p>{sections.map(section => <section className="mt-10" key={section.title}><h2 className="section-title">{section.title}</h2><div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{section.links.map(([name,href]) => <Link className="btn-secondary" href={href} key={href}>{name}</Link>)}</div></section>)}</main>;
}
