'use client';

/**
 * PREVIEW DEV-ONLY do editor de Legendas Automáticas (02.09).
 *
 * Monta o MESMO componente da ferramenta real sem o portão de login — é como
 * o Claude confere o editor de verdade (layout, timeline, cliques) sem senha.
 * O botão "carregar vídeo de teste" injeta o public/dev-tiny.mp4 (ignorado
 * pelo git) com uma sessão sintética de palavras/blocos/headline, então o
 * passo 3 abre inteiro sem gastar transcrição.
 *
 * Fora do dev responde 404, como as outras páginas de /dev.
 */

import { notFound } from 'next/navigation';
import TipografiaPage from '@/app/tools/tipografia/page';
import { ToolsStateProvider } from '@/components/ToolsStateProvider';

export default function DevLegendas() {
  if (process.env.NODE_ENV === 'production') notFound();
  return (
    <ToolsStateProvider>
      <TipografiaPage />
    </ToolsStateProvider>
  );
}
