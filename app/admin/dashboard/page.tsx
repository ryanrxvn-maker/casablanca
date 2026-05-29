'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * /admin/dashboard — o "cérebro" do AutoEdit.
 *
 * Painel do dono: online agora, totais, % de tiers, pagantes, MRR, ranking
 * de ferramentas, origem de tráfego, signups recentes e quem está online
 * (com IP + ferramenta). Visual: cérebro neural 3D + chuva de código que
 * muda de cor perto do mouse. Atualiza a cada 15s.
 */

type Dash = {
  now: string;
  totals: { users: number; online: number; paying: number; mrr: number };
  tiers: {
    counts: { free: number; basic: number; pro: number; admin: number };
    pct: { free: number; basic: number; pro: number; admin: number };
  };
  paying: { basic: number; pro: number };
  onlineUsers: Array<{
    id: string;
    name: string | null;
    email: string | null;
    tier: string;
    last_ip: string | null;
    tool: string | null;
    usingTool: boolean;
  }>;
  recentSignups: Array<{
    id: string;
    name: string | null;
    email: string | null;
    tier: string;
    traffic_source: string | null;
    created_at: string | null;
  }>;
  toolRanking: Array<{ tool: string; count: number }>;
  trafficSources: Array<{ source: string; count: number }>;
  payments: Array<{
    id: number;
    email: string | null;
    amount: number;
    currency: string;
    plan: string | null;
    billing: string | null;
    status: string;
    receipt_url: string | null;
    created_at: string | null;
  }>;
  revenueTotal: number;
};

function brl(centavos: number): string {
  return (centavos / 100).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });
}

const TIER_COLOR: Record<string, string> = {
  free: '#8b8b96',
  basic: '#f472b6',
  pro: '#c084fc',
  admin: '#c8ff00',
};

const TOOL_LABEL: Record<string, string> = {
  decupagem: 'Decupagem',
  'decupagem-copy': 'Decupagem Copy',
  downloader: 'Downloader',
  camuflagem: 'Camuflagem',
  compressor: 'Compressor',
  'audio-split': 'Audio Split',
  acelerador: 'Acelerador',
  normalizador: 'Normalizador',
  calculadora: 'Calculadora',
  'copy-srt': 'Copy SRT',
  'auto-broll': 'Auto B-roll',
  'troca-produto': 'Troca de Produto',
  'heygen-auto': 'HeyGen Auto',
  'clickup-pilot': 'ClickUp Pilot',
  'remover-elementos': 'Remover Legenda',
  'separador-audio': 'Separador de Áudio',
  'ltx-video': 'LTX Video',
};
const toolLabel = (s: string) => TOOL_LABEL[s] ?? s;

export default function DashboardPage() {
  const [data, setData] = useState<Dash | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const res = await fetch('/api/admin/dashboard', { cache: 'no-store' });
        const j = await res.json();
        if (!alive) return;
        if (!res.ok) {
          setErr(j.error || 'Falha ao carregar.');
          return;
        }
        setErr(null);
        setData(j as Dash);
      } catch {
        if (alive) setErr('Erro de conexão.');
      }
    }
    load();
    const id = setInterval(load, 15_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  return (
    <div className="relative mx-auto w-full max-w-[1280px] px-5 md:px-8">
      <CodeRain />

      {/* Header com cérebro */}
      <header className="relative z-10 flex flex-col items-center pt-6 text-center">
        <Brain3D />
        <div
          className="mt-2 inline-flex items-center gap-2 rounded-full border border-violet/35 bg-violet/10 px-3 py-1 text-[10.5px] font-semibold uppercase tracking-[0.20em] text-violet"
          style={{ fontFamily: 'var(--font-tech)' }}
        >
          <span className="inline-block h-1.5 w-1.5 animate-pulse-soft rounded-full bg-violet shadow-[0_0_10px_rgba(167,139,250,0.9)]" />
          CÉREBRO · AUTO EDIT
        </div>
        <h1
          className="mt-3 text-[34px] font-extrabold tracking-tight text-white md:text-[44px]"
          style={{ fontFamily: 'var(--font-tech)', letterSpacing: '-0.03em' }}
        >
          Dashboard
        </h1>
        <p className="mt-1 text-[13px] text-text-muted">
          {data
            ? `Atualizado ${new Date(data.now).toLocaleTimeString('pt-BR')} · auto a cada 15s`
            : 'Carregando o cérebro…'}
        </p>
      </header>

      {err ? (
        <div className="relative z-10 mt-8 rounded-[14px] border border-rose-500/40 bg-rose-500/10 p-5 text-center text-sm text-rose-200">
          {err}
        </div>
      ) : null}

      {/* Stat cards */}
      <section className="relative z-10 mt-10 grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard
          label="Online agora"
          value={data?.totals.online ?? '—'}
          hue="rgba(200,255,0,0.6)"
          live
        />
        <StatCard
          label="Usuários"
          value={data?.totals.users ?? '—'}
          hue="rgba(167,139,250,0.6)"
        />
        <StatCard
          label="Pagantes"
          value={data?.totals.paying ?? '—'}
          hue="rgba(244,114,182,0.6)"
        />
        <StatCard
          label="MRR estimado"
          value={data ? `R$ ${data.totals.mrr.toLocaleString('pt-BR')}` : '—'}
          hue="rgba(103,232,249,0.6)"
        />
      </section>

      {/* Distribuição de tiers */}
      <section className="relative z-10 mt-6">
        <Panel title="Distribuição de planos">
          {data ? (
            <>
              <div className="flex h-5 w-full overflow-hidden rounded-full border border-line/70">
                {(['free', 'basic', 'pro', 'admin'] as const).map((t) =>
                  data.tiers.pct[t] > 0 ? (
                    <div
                      key={t}
                      style={{
                        width: `${data.tiers.pct[t]}%`,
                        background: TIER_COLOR[t],
                        boxShadow: `0 0 14px ${TIER_COLOR[t]}`,
                      }}
                      title={`${t}: ${data.tiers.counts[t]}`}
                    />
                  ) : null,
                )}
              </div>
              <div className="mt-3 flex flex-wrap gap-4">
                {(['free', 'basic', 'pro', 'admin'] as const).map((t) => (
                  <div key={t} className="flex items-center gap-2 text-[12.5px]">
                    <span
                      className="inline-block h-2.5 w-2.5 rounded-full"
                      style={{ background: TIER_COLOR[t], boxShadow: `0 0 8px ${TIER_COLOR[t]}` }}
                    />
                    <span className="font-bold capitalize text-white">{t}</span>
                    <span className="text-text-muted">
                      {data.tiers.counts[t]} · {data.tiers.pct[t]}%
                    </span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <Skeleton h={60} />
          )}
        </Panel>
      </section>

      {/* Duas colunas: ferramentas + tráfego */}
      <section className="relative z-10 mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Panel title="Ferramentas mais usadas (30d)">
          {data ? (
            data.toolRanking.length ? (
              <BarList
                items={data.toolRanking.map((t) => ({
                  label: toolLabel(t.tool),
                  value: t.count,
                }))}
                hue="rgba(192,132,252,0.85)"
              />
            ) : (
              <Empty>Sem uso registrado ainda.</Empty>
            )
          ) : (
            <Skeleton h={160} />
          )}
        </Panel>

        <Panel title="Por onde chegaram">
          {data ? (
            data.trafficSources.length ? (
              <BarList
                items={data.trafficSources.map((s) => ({
                  label: s.source,
                  value: s.count,
                }))}
                hue="rgba(103,232,249,0.85)"
              />
            ) : (
              <Empty>Sem dados de origem ainda.</Empty>
            )
          ) : (
            <Skeleton h={160} />
          )}
        </Panel>
      </section>

      {/* Online agora — detalhe */}
      <section className="relative z-10 mt-6">
        <Panel title={`Quem está online (${data?.onlineUsers.length ?? 0})`}>
          {data ? (
            data.onlineUsers.length ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[13px]">
                  <thead>
                    <tr className="text-[10.5px] uppercase tracking-[0.16em] text-text-dim">
                      <th className="pb-2 pr-4">Usuário</th>
                      <th className="pb-2 pr-4">Plano</th>
                      <th className="pb-2 pr-4">Ferramenta</th>
                      <th className="pb-2">IP</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.onlineUsers.map((u) => (
                      <tr key={u.id} className="border-t border-line/40">
                        <td className="py-2 pr-4 text-white">
                          {u.name || u.email || u.id.slice(0, 8)}
                        </td>
                        <td className="py-2 pr-4">
                          <span
                            className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase"
                            style={{
                              color: TIER_COLOR[u.tier],
                              border: `1px solid ${TIER_COLOR[u.tier]}`,
                            }}
                          >
                            {u.tier}
                          </span>
                        </td>
                        <td className="py-2 pr-4 text-text-muted">
                          {u.tool ? (
                            <span className={u.usingTool ? 'text-lime' : ''}>
                              {toolLabel(u.tool)}
                              {u.usingTool ? ' ●' : ''}
                            </span>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="py-2 font-mono text-text-dim">{u.last_ip || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty>Ninguém online no momento.</Empty>
            )
          ) : (
            <Skeleton h={120} />
          )}
        </Panel>
      </section>

      {/* Pagamentos / Comprovantes */}
      <section className="relative z-10 mt-6">
        <Panel
          title={`Pagamentos / comprovantes${
            data ? ` · ${brl(data.revenueTotal)} arrecadado` : ''
          }`}
        >
          {data ? (
            data.payments.length ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[13px]">
                  <thead>
                    <tr className="text-[10.5px] uppercase tracking-[0.16em] text-text-dim">
                      <th className="pb-2 pr-4">Cliente</th>
                      <th className="pb-2 pr-4">Plano</th>
                      <th className="pb-2 pr-4">Valor</th>
                      <th className="pb-2 pr-4">Data</th>
                      <th className="pb-2 pr-4">Status</th>
                      <th className="pb-2">Comprovante</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.payments.map((p) => (
                      <tr key={p.id} className="border-t border-line/40">
                        <td className="py-2 pr-4 text-white">{p.email || '—'}</td>
                        <td className="py-2 pr-4 capitalize text-text-muted">
                          {p.plan || '—'}
                          {p.billing ? (
                            <span className="text-text-dim">
                              {' '}
                              · {p.billing === 'annual' ? 'anual' : 'mensal'}
                            </span>
                          ) : null}
                        </td>
                        <td className="py-2 pr-4 font-bold text-lime">{brl(p.amount)}</td>
                        <td className="py-2 pr-4 text-text-muted">
                          {p.created_at
                            ? new Date(p.created_at).toLocaleString('pt-BR')
                            : '—'}
                        </td>
                        <td className="py-2 pr-4">
                          <span className="rounded-full border border-lime/45 bg-lime/10 px-2 py-0.5 text-[10px] font-bold uppercase text-lime">
                            {p.status === 'paid' ? 'pago' : p.status}
                          </span>
                        </td>
                        <td className="py-2">
                          {p.receipt_url ? (
                            <a
                              href={p.receipt_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-violet underline-offset-2 hover:underline"
                            >
                              Ver comprovante →
                            </a>
                          ) : (
                            <span className="text-text-dim">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty>Nenhum pagamento registrado ainda.</Empty>
            )
          ) : (
            <Skeleton h={120} />
          )}
        </Panel>
      </section>

      {/* Signups recentes */}
      <section className="relative z-10 mb-16 mt-6">
        <Panel title="Cadastros recentes">
          {data ? (
            data.recentSignups.length ? (
              <ul className="flex flex-col divide-y divide-line/40">
                {data.recentSignups.map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-3 py-2.5 text-[13px]">
                    <span className="text-white">{s.name || s.email || s.id.slice(0, 8)}</span>
                    <span className="flex items-center gap-3 text-text-muted">
                      <span
                        className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase"
                        style={{ color: TIER_COLOR[s.tier], border: `1px solid ${TIER_COLOR[s.tier]}` }}
                      >
                        {s.tier}
                      </span>
                      <span className="text-[11.5px]">{s.traffic_source || 'direct'}</span>
                      <span className="text-[11px] text-text-dim">
                        {s.created_at
                          ? new Date(s.created_at).toLocaleDateString('pt-BR')
                          : ''}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty>Nenhum cadastro ainda.</Empty>
            )
          ) : (
            <Skeleton h={120} />
          )}
        </Panel>
      </section>
    </div>
  );
}

/* ───────────────────── Subcomponentes ───────────────────── */

function StatCard({
  label,
  value,
  hue,
  live,
}: {
  label: string;
  value: string | number;
  hue: string;
  live?: boolean;
}) {
  return (
    <div
      className="relative overflow-hidden rounded-[18px] border p-5"
      style={{
        borderColor: hue.replace('0.6', '0.4'),
        background:
          'linear-gradient(180deg, rgba(255,255,255,0.03), rgba(0,0,0,0.25)), linear-gradient(180deg, #15151a, #0b0b0e)',
        boxShadow: `0 0 30px -16px ${hue}`,
      }}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full opacity-40 blur-2xl"
        style={{ background: hue }}
      />
      <div className="flex items-center gap-2 text-[10.5px] font-bold uppercase tracking-[0.16em] text-text-muted" style={{ fontFamily: 'var(--font-tech)' }}>
        {live ? (
          <span className="inline-block h-1.5 w-1.5 animate-pulse-soft rounded-full bg-lime shadow-[0_0_8px_rgba(200,255,0,0.95)]" />
        ) : null}
        {label}
      </div>
      <div
        className="mt-2 text-[30px] font-extrabold tracking-tight text-white"
        style={{ fontFamily: 'var(--font-tech)', letterSpacing: '-0.02em' }}
      >
        {value}
      </div>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      className="rounded-[18px] border border-line/70 p-5 md:p-6"
      style={{
        background:
          'linear-gradient(180deg, rgba(255,255,255,0.02), rgba(0,0,0,0.18)), linear-gradient(180deg, #131318, #0b0b0e)',
        backdropFilter: 'blur(6px)',
      }}
    >
      <h2
        className="mb-4 text-[12px] font-bold uppercase tracking-[0.18em] text-text-muted"
        style={{ fontFamily: 'var(--font-tech)' }}
      >
        {title}
      </h2>
      {children}
    </div>
  );
}

function BarList({
  items,
  hue,
}: {
  items: Array<{ label: string; value: number }>;
  hue: string;
}) {
  const max = Math.max(...items.map((i) => i.value), 1);
  return (
    <ul className="flex flex-col gap-2.5">
      {items.slice(0, 10).map((it) => (
        <li key={it.label} className="flex items-center gap-3">
          <span className="w-[42%] truncate text-[12.5px] text-white">{it.label}</span>
          <span className="relative h-3 flex-1 overflow-hidden rounded-full bg-black/40">
            <span
              className="absolute inset-y-0 left-0 rounded-full"
              style={{
                width: `${Math.max((it.value / max) * 100, 4)}%`,
                background: hue,
                boxShadow: `0 0 12px ${hue}`,
              }}
            />
          </span>
          <span className="w-8 text-right text-[12px] font-bold text-text-muted">
            {it.value}
          </span>
        </li>
      ))}
    </ul>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="py-6 text-center text-[13px] text-text-dim">{children}</div>;
}

function Skeleton({ h }: { h: number }) {
  return (
    <div
      className="w-full animate-pulse rounded-[12px] bg-white/5"
      style={{ height: h }}
    />
  );
}

/* ───────────────────── Cérebro 3D (SVG neural) ───────────────────── */

function Brain3D() {
  return (
    <div className="brain-wrap" style={{ perspective: '900px' }}>
      <div className="brain-spin relative" style={{ width: 150, height: 150 }}>
        <span aria-hidden className="brain-halo" />
        <svg width="150" height="150" viewBox="0 0 120 120" fill="none" className="relative z-10">
          <defs>
            <radialGradient id="bgrad" cx="50%" cy="45%" r="60%">
              <stop offset="0%" stopColor="#d8b4fe" />
              <stop offset="60%" stopColor="#a855f7" />
              <stop offset="100%" stopColor="#6d28d9" />
            </radialGradient>
          </defs>
          {/* Contorno do cérebro */}
          <path
            d="M60 18c-10-8-26-6-30 6-10 2-16 12-12 22-6 6-5 18 3 22-1 10 8 18 18 16 5 6 16 6 21 0 10 2 19-6 18-16 8-4 9-16 3-22 4-10-2-20-12-22-4-12-20-14-30-6z"
            stroke="url(#bgrad)"
            strokeWidth="2"
            fill="rgba(168,85,247,0.08)"
            style={{ filter: 'drop-shadow(0 0 8px rgba(168,85,247,0.8))' }}
          />
          {/* Sulcos */}
          <path d="M60 22v76M44 30c8 6 8 18 0 24s-8 18 0 24M76 30c-8 6-8 18 0 24s8 18 0 24" stroke="rgba(216,180,254,0.55)" strokeWidth="1.4" fill="none" />
          {/* Nós neurais pulsando */}
          {[
            [60, 30], [44, 44], [76, 44], [38, 64], [82, 64], [52, 78], [70, 86], [60, 56],
          ].map(([x, y], i) => (
            <circle key={i} cx={x} cy={y} r="2.4" fill="#e9d5ff" className="brain-node" style={{ animationDelay: `${i * 220}ms` }} />
          ))}
        </svg>
      </div>
      <style jsx>{`
        .brain-spin {
          transform-style: preserve-3d;
          animation: brain-float 5s ease-in-out infinite;
        }
        .brain-halo {
          position: absolute;
          inset: -10px;
          border-radius: 9999px;
          background: radial-gradient(50% 50% at 50% 50%, rgba(168, 85, 247, 0.45), transparent 70%);
          filter: blur(14px);
          animation: brain-halo 3.4s ease-in-out infinite;
        }
        :global(.brain-node) {
          animation: brain-node 2.2s ease-in-out infinite;
          filter: drop-shadow(0 0 6px rgba(233, 213, 255, 0.95));
        }
        @keyframes brain-float {
          0%, 100% { transform: translateY(0) rotateY(-8deg); }
          50% { transform: translateY(-7px) rotateY(8deg); }
        }
        @keyframes brain-halo {
          0%, 100% { opacity: 0.6; transform: scale(1); }
          50% { opacity: 1; transform: scale(1.08); }
        }
        @keyframes brain-node {
          0%, 100% { opacity: 0.4; r: 2; }
          50% { opacity: 1; r: 3.2; }
        }
      `}</style>
    </div>
  );
}

/* ───────────────────── Chuva de código (canvas) ───────────────────── */
/**
 * Matrix de código atrás do conteúdo. As colunas perto do mouse mudam pra
 * lime/cyan; longe, ficam violeta tênue. Fica fixo cobrindo a área do painel.
 */
function CodeRain() {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const mouseX = useRef<number>(-9999);

  useEffect(() => {
    const cv: HTMLCanvasElement | null = ref.current;
    if (!cv) return;
    const c2d: CanvasRenderingContext2D | null = cv.getContext('2d');
    if (!c2d) return;
    const canvas: HTMLCanvasElement = cv;
    const ctx: CanvasRenderingContext2D = c2d;

    const GLYPHS = 'const{}=>()[];funcif<>0123abcXY/*+await async.map'.split('');
    const FONT = 14;
    let cols = 0;
    let drops: number[] = [];
    let raf = 0;

    function resize() {
      const parent = canvas.parentElement;
      const w = parent ? parent.clientWidth : window.innerWidth;
      const h = parent ? parent.scrollHeight : window.innerHeight;
      canvas.width = w;
      canvas.height = h;
      cols = Math.floor(w / FONT);
      drops = new Array(cols).fill(0).map(() => Math.random() * -50);
    }
    resize();

    function draw() {
      ctx.fillStyle = 'rgba(8,8,11,0.18)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.font = `${FONT}px var(--font-tech, monospace)`;
      for (let i = 0; i < cols; i++) {
        const x = i * FONT;
        const y = drops[i] * FONT;
        const dist = Math.abs(x - mouseX.current);
        if (dist < 90) ctx.fillStyle = 'rgba(200,255,0,0.9)';
        else if (dist < 180) ctx.fillStyle = 'rgba(103,232,249,0.7)';
        else ctx.fillStyle = 'rgba(167,139,250,0.22)';
        const g = GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
        ctx.fillText(g, x, y);
        if (y > canvas.height && Math.random() > 0.975) drops[i] = 0;
        drops[i] += 0.5;
      }
      raf = requestAnimationFrame(draw);
    }
    draw();

    function onMove(e: MouseEvent) {
      const rect = canvas.getBoundingClientRect();
      mouseX.current = e.clientX - rect.left;
    }
    window.addEventListener('resize', resize);
    window.addEventListener('mousemove', onMove);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      window.removeEventListener('mousemove', onMove);
    };
  }, []);

  return (
    <canvas
      ref={ref}
      aria-hidden
      className="pointer-events-none absolute inset-0 z-0 opacity-60"
    />
  );
}
