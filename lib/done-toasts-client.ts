'use client';

/**
 * Loja das notificações de "concluído" no navegador (a regra pura está em
 * lib/done-toasts.ts).
 *
 * De onde vem: logHistory() dispara `autoedit:done` com o evento NOVO.
 * Onde aparece: na aba que você está OLHANDO, uma vez só.
 *   • terminou na aba visível → mostra ali e avisa as outras ("já mostrei");
 *   • terminou numa aba oculta → pergunta às outras; uma aba visível mostra e
 *     confirma. Se nenhuma estava visível, aparece quando você voltar pra aba
 *     onde terminou — e o título dela ganha um "✓ " enquanto isso.
 * Sem localStorage: é aviso do momento; o registro de verdade é o histórico.
 */

import { useSyncExternalStore } from 'react';
import { isDoneToast, pushToast, toastFromEvent, type DoneToast } from './done-toasts';

const EMPTY: DoneToast[] = [];
const TITLE_MARK = '✓ ';

let toasts: DoneToast[] = EMPTY;
const listeners = new Set<() => void>();
/** ids já mostrados aqui ou em outra aba (nunca mostra duas vezes) */
const seen = new Set<string>();
/** terminou com esta aba oculta: espera alguma aba visível mostrar */
const pending = new Map<string, DoneToast>();
let chan: BroadcastChannel | null = null;
let starts = 0;

function emit() {
  for (const l of listeners) l();
}

function visible() {
  return typeof document !== 'undefined' && document.visibilityState === 'visible';
}

function markTitle() {
  if (typeof document === 'undefined' || document.title.startsWith(TITLE_MARK)) return;
  document.title = TITLE_MARK + document.title;
}

function unmarkTitle() {
  if (typeof document === 'undefined' || pending.size) return;
  if (document.title.startsWith(TITLE_MARK)) document.title = document.title.slice(TITLE_MARK.length);
}

function show(t: DoneToast) {
  if (seen.has(t.id)) return;
  seen.add(t.id);
  pending.delete(t.id);
  toasts = pushToast(toasts, t);
  emit();
  try {
    chan?.postMessage({ type: 'shown', id: t.id });
  } catch {
    /* canal fechado: só esta aba */
  }
  unmarkTitle();
}

export function dismissDone(id: string) {
  const next = toasts.filter((t) => t.id !== id);
  if (next.length === toasts.length) return;
  toasts = next.length ? next : EMPTY;
  emit();
}

function onLocal(e: Event) {
  const t = toastFromEvent((e as CustomEvent).detail);
  if (!t || seen.has(t.id)) return;
  if (visible()) {
    show(t);
    return;
  }
  pending.set(t.id, t);
  markTitle();
  try {
    chan?.postMessage({ type: 'event', toast: t });
  } catch {
    /* sem canal: aparece quando voltar pra esta aba */
  }
}

function onMessage(m: MessageEvent) {
  const d = m.data as { type?: unknown; id?: unknown; toast?: unknown } | null;
  if (!d || typeof d !== 'object') return;
  if (d.type === 'shown' && typeof d.id === 'string') {
    seen.add(d.id);
    pending.delete(d.id);
    unmarkTitle();
  } else if (d.type === 'event' && isDoneToast(d.toast) && visible()) {
    show(d.toast);
  }
}

function onVisibility() {
  if (!visible()) return;
  for (const t of Array.from(pending.values())) show(t);
  unmarkTitle();
}

/** Liga a escuta (o host chama ao montar). Pode ser chamada mais de uma vez. */
export function startDoneToasts(): () => void {
  if (typeof window === 'undefined') return () => {};
  if (starts++ === 0) {
    window.addEventListener('autoedit:done', onLocal);
    document.addEventListener('visibilitychange', onVisibility);
    try {
      chan = new BroadcastChannel('autoedit:done');
      chan.onmessage = onMessage;
    } catch {
      chan = null;
    }
  }
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    if (--starts > 0) return;
    window.removeEventListener('autoedit:done', onLocal);
    document.removeEventListener('visibilitychange', onVisibility);
    try {
      chan?.close();
    } catch {
      /* já fechado */
    }
    chan = null;
  };
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useDoneToasts(): DoneToast[] {
  return useSyncExternalStore(
    subscribe,
    () => toasts,
    () => EMPTY,
  );
}
