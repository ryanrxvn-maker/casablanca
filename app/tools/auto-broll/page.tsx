'use client';

import { useEffect, useRef, useState } from 'react';
import { JobControlPanel } from '@/components/JobControlPanel';
import { useToolState } from '@/components/ToolsStateProvider';
import { CancelButton } from '@/components/CancelButton';
/**
 * Status duplo: DB (cookies cifrados) + bridge da extensão (live).
 *
 * Estados possíveis:
 *  - connected:true                       → DB ok + extensão ativa = pronto
 *  - connected:false, reason:'no-ext'     → DB ok mas extensão removida = reinstalar
 *  - connected:false, reason:'no-creds'   → DB vazio = primeira instalação
 */
type MagnificExtensionStatus =
  | { connected: true; version: string }
  | { connected: false; reason: 'no-ext' | 'no-creds' | 'error'; detail?: string };

async function detectMagnificExtension(): Promise<MagnificExtensionStatus> {
  try {
    // 1) Confere DB
    const r = await fetch('/api/auto-broll-v2/save-creds', { method: 'GET' });
    if (!r.ok) return { connected: false, reason: 'error', detail: `HTTP ${r.status}` };
    const j = (await r.json()) as {
      configured: boolean;
      magnificUserId: number | null;
      plan: string | null;
    };
    if (!j.configured) return { connected: false, reason: 'no-creds' };

    // 2) Confere extensão (bridge ping)
    const { isExtensionInstalled } = await import('@/lib/magnific-bridge');
    const extOk = await isExtensionInstalled(true); // force re-check
    if (!extOk) {
      return {
        connected: false,
        reason: 'no-ext',
        detail: 'Cookies salvos mas extensão removida ou desabilitada.',
      };
    }
    return {
      connected: true,
      version: `${j.plan || 'Magnific'} · user ${j.magnificUserId}`,
    };
  } catch (e) {
    return { connected: false, reason: 'error', detail: (e as Error).message };
  }
}

async function testMagnificSession(): Promise<{
  ok: boolean;
  detail?: string;
  endpoint?: string;
}> {
  try {
    const r = await fetch('/api/auto-broll-v2/save-creds', { method: 'GET' });
    const j = (await r.json()) as { configured?: boolean; plan?: string };
    if (!r.ok || !j.configured) {
      return { ok: false, detail: 'Cookies Magnific não configurados.' };
    }
    const { isExtensionInstalled } = await import('@/lib/magnific-bridge');
    const extOk = await isExtensionInstalled(true);
    if (!extOk) {
      return { ok: false, detail: 'Extensão removida — reinstale em /configuracoes/magnific.' };
    }
    return { ok: true, detail: `Conectado · ${j.plan || 'Magnific'}`, endpoint: 'api-v2' };
  } catch (e) {
    return { ok: false, detail: (e as Error).message };
  }
}
import {
  parseMagnificPrompts,
  type MagnificTakeInput,
  type PipelineProgress,
} from '@/lib/magnific-pipeline';
import { runMagnificPipelineV2 } from '@/lib/magnific-pipeline-v2';
import { ToolStep } from '@/components/tool-kit';
import { IconStepPlug, IconStepSliders, IconStepPipeline } from '@/components/ToolIcons';
import { TierGate } from '@/components/TierGate';
import { TakeCard } from './TakeCard';
import { AutoBrollHero } from './AutoBrollHero';

const HUE = 'rgba(240,171,252,0.45)';

/**
 * Magnific Auto B-Rolls — MULTI-JOB.
 *
 *  1) User cola 1+ listas JSON (cada lista = 1 nicho/job independente)
 *  2) Cada job dispara SEPARADO: cria seu PRÓPRIO space no Magnific
 *  3) Extension gera Nano Banana (1K 9:16) + Kling 2.5 (720p 9:16) — zero crédito
 *  4) Roda 100% em SEGUNDO PLANO (a aba Magnific NÃO abre na sua tela)
 *  5) Botão 3D por job: abre o Space DAQUELE job se quiser ver o processo
 *  6) ZIP por job só libera quando TODOS os takes geraram (auto-retry interno)
 */

/**
 * Pipeline TRAVADO em: Nano Banana Pro · 1K · 9:16 + Kling 2.5 · 720p · 9:16 · 10s.
 * Sem opções — garantia de 100% assertividade na seleção dos modelos. Qualquer
 * tentativa de mudar isso é silenciosamente ignorada pela lib (defesa profunda).
 */
const IMAGE_MODEL_FIXED = 'nano-banana-pro' as const;

type Job = {
  id: string;
  name: string;
  raw: string;
  status: 'idle' | 'running' | 'done' | 'error';
  progress: PipelineProgress | null;
  error: string | null;
  zip: { blob: Blob; name: string } | null;
};

function newJob(name = ''): Job {
  return {
    id: 'job_' + Math.random().toString(36).slice(2, 9),
    name,
    raw: '',
    status: 'idle',
    progress: null,
    error: null,
    zip: null,
  };
}

export default function AutoBrollPage() {
  return (
    <TierGate require="pro" toolName="Auto B-roll">
      <AutoBrollInner />
    </TierGate>
  );
}

function AutoBrollInner() {
  const [extStatus, setExtStatus] = useState<MagnificExtensionStatus>({
    connected: false,
    reason: 'no-creds',
  });
  const [sessionOk, setSessionOk] = useState<null | { ok: boolean; detail?: string }>(null);
  const [testingSession, setTestingSession] = useState(false);

  // imageModel TRAVADO em nano-banana-pro — sem state, sem opção
  const imageModel = IMAGE_MODEL_FIXED;
  const [globalMotion, setGlobalMotion] = useToolState<string>('mgAuto:motion', '');

  const [jobs, setJobs] = useState<Job[]>([newJob()]);
  const abortRefs = useRef<Record<string, AbortController | null>>({});

  // Detect extension on mount + handoff do clickup-pilot (preenche 1º job)
  useEffect(() => {
    let cancelled = false;
    detectMagnificExtension().then((s) => {
      if (!cancelled) setExtStatus(s);
    });
    // Re-check a cada 3s enquanto não conectado — pra detectar a extensão
    // Freepik Sync sincronizando os cookies sem precisar dar refresh.
    const poll = setInterval(() => {
      detectMagnificExtension().then((s) => {
        if (cancelled) return;
        setExtStatus((prev) => {
          // Só atualiza se mudou — evita re-render desnecessário
          if (prev.connected === s.connected) return prev;
          return s;
        });
      });
    }, 3000);
    try {
      const raw = sessionStorage.getItem('darkolab:auto-broll:handoff');
      if (raw) {
        const ho = JSON.parse(raw) as { adName?: string; copy?: string; mode?: string };
        if (ho.copy || ho.adName) {
          setJobs((prev) => {
            const j = [...prev];
            j[0] = {
              ...j[0],
              name: ho.adName || j[0].name,
              raw: ho.copy
                ? `# COPY DO AD ${ho.adName ?? ''}\n# Cole no seu Claude e gere os prompts. Cole o JSON aqui.\n\n${ho.copy}`
                : j[0].raw,
            };
            return j;
          });
        }
        sessionStorage.removeItem('darkolab:auto-broll:handoff');
      }
    } catch (e) {
      console.warn('[auto-broll] handoff parse falhou:', e);
    }
    return () => {
      cancelled = true;
      clearInterval(poll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const patchJob = (id: string, patch: Partial<Job>) =>
    setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, ...patch } : j)));

  const parseJob = (raw: string): MagnificTakeInput[] => {
    if (!raw.trim()) return [];
    return parseMagnificPrompts(raw).map((it) => ({
      ...it,
      videoPrompt: it.videoPrompt || globalMotion || '',
    }));
  };

  async function handleTestSession() {
    setTestingSession(true);
    try {
      setSessionOk(await testMagnificSession());
    } catch (e) {
      setSessionOk({ ok: false, detail: (e as Error).message });
    } finally {
      setTestingSession(false);
    }
  }

  async function runJob(job: Job) {
    if (!extStatus.connected) {
      patchJob(job.id, {
        error: 'Magnific não conectado. Configure os cookies em /configuracoes/magnific.',
      });
      return;
    }
    // Defesa anti-double-click: se já rodando OU se já existe AbortController
    // ativo pra este job, é re-clique acidental — no-op.
    if (job.status === 'running' || abortRefs.current[job.id]) {
      return;
    }
    const takes = parseJob(job.raw);
    if (!takes.length) {
      patchJob(job.id, { error: 'Sem prompts válidos nesta lista.' });
      return;
    }
    const ac = new AbortController();
    abortRefs.current[job.id] = ac;
    patchJob(job.id, { status: 'running', error: null, zip: null, progress: null });
    try {
      // SEMPRE V2 — API direta Magnific server-side. Sem extension, sem aba aberta.
      const r = await runMagnificPipelineV2(
        {
          spaceName: job.name.trim() || `DARKO_BROLLS_${job.id}`,
          takes,
          imageModel,
          videoModel: 'kling-25',
        },
        {
          signal: ac.signal,
          onProgress: (p) => patchJob(job.id, { progress: p }),
        },
      );
      // PERSISTE NO HISTÓRICO sempre que tiver pelo menos 1 sucesso —
      // mesmo batch parcial vale a pena salvar pra user re-baixar depois.
      // (Antes salvava só quando complete=true. Agora salva sempre que houver
      // zipBlob e ao menos 1 take ok.)
      if (r.zipBlob && r.zipName && r.successCount > 0) {
        try {
          const { saveZip } = await import('@/lib/zip-store');
          const key = `broll:${job.id}:${Date.now()}:zip`;
          await saveZip(key, r.zipBlob, r.zipName);
          const histKey = 'darkolab:auto-broll:history';
          const hist = (() => { try { return JSON.parse(localStorage.getItem(histKey) || '[]'); } catch { return []; } })();
          hist.unshift({
            jobId: job.id,
            spaceName: job.name || `BROLL_${job.id}`,
            zipKey: key,
            zipName: r.zipName,
            totalTakes: takes.length,
            successCount: r.successCount,
            failedCount: r.failedCount,
            takeUrls: r.takes.map((t: any) => ({
              idx: t.idx,
              status: t.status,
              videoUrl: t.videoUrl || null,
              imageUrl: t.imageUrl || null,
            })),
            createdAt: Date.now(),
          });
          localStorage.setItem(histKey, JSON.stringify(hist.slice(0, 50)));
          window.dispatchEvent(new Event('darkolab:auto-broll:history-changed'));
        } catch (e) {
          console.warn('[auto-broll] persist history falhou:', e);
        }
      }
      if (r.ok && r.complete && r.zipBlob && r.zipName) {
        patchJob(job.id, { status: 'done', zip: { blob: r.zipBlob, name: r.zipName } });
      } else if (r.complete === false) {
        const miss = (r.missingIdxs || []).join(', ');
        // Mesmo incompleto, se temos ZIP parcial deixa baixar — user reclamou
        // que perdia takes ok quando alguns falhavam.
        patchJob(job.id, {
          status: 'error',
          zip: r.zipBlob && r.zipName ? { blob: r.zipBlob, name: r.zipName } : null,
          error: `${r.successCount}/${takes.length} ok. Faltaram: ${miss || '?'}. ZIP parcial disponível abaixo + entrada criada no Histórico. Rode de novo no mesmo space pra completar os faltantes.`,
        });
      } else {
        patchJob(job.id, {
          status: 'error',
          error: `Finalizou sem MP4s (sucesso=${r.successCount}/falhas=${r.failedCount}).`,
        });
      }
    } catch (e) {
      patchJob(job.id, { status: 'error', error: (e as Error).message });
    } finally {
      abortRefs.current[job.id] = null;
    }
  }

  function cancelJob(id: string) {
    abortRefs.current[id]?.abort();
    patchJob(id, { status: 'idle' });
  }

  function downloadZip(job: Job) {
    if (!job.zip) return;
    const url = URL.createObjectURL(job.zip.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = job.zip.name;
    a.click();
    URL.revokeObjectURL(url);
  }

  function addJob() {
    setJobs((prev) => [...prev, newJob()]);
  }
  function removeJob(id: string) {
    abortRefs.current[id]?.abort();
    setJobs((prev) => (prev.length <= 1 ? prev : prev.filter((j) => j.id !== id)));
  }

  // v3.5.47 (pedido do user): SERIALIZADO — 1 JSON por vez. JSON 1 termina
  // 100% (ZIP liberado) → AÍ dispara JSON 2, e assim por diante. Roda 2
  // simultâneos causava contenção nos popups do Vue Flow (EDGE_CREATE_FAIL).
  async function runAll() {
    for (const j of jobs) {
      if (j.status === 'running') continue;
      if (parseJob(j.raw).length === 0) continue;
      // await: só passa pro próximo job quando ESTE terminar (done/error)
      await runJob(j);
    }
  }

  const anyRunning = jobs.some((j) => j.status === 'running');

  return (
    <div className="mx-auto w-full max-w-[1200px] px-5 pt-6 md:px-8 md:pt-8">
      <AutoBrollHero />
      <div className="mt-6 rounded-[20px] border border-line/60 bg-bg-soft/40 p-5 backdrop-blur-sm md:p-7">
      <div className="grid gap-5">
        {/* Controle da fila Magnific (Retomar/Pausar/Debug) — funciona
            mesmo sem ter vindo do ClickUp Pilot */}
        <JobControlPanel scopes={['magnific']} />
        <ToolStep n={1} icon={<IconStepPlug size={18} />} title="Extensão Magnific" hint="Conecta à sua conta Premium+ — gera sem gastar crédito" hue={HUE}>
        {/* Extension status */}
        {extStatus.connected ? (
          <div
            className="relative overflow-hidden rounded-[16px] border border-lime/35 bg-gradient-to-br from-lime/[0.08] via-bg-soft/40 to-bg/30 p-4 backdrop-blur-md"
            style={{
              boxShadow:
                'inset 0 1px 0 rgba(200,255,0,0.10), 0 12px 30px -14px rgba(200,255,0,0.30), 0 0 50px -22px rgba(200,255,0,0.45)',
            }}
          >
            {/* Glow decorativo no canto */}
            <div
              aria-hidden
              className="pointer-events-none absolute -right-12 -top-12 h-40 w-40 rounded-full opacity-40 blur-3xl"
              style={{ background: 'radial-gradient(circle, rgba(200,255,0,0.5), transparent 70%)' }}
            />
            <div className="relative flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] border border-lime/40 bg-lime/10">
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-lime opacity-60" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-lime shadow-[0_0_10px_rgba(200,255,0,0.95)]" />
                  </span>
                </div>
                <div className="flex flex-col gap-0.5">
                  <span
                    className="mono text-[10px] font-bold uppercase tracking-[0.18em] text-lime"
                    style={{ fontFamily: 'var(--font-tech)' }}
                  >
                    Magnific · Conectado
                  </span>
                  <span className="text-[13px] font-semibold text-white">
                    {extStatus.version}
                  </span>
                  {sessionOk?.ok ? (
                    <span
                      className="mono mt-0.5 inline-flex w-fit items-center gap-1 rounded-full bg-lime/15 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em] text-lime"
                      style={{ fontFamily: 'var(--font-tech)' }}
                    >
                      ✓ {sessionOk.detail || 'sessão validada'}
                    </span>
                  ) : sessionOk && !sessionOk.ok ? (
                    <span
                      className="mono mt-0.5 inline-flex w-fit items-center gap-1 rounded-full bg-red-500/15 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em] text-red-300"
                      style={{ fontFamily: 'var(--font-tech)' }}
                    >
                      ✗ {sessionOk.detail}
                    </span>
                  ) : null}
                </div>
              </div>
              <button
                type="button"
                onClick={handleTestSession}
                disabled={testingSession}
                className="mono inline-flex items-center gap-1.5 rounded-[10px] border border-lime/30 bg-bg-soft/60 px-3 py-2 text-[10px] font-bold uppercase tracking-[0.14em] text-text-muted backdrop-blur transition-all hover:border-lime hover:bg-lime/5 hover:text-lime active:translate-y-px disabled:opacity-50"
                style={{ fontFamily: 'var(--font-tech)' }}
              >
                {testingSession ? (
                  <>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="animate-spin">
                      <circle cx="12" cy="12" r="10" strokeDasharray="32 32" />
                    </svg>
                    Testando
                  </>
                ) : (
                  <>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path d="M9 12l2 2 4-4M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    Testar sessão
                  </>
                )}
              </button>
            </div>
          </div>
        ) : (
          <div
            className={
              extStatus.reason === 'no-ext'
                ? 'rounded-[12px] border-2 border-amber-400/50 bg-amber-400/[0.06] px-4 py-4'
                : 'rounded-[12px] border-2 border-lime/40 bg-lime/[0.05] px-4 py-4'
            }
          >
            <div className="flex items-start gap-3">
              <span className="text-2xl leading-none">
                {extStatus.reason === 'no-ext' ? '⚠️' : '🔌'}
              </span>
              <div className="flex-1">
                <div className="mb-1 flex items-center gap-2">
                  <strong
                    className={
                      extStatus.reason === 'no-ext'
                        ? 'text-sm text-amber-300'
                        : 'text-sm text-lime'
                    }
                  >
                    {extStatus.reason === 'no-ext'
                      ? 'Extensão removida ou desabilitada'
                      : 'Magnific não conectado'}
                  </strong>
                  <span
                    className={
                      extStatus.reason === 'no-ext'
                        ? 'rounded-full bg-amber-400 px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest text-black'
                        : 'rounded-full bg-lime px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest text-black'
                    }
                  >
                    {extStatus.reason === 'no-ext' ? 'reinstalar' : '1 clique'}
                  </span>
                </div>
                <p className="mb-3 text-[12px] text-text-muted">
                  {extStatus.reason === 'no-ext'
                    ? 'Seus cookies ainda estão salvos no banco, mas a extensão não responde. Reinstala pra voltar a disparar.'
                    : 'Instala a extensão Chrome (1x) → loga em Freepik → conectado pra sempre. Auto-sync invisível, zero copy/paste.'}
                </p>
                <div className="flex flex-wrap gap-2">
                  <a
                    href="/api/extension-freepik-sync/download"
                    download
                    className="btn-primary inline-flex items-center gap-2"
                  >
                    ⬇ Baixar Extensão
                  </a>
                  <a
                    href="/configuracoes/magnific"
                    className="rounded-[12px] border border-line px-4 py-2 text-xs text-text-muted transition hover:border-lime hover:text-lime"
                  >
                    Passo a passo →
                  </a>
                </div>
                <details className="mt-3">
                  <summary className="cursor-pointer text-[11px] text-text-muted hover:text-white select-none">
                    Instalação manual (avançado)
                  </summary>
                  <ol className="mt-2 list-decimal space-y-1 pl-5 text-[11px] text-text-muted">
                    <li>Baixa o ZIP no botão acima</li>
                    <li>Descompacta numa pasta qualquer</li>
                    <li>
                      Abre{' '}
                      <code className="mono">chrome://extensions</code>
                    </li>
                    <li>Ativa &ldquo;Modo de desenvolvedor&rdquo;</li>
                    <li>
                      Clica &ldquo;Carregar sem compactação&rdquo; → escolhe a pasta
                    </li>
                    <li>
                      Loga em{' '}
                      <a
                        href="https://www.magnific.com"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-lime underline"
                      >
                        magnific.com
                      </a>{' '}
                      (Freepik Premium+)
                    </li>
                    <li>Volta aqui — status auto-atualiza em ~3s</li>
                  </ol>
                </details>
              </div>
            </div>
          </div>
        )}
        </ToolStep>

        <ToolStep n={2} icon={<IconStepSliders size={18} />} title="Configuração" hint="Parâmetros travados — máxima qualidade, zero risco de seleção errada" hue={HUE}>
          {/* Setup TRAVADO. Sem opções de mudar modelo/aspect/quality —
              a extension SEMPRE escolhe exatamente: Nano Banana Pro 1K 9:16
              + Kling 2.5 720p 9:16 10s. Zero chance de clicar errado. */}
          <div className="grid gap-3 md:grid-cols-2">
            <ModelCard
              kind="image"
              label="Imagem"
              model="Nano Banana Pro"
              specs={['1K', '9:16']}
              icon="🍌"
              tint="violet"
            />
            <ModelCard
              kind="video"
              label="Vídeo"
              model="Kling 2.5"
              specs={['720p', '9:16', '10s']}
              icon="🎬"
              tint="cyan"
            />
          </div>
          <label className="mt-3 block">
            <span className="label-field">Motion default (opcional, Kling 2.5)</span>
            <input
              type="text"
              value={globalMotion}
              onChange={(e) => setGlobalMotion(e.target.value)}
              placeholder="Ex: slow camera push-in, soft handheld motion"
              className="input-field"
              disabled={anyRunning}
            />
          </label>
        </ToolStep>

        <ToolStep n={3} icon={<IconStepPipeline size={18} />} title="Jobs" hint="Cada lista de prompts dispara em seu próprio Space — rodam em série" hue={HUE}>
        {/* JOBS — cada lista JSON dispara separada, com seu próprio Space */}
        <div className="grid gap-4">
          {jobs.map((job, idx) => (
            <JobCard
              key={job.id}
              job={job}
              index={idx}
              total={jobs.length}
              extConnected={extStatus.connected}
              takesCount={parseJob(job.raw).length}
              onName={(v) => patchJob(job.id, { name: v })}
              onRaw={(v) => patchJob(job.id, { raw: v })}
              onRun={() => runJob(job)}
              onCancel={() => cancelJob(job.id)}
              onDebug={() => {
                if (!confirm(`DEBUG: reiniciar "${job.name || 'job ' + (idx + 1)}" do ZERO?\n\nAborta o atual e recria num space novo.`)) return;
                abortRefs.current[job.id]?.abort();
                setTimeout(() => runJob(job), 300);
              }}
              onRemove={() => removeJob(job.id)}
              onDownload={() => downloadZip(job)}
            />
          ))}
        </div>

          <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={addJob}
              disabled={anyRunning}
              className="rounded-[8px] border border-line-strong bg-bg-soft px-4 py-2 text-sm font-semibold text-text-muted transition hover:border-violet hover:text-violet disabled:opacity-50"
            >
              + Adicionar outro JSON (novo job/space)
            </button>
            {jobs.length > 1 && (
              <button
                type="button"
                onClick={runAll}
                disabled={!extStatus.connected || anyRunning}
                className="btn-primary"
              >
                Disparar TODOS os {jobs.length} jobs
              </button>
            )}
          </div>
        </ToolStep>
        <BrollHistorySection />
      </div>
      </div>
    </div>
  );
}

function BrollHistorySection() {
  const [hist, setHist] = useState<Array<{
    jobId: string;
    spaceName: string;
    zipKey: string;
    zipName: string;
    totalTakes: number;
    successCount: number;
    failedCount: number;
    takeUrls: Array<{ idx: number; status: string; videoUrl: string | null; imageUrl: string | null }>;
    createdAt: number;
  }>>([]);
  const [loading, setLoading] = useState<string | null>(null);

  function load() {
    try {
      const raw = localStorage.getItem('darkolab:auto-broll:history');
      setHist(raw ? JSON.parse(raw) : []);
    } catch {
      setHist([]);
    }
  }

  useEffect(() => {
    load();
    const h = () => load();
    window.addEventListener('darkolab:auto-broll:history-changed', h);
    return () => window.removeEventListener('darkolab:auto-broll:history-changed', h);
  }, []);

  async function redownload(item: typeof hist[number]) {
    setLoading(item.zipKey);
    try {
      const { loadZip } = await import('@/lib/zip-store');
      const z = await loadZip(item.zipKey);
      if (z) {
        const a = document.createElement('a');
        a.href = z.blobUrl;
        a.download = z.filename;
        a.click();
        setTimeout(() => URL.revokeObjectURL(z.blobUrl), 5000);
      } else {
        // ZIP perdido — tenta reconstruir baixando URLs Magnific
        if (!confirm('ZIP não está mais no cache local. Reconstruir baixando dos URLs Magnific?\n(Pode levar 30-60s.)')) return;
        const JSZip = (await import('jszip')).default;
        const zip = new JSZip();
        let n = 0;
        for (const t of item.takeUrls) {
          if (!t.videoUrl) continue;
          try {
            const r = await fetch(t.videoUrl);
            if (!r.ok) continue;
            const ab = await r.arrayBuffer();
            zip.file(`take_${String(t.idx).padStart(2, '0')}.mp4`, ab);
            n++;
          } catch {}
        }
        if (n === 0) { alert('Nenhum vídeo Magnific acessível mais. URLs podem ter expirado.'); return; }
        const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 1 } });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = item.zipName;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
      }
    } catch (e) {
      alert('Erro: ' + ((e as Error)?.message || String(e)));
    } finally {
      setLoading(null);
    }
  }

  async function remove(item: typeof hist[number]) {
    if (!confirm(`Remover "${item.spaceName}" do histórico?`)) return;
    try {
      const { deleteZip } = await import('@/lib/zip-store');
      await deleteZip(item.zipKey);
    } catch {}
    const next = hist.filter((h) => h.zipKey !== item.zipKey);
    localStorage.setItem('darkolab:auto-broll:history', JSON.stringify(next));
    setHist(next);
  }

  return (
    <ToolStep
      n={4}
      icon={<IconStepPipeline size={18} />}
      title={hist.length === 0 ? 'Histórico' : `Histórico (${hist.length})`}
      hint="Re-baixe ZIPs gerados anteriormente, mesmo após reload"
      hue={HUE}
    >
      {hist.length === 0 ? (
        <div className="rounded-[12px] border border-line/40 bg-bg-soft/30 p-4 text-center">
          <div className="mono text-[10px] uppercase tracking-widest text-text-muted mb-1">
            Sem batches finalizados ainda
          </div>
          <div className="text-[11px] text-text-dim">
            Quando um job completar, ele será salvo aqui automaticamente.
            <br />
            Você poderá re-baixar o ZIP mesmo após reload, ou reconstruir a partir das URLs Magnific.
          </div>
        </div>
      ) : (
      <div className="grid gap-2">
        {hist.map((item) => {
          const ts = new Date(item.createdAt);
          const dateStr = ts.toLocaleDateString('pt-BR') + ' ' + ts.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
          return (
            <div
              key={item.zipKey}
              className="flex items-center gap-3 rounded-[12px] border border-line/60 bg-bg-soft/40 px-4 py-3 backdrop-blur-sm hover:border-violet/40 transition"
            >
              <div className="flex-1 min-w-0">
                <div className="mono text-[11px] uppercase tracking-widest text-violet truncate">{item.spaceName}</div>
                <div className="mt-0.5 flex flex-wrap gap-2 text-[10px] text-text-muted">
                  <span>{dateStr}</span>
                  <span>·</span>
                  <span className="text-lime">{item.successCount}/{item.totalTakes} ok</span>
                  {item.failedCount > 0 && (<><span>·</span><span className="text-yellow-300">{item.failedCount} falhas</span></>)}
                </div>
              </div>
              <button
                type="button"
                onClick={() => redownload(item)}
                disabled={loading === item.zipKey}
                className="rounded-[8px] border border-lime/40 bg-lime/10 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-widest text-lime hover:bg-lime/20 disabled:opacity-50"
                title="Baixar ZIP novamente"
              >
                {loading === item.zipKey ? '...' : '↓ Baixar'}
              </button>
              <button
                type="button"
                onClick={() => remove(item)}
                className="rounded-[8px] border border-text-muted/30 bg-bg/40 px-2 py-1.5 text-[11px] text-text-muted hover:border-red-500/40 hover:text-red-300"
                title="Remover do histórico"
              >
                ×
              </button>
            </div>
          );
        })}
      </div>
      )}
    </ToolStep>
  );
}

function JobCard({
  job,
  index,
  total,
  extConnected,
  takesCount,
  onName,
  onRaw,
  onRun,
  onCancel,
  onDebug,
  onRemove,
  onDownload,
}: {
  job: Job;
  index: number;
  total: number;
  extConnected: boolean;
  takesCount: number;
  onName: (v: string) => void;
  onRaw: (v: string) => void;
  onRun: () => void;
  onCancel: () => void;
  onDebug: () => void;
  onRemove: () => void;
  onDownload: () => void;
}) {
  const running = job.status === 'running';
  const p = job.progress;

  return (
    <div
      className="relative overflow-hidden rounded-[18px] border border-line bg-gradient-to-br from-bg-soft/60 via-bg/40 to-bg-soft/30 p-5 backdrop-blur-md transition-all duration-500 hover:border-violet/40"
      style={{
        boxShadow:
          'inset 0 1px 0 rgba(255,255,255,0.04), 0 16px 36px -18px rgba(0,0,0,0.6)',
      }}
    >
      {/* Decorative corner glow */}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-16 -top-16 h-44 w-44 rounded-full opacity-20 blur-3xl"
        style={{ background: 'radial-gradient(circle, rgba(167,139,250,0.6), transparent 70%)' }}
      />

      <div className="relative mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <div
            className="flex h-9 w-9 items-center justify-center rounded-[10px] border border-violet/40 bg-violet/10"
            style={{ boxShadow: '0 0 16px -4px rgba(167,139,250,0.45)' }}
          >
            <span className="text-[16px] font-extrabold text-violet" style={{ fontFamily: 'var(--font-tech)' }}>
              {String(index + 1).padStart(2, '0')}
            </span>
          </div>
          <div className="flex flex-col gap-0.5">
            <span
              className="mono text-[10px] font-bold uppercase tracking-[0.18em] text-lime"
              style={{ fontFamily: 'var(--font-tech)' }}
            >
              Job {index + 1} <span className="text-text-dim">/ {total}</span>
            </span>
            <span className="text-[11px] text-text-muted">
              {running ? (
                <span className="inline-flex items-center gap-1">
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-violet opacity-60" />
                    <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-violet" />
                  </span>
                  Rodando em segundo plano
                </span>
              ) : (
                <span>Pronto pra disparar</span>
              )}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {total > 1 && !running && (
            <button
              type="button"
              onClick={onRemove}
              className="rounded-md border border-line px-2 py-1 text-[11px] text-text-muted transition hover:border-red-400 hover:text-red-300"
              title="Remover este job"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      <div className="relative grid gap-4">
        {/* Nome do AD */}
        <label className="block">
          <span
            className="mono mb-1.5 block text-[10px] font-bold uppercase tracking-[0.18em] text-text-muted"
            style={{ fontFamily: 'var(--font-tech)' }}
          >
            Código do AD / Nome do Space
          </span>
          <input
            type="text"
            value={job.name}
            onChange={(e) => onName(e.target.value)}
            placeholder={`Ex: AD15VN-PRPB06 (job ${index + 1})`}
            className="w-full rounded-[12px] border border-line bg-bg/60 px-4 py-3 text-sm font-medium text-white placeholder:text-text-dim focus:border-violet/60 focus:outline-none focus:ring-2 focus:ring-violet/20 disabled:opacity-50"
            disabled={running}
          />
        </label>

        {/* JSON code editor */}
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <span
              className="mono text-[10px] font-bold uppercase tracking-[0.18em] text-text-muted"
              style={{ fontFamily: 'var(--font-tech)' }}
            >
              Prompts do job
              <span className="mx-2 text-text-dim">·</span>
              <span className="text-violet">JSON do Claude</span> ou texto numerado
            </span>
            {takesCount > 0 && (
              <span
                className="mono inline-flex items-center gap-1.5 rounded-full border border-lime/40 bg-lime/10 px-2.5 py-0.5 text-[9.5px] font-bold uppercase tracking-[0.14em] text-lime"
                style={{ fontFamily: 'var(--font-tech)' }}
              >
                <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor">
                  <circle cx="12" cy="12" r="5" />
                </svg>
                {takesCount} take{takesCount === 1 ? '' : 's'} detectados
              </span>
            )}
          </div>
          <div
            className="relative overflow-hidden rounded-[12px] border border-line bg-black/60 transition-colors focus-within:border-violet/60"
            style={{
              boxShadow:
                'inset 0 1px 0 rgba(255,255,255,0.04), inset 0 0 0 1px rgba(0,0,0,0.4)',
            }}
          >
            {/* Code-editor strip */}
            <div className="flex items-center gap-1.5 border-b border-line bg-bg-soft/60 px-3 py-1.5">
              <span className="h-2 w-2 rounded-full bg-red-500/60" />
              <span className="h-2 w-2 rounded-full bg-amber-400/60" />
              <span className="h-2 w-2 rounded-full bg-lime/60" />
              <span
                className="ml-2 text-[10px] text-text-dim"
                style={{ fontFamily: 'var(--font-tech)' }}
              >
                prompts.json
              </span>
              <span className="ml-auto text-[9px] text-text-dim">
                {job.raw.length} chars
              </span>
            </div>
            <textarea
              value={job.raw}
              onChange={(e) => onRaw(e.target.value)}
              placeholder={`[\n  { "imagePrompt": "...", "videoPrompt": "..." },\n  ...\n]`}
              rows={8}
              className="block w-full resize-y bg-transparent px-4 py-3 font-mono text-[11.5px] leading-relaxed text-white placeholder:text-text-dim focus:outline-none disabled:opacity-50"
              disabled={running}
              spellCheck={false}
            />
          </div>
        </div>
      </div>

      {job.error && (
        <div
          role="alert"
          className="mt-3 flex items-start gap-2 rounded-[12px] border border-red-500/40 bg-red-500/10 px-4 py-3 text-xs text-red-300 shadow-[0_0_22px_-8px_rgba(239,68,68,0.45)]"
        >
          <span className="mt-0.5 text-base">⚠</span>
          <span className="flex-1 leading-relaxed">{job.error}</span>
        </div>
      )}

      {/* ACTIONS BAR — hero CTA + secondary */}
      <div className="relative mt-4 flex flex-wrap items-center gap-3">
        {running ? (
          <CancelButton onClick={onCancel} label="Cancelar este job" />
        ) : (
          <button
            type="button"
            onClick={onRun}
            disabled={!extConnected || takesCount === 0}
            className="group relative inline-flex items-center gap-2 overflow-hidden rounded-full bg-gradient-to-r from-violet via-violet-deep to-cyan-400 px-6 py-3 text-[13px] font-extrabold uppercase tracking-[0.12em] text-white shadow-[0_12px_30px_-10px_rgba(109,78,232,0.65),inset_0_1px_0_rgba(255,255,255,0.3)] transition-all duration-300 hover:scale-[1.03] hover:shadow-[0_18px_42px_-10px_rgba(109,78,232,0.85)] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:scale-100"
            style={{ fontFamily: 'var(--font-tech)' }}
          >
            <span className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/30 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5v14l11-7z" />
            </svg>
            <span className="relative">
              Disparar {takesCount || 0} take{takesCount === 1 ? '' : 's'}
            </span>
          </button>
        )}
        <button
          type="button"
          onClick={onDebug}
          disabled={!extConnected || takesCount === 0}
          className="mono inline-flex items-center gap-1.5 rounded-[10px] border border-fuchsia-500/50 bg-fuchsia-500/10 px-3 py-2 text-[10px] font-bold uppercase tracking-[0.14em] text-fuchsia-200 transition-all hover:bg-fuchsia-500/20 active:translate-y-px disabled:opacity-40"
          title="Aborta o atual e recria do ZERO num space novo"
          style={{ fontFamily: 'var(--font-tech)' }}
        >
          🐞 Debug
        </button>
        {job.zip && (
          <button
            type="button"
            onClick={onDownload}
            className="mono inline-flex items-center gap-1.5 rounded-[10px] border border-lime/50 bg-lime/10 px-3 py-2 text-[10px] font-bold uppercase tracking-[0.14em] text-lime transition-all hover:bg-lime/20 active:translate-y-px"
            style={{ fontFamily: 'var(--font-tech)' }}
          >
            ⬇ Baixar ZIP ({(job.zip.blob.size / 1024 / 1024).toFixed(1)} MB)
          </button>
        )}
      </div>

      {p && (
        <div className="mt-4 space-y-4">
          {/* HERO BAR — progresso global + ações */}
          <div className="relative overflow-hidden rounded-[14px] border border-line bg-gradient-to-r from-bg-soft/60 via-bg/40 to-bg-soft/60 p-4 backdrop-blur-md">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <span
                    className="mono text-[10px] font-bold uppercase tracking-[0.18em] text-text-muted"
                    style={{ fontFamily: 'var(--font-tech)' }}
                  >
                    Pipeline
                  </span>
                  <span
                    className="text-[10px] font-bold uppercase tracking-[0.14em] text-lime"
                    style={{ fontFamily: 'var(--font-tech)' }}
                  >
                    {p.ready}/{p.total} prontos
                  </span>
                  {p.phase && (
                    <span
                      className="mono rounded-full border border-violet/40 bg-violet/10 px-2 py-0.5 text-[9px] uppercase tracking-widest text-violet"
                      style={{ fontFamily: 'var(--font-tech)' }}
                    >
                      {p.phase}
                    </span>
                  )}
                </div>
                {p.message && (
                  <p className="text-[11px] italic text-text-muted">{p.message}</p>
                )}
              </div>
              <div className="flex items-center gap-2">
                {job.zip ? (
                  <button
                    type="button"
                    onClick={onDownload}
                    className="group relative inline-flex items-center gap-2 overflow-hidden rounded-full border border-lime/60 bg-lime/95 px-4 py-2 text-[11px] font-bold uppercase tracking-[0.14em] text-black shadow-[0_8px_22px_-8px_rgba(200,255,0,0.55)] transition-all hover:scale-[1.03]"
                    style={{ fontFamily: 'var(--font-tech)' }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path d="M12 3v12m0 0l-4-4m4 4l4-4M5 21h14" />
                    </svg>
                    Baixar ZIP ({(job.zip.blob.size / 1024 / 1024).toFixed(1)} MB)
                  </button>
                ) : (
                  <span
                    className="mono rounded-full border border-line bg-bg/60 px-3 py-1.5 text-[10px] uppercase tracking-widest text-text-muted"
                    style={{ fontFamily: 'var(--font-tech)' }}
                  >
                    ZIP final sai quando todos terminam
                  </span>
                )}
              </div>
            </div>
            {/* Progress bar global */}
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-line/40">
              <div
                className="h-full bg-gradient-to-r from-violet via-violet-deep to-lime transition-all duration-700"
                style={{
                  width: `${Math.round((p.ready / Math.max(p.total, 1)) * 100)}%`,
                  boxShadow: '0 0 14px rgba(167,139,250,0.6)',
                }}
              />
            </div>
          </div>

          {/* GRID DE TAKES */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
            {p.takes.map((t, i) => (
              <TakeCard
                key={t.idx}
                take={t}
                position={i + 1}
                total={p.takes.length}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// TakeRow legado removido — substituído pelo TakeCard grid 3D.

/* ────────────────────────────────────────────────────────────────────
 * ModelCard — card 3D mostrando o modelo travado (Nano Banana / Kling)
 * com hover lift + glow tinted + animação border shine
 * ──────────────────────────────────────────────────────────────────── */
function ModelCard({
  kind,
  label,
  model,
  specs,
  icon,
  tint,
}: {
  kind: 'image' | 'video';
  label: string;
  model: string;
  specs: string[];
  icon: string;
  tint: 'violet' | 'cyan';
}) {
  const tintCls =
    tint === 'violet'
      ? {
          border: 'border-violet/30 hover:border-violet/65',
          glow: 'rgba(167,139,250,0.45)',
          accent: 'text-violet',
          bg: 'from-violet/[0.08] via-transparent to-bg/30',
        }
      : {
          border: 'border-cyan-400/30 hover:border-cyan-400/65',
          glow: 'rgba(34,211,238,0.45)',
          accent: 'text-cyan-300',
          bg: 'from-cyan-400/[0.08] via-transparent to-bg/30',
        };
  return (
    <div
      className={`group relative overflow-hidden rounded-[16px] border ${tintCls.border} bg-gradient-to-br ${tintCls.bg} p-4 transition-all duration-500 hover:-translate-y-1`}
      style={{
        boxShadow: `inset 0 1px 0 rgba(255,255,255,0.05), 0 14px 32px -16px ${tintCls.glow}, 0 0 0 0 ${tintCls.glow}`,
        transformStyle: 'preserve-3d',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.boxShadow = `inset 0 1px 0 rgba(255,255,255,0.08), 0 24px 48px -16px ${tintCls.glow}, 0 0 60px -12px ${tintCls.glow}`;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.boxShadow = `inset 0 1px 0 rgba(255,255,255,0.05), 0 14px 32px -16px ${tintCls.glow}, 0 0 0 0 ${tintCls.glow}`;
      }}
    >
      {/* Border shine animation */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-[16px] opacity-0 transition-opacity duration-500 group-hover:opacity-100"
        style={{
          background:
            'linear-gradient(120deg, transparent 30%, rgba(255,255,255,0.06) 50%, transparent 70%)',
          backgroundSize: '200% 100%',
          animation: 'modelShine 2.5s ease-in-out infinite',
        }}
      />
      <div className="relative flex items-start gap-3">
        <div
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] border ${tintCls.border} bg-bg-soft/50 text-xl transition-transform duration-500 group-hover:scale-110 group-hover:rotate-[-6deg]`}
        >
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span
              className={`mono text-[9px] font-bold uppercase tracking-[0.22em] ${tintCls.accent}`}
              style={{ fontFamily: 'var(--font-tech)' }}
            >
              {label}
            </span>
            <span
              className="mono inline-flex items-center gap-1 rounded-full border border-lime/45 bg-lime/10 px-1.5 py-0 text-[8.5px] font-bold uppercase tracking-[0.14em] text-lime"
              style={{ fontFamily: 'var(--font-tech)' }}
            >
              ∞ unlimited
            </span>
          </div>
          <div
            className="mt-0.5 truncate text-[16px] font-extrabold text-white"
            style={{ fontFamily: 'var(--font-tech)', letterSpacing: '0.01em' }}
          >
            {model}
          </div>
          <div className="mt-1 flex flex-wrap gap-1">
            {specs.map((s) => (
              <span
                key={s}
                className="mono rounded border border-line/80 bg-bg/40 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-widest text-text-muted"
                style={{ fontFamily: 'var(--font-tech)' }}
              >
                {s}
              </span>
            ))}
          </div>
          <div className="mono mt-2 text-[10px] text-text-dim" style={{ fontFamily: 'var(--font-tech)' }}>
            Zero crédito · qualidade trava
          </div>
        </div>
      </div>
      <style jsx>{`
        @keyframes modelShine {
          0% { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
      `}</style>
    </div>
  );
}

