'use client';

import { usePathname } from 'next/navigation';
import { FloatingOrbs } from '@/components/FloatingOrbs';
import { MouseGlow } from '@/components/MouseGlow';
import { RippleRoot } from '@/components/RippleRoot';

/** Preserve the original ambient motion on the public brand pages. */
export function BrandMotion() {
  const pathname = usePathname();
  const publicPage = pathname === '/' || /^\/(planos|login|register|forgot-password|recursos|termos|politica)(\/|$)/.test(pathname);
  if (!publicPage) return <RippleRoot />;
  return <div className="ae-brand-motion" aria-hidden="true"><FloatingOrbs /><MouseGlow /><RippleRoot /></div>;
}
