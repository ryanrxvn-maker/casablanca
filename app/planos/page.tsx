import { Suspense } from 'react';
import type { Metadata } from 'next';
import { Plans } from '@/components/Plans';

export const metadata: Metadata = {
  title: 'Planos e preços',
  description:
    'Comece grátis. Plano Premium (R$ 57/mês) com todas as ferramentas: lipsync, decupagem, legendas e processamento em lote. Mensal recorrente ou anual parcelável.',
  alternates: { canonical: '/planos' },
  openGraph: {
    title: 'Planos e preços · Auto Edit',
    description:
      'Comece grátis. Premium com automação de edição de vídeo. Mensal ou anual parcelável.',
    url: 'https://www.darkoautoedit.com/planos',
  },
};

/**
 * /planos — vitrine pública de planos (Free / Premium).
 * Acessível sem login, com link no header da landing e no hub.
 */
export default function PlanosPage() {
  return (
    <Suspense fallback={null}>
      <Plans />
    </Suspense>
  );
}
