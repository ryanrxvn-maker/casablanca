import Link from 'next/link';
import { DarkoLogo } from './DarkoLogo';
import { SmokeText } from './SmokeText';

/**
 * Brand Auto Edit.
 *
 * Combina logo do coelho neon frontal com wordmark "Auto Edit".
 * O wordmark usa o componente SmokeText — ao passar o mouse, o
 * texto se dissolve em fumaça e volta quando o mouse sai.
 */
export function Brand({
  href = '/tools',
  size = 'md',
}: {
  href?: string;
  size?: 'sm' | 'md' | 'lg';
}) {
  const sizes = {
    sm: { text: 'text-[14px]', logo: 26 },
    md: { text: 'text-[17px]', logo: 34 },
    lg: { text: 'text-[26px]', logo: 52 },
  };
  const s = sizes[size];
  return (
    <Link
      href={href}
      className={`brand group flex items-center gap-2.5 ${s.text} select-none transition-transform duration-300`}
      aria-label="Auto Edit"
    >
      <span
        className="transition-transform duration-500 group-hover:scale-[1.08] group-hover:-rotate-[6deg]"
        style={{ filter: 'drop-shadow(0 0 14px rgba(192,132,252,0.5))' }}
      >
        <DarkoLogo size={s.logo} />
      </span>
      <SmokeText text="Auto Edit" className="leading-none" />
    </Link>
  );
}
