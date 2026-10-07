'use client';

/**
 * /dev/admin — o PAINEL ADMIN REAL com dados de exemplo, sem login (404 fora
 * do dev). Intercepta só as rotas /api/admin/* do próprio painel; o resto do
 * fetch segue normal. Serve pra conferir desenho, perfil, histórico de IPs e
 * aviso de acesso simultâneo sem precisar de Supabase local.
 */

import { notFound } from 'next/navigation';
import { useState } from 'react';
import AdminPage from '@/app/admin/page';
import { Heartbeat } from '@/components/Heartbeat';
import { summarizeAccess, summarizeUsage, type AccessEventRow, type AccessSessionRow } from '@/lib/admin-access-summary';

const FIRST = ['Vanessa', 'Eduardo', 'Caio', 'Alexandre', 'Beatriz', 'Rafaela', 'Thiago', 'Juliana', 'Marcos', 'Larissa', 'Pedro', 'Camila', 'Gustavo', 'Renata', 'Diego', 'Patrícia', 'Lucas', 'Fernanda', 'André', 'Mariana', 'Felipe', 'Aline', 'Rodrigo', 'Tatiane', 'Bruno', 'Isabela', 'Leandro', 'Gabriela', 'Vinícius', 'Natália'];
const LAST = ['Branchine', 'Moura', 'Trindade', 'Bahia', 'Siqueira', 'Albuquerque', 'Nogueira', 'Pacheco', 'Teixeira', 'Rezende', 'Cavalcanti', 'Barros', 'Figueiredo', 'Lacerda', 'Monteiro', 'Peixoto', 'Quintela', 'Sampaio', 'Valadares', 'Xavier'];
const TOOLS = ['fakepass', 'decupagem', 'camuflagem', 'lipsync', 'downloader', 'compressor', 'clickup-pilot', 'heygen-auto', 'tipografia', 'auto-broll'];
const CITIES: Array<[string, string]> = [['São Paulo', 'SP'], ['Rio de Janeiro', 'RJ'], ['Belo Horizonte', 'MG'], ['Curitiba', 'PR'], ['Recife', 'PE'], ['Porto Alegre', 'RS'], ['Campinas', 'SP'], ['Florianópolis', 'SC']];
const DEVICES: Array<[string, string, string]> = [['Chrome', 'Windows', 'desktop'], ['Safari', 'iOS', 'mobile'], ['Chrome', 'Android', 'mobile'], ['Safari', 'macOS', 'desktop'], ['Edge', 'Windows', 'desktop']];

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function buildMock() {
  const now = Date.now();
  const r = rng(7);
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
  const iso = (msAgo: number) => new Date(now - msAgo).toISOString();
  const ip = () => `${pick([138, 189, 177, 200, 191, 179])}.${Math.floor(r() * 250)}.${Math.floor(r() * 250)}.${Math.floor(r() * 250)}`;

  const users = Array.from({ length: 132 }, (_, i) => {
    const name = `${FIRST[i % FIRST.length]} ${LAST[(i * 7) % LAST.length]}`;
    const email = `${name.toLowerCase().normalize('NFD').replace(/[^a-z ]/g, '').replace(' ', '.')}${i}@gmail.com`;
    const roll = r();
    const access = i === 2 ? 'paid' : roll < 0.08 ? 'paid' : roll < 0.14 ? 'granted' : roll < 0.16 ? 'pending' : 'free';
    const online = i < 6;
    const seenAgo = online ? 10_000 + r() * 30_000 : r() < 0.3 ? r() * 86_400_000 : r() * 40 * 86_400_000;
    const tool = pick(TOOLS);
    return {
      id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
      email,
      name: i === 9 ? null : name,
      is_admin: false,
      is_active: i !== 11,
      must_change_password: i === 14,
      created_at: iso(i * 0.9 * 86_400_000 + r() * 86_400_000),
      last_seen_at: i === 20 ? null : iso(seenAgo),
      last_ip: ip(),
      last_tool: tool,
      last_tool_at: iso(online && i % 2 === 0 ? 20_000 : seenAgo + 60_000),
      tier: access === 'free' ? 'free' : 'basic',
      phone: r() < 0.7 ? `+55${pick(['11', '21', '31', '41', '81', '48'])}9${Math.floor(10000000 + r() * 89999999)}` : null,
      phone_verified: r() < 0.5,
      subscription_status: access === 'paid' ? 'active' : access === 'granted' ? 'admin_grant' : access === 'pending' ? 'past_due' : null,
      subscription_plan: access === 'free' ? null : 'basic',
      current_period_end: access === 'paid' ? iso(-20 * 86_400_000) : null,
      traffic_source: pick(['instagram.com', 'direct', 'google.com', 'youtube.com', 'l.facebook.com']),
      plan: access === 'paid' || access === 'granted' ? 'premium' : 'free',
      access,
      tool_unlocks: i % 9 === 0 ? ['/tools/heygen-auto', '/tools/clickup-pilot'] : [],
      static_unlocks: [],
      receipt_url: access === 'paid' ? 'https://pay.stripe.com/receipts/exemplo' : null,
      last_payment_at: access === 'paid' ? iso(10 * 86_400_000) : null,
      concurrent_30d: i === 2 ? 3 : i === 4 ? 1 : 0,
      concurrent_last_at: i === 2 ? iso(2 * 3_600_000) : i === 4 ? iso(3 * 86_400_000) : null,
    };
  });

  const payments = users
    .filter((u) => u.access === 'paid')
    .flatMap((u, k) => [0, 1].map((m) => ({
      id: k * 10 + m,
      email: u.email,
      amount: 5700,
      currency: 'brl',
      plan: 'basic',
      billing: 'monthly',
      status: k === 3 && m === 0 ? 'refunded' : 'paid',
      receipt_url: 'https://pay.stripe.com/receipts/exemplo',
      created_at: iso((m * 30 + k * 2.3) * 86_400_000),
    })));

  const signupDays = Array.from({ length: 30 }, (_, i) => {
    const d = new Date(now - (29 - i) * 86_400_000);
    const key = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
    return { day: key, count: Math.floor(r() * 9) };
  });

  const dash = {
    totals: { users: users.length, online: 6, paying: 10, mrr: 570 },
    toolRanking: [['fakepass', 42], ['decupagem', 39], ['camuflagem', 36], ['lipsync', 12], ['downloader', 12], ['compressor', 9], ['tipografia', 5]].map(([tool, count]) => ({ tool, count })),
    trafficSources: [['instagram.com', 188], ['direct', 141], ['google.com', 63], ['youtube.com', 29], ['l.facebook.com', 11]].map(([source, count]) => ({ source, count })),
    payments,
    revenueTotal: payments.filter((p) => p.status === 'paid').reduce((s, p) => s + p.amount, 0),
    refundedTotal: 5700,
    growth: { newToday: 4, new7d: 31, new30d: 118, active24h: 23, active7d: 61, active30d: 97, customers: users.length, signupDays },
    concurrency: {
      enabled: true,
      accounts7d: 2,
      events7d: 4,
      recent: [
        { id: 1, user_id: users[2].id, name: users[2].name, email: users[2].email, started_at: iso(2 * 3_600_000 + 19 * 60_000), ended_at: iso(2 * 3_600_000), label_a: 'Chrome · Windows', label_b: 'Safari · iOS', place_a: 'São Paulo, SP, BR', place_b: 'Recife, PE, BR', same_network: false },
        { id: 2, user_id: users[4].id, name: users[4].name, email: users[4].email, started_at: iso(3 * 86_400_000), ended_at: iso(3 * 86_400_000 - 600_000), label_a: 'Chrome · Windows', label_b: 'Chrome · Windows', place_a: 'Curitiba, PR, BR', place_b: 'Curitiba, PR, BR', same_network: true },
      ],
    },
  };

  function profileFor(id: string) {
    const u = users.find((x) => x.id === id) ?? users[0];
    const pr = rng(id.length + parseInt(id.slice(-4), 10));
    const pk = <T,>(a: T[]) => a[Math.floor(pr() * a.length)];
    const devs = [DEVICES[0], DEVICES[1], DEVICES[3]].map((d, k) => ({ id: `dev-${k}-${id.slice(-4)}`, d }));
    const sessions: AccessSessionRow[] = [];
    let sid = 1;
    for (let day = 0; day < 22; day++) {
      if (pr() < 0.25) continue;
      const n = 1 + Math.floor(pr() * 3);
      for (let k = 0; k < n; k++) {
        const dv = pk(devs);
        const [city, region] = dv.d[2] === 'mobile' && pr() < 0.5 ? CITIES[4] : CITIES[0];
        const start = now - day * 86_400_000 - (9 + k * 4 + pr() * 2) * 3_600_000;
        const len = (15 + pr() * 140) * 60_000;
        sessions.push({
          id: sid++,
          device_id: dv.id,
          ip: dv.d[2] === 'mobile' ? `177.42.${10 + Math.floor(pr() * 3)}.9` : '189.110.23.41',
          city,
          region,
          country: 'BR',
          browser: dv.d[0],
          os: dv.d[1],
          device_kind: dv.d[2],
          started_at: new Date(start).toISOString(),
          last_seen_at: new Date(start + len).toISOString(),
          pings: Math.round(len / 25_000),
          active_seconds: Math.round((len / 1000) * (0.35 + pr() * 0.5)),
        });
      }
    }
    const events: AccessEventRow[] =
      (u.concurrent_30d ?? 0) > 0
        ? [
            { id: 11, device_a: devs[0].id, device_b: devs[1].id, ip_a: '189.110.23.41', ip_b: '177.42.11.9', place_a: 'São Paulo, SP, BR', place_b: 'Recife, PE, BR', label_a: 'Chrome · Windows', label_b: 'Safari · iOS', same_network: false, same_machine: false, started_at: iso(2 * 3_600_000 + 19 * 60_000), ended_at: iso(2 * 3_600_000) },
            { id: 12, device_a: devs[0].id, device_b: devs[2].id, ip_a: '189.110.23.41', ip_b: '189.110.23.41', place_a: 'São Paulo, SP, BR', place_b: 'São Paulo, SP, BR', label_a: 'Chrome · Windows', label_b: 'Safari · macOS', same_network: true, same_machine: false, started_at: iso(5 * 86_400_000 + 3_600_000), ended_at: iso(5 * 86_400_000 + 2_400_000) },
            { id: 13, device_a: devs[0].id, device_b: 'dev-incog', ip_a: '189.110.23.41', ip_b: '189.110.23.41', place_a: 'São Paulo, SP, BR', place_b: 'São Paulo, SP, BR', label_a: 'Chrome · Windows', label_b: 'Edge · Windows', same_network: true, same_machine: true, started_at: iso(9 * 86_400_000), ended_at: iso(9 * 86_400_000 - 300_000) },
          ].slice(0, u.concurrent_30d === 1 ? 1 : 3)
        : [];
    const devices = devs.map((d) => ({
      device_id: d.id,
      browser: d.d[0],
      os: d.d[1],
      device_kind: d.d[2],
      first_seen_at: iso(22 * 86_400_000),
      last_seen_at: sessions.find((s) => s.device_id === d.id)?.last_seen_at ?? iso(22 * 86_400_000),
      last_ip: d.d[2] === 'mobile' ? '177.42.11.9' : '189.110.23.41',
      last_place: d.d[2] === 'mobile' ? 'Recife, PE, BR' : 'São Paulo, SP, BR',
    }));
    const toolEvents = Array.from({ length: 140 }, () => ({ tool: pk(TOOLS), created_at: iso(pr() * 60 * 86_400_000) }));
    const pays = payments.filter((p) => p.email === u.email);
    return {
      user: { ...u, utm_source: 'instagram', utm_medium: 'bio', utm_campaign: 'lancamento-out', first_touch_at: u.created_at, stripe_customer_id: u.access === 'paid' ? 'cus_Qx81LmPz0aTr2K' : null, stripe_subscription_id: u.access === 'paid' ? 'sub_1Q8xYzLmPz0aTr2KvB' : null, phone_verified_at: u.phone_verified ? u.created_at : null },
      auth: { created_at: u.created_at, last_sign_in_at: iso(3 * 3_600_000), email_confirmed_at: u.created_at, provider: 'email', providers: ['email'] },
      payments: pays,
      billing: {
        totalPaid: pays.filter((p) => p.status === 'paid').reduce((s, p) => s + p.amount, 0),
        refunded: pays.filter((p) => p.status === 'refunded').reduce((s, p) => s + p.amount, 0),
        count: pays.filter((p) => p.status === 'paid').length,
        firstAt: pays.length ? pays[pays.length - 1].created_at : null,
        lastAt: pays.length ? pays[0].created_at : null,
      },
      tierChanges: u.access === 'granted' ? [{ id: 1, from_tier: 'free', to_tier: 'basic', reason: 'Parceria de conteúdo', created_at: iso(12 * 86_400_000), by: 'Silas' }] : [],
      usage: summarizeUsage(toolEvents, 30),
      access: { enabled: true, sessions: [...sessions].sort((a, b) => Date.parse(b.last_seen_at) - Date.parse(a.last_seen_at)), events, ...summarizeAccess(sessions, devices, events, 30) },
    };
  }

  return { users, dash, profileFor };
}

let installed = false;
function installMock() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  const mock = buildMock();
  const real = window.fetch.bind(window);
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (url.startsWith('/api/admin/list-users')) return json({ users: mock.users });
    if (url.startsWith('/api/admin/dashboard')) return json(mock.dash);
    if (url.startsWith('/api/admin/user-profile')) {
      const id = new URL(url, window.location.origin).searchParams.get('id') ?? '';
      await new Promise((r) => setTimeout(r, 250));
      return json(mock.profileFor(id));
    }
    if (url.startsWith('/api/admin/')) return json({ ok: true, password: 'Kx7-pR2m-Q9tw', applied: false, reason: 'exemplo' });
    if (url.startsWith('/api/user/heartbeat')) {
      // Guarda o que o heartbeat mandou, pra conferir aparelho/uso ativo.
      const w = window as unknown as { __hb?: unknown[] };
      (w.__hb ||= []).push({ at: Date.now(), body: JSON.parse(String(init?.body ?? '{}')) });
      return json({ ok: true });
    }
    return real(input, init);
  };
}

export default function DevAdminPreview() {
  if (process.env.NODE_ENV === 'production') notFound();
  useState(() => {
    installMock();
    return true;
  });
  return (
    <main className="min-h-screen bg-bg pb-16 pt-8">
      <Heartbeat />
      <AdminPage />
    </main>
  );
}
