import Link from 'next/link';
import { DarkoLogo } from './DarkoLogo';
import { SmokeText } from './SmokeText';

/**
 * Brand Auto Edit.
 *
 * Logo do coelho neon frontal + wordmark "Auto Edit" com efeito SmokeText
 * (ao passar o mouse, texto se dissolve em fumaça).
 */
export function Brand({
  href = '/tools',
  size = 'md',
}: {
  href?: string;
  size?: 'sm' | 'md' | 'lg';
}) {
  const sizes = {
    sm: { logo: 26, fontSize: '13px' },
    md: { logo: 34, fontSize: '17px' },
    lg: { logo: 52, fontSize: '26px' },
  };
  const s = sizes[size];
  return (
    <Link
      href={href}
      className="brand group flex items-center gap-2.5 select-none transition-transform duration-300"
      aria-label="Auto Edit"
      style={{ fontSize: s.fontSize }}
    >
      <span
        className="transition-transform duration-500 group-hover:scale-[1.08] group-hover:-rotate-[6deg]"
        style={{ filter: 'drop-shadow(0 0 14px rgba(192,132,252,0.5))' }}
      >
        <DarkoLogo size={s.logo} />
      </span>
      <span
        className="leading-none"
        style={{
          fontFamily: 'var(--font-tech)',
          fontWeight: 800,
          letterSpacing: '-0.02em',
        }}
      >
        <span style={{ color: '#fff' }}>
          <SmokeText text="Auto Edit" />
        </span>
      </span>
    </Link>
  );
}
