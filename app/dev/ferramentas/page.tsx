'use client';

/**
 * /dev/ferramentas — bancada do painel "Ferramentas" sem login (404 fora do dev).
 *
 * Monta o painel admin REAL e o hub REAL com um servidor falso que usa a MESMA
 * regra de produção (lib/maintenance.ts): ligar/desligar manutenção, recado,
 * previsão, contas liberadas, conflito de versão. O hub mostra a visão de um
 * cliente comum (sem furar a manutenção).
 *
 *   /dev/ferramentas                         painel admin
 *   /dev/ferramentas?v=hub                   hub do cliente
 *   /dev/ferramentas?v=hub&maintenance=1&from=/tools/lipsync   aviso de barrado
 */

import { notFound } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import AdminPage from '@/app/admin/page';
import { ToolsHub } from '@/components/ToolsHub';
import {
  applyToolChange,
  canBypassMaintenance,
  defaultToolsConfig,
  toSnapshot,
  type ToolChange,
  type ToolsConfig,
} from '@/lib/maintenance';
import { catalogTool, toolName } from '@/lib/tool-catalog';

const W = typeof window !== 'undefined' ? (window as unknown as Record<string, unknown>) : ({} as Record<string, unknown>);

function state(): { cfg: ToolsConfig } {
  if (!W.__toolsCfg) {
    let cfg = defaultToolsConfig();
    // ?seed=1 → já começa com Lipsync (com recado e previsão) e Legendas em manutenção
    if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('seed') === '1') {
      const a = applyToolChange(cfg, { kind: 'set', path: '/tools/lipsync', maintenance: true, message: 'Estamos deixando a sincronia da boca ainda mais precisa. Volta hoje mesmo.', until: new Date(Date.now() + 2 * 3_600_000).toISOString() }, 'Silas', toolName);
      if (a.ok) cfg = a.cfg;
      const b = applyToolChange(cfg, { kind: 'set', path: '/tools/tipografia', maintenance: true }, 'Silas', toolName);
      if (b.ok) cfg = b.cfg;
    }
    W.__toolsCfg = { cfg };
  }
  return W.__toolsCfg as { cfg: ToolsConfig };
}

function mockUsers() {
  const names = ['Ana Ribeiro', 'Bruno Lacerda', 'Carla Moura', 'Diego Sampaio', 'Elisa Prado', 'Fábio Nunes', 'Gabi Torres', 'Hugo Matos'];
  return Array.from({ length: 24 }, (_, i) => {
    const access = i % 5 === 0 ? 'paid' : 'free';
    const name = names[i % names.length];
    return {
      id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
      email: `${name.toLowerCase().normalize('NFD').replace(/[^a-z ]/g, '').replace(' ', '.')}${i}@gmail.com`,
      name,
      is_admin: false,
      is_active: true,
      must_change_password: false,
      created_at: new Date(Date.now() - i * 86_400_000).toISOString(),
      last_seen_at: new Date(Date.now() - i * 3_600_000).toISOString(),
      last_ip: '189.110.23.41',
      last_tool: 'fakepass',
      last_tool_at: null,
      tier: access === 'free' ? 'free' : 'basic',
      plan: access === 'paid' ? 'premium' : 'free',
      access,
      tool_unlocks: [],
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
    const st = state();
    if (url.startsWith('/api/admin/tools-status')) {
      await new Promise((r) => setTimeout(r, 220));
      if (method === 'GET') return json({ cfg: st.cfg, source: 'storage', error: null, fixedBypass: ['elderemanoel.13@gmail.com'], now: new Date().toISOString() });
      const body = JSON.parse(String(init?.body ?? '{}')) as { change: ToolChange; rev?: number };
      if (typeof body.rev === 'number' && body.rev !== st.cfg.rev) {
        return json({ error: 'Outra pessoa mudou as ferramentas agora há pouco. A lista foi atualizada: confira e faça de novo.', cfg: st.cfg, conflict: true }, 409);
      }
      const r = applyToolChange(st.cfg, body.change, 'Silas', toolName);
      if (!r.ok) return json({ error: r.error }, 400);
      st.cfg = r.cfg;
      return json({ ok: true, cfg: r.cfg, summary: r.summary, changed: r.changed });
    }
    if (url.startsWith('/api/tools/status')) {
      // visão de um CLIENTE comum (não admin, não liberado)
      const email = 'cliente@gmail.com';
      const full = toSnapshot(st.cfg, canBypassMaintenance(email, st.cfg));
      const tools: typeof full.tools = {};
      for (const [p, info] of Object.entries(full.tools)) if (catalogTool(p)?.plan !== 'admin') tools[p] = info;
      return json({ ...full, tools });
    }
    if (url.startsWith('/api/admin/list-users')) return json({ users, schema: 'full' });
    if (url.startsWith('/api/admin/dashboard')) {
      return json({ totals: { users: users.length, online: 2, paying: 5, mrr: 285 }, toolRanking: [], trafficSources: [], payments: [], revenueTotal: 0, refundedTotal: 0 });
    }
    if (url.startsWith('/api/admin/announcements')) return json({ enabled: true, items: [] });
    if (url.startsWith('/api/admin/')) return json({ ok: true, items: [] });
    if (url.startsWith('/api/user/')) return json({ ok: true, enabled: false, items: [], popups: [], unread: 0, sk: '', userId: null });
    return real(input, init);
  };
}

export default function DevFerramentas() {
  if (process.env.NODE_ENV === 'production') notFound();
  useState(() => {
    install();
    return true;
  });
  const [view, setView] = useState<'admin' | 'hub' | null>(null);
  useEffect(() => {
    try {
      setView(new URLSearchParams(window.location.search).get('v') === 'hub' ? 'hub' : 'admin');
    } catch {
      setView('admin');
    }
  }, []);
  if (!view) return null;
  return (
    <main className="min-h-screen bg-bg pb-16 pt-8">
      {view === 'admin' ? (
        <AdminPage />
      ) : (
        <Suspense fallback={null}>
          <ToolsHub />
        </Suspense>
      )}
    </main>
  );
}
