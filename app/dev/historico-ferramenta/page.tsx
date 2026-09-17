'use client';

/**
 * PREVIEW DEV-ONLY do HISTÓRICO POR FERRAMENTA (17.09).
 *
 * Monta o botão e a gaveta reais com registros sintéticos, sem login e sem
 * depender do cofre do navegador — é como o visual é conferido antes de subir.
 * Fora do dev responde 404, como as outras páginas de /dev.
 */

import { notFound } from 'next/navigation';
import { useEffect, useState } from 'react';

import { ToolHistoryPanel } from '@/components/history/ToolHistoryPanel';
import type { HistoryEvent } from '@/lib/history';

const AGORA = Date.now();
const H = 3600_000;

const EXEMPLOS: HistoryEvent[] = [
  {
    id: 'e1',
    t: AGORA - 20 * 60_000,
    tool: 'compressor',
    title: 'AD07-MEMORIA.mp4 comprimido',
    kind: 'done',
    meta: '68% menor · 1080p',
    ref: [{ via: 'vault', key: 'hv:1', name: 'AD07-MEMORIA_comprimido.mp4', size: 18_400_000 }],
  },
  {
    id: 'e2',
    t: AGORA - 3 * H,
    tool: 'compressor',
    title: 'lote de 4 arquivos comprimido',
    kind: 'export',
    meta: '4 arquivos · 212 MB → 61 MB',
    ref: [{ via: 'vault', key: 'hv:2', name: 'compressor_lote.zip', size: 61_000_000 }],
  },
  {
    id: 'e3',
    t: AGORA - 27 * H,
    tool: 'compressor',
    title: 'VSL-KALEBE-bruto.mov comprimido',
    kind: 'done',
    meta: '41% menor · 4K → 1080p',
    ref: [{ via: 'vault', key: 'hv:expirada', name: 'VSL-KALEBE_comprimido.mp4' }],
  },
  {
    id: 'e4',
    t: AGORA - 30 * H,
    tool: 'compressor',
    title: 'depoimento-paciente.mp4 comprimido',
    kind: 'done',
    meta: '0:48 · 12 MB',
  },
];

/**
 * Semeia bytes de mentira NO COFRE (mesmo schema de lib/history-vault) pras
 * chaves hv:1 e hv:2. A hv:expirada fica de fora de proposito: o preview
 * mostra na mesma tela o botao vivo e o botao que diz honestamente "expirou".
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
          { key: 'hv:1', name: 'AD07-MEMORIA_comprimido.mp4', mime: 'video/mp4', size: 18_400_000 },
          { key: 'hv:2', name: 'compressor_lote.zip', mime: 'application/zip', size: 61_000_000 },
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
            4
          </span>
        </button>
        <span className="hist-fab__label" aria-hidden>
          Histórico
        </span>
      </div>

      {aberto && pronto ? (
        <ToolHistoryPanel
          tool="compressor"
          eventosDeTeste={EXEMPLOS}
          onClose={() => setAberto(false)}
        />
      ) : null}
    </div>
  );
}
