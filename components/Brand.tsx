import Link from 'next/link';
import { DarkoLogo } from './DarkoLogo';

/**
 * Brand DARKO LAB v2.
 *
 * Wordmark com peso 800 + tracking apertado pra parecer marca de produto
 * (nao mais "vibe-code"). "DARKO" e' branco com leve glow violet no hover;
 * "LAB" e' a parte com peso editorial (lime sutil) que cria a dupla camada.
 */
export function Brand({
  href = '/tools',
  size = 'md',
}: {
  href?: string;
  size?: 'sm' | 'md' | 'lg';
}) {
  const sizes = {
    sm: { text: 'text-[13px]', logo: 22 },
    md: { text: 'text-[15px]', logo: 30 },
    lg: { text: 'text-[22px]', logo: 44 },
  };
  const s = sizes[size];
  return (
    <Link
      href={href}
      className={`brand group flex items-center gap-2.5 ${s.text} select-none transition-transform duration-300 hover:scale-[1.03]`}
    >
      <span className="transition-transform duration-500 group-hover:rotate-[-5deg]">
        <DarkoLogo size={s.logo} />
      </span>
      <span className="leading-none">
        <span className="text-white">DARKO</span>
        <span className="brand-mark ml-1.5">LAB</span>
      </span>
    </Link>
  );
}
