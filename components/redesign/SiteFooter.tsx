import Link from 'next/link';
import { Wordmark } from './SiteHeader';
export function SiteFooter() {
  return <footer className="ae-container ae-footer"><div className="ae-footer-top"><div><Wordmark /><p>Mais espaço para criar.<br />Menos tempo no repetitivo.</p></div><nav aria-label="Produto"><span>Produto</span><Link href="/#suite">Ferramentas</Link><Link href="/planos">Planos</Link><Link href="/recursos">Recursos</Link></nav><nav aria-label="Sua conta"><span>Sua conta</span><Link href="/login">Entrar</Link><Link href="/register">Criar conta</Link><Link href="/#faq">Perguntas frequentes</Link></nav><nav aria-label="Informações legais"><span>Informações</span><Link href="/termos">Termos de uso</Link><Link href="/politica">Assinatura e cancelamento</Link></nav></div><div className="ae-footer-bottom"><span>© {new Date().getFullYear()} Auto Edit</span><span>Ferramentas para quem vive de vídeo.</span></div></footer>;
}
