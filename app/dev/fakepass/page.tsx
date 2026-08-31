'use client';

/**
 * PREVIEW DEV-ONLY do FAKEPASS (31.08) — monta a PÁGINA REAL da ferramenta
 * (mesmos modelos, mesmo motor de export) sem passar pelo login, pra conferir
 * formatos dos sites, export de vídeo e alinhamento. Fora do dev responde 404
 * (e o middleware nem deixa chegar).
 */

import { notFound } from 'next/navigation';
import { ToolsStateProvider } from '@/components/ToolsStateProvider';
import FakePassPage from '../../tools/fakepass/page';

export default function DevFakePass() {
  if (process.env.NODE_ENV !== 'development') notFound();
  return (
    <ToolsStateProvider>
      <FakePassPage />
    </ToolsStateProvider>
  );
}
