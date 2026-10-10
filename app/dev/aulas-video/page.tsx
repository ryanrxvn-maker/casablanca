'use client';

/**
 * PREVIEW DEV-ONLY das AULAS EM VÍDEO (10.10).
 *
 * Abre o "Como usar" real (GuidePanel) com a aula no topo, sem login.
 * `?path=` troca a ferramenta (padrão: /tools/decupagem). Deslogado o tier é
 * free, então ferramenta paga (ex.: /tools/tipografia) NÃO mostra a aula —
 * é o próprio teste do bloqueio. `?path=/configuracoes/api` mostra a aula da
 * página de Chaves de IA, que não depende de plano.
 * Fora do dev responde 404, como as outras páginas de /dev.
 */

import { notFound, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';

import { AulaVideo } from '@/components/AulaVideo';
import { GuidePanel } from '@/components/tool-guides/GuidePanel';

export default function DevAulasVideo() {
  if (process.env.NODE_ENV === 'production') notFound();
  return (
    <Suspense fallback={null}>
      <Preview />
    </Suspense>
  );
}

function Preview() {
  const params = useSearchParams();
  const path = params?.get('path') || '/tools/decupagem';
  const [aberto, setAberto] = useState(false);
  // abre depois de montar: o GuidePanel é um portal no document.body (não existe no SSR)
  useEffect(() => {
    if (path.startsWith('/tools/')) setAberto(true);
  }, [path]);

  return (
    <div className="min-h-screen bg-bg p-10">
      <h1 className="mb-4 text-[22px] font-bold text-text" style={{ fontFamily: 'var(--font-tech)' }}>
        Preview — aula em vídeo ({path})
      </h1>
      {path.startsWith('/tools/') ? (
        <button type="button" className="btn-secondary" onClick={() => setAberto(true)}>
          Abrir o Como usar
        </button>
      ) : (
        <AulaVideo path={path} className="mb-6 max-w-[640px]" />
      )}
      {aberto && <GuidePanel path={path} onClose={() => setAberto(false)} />}
    </div>
  );
}
