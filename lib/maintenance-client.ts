'use client';

/**
 * Estado de manutenção no navegador: UMA consulta pro hub e pro menu lateral
 * (/api/tools/status). Busca ao abrir, ao voltar pra aba e no máximo a cada
 * 30 s; guarda na sessão (sessionStorage) pra não piscar selo errado no F5.
 * Enquanto não chega nada, vale o estado padrão do código (o mesmo que o
 * servidor usa sem o arquivo do painel).
 */

import { useEffect, useSyncExternalStore } from 'react';
import type { MaintenanceSnapshot } from './maintenance';

const SS_KEY = 'ae:maint:v1';
const MIN_GAP_MS = 30_000;

let snap: MaintenanceSnapshot | null = null;
let lastAt = 0;
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function readSession(): MaintenanceSnapshot | null {
  try {
    const raw = sessionStorage.getItem(SS_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as MaintenanceSnapshot;
    return v && typeof v === 'object' && v.tools && typeof v.tools === 'object' ? v : null;
  } catch {
    return null;
  }
}

function set(next: MaintenanceSnapshot | null) {
  snap = next;
  try {
    if (next) sessionStorage.setItem(SS_KEY, JSON.stringify(next));
    else sessionStorage.removeItem(SS_KEY);
  } catch {
    /* sem storage: segue só em memória */
  }
  for (const l of Array.from(listeners)) l();
}

export function refreshMaintenance(force = false): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  if (inflight) return inflight;
  if (!force && Date.now() - lastAt < MIN_GAP_MS) return Promise.resolve();
  inflight = (async () => {
    try {
      const res = await fetch('/api/tools/status', { cache: 'no-store', credentials: 'same-origin' });
      if (res.status === 401) {
        set(null);
        return;
      }
      if (!res.ok) return;
      const v = (await res.json()) as MaintenanceSnapshot;
      if (v && v.tools && typeof v.tools === 'object') set(v);
    } catch {
      /* rede: mantém o último */
    } finally {
      lastAt = Date.now();
      inflight = null;
    }
  })();
  return inflight;
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

const getSnapshot = () => snap;
const getServerSnapshot = () => null;

/** Retrato atual (null = ainda não chegou; use o padrão do código). */
export function useMaintenance(): MaintenanceSnapshot | null {
  const value = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  useEffect(() => {
    if (!snap) {
      const cached = readSession();
      if (cached) set(cached);
    }
    void refreshMaintenance();
    const onVis = () => {
      if (document.visibilityState === 'visible') void refreshMaintenance();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);
  return value;
}
