'use client';

/**
 * PREVIEW DEV-ONLY do HISTÓRICO POR FERRAMENTA (17.09).
 *
 * Monta a gaveta real com registros sintéticos, sem login — é como o desenho é
 * conferido antes de subir. `?tool=` troca a ferramenta do preview (padrão:
 * clickup-pilot, que é onde aparecem as 4 ações).
 * Fora do dev responde 404, como as outras páginas de /dev.
 */

import { notFound, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';

import { ToolHistoryPanel } from '@/components/history/ToolHistoryPanel';
import type { HistoryEvent } from '@/lib/history';

const AGORA = Date.now();
const H = 3600_000;

/** Disparos do Pilot: entrega com montado + takes + resgate, e disparos crus. */
const PILOT: HistoryEvent[] = [
  {
    id: 'p1',
    t: AGORA - 40 * 60_000,
    tool: 'clickup-pilot',
    title: 'AD02 entregue',
    kind: 'done',
    meta: '10 takes · 193.2MB',
    ref: [
      { via: 'zip', key: 'zs:montado', name: 'AD02G1GL - FLPB09.mp4', label: 'Montado', taskId: '86aj6nfue' },
      { via: 'zip', key: 'zs:takes', name: 'AD02_takes.zip', label: 'Takes', taskId: '86aj6nfue' },
      { via: 'heygen', parts: [{ label: 'take 1', videoId: 'v1' }], name: 'AD02_heygen.zip', label: 'Resgatar takes do HeyGen', taskId: '86aj6nfue' },
    ],
  },
  {
    id: 'p2',
    t: AGORA - 70 * 60_000,
    tool: 'clickup-pilot',
    title: 'AD01 entregue',
    kind: 'done',
    meta: '10 takes · 233.1MB',
    ref: [
      { via: 'vault', key: 'hv:1', name: 'AD01G1GL - FLPB09.mp4', label: 'Montado', taskId: '86aj6nfuf' },
    ],
  },
  {
    id: 'p3',
    t: AGORA - 3 * H,
    tool: 'clickup-pilot',
    title: 'AD03 entregue',
    kind: 'done',
    meta: '16 takes · 302.4MB',
    ref: [
      { via: 'zip', key: 'zs:sumiu', name: 'AD03G1GL - FLPB09.mp4', label: 'Montado', taskId: '86aj6nfug' },
    ],
  },
  { id: 'dispatch:86aj6nfue:1', t: AGORA - 4 * H, tool: 'clickup-pilot', title: 'AD01 - CREATOR', kind: 'dispatch' },
  { id: 'dispatch:86aj6nfuh:2', t: AGORA - 26 * H, tool: 'clickup-pilot', title: 'AD03 - CREATOR', kind: 'dispatch' },
  {
    id: 'p4',
    t: AGORA - 27 * H,
    tool: 'clickup-pilot',
    title: 'AD07 entregue (camuflado)',
    kind: 'export',
    meta: '8 takes · 96.1MB',
    ref: [{ via: 'vault', key: 'hv:2', name: 'AD07_camuflado.zip', label: 'Camuflado', taskId: '86aj6nfui' }],
  },
];

/** Ferramenta comum: só baixar e remover. */
const COMPRESSOR: HistoryEvent[] = [
  {
    id: 'c1',
    t: AGORA - 20 * 60_000,
    tool: 'compressor',
    title: 'AD07-MEMORIA.mp4 comprimido',
    kind: 'done',
    meta: '68% menor · 1080p',
    ref: [{ via: 'vault', key: 'hv:1', name: 'AD07-MEMORIA_comprimido.mp4', size: 18_400_000 }],
  },
  {
    id: 'c2',
    t: AGORA - 3 * H,
    tool: 'compressor',
    title: 'lote de 4 arquivos comprimido',
    kind: 'export',
    meta: '212 MB → 61 MB',
    ref: [{ via: 'vault', key: 'hv:2', name: 'compressor_lote.zip', size: 61_000_000 }],
  },
  {
    id: 'c3',
    t: AGORA - 27 * H,
    tool: 'compressor',
    title: 'VSL-KALEBE-bruto.mov comprimido',
    kind: 'done',
    meta: '41% menor · 4K → 1080p',
    ref: [{ via: 'vault', key: 'hv:expirada', name: 'VSL-KALEBE_comprimido.mp4' }],
  },
  { id: 'c4', t: AGORA - 30 * H, tool: 'compressor', title: 'depoimento-paciente.mp4 comprimido', kind: 'done', meta: '0:48 · 12 MB' },
];

/**
 * Semeia bytes de mentira NO COFRE (mesmo schema de lib/history-vault) pras
 * chaves hv:1 e hv:2. A hv:expirada e a zs:sumiu ficam de fora de proposito: o
 * preview mostra na mesma tela o botao vivo e o que diz honestamente "expirou".
 */
function semearCofre(): Promise<void> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open('autoedit-history-vault', 2);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('files')) db.createObjectStore('files', { keyPath: 'key' });
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
      };
      req.onerror = () => resolve();
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction(['files', 'meta'], 'readwrite');
        const recs = [
          { key: 'hv:1', name: 'AD01G1GL - FLPB09.mp4', mime: 'video/mp4', size: 233_100_000 },
          { key: 'hv:2', name: 'AD07_camuflado.zip', mime: 'application/zip', size: 96_100_000 },
        ];
        for (const r of recs) {
          const blob = new Blob([`preview ${r.key} `.repeat(20)], { type: r.mime });
          tx.objectStore('files').put({ ...r, blob, createdAt: Date.now() });
          tx.objectStore('meta').put({ ...r, createdAt: Date.now() });
        }
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => {
          db.close();
          resolve();
        };
      };
    } catch {
      resolve();
    }
  });
}

export default function DevHistoricoFerramenta() {
  if (process.env.NODE_ENV === 'production') notFound();
  return (
    <Suspense fallback={null}>
      <Preview />
    </Suspense>
  );
}

function Preview() {
  const params = useSearchParams();
  const tool = params?.get('tool') || 'clickup-pilot';
  const [aberto, setAberto] = useState(false);
  const [pronto, setPronto] = useState(false);

  useEffect(() => {
    void semearCofre().then(() => {
      setPronto(true);
      setAberto(true);
    });
  }, []);

  return (
    <div className="min-h-screen bg-bg p-10">
      <h1 className="mb-4 text-[22px] font-bold text-text" style={{ fontFamily: 'var(--font-tech)' }}>
        Preview — histórico por ferramenta
      </h1>
      <button type="button" className="btn-secondary" onClick={() => setAberto(true)}>
        Abrir a gaveta
      </button>

      {/* O botão real, como aparece em cima de qualquer ferramenta */}
      <div className="hist-fab fixed right-7 top-[92px] z-[53] flex flex-col items-center gap-1.5">
        <button type="button" className="hist-fab__btn" onClick={() => setAberto(true)}>
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path d="M3 12a9 9 0 1 0 3-6.7" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M3 4v4h4" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M12 8v4l3 2" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="hist-fab__dot" aria-hidden>
            {tool === 'compressor' ? COMPRESSOR.length : PILOT.length}
          </span>
        </button>
        <span className="hist-fab__label" aria-hidden>
          Histórico
        </span>
      </div>

      {aberto && pronto ? (
        <ToolHistoryPanel
          tool={tool}
          eventosDeTeste={tool === 'compressor' ? COMPRESSOR : PILOT}
          onClose={() => setAberto(false)}
        />
      ) : null}
    </div>
  );
}
