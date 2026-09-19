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
import type { FilaAoVivo } from '@/components/history/HistoryTimeline';
import { statusDoDisparo } from '@/lib/history-fila';
import type { HistoryEvent } from '@/lib/history';

const AGORA = Date.now();
const H = 3600_000;

/** Disparos do Pilot: entrega com montado + takes + resgate, e disparos crus. */
const PILOT: HistoryEvent[] = [
  { id: 'dispatch:viva-1:1', t: AGORA - 32_000, tool: 'clickup-pilot', title: 'AD122VN - PRPB07', kind: 'dispatch', channels: [{ label: 'YOUTUBE', color: '#e50914' }] },
  { id: 'dispatch:viva-2:2', t: AGORA - 43_000, tool: 'clickup-pilot', title: 'AD123VN - PRPB07', kind: 'dispatch', channels: [{ label: 'META', color: '#1877f2' }] },
  { id: 'dispatch:viva-3:3', t: AGORA - 48_000, tool: 'clickup-pilot', title: 'AD121VN - PRPB07', kind: 'dispatch', channels: [{ label: 'KWAI', color: '#ffbe0b' }, { label: 'TIKTOK', color: '#111111' }] },
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
  // TRES VERSOES do mesmo AD: a linha colapsa e ganha o seletor.
  {
    id: 'v1', t: AGORA - 5 * H, tool: 'clickup-pilot', title: 'AD05 entregue', kind: 'done', meta: '8 takes · 120.4MB',
    ref: [{ via: 'vault', key: 'hv:1', name: 'AD05G1GL.mp4', label: 'Montado', taskId: '86ad5' }],
  },
  {
    id: 'v2', t: AGORA - 5 * H + 60_000, tool: 'clickup-pilot', title: 'AD05 entregue', kind: 'done', meta: '8 takes · 118.9MB',
    ref: [{ via: 'vault', key: 'hv:2', name: 'AD05G1GL-v2.mp4', label: 'Montado', taskId: '86ad5-v2' }],
  },
  {
    id: 'v3', t: AGORA - 5 * H + 120_000, tool: 'clickup-pilot', title: 'AD05 entregue', kind: 'done', meta: '8 takes · 121.7MB',
    ref: [{ via: 'zip', key: 'zs:sumiu', name: 'AD05G1GL-v3.mp4', label: 'Montado', taskId: '86ad5-v3' }],
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

/** Fila sintética: o preview precisa mostrar o disparo ANDANDO. */
const parte = (id: string | null, pronto: boolean) => ({ videoId: id, videoStatus: pronto ? 'completed' : null });
const FILA: FilaAoVivo = {
  agora: AGORA,
  url: { '86aj6nfue': 'https://app.clickup.com/t/exemplo' },
  canais: {
    'viva-1': [{ label: 'YOUTUBE', color: '#ff2d55' }],
    'viva-2': [{ label: 'META', color: '#1877f2' }],
    'viva-3': [{ label: 'KWAI', color: '#ff7a00' }, { label: 'TIKTOK', color: '#111111' }],
  },
  inicio: { 'viva-1': AGORA - 32_000, 'viva-2': AGORA - 43_000, 'viva-3': AGORA - 48_000 },
  status: {
    'viva-1': statusDoDisparo({
      phase: 'rendering',
      parts: [...Array(10)].map((_, i) => parte(`v${i}`, i < 4)),
    }),
    'viva-2': statusDoDisparo({
      phase: 'post',
      parts: [...Array(10)].map((_, i) => parte(`v${i}`, true)),
    }),
    'viva-3': statusDoDisparo({ phase: 'queued', parts: [...Array(10)].map(() => parte(null, false)) }),
    '86aj6nfue': statusDoDisparo({ phase: 'done', parts: [...Array(10)].map((_, i) => parte(`v${i}`, true)) }),
  },
};

/**
 * Semeia TAKES de mentira no zip-store (`pilot:<taskId>:g:dev:part:<label>`)
 * usando o dev-tiny.mp4, pra a janela de previews abrir com card de verdade.
 */
async function semearTakes(taskId: string, quantos: number): Promise<void> {
  try {
    const buf = (await fetch('/dev-tiny.mp4').then((r) => r.arrayBuffer())) as ArrayBuffer;
    const bytes = new Uint8Array(buf);
    await new Promise<void>((resolve) => {
      const req = indexedDB.open('darkolab-zip-store');
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('zips')) db.createObjectStore('zips', { keyPath: 'key' });
      };
      req.onerror = () => resolve();
      req.onsuccess = () => {
        const db = req.result;
        try {
          const tx = db.transaction('zips', 'readwrite');
          const store = tx.objectStore('zips');
          for (let i = 1; i <= quantos; i++) {
            const label = i === 1 ? 'hook' : `parte ${i}`;
            store.put({
              key: `pilot:${taskId}:g:dev:part:${label}`,
              filename: `${label}.mp4`,
              bytes,
              size: bytes.length,
              createdAt: Date.now(),
            });
          }
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => {
            db.close();
            resolve();
          };
        } catch {
          db.close();
          resolve();
        }
      };
    });
  } catch {
    /* preview sem takes ainda abre, so' mostra o estado vazio */
  }
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
    void Promise.all([semearCofre(), semearTakes('viva-1', 4), semearTakes('86aj6nfue', 6)]).then(
      () => {
        setPronto(true);
        setAberto(true);
      },
    );
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
          filaDeTeste={tool === 'compressor' ? undefined : FILA}
          onClose={() => setAberto(false)}
        />
      ) : null}
    </div>
  );
}
