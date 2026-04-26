import Link from 'next/link';
import { DarkoLogo } from './DarkoLogo';

/**
 * Brand da aplicacao — DARKO LAB.
 *
 * Combina o coelho sombrio do Donnie Darko (olho verde lime brilhando)
 * com o wordmark em caixa alta, letter-spacing hacker.
 */
export function Brand({
  href = '/tools',
  size = 'md',
}: {
  href?: string;
  size?: 'sm' | 'md' | 'lg';
}) {
  const sizes = {
    sm: { text: 'text-sm', logo: 20 },
    md: { text: 'text-lg', logo: 28 },
    lg: { text: 'text-2xl', logo: 40 },
  };
  const s = sizes[size];
  return (
    <Link
      href={href}
      className={`brand group flex items-center gap-2 font-display uppercase ${s.text} select-none transition-transform duration-300 hover:scale-[1.04]`}
    >
      <span className="transition-transform duration-500 group-hover:rotate-[-4deg]">
        <DarkoLogo size={s.logo} />
      </span>
      <span>DARKO LAB</span>
    </Link>
  );
}
