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
    const leaving = (event: BeforeUnloadEvent) => {
      const s = durabilityStatus();
      if (s.pending || s.conflicts) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', leaving);
    return () => {
      clearInterval(timer); clearInterval(pullTimer); window.removeEventListener(RECORDS_EVENT, refresh);
      document.removeEventListener('visibilitychange', pull);
      window.removeEventListener('online', retry); window.removeEventListener('beforeunload', leaving);
    };
  }, []);
  if (state.error) {
    return <>
      <div role="alert" className="mx-5 mb-4 flex items-center justify-between gap-4 rounded-xl border border-amber-400/50 p-3 text-sm text-amber-200">
        <p>{state.message}</p>
        <button type="button" className="shrink-0" onClick={() => void (state.ready ? syncDurableRecords() : initializeDurableRecords())}>Tentar novamente</button>
      </div>
      {state.ready && children}
    </>;
  }

  return state.ready
    ? children
    : <p className="mx-5 text-sm text-text-muted">Recuperando seus registros…</p>;
}
