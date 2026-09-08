'use client';
import { useEffect, useState } from 'react';
import { RECORDS_EVENT, durabilityStatus, initializeDurableRecords, syncDurableRecords, refreshDurableRecords, importLegacyRecords, exportRecovery } from '@/lib/durable-records';

export function DurableRecordsProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState(durabilityStatus);
  useEffect(() => {
    const refresh = () => setState(durabilityStatus());
    window.addEventListener(RECORDS_EVENT, refresh);
    void initializeDurableRecords();
    const retry = () => { void (durabilityStatus().ready ? syncDurableRecords() : initializeDurableRecords()); };
    window.addEventListener('online', retry);
    const timer = setInterval(retry, 15000);
    const pullTimer = setInterval(() => { void refreshDurableRecords(); }, 30000);
    const leaving = (event: BeforeUnloadEvent) => {
      const s = durabilityStatus();
      if (s.pending || s.conflicts) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', leaving);
    return () => {
      clearInterval(timer); clearInterval(pullTimer); window.removeEventListener(RECORDS_EVENT, refresh);
      window.removeEventListener('online', retry); window.removeEventListener('beforeunload', leaving);
    };
  }, []);
  return <>
    <div role={state.error ? 'alert' : 'status'} className={`mx-5 mb-4 rounded-xl border p-3 text-sm ${state.error ? 'border-amber-400/50 text-amber-200' : 'border-line text-text-muted'}`}>
      <p>{state.message}</p>
      <div className="mt-2 flex flex-wrap gap-4">
        {(state.error || !state.ready) && <button type="button" onClick={() => void (state.ready ? syncDurableRecords() : initializeDurableRecords())}>Tentar novamente</button>}
        {state.ready && <button type="button" onClick={exportRecovery}>Exportar cópia dos registros</button>}
        {state.legacy > 0 && <button type="button" onClick={() => {
          if (confirm(`Importar ${state.legacy} registros deste navegador para a conta atual? Confirme somente se estes registros são seus.`)) void importLegacyRecords().then(() => {
            alert('Registros importados. Eles aparecem na página de background. Para recuperar os cards no Pilot, recarregue quando não houver processamento nesta aba.');
          }).catch(() => {});
        }}>Importar registros antigos ({state.legacy})</button>}
      </div>
      <p className="mt-1 text-xs">O salvamento protege os registros. A disponibilidade dos vídeos é conferida separadamente.</p>
    </div>
    {state.ready ? children : <p className="mx-5 text-sm text-text-muted">Aguardando recuperar a lista antes de permitir novas alterações.</p>}
  </>;
}
