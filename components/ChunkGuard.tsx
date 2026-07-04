'use client';

import { useEffect } from 'react';
import { isChunkLoadError, reloadOnceForChunk } from '@/lib/chunk-guard';

/**
 * Handler GLOBAL de ChunkLoadError (fix 2026-07-04). Cobre os erros de chunk
 * NÃO-capturados (navegação, import dinâmico em tempo de render) — quando um
 * deploy novo invalida os chunks da página aberta. Detecta e recarrega uma vez
 * (guarded). Os catches das tasks tratam os casos capturados por conta própria.
 * Renderiza null — só instala os listeners. Ver lib/chunk-guard.ts.
 */
export function ChunkGuard() {
  useEffect(() => {
    const onError = (ev: ErrorEvent) => {
      if (isChunkLoadError(ev.error) || isChunkLoadError(ev.message)) reloadOnceForChunk();
    };
    const onRejection = (ev: PromiseRejectionEvent) => {
      if (isChunkLoadError(ev.reason)) reloadOnceForChunk();
    };
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);
  return null;
}
