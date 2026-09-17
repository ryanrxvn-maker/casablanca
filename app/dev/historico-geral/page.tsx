'use client';

/**
 * PREVIEW DEV-ONLY da página /tools/historico (17.09).
 *
 * Monta a página REAL do histórico geral sem o portão de login — serve pra
 * conferir que a refatoração (lista e botão Baixar vieram pro componente
 * compartilhado HistoryTimeline) continua montando de pé.
 * Fora do dev responde 404, como as outras páginas de /dev.
 */

import { notFound } from 'next/navigation';

import HistoricoPage from '@/app/tools/historico/page';
import { ToolsStateProvider } from '@/components/ToolsStateProvider';

export default function DevHistoricoGeral() {
  if (process.env.NODE_ENV === 'production') notFound();
  return (
    <ToolsStateProvider>
      <HistoricoPage />
    </ToolsStateProvider>
  );
}
