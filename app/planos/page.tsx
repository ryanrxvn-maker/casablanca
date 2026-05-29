import { Suspense } from 'react';
import type { Metadata } from 'next';
import { Plans } from '@/components/Plans';

export const metadata: Metadata = {
  title: 'Planos e preços',
  description:
    'Comece grátis. Planos Basic (R$ 57/mês) e Pro (R$ 116/mês) com decupagem, B-roll, lipsync e legendas no automático. Mensal recorrente ou anual parcelável.',
  alternates: { canonical: '/planos' },
  openGraph: {
    title: 'Planos e preços · Auto Edit',
    description:
      'Comece grátis. Basic e Pro com automação de edição de vídeo. Mensal ou anual parcelável.',
    url: 'https://www.darkoautoedit.com/planos',
  },
};

/**
 * /planos — vitrine pública de planos (Free / Basic / Pro).
 * Acessível sem login, com link no header da landing e no hub.
 */
export default function PlanosPage() {
  return (
    <Suspense fallback={null}>
      <Plans />
    </Suspense>
  );
}
