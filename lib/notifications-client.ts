'use client';

/**
 * Sino de notificações no navegador: UMA fonte pra todo mundo (botão do
 * topo, janela na tela e página /tools/notificacoes).
 *
 *  • Sincroniza com /api/user/notifications ao abrir o app (é o "login":
 *    janela de aviso no ar abre aqui), a cada 30 s com a aba VISÍVEL e ao
 *    voltar pra aba. Aba escondida não consulta nada.
 *  • Ações são otimistas (o sino e a lista mudam na hora) e avisam as
 *    outras abas por BroadcastChannel: fechou a janela numa aba, some nas
 *    outras em seguida.
 *  • Janela fechada some na hora e NÃO volta numa resposta atrasada do
 *    servidor (lista local por aviso+ativação, zerada em login novo).
 */

import { useSyncExternalStore } from 'react';
import type { NotifAction, NotifItem, NotifPayload } from './announcements';

export type NotifStatus = 'idle' | 'ready' | 'off' | 'error';

export type NotifState = {
  status: NotifStatus;
  userId: string | null;
  sk: string;
  items: NotifItem[];
  unread: number;
  /** janelas a abrir agora (já sem as fechadas nesta página) */
  popups: NotifItem[];
  /** central de avisos do admin aberta: janelas esperam ela fechar */
  suppressed: boolean;
  lastSync: number;
};

const EMPTY: NotifState = {
  status: 'idle',
  userId: null,
  sk: '',
  items: [],
  unread: 0,
  popups: [],
  suppressed: false,
  lastSync: 0,
};

export const POLL_MS = 30_000;
const MIN_GAP_MS = 8_000;
const CHANNEL = 'ae-notifications';

let state: NotifState = EMPTY;
let serverPopups: NotifItem[] = [];
const closedHere = new Set<string>();
let suppressCount = 0;
const listeners = new Set<() => void>();

const keyOf = (p: Pick<NotifItem, 'id' | 'activatedAt'>) => `${p.id}@${p.activatedAt ?? ''}`;
const countUnread = (items: NotifItem[]) => items.reduce((n, i) => n + (i.readAt ? 0 : 1), 0);

function emit() {
  for (const l of Array.from(listeners)) l();
}

function commit(patch: Partial<NotifState>) {
  state = { ...state, ...patch };
  state.popups = serverPopups.filter((p) => !closedHere.has(keyOf(p)));
  emit();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
const getSnapshot = () => state;
const getServerSnapshot = () => EMPTY;

export function useNotifications(): NotifState {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function getNotificationsState(): NotifState {
  return state;
}

/** Saiu da conta (ou trocou de conta): nada do anterior fica na tela. */
export function resetNotifications() {
  serverPopups = [];
  closedHere.clear();
  const suppressed = state.suppressed;
  state = { ...EMPTY, suppressed };
  emit();
}

/* ───────────────────────── Sincronização ───────────────────────── */

let inflight: Promise<void> | null = null;
let again = false;

export function refreshNotifications(opts: { force?: boolean } = {}): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  if (inflight) {
    // pedido forçado no meio de outro: roda mais uma vez quando acabar
    if (opts.force) again = true;
    return inflight;
  }
  if (!opts.force && Date.now() - state.lastSync < MIN_GAP_MS) return Promise.resolve();
  inflight = (async () => {
    try {
      const res = await fetch('/api/user/notifications', { cache: 'no-store', credentials: 'same-origin' });
      if (res.status === 401) {
        resetNotifications();
        return;
      }
      if (!res.ok) {
        commit({ status: state.status === 'ready' ? 'ready' : 'error', lastSync: Date.now() });
        return;
      }
      const p = (await res.json()) as NotifPayload;
      if (p.userId !== state.userId || p.sk !== state.sk) closedHere.clear(); // outra conta ou login novo
      serverPopups = Array.isArray(p.popups) ? p.popups : [];
      // o servidor já sabe dos fechamentos: esquece os que não voltaram
      const alive = new Set(serverPopups.map(keyOf));
      for (const k of Array.from(closedHere)) if (!alive.has(k)) closedHere.delete(k);
      const items = Array.isArray(p.items) ? p.items : [];
      commit({
        status: p.enabled ? 'ready' : 'off',
        userId: p.userId,
        sk: p.sk,
        items,
        unread: typeof p.unread === 'number' ? p.unread : countUnread(items),
        lastSync: Date.now(),
      });
    } catch {
      commit({ status: state.status === 'ready' ? 'ready' : 'error', lastSync: Date.now() });
    } finally {
      inflight = null;
      if (again) {
        again = false;
        void refreshNotifications({ force: true });
      }
    }
  })();
  return inflight;
}

/* ───────────────────────── Entre abas ───────────────────────── */

let channel: BroadcastChannel | null = null;
function tellOtherTabs() {
  try {
    channel?.postMessage({ t: Date.now() });
  } catch {
    /* canal fechado */
  }
}

/* ───────────────────────── Ciclo de vida ───────────────────────── */

let users = 0;
let timer: ReturnType<typeof setInterval> | null = null;

function onVisible() {
  if (document.visibilityState === 'visible') void refreshNotifications();
}

/** Liga a sincronização (contador: vários montadores, um ciclo só). */
export function startNotifications(): () => void {
  if (typeof window === 'undefined') return () => {};
  users += 1;
  if (users === 1) {
    timer = setInterval(() => {
      if (document.visibilityState === 'visible') void refreshNotifications({ force: true });
    }, POLL_MS);
    document.addEventListener('visibilitychange', onVisible);
    try {
      channel = new BroadcastChannel(CHANNEL);
      channel.onmessage = () => void refreshNotifications({ force: true });
    } catch {
      channel = null;
    }
  }
  void refreshNotifications({ force: Date.now() - state.lastSync > 15_000 });
  return () => {
    users -= 1;
    if (users > 0) return;
    if (timer) clearInterval(timer);
    timer = null;
    document.removeEventListener('visibilitychange', onVisible);
    try {
      channel?.close();
    } catch {
      /* já fechado */
    }
    channel = null;
  };
}

/** Central de avisos aberta: janelas esperam (contador, nunca trava). */
export function suppressPopups(on: boolean) {
  suppressCount = Math.max(0, suppressCount + (on ? 1 : -1));
  commit({ suppressed: suppressCount > 0 });
}

/* ───────────────────────── Ações ───────────────────────── */

// Ações em FILA: "apagar" e "desfazer" logo em seguida chegam ao servidor
// nessa ordem (duas requisições soltas podem inverter e o item sumiria de novo).
let chain: Promise<unknown> = Promise.resolve();

function send(action: NotifAction, id?: string): Promise<boolean> {
  const run = chain.then(() => post(action, id));
  chain = run.catch(() => undefined);
  return run;
}

async function post(action: NotifAction, id?: string): Promise<boolean> {
  try {
    const res = await fetch('/api/user/notifications', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(id ? { action, id } : { action }),
      keepalive: action === 'dismiss' || action === 'click',
    });
    if (!res.ok) throw new Error(String(res.status));
    tellOtherTabs();
    return true;
  } catch {
    void refreshNotifications({ force: true });
    return false;
  }
}

function patchItems(fn: (items: NotifItem[]) => NotifItem[]) {
  const items = fn(state.items);
  commit({ items, unread: countUnread(items) });
}

const stamp = () => new Date().toISOString();

export function markRead(id: string) {
  const it = state.items.find((i) => i.id === id);
  if (!it || it.readAt) return Promise.resolve(true);
  patchItems((items) => items.map((i) => (i.id === id ? { ...i, readAt: stamp() } : i)));
  return send('read', id);
}

export function markUnread(id: string) {
  patchItems((items) => items.map((i) => (i.id === id ? { ...i, readAt: null } : i)));
  return send('unread', id);
}

export function markAllRead() {
  if (!state.unread) return Promise.resolve(true);
  const now = stamp();
  patchItems((items) => items.map((i) => (i.readAt ? i : { ...i, readAt: now })));
  return send('read_all');
}

export function clearRead() {
  patchItems((items) => items.filter((i) => !i.readAt));
  return send('clear_read');
}

/** Apaga do histórico e devolve o item pra "Desfazer". */
export function deleteNotification(id: string): NotifItem | null {
  const it = state.items.find((i) => i.id === id) ?? null;
  patchItems((items) => items.filter((i) => i.id !== id));
  void send('delete', id);
  return it;
}

export function restoreNotification(item: NotifItem) {
  patchItems((items) =>
    [...items.filter((i) => i.id !== item.id), { ...item, readAt: item.readAt ?? stamp() }].sort(
      (a, b) => Date.parse(b.deliveredAt) - Date.parse(a.deliveredAt),
    ),
  );
  return send('restore', item.id);
}

/** Fechou a janela (X, "Agora não", Esc, fundo): some agora, fica no histórico. */
export function dismissPopup(p: NotifItem, clicked = false) {
  closedHere.add(keyOf(p));
  const now = stamp();
  patchItems((items) => items.map((i) => (i.id === p.id && !i.readAt ? { ...i, readAt: now } : i)));
  return send(clicked ? 'click' : 'dismiss', p.id);
}
