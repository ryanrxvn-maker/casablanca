import { Suspense } from 'react';
import type { Metadata } from 'next';
import { Plans } from '@/components/Plans';

export const metadata: Metadata = {
  title: 'Planos e preços',
  description:
    'Free com Remover Silêncios em áudio, Compressor, Downloader e FakePrint social. Premium com vídeo, legendas, lipsync e as demais ferramentas.',
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
