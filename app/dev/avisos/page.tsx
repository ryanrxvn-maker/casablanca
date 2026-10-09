'use client';

/**
 * /dev/avisos — bancada dos AVISOS sem login (404 fora do dev).
 *
 * Monta a casca real (TopBar com o sino + janela na tela) e, por cima, o
 * painel admin OU a página de notificações. O "servidor" é falso mas usa a
 * MESMA lógica de produção (lib/announcements.ts): audiência, entrega,
 * janela por sessão de login, reativação, ler/apagar/desfazer.
 *
 * Barra de teste no rodapé: trocar quem está vendo (admin, free, premium...)
 * e "Sair e entrar de novo" (sessão nova → janela no ar abre de novo).
 */

import { notFound } from 'next/navigation';
import { useEffect, useState } from 'react';
import AdminPage from '@/app/admin/page';
import NotificacoesPage from '@/app/tools/notificacoes/page';
import { TopBar } from '@/components/TopBar';
import { AnnouncementHost } from '@/components/notifications/AnnouncementHost';
import {
  addDismissedKey,
  cleanAudience,
  cleanContent,
  cleanEndsAt,
  isLive,
  matchesAudience,
  popupKey,
  readContent,
  shouldPopup,
  sortPopups,
  type AdminAnnouncement,
  type AnnKind,
  type NotifItem,
  type Viewer,
} from '@/lib/announcements';
import { refreshNotifications, resetNotifications } from '@/lib/notifications-client';

type Ann = {
  id: string;
  kind: AnnKind;
  content: unknown;
  audience: unknown;
  popup: boolean;
  active: boolean;
  activated_at: string | null;
  ends_at: string | null;
  created_at: string;
  updated_at: string;
};
type Inbox = { delivered_at: string; read_at: string | null; dismissed_keys: string[]; clicked_at: string | null; deleted_at: string | null; dismissed_at: string | null };

const VIEWERS: Record<string, Viewer> = {
  admin: { id: 'admin-1', email: 'silas@autoedit.com', isAdmin: true, isActive: true, plan: 'premium', access: 'granted', beta: true },
  free: { id: 'free-1', email: 'ana.free@gmail.com', isAdmin: false, isActive: true, plan: 'free', access: 'free', beta: false },
  pago: { id: 'pago-1', email: 'bruno.pago@gmail.com', isAdmin: false, isActive: true, plan: 'premium', access: 'paid', beta: false },
  liberado: { id: 'lib-1', email: 'carla.liberada@gmail.com', isAdmin: false, isActive: true, plan: 'premium', access: 'granted', beta: false },
};

const W = typeof window !== 'undefined' ? (window as unknown as Record<string, unknown>) : ({} as Record<string, unknown>);

function db() {
  if (!W.__annDb) {
    const now = Date.now();
    const iso = (ago: number) => new Date(now - ago).toISOString();
    const anns: Ann[] = [
      {
        id: '11111111-1111-4111-8111-111111111111',
        kind: 'propaganda',
        content: {
          theme: 'violeta',
          badge: 'Oferta por tempo limitado',
          title: 'Premium com 40% off nesta semana',
          body: 'Todas as ferramentas liberadas, sem limite de uso. Assine agora e pague menos pelo ano inteiro.',
          bullets: ['Legendas automáticas sem limite', 'Lipsync de vídeo pra vídeo', 'FakePrint completo, todos os modelos'],
          priceOld: 'R$ 97',
          priceNew: 'R$ 57',
          priceNote: 'por mês',
          ctaLabel: 'Quero o Premium',
          ctaUrl: '/planos',
          imageUrl: '',
        },
        audience: { segments: ['free'], emails: [], includeAdmins: true },
        popup: true,
        active: true,
        activated_at: iso(3 * 3_600_000),
        ends_at: new Date(now + 2 * 86_400_000 + 4 * 3_600_000).toISOString(),
        created_at: iso(3 * 3_600_000),
        updated_at: iso(3 * 3_600_000),
      },
      {
        id: '22222222-2222-4222-8222-222222222222',
        kind: 'aviso',
        content: { tone: 'atencao', title: 'Manutenção hoje às 23h', body: 'O site fica fora por uns 15 minutos pra atualização. Salve o que estiver fazendo antes.', ctaLabel: '', ctaUrl: '' },
        audience: { segments: ['all'], emails: [], includeAdmins: true },
        popup: true,
        active: true,
        activated_at: iso(40 * 60_000),
        ends_at: null,
        created_at: iso(40 * 60_000),
        updated_at: iso(40 * 60_000),
      },
      {
        id: '33333333-3333-4333-8333-333333333333',
        kind: 'aviso',
        content: { tone: 'novidade', title: 'Chegou o Mixer de Velocidade', body: 'Acelere a voz sem deixar robótica. Já está na sua lista de ferramentas.', ctaLabel: 'Abrir ferramenta', ctaUrl: '/tools/acelerador' },
        audience: { segments: ['all'], emails: [], includeAdmins: true },
        popup: true,
        active: false,
        activated_at: iso(2 * 86_400_000),
        ends_at: null,
        created_at: iso(2 * 86_400_000),
        updated_at: iso(1 * 86_400_000),
      },
    ];
    const inbox: Record<string, Record<string, Inbox>> = {};
    // histórico velho: o aviso pausado já tinha chegado e sido lido
    for (const v of Object.values(VIEWERS)) {
      inbox[v.id] = {
        '33333333-3333-4333-8333-333333333333': { delivered_at: iso(2 * 86_400_000), read_at: iso(2 * 86_400_000 - 60_000), dismissed_keys: ['S0:0'], clicked_at: null, deleted_at: null, dismissed_at: iso(2 * 86_400_000) },
      };
    }
    W.__annDb = { anns, inbox, viewer: 'admin', session: 'S1' };
  }
  return W.__annDb as { anns: Ann[]; inbox: Record<string, Record<string, Inbox>>; viewer: string; session: string };
}

function adminItem(a: Ann): AdminAnnouncement {
  const d = db();
  const rows = Object.values(d.inbox).map((m) => m[a.id]).filter(Boolean);
  return {
    id: a.id,
    kind: a.kind,
    content: readContent(a.kind, a.content),
    audience: cleanAudience(a.audience),
    popup: a.popup,
    active: a.active,
    live: isLive(a),
    activatedAt: a.activated_at,
    endsAt: a.ends_at,
    createdAt: a.created_at,
    updatedAt: a.updated_at,
    stats: {
      delivered: rows.length + (a.active ? 37 : 12),
      read: rows.filter((r) => r.read_at).length + (a.active ? 21 : 9),
      clicked: rows.filter((r) => r.clicked_at).length + (a.active ? 6 : 1),
      dismissed: rows.filter((r) => r.dismissed_at).length,
      deleted: rows.filter((r) => r.deleted_at).length,
    },
  };
}

function notifPayload() {
  const d = db();
  const v = VIEWERS[d.viewer];
  const box = (d.inbox[v.id] ||= {});
  const now = Date.now();
  const stamp = new Date(now).toISOString();
  const matched = d.anns.filter((a) => isLive(a, now) && matchesAudience(cleanAudience(a.audience), v));
  for (const a of matched) if (!box[a.id]) box[a.id] = { delivered_at: stamp, read_at: null, dismissed_keys: [], clicked_at: null, deleted_at: null, dismissed_at: null };
  const toItem = (a: Ann, r: Inbox): NotifItem => ({
    id: a.id,
    kind: a.kind,
    content: readContent(a.kind, a.content),
    deliveredAt: r.delivered_at,
    readAt: r.read_at,
    clickedAt: r.clicked_at,
    live: isLive(a, now),
    activatedAt: a.activated_at,
    endsAt: a.ends_at,
  });
  const items = d.anns
    .filter((a) => box[a.id] && !box[a.id].deleted_at)
    .map((a) => toItem(a, box[a.id]))
    .sort((x, y) => Date.parse(y.deliveredAt) - Date.parse(x.deliveredAt));
  const popups = sortPopups(matched.filter((a) => shouldPopup(a, box[a.id], d.session, now)).map((a) => toItem(a, box[a.id])));
  return { enabled: true, userId: v.id, sk: d.session, items, unread: items.filter((i) => !i.readAt).length, popups };
}

function userAction(body: { action: string; id?: string }) {
  const d = db();
  const v = VIEWERS[d.viewer];
  const box = (d.inbox[v.id] ||= {});
  const stamp = new Date().toISOString();
  const r = body.id ? box[body.id] : undefined;
  switch (body.action) {
    case 'read':
      if (r && !r.read_at) r.read_at = stamp;
      break;
    case 'unread':
      if (r) r.read_at = null;
      break;
    case 'delete':
      if (r) {
        r.deleted_at = stamp;
        r.read_at ||= stamp;
      }
      break;
    case 'restore':
      if (r) r.deleted_at = null;
      break;
    case 'read_all':
      for (const x of Object.values(box)) if (!x.read_at && !x.deleted_at) x.read_at = stamp;
      break;
    case 'clear_read':
      for (const x of Object.values(box)) if (x.read_at && !x.deleted_at) x.deleted_at = stamp;
      break;
    case 'dismiss':
    case 'click': {
      const a = d.anns.find((y) => y.id === body.id);
      if (r && a) {
        r.dismissed_at = stamp;
        r.dismissed_keys = addDismissedKey(r.dismissed_keys, popupKey(d.session, a.activated_at));
        r.read_at ||= stamp;
        if (body.action === 'click') r.clicked_at = stamp;
      }
      break;
    }
  }
  return { ok: true };
}

function adminWrite(method: string, url: string, body: Record<string, unknown>) {
  const d = db();
  const stamp = new Date().toISOString();
  if (method === 'POST') {
    const kind = body.kind === 'propaganda' ? 'propaganda' : 'aviso';
    const c = cleanContent(kind, body.content);
    if (!c.ok) return { status: 400, body: { error: c.error } };
    const endsAt = cleanEndsAt(body.endsAt);
    if (endsAt === undefined) return { status: 400, body: { error: 'Prazo inválido.' } };
    const a: Ann = {
      id: crypto.randomUUID(),
      kind,
      content: c.value,
      audience: cleanAudience(body.audience),
      popup: body.popup !== false,
      active: body.active === true,
      activated_at: body.active === true ? stamp : null,
      ends_at: endsAt,
      created_at: stamp,
      updated_at: stamp,
    };
    d.anns.unshift(a);
    return { status: 200, body: { ok: true, item: adminItem(a) } };
  }
  if (method === 'DELETE') {
    const id = new URL(url, location.origin).searchParams.get('id');
    d.anns = d.anns.filter((a) => a.id !== id);
    for (const m of Object.values(d.inbox)) if (id) delete m[id];
    return { status: 200, body: { ok: true } };
  }
  const a = d.anns.find((x) => x.id === body.id);
  if (!a) return { status: 404, body: { error: 'Esse aviso não existe mais.' } };
  a.updated_at = stamp;
  if (body.action === 'activate') {
    a.active = true;
    a.activated_at = stamp;
    if (a.ends_at && Date.parse(a.ends_at) <= Date.now()) a.ends_at = null;
  } else if (body.action === 'pause') a.active = false;
  else if (body.action === 'republish') a.activated_at = stamp;
  else if (body.action === 'update') {
    const kind = (body.kind as AnnKind) ?? a.kind;
    const c = cleanContent(kind, body.content);
    if (!c.ok) return { status: 400, body: { error: c.error } };
    a.kind = kind;
    a.content = c.value;
    a.audience = cleanAudience(body.audience);
    a.popup = body.popup !== false;
    const e = cleanEndsAt(body.endsAt);
    if (e !== undefined) a.ends_at = e;
    if (body.republish === true && a.active) a.activated_at = stamp;
  }
  return { status: 200, body: { ok: true, item: adminItem(a) } };
}

function mockUsers() {
  const names = ['Ana Ribeiro', 'Bruno Lacerda', 'Carla Moura', 'Diego Sampaio', 'Elisa Prado', 'Fábio Nunes', 'Gabi Torres', 'Hugo Matos', 'Íris Lemos', 'João Peixoto', 'Kátia Reis', 'Lucas Brito'];
  return Array.from({ length: 48 }, (_, i) => {
    const access = i % 9 === 0 ? 'paid' : i % 13 === 0 ? 'granted' : i % 17 === 0 ? 'pending' : 'free';
    const name = names[i % names.length];
    return {
      id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
      email: `${name.toLowerCase().normalize('NFD').replace(/[^a-z ]/g, '').replace(' ', '.')}${i}@gmail.com`,
      name,
      is_admin: false,
      is_active: i !== 5,
      must_change_password: false,
      created_at: new Date(Date.now() - i * 86_400_000).toISOString(),
      last_seen_at: new Date(Date.now() - i * 3_600_000).toISOString(),
      last_ip: '189.110.23.41',
      last_tool: 'fakepass',
      last_tool_at: null,
      tier: access === 'free' ? 'free' : 'basic',
      plan: access === 'paid' || access === 'granted' ? 'premium' : 'free',
      access,
      tool_unlocks: i % 11 === 0 ? ['/tools/heygen-auto'] : [],
      static_unlocks: [],
      receipt_url: null,
      last_payment_at: null,
      concurrent_30d: 0,
      concurrent_last_at: null,
    };
  });
}

let installed = false;
function install() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  const real = window.fetch.bind(window);
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const users = mockUsers();
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const method = (init?.method ?? 'GET').toUpperCase();
    const parse = () => {
      try {
        return JSON.parse(String(init?.body ?? '{}'));
      } catch {
        return {};
      }
    };
    if (url.startsWith('/api/user/notifications')) {
      await new Promise((r) => setTimeout(r, 120));
      return json(method === 'POST' ? userAction(parse()) : notifPayload());
    }
    if (url.startsWith('/api/admin/announcements/upload')) {
      await new Promise((r) => setTimeout(r, 400));
      const f = (init?.body as FormData | undefined)?.get('file');
      return json({ ok: true, url: f instanceof Blob ? URL.createObjectURL(f) : '' });
    }
    if (url.startsWith('/api/admin/announcements')) {
      await new Promise((r) => setTimeout(r, 160));
      if (method === 'GET') return json({ enabled: true, items: db().anns.map(adminItem) });
      const r = adminWrite(method, url, method === 'DELETE' ? {} : parse());
      return json(r.body, r.status);
    }
    if (url.startsWith('/api/admin/list-users')) return json({ users, schema: 'full' });
    if (url.startsWith('/api/admin/dashboard')) {
      return json({ totals: { users: users.length, online: 2, paying: 5, mrr: 285 }, toolRanking: [], trafficSources: [], payments: [], revenueTotal: 0, refundedTotal: 0 });
    }
    if (url.startsWith('/api/admin/')) return json({ ok: true });
    if (url.startsWith('/api/user/heartbeat')) return json({ ok: true });
    return real(input, init);
  };
}

export default function DevAvisos() {
  if (process.env.NODE_ENV === 'production') notFound();
  useState(() => {
    install();
    return true;
  });
  const [view, setView] = useState<'admin' | 'notificacoes'>('admin');
  const [who, setWho] = useState('admin');
  const [session, setSession] = useState('S1');

  useEffect(() => {
    try {
      const v = new URLSearchParams(window.location.search).get('v');
      if (v === 'notificacoes') setView('notificacoes');
    } catch {
      /* sem query */
    }
  }, []);

  function switchViewer(v: string) {
    db().viewer = v;
    setWho(v);
    resetNotifications();
    void refreshNotifications({ force: true });
  }
  function relogin() {
    const next = `S${Number(db().session.slice(1)) + 1}`;
    db().session = next;
    setSession(next);
    void refreshNotifications({ force: true });
  }

  return (
    <div className="min-h-screen bg-bg">
      <AnnouncementHost />
      <TopBar />
      <main className="pb-28 pt-6 md:pt-8">{view === 'admin' ? <AdminPage /> : <NotificacoesPage />}</main>
      <div
        className="field-label fixed bottom-4 left-1/2 z-[70] flex -translate-x-1/2 flex-wrap items-center gap-2 rounded-full bg-bg-elev px-3 py-2 text-[12.5px] text-text"
        style={{ boxShadow: 'inset 0 0 0 1px rgb(var(--text) / 0.12), 0 20px 40px -16px rgb(0 0 0 / 0.7)' }}
      >
        <b className="px-1">Bancada</b>
        {(['admin', 'notificacoes'] as const).map((v) => (
          <button key={v} type="button" onClick={() => setView(v)} className="rounded-full px-3 py-1" style={{ background: view === v ? 'rgb(var(--violet) / 0.2)' : 'transparent' }}>
            {v === 'admin' ? 'Painel admin' : 'Notificações'}
          </button>
        ))}
        <span className="opacity-40">|</span>
        {Object.keys(VIEWERS).map((v) => (
          <button key={v} type="button" onClick={() => switchViewer(v)} className="rounded-full px-3 py-1" style={{ background: who === v ? 'rgb(var(--lime) / 0.2)' : 'transparent' }}>
            {v}
          </button>
        ))}
        <span className="opacity-40">|</span>
        <button type="button" onClick={relogin} className="rounded-full px-3 py-1" style={{ background: 'rgb(var(--text) / 0.06)' }}>
          Sair e entrar ({session})
        </button>
      </div>
    </div>
  );
}
