import Link from 'next/link';

/**
 * Logo textual CASABLANCA — font-weight 900, letter-spacing 0.25em, cor lime.
 */
export function Brand({
  href = '/tools',
  size = 'md',
}: {
  href?: string;
  size?: 'sm' | 'md' | 'lg';
}) {
  const sizes = {
    sm: 'text-sm',
    md: 'text-lg',
    lg: 'text-2xl',
  };
  return (
    <Link
      href={href}
      className={`brand font-display uppercase ${sizes[size]} select-none`}
    >
      CASABLANCA
    </Link>
  );
}
