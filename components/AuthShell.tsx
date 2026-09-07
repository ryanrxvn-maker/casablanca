'use client';
import { SiteHeader } from './redesign/SiteHeader';
import { SmokeText } from './SmokeText';
import { ProductDemo } from './redesign/Marketing';
export function AuthShell({title,subtitle,children,footer}:{title:string;subtitle?:string;children:React.ReactNode;footer?:React.ReactNode}) {
  return <main className="ae-auth"><SiteHeader compact /><section className="ae-container ae-auth-layout"><div className="ae-auth-showcase"><h2>Sua próxima ideia.<br /><span className="ae-headline-accent"><SmokeText text="Seu próximo vídeo." /></span></h2><ProductDemo /></div><div className="ae-auth-form"><h1>{title}</h1>{subtitle && <p className="ae-auth-subtitle">{subtitle}</p>}<div className="ae-auth-fields">{children}</div>{footer && <div className="ae-auth-footer">{footer}</div>}</div></section></main>;
}
