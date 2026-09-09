'use client';
import { useEffect, useState } from 'react';
import { RECORDS_EVENT, durabilityStatus, initializeDurableRecords, syncDurableRecords, refreshDurableRecords } from '@/lib/durable-records';

export function DurableRecordsProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState(durabilityStatus);
  useEffect(() => {
    const refresh = () => setState(durabilityStatus());
    window.addEventListener(RECORDS_EVENT, refresh);
    void initializeDurableRecords();
    const retry = () => { void (durabilityStatus().ready ? syncDurableRecords() : initializeDurableRecords()); };
    window.addEventListener('online', retry);
    const timer = setInterval(retry, 15000);
    const pull = () => { if (document.visibilityState === 'visible') void refreshDurableRecords(); };
    const pullTimer = setInterval(pull, 120000);
    document.addEventListener('visibilitychange', pull);
    return () => {
      clearInterval(timer); clearInterval(pullTimer); window.removeEventListener(RECORDS_EVENT, refresh);
      document.removeEventListener('visibilitychange', pull);
      window.removeEventListener('online', retry);
    };
  }, []);
  // A posição dos filhos precisa ser estável. Antes, alternar entre o retorno
  // "saudável" e o retorno de erro inseria um banner antes de `children` e o
  // React remontava a ferramenta inteira. Na Decupagem isso apagava os Files
  // da fila e fazia o clique parecer um reload/no-op em loop.
  return <>
    <p className="sr-only" aria-live="polite">{state.error ? 'Sincronização dos registros será retomada automaticamente.' : ''}</p>
    {/* Persistência é proteção adicional, nunca uma barreira para a ferramenta.
        Se a rede falhar no bootstrap, o estado local continua disponível e o
        usuário não pode ficar diante de uma tela vazia ao iniciar uma fila. */}
    {(state.ready || state.error) ? children : <p className="mx-5 text-sm text-text-muted">Recuperando seus registros…</p>}
  </>;
}
