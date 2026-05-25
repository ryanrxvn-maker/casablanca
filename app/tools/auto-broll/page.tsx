'use client';

import { useEffect, useRef, useState } from 'react';
import { ToolShell } from '@/components/ToolShell';
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
import { IconAutoBroll } from '@/components/ToolIcons';
import { TierGate } from '@/components/TierGate';
import { TakeCard } from './TakeCard';

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
      if (r.ok && r.complete && r.zipBlob && r.zipName) {
        patchJob(job.id, { status: 'done', zip: { blob: r.zipBlob, name: r.zipName } });
      } else if (r.complete === false) {
        const miss = (r.missingIdxs || []).join(', ');
        patchJob(job.id, {
          status: 'error',
          error: `Ainda faltou take(s) ${miss || '?'} (${r.successCount}/${takes.length}) mesmo após auto-retry. Rode de novo — reaproveita o mesmo space e completa só os faltantes.`,
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

  function openSpace3D(job: Job) {
    const u = job.progress?.spaceUrl;
    if (u) window.open(u, '_blank', 'noopener,noreferrer');
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
    <ToolShell
      title="Auto B-roll"
      eyebrow="VÍDEO COM IA"
      description="Cola a sua lista, deixa rodando. Os B-rolls saem prontos enquanto você faz outra coisa."
      hue={HUE}
      icon={<IconAutoBroll size={56} />}
    >
      <div className="grid gap-5">
        {/* Controle da fila Magnific (Retomar/Pausar/Debug) — funciona
            mesmo sem ter vindo do ClickUp Pilot */}
        <JobControlPanel scopes={['magnific']} />
        <ToolStep n={1} icon={<IconStepPlug size={18} />} title="Extensão Magnific" hint="Conecta à sua conta Premium+ — gera sem gastar crédito" hue={HUE}>
        {/* Extension status */}
        {extStatus.connected ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-[12px] border border-lime/40 bg-lime/5 px-4 py-3 text-sm">
            <div className="flex items-center gap-2">
              <span className="relative flex h-2 w-2 shrink-0">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-lime opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-lime shadow-[0_0_8px_rgba(200,255,0,0.9)]" />
              </span>
              <span className="text-lime">
                Magnific conectado · {extStatus.version}
              </span>
              {sessionOk?.ok ? (
                <span className="mono ml-2 rounded-full bg-lime/15 px-2 py-0.5 text-[10px] uppercase text-lime">
                  ✓ {sessionOk.detail || 'sessão OK'}
                </span>
              ) : sessionOk && !sessionOk.ok ? (
                <span className="mono ml-2 rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] uppercase text-red-300">
                  ✗ {sessionOk.detail}
                </span>
              ) : null}
            </div>
            <button
              type="button"
              onClick={handleTestSession}
              disabled={testingSession}
              className="rounded-md border border-line-strong bg-bg-soft px-3 py-1 text-[11px] uppercase tracking-widest text-text-muted transition hover:border-lime hover:text-lime disabled:opacity-50"
            >
              {testingSession ? 'Testando...' : 'Testar sessão Magnific'}
            </button>
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
          <div className="grid gap-2.5 md:grid-cols-2">
            <div
              className="rounded-[14px] border border-violet/35 bg-violet/[0.06] px-4 py-3"
              style={{ boxShadow: '0 0 18px -6px rgba(167,139,250,0.45), inset 0 1px 0 rgba(255,255,255,0.04)' }}
            >
              <div className="mono mb-1 text-[10px] uppercase tracking-[0.22em] text-violet/90" style={{ fontFamily: 'var(--font-tech)' }}>
                IMAGEM
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[14px] font-bold text-white" style={{ fontFamily: 'var(--font-tech)' }}>Nano Banana Pro</span>
                <span className="mono rounded-full border border-lime/45 bg-lime/10 px-1.5 py-0 text-[9px] font-bold uppercase tracking-[0.16em] text-lime">∞ 1K · 9:16</span>
              </div>
              <div className="mono mt-0.5 text-[10.5px] text-text-muted">Ilimitado — zero crédito</div>
            </div>
            <div
              className="rounded-[14px] border border-cyan-400/35 bg-cyan-400/[0.06] px-4 py-3"
              style={{ boxShadow: '0 0 18px -6px rgba(34,211,238,0.45), inset 0 1px 0 rgba(255,255,255,0.04)' }}
            >
              <div className="mono mb-1 text-[10px] uppercase tracking-[0.22em] text-cyan-300" style={{ fontFamily: 'var(--font-tech)' }}>
                VÍDEO
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[14px] font-bold text-white" style={{ fontFamily: 'var(--font-tech)' }}>Kling 2.5</span>
                <span className="mono rounded-full border border-lime/45 bg-lime/10 px-1.5 py-0 text-[9px] font-bold uppercase tracking-[0.16em] text-lime">∞ 720p · 9:16 · 10s</span>
              </div>
              <div className="mono mt-0.5 text-[10.5px] text-text-muted">Ilimitado — zero crédito</div>
            </div>
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
              onOpenSpace={() => openSpace3D(job)}
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
      </div>
    </ToolShell>
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
  onOpenSpace,
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
  onOpenSpace: () => void;
}) {
  const running = job.status === 'running';
  const p = job.progress;
  const hasSpace = !!p?.spaceUrl;

  return (
    <div className="rounded-[14px] border border-line bg-bg-soft/40 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <span className="mono text-xs font-bold uppercase tracking-widest text-lime">
          JOB {index + 1}/{total}
        </span>
        <div className="flex items-center gap-2">
          {/* BOTÃO 3D — abre o Space DESTE job (só se quiser ver o processo) */}
          <button
            type="button"
            onClick={onOpenSpace}
            disabled={!hasSpace}
            title={
              hasSpace
                ? 'Abre o Space deste job no Magnific (nova aba). O processo já roda em segundo plano — isto é só pra você acompanhar se quiser.'
                : 'O Space aparece aqui assim que o job começar'
            }
            className={
              'group relative inline-flex items-center gap-1.5 rounded-[10px] px-3 py-1.5 text-xs font-bold transition-all ' +
              (hasSpace
                ? 'border border-cyan-300/60 bg-gradient-to-b from-cyan-400/25 to-cyan-600/10 text-cyan-200 shadow-[0_3px_0_rgba(34,211,238,0.35),0_6px_14px_rgba(34,211,238,0.25)] hover:translate-y-[1px] hover:shadow-[0_2px_0_rgba(34,211,238,0.35),0_4px_10px_rgba(34,211,238,0.25)] active:translate-y-[3px] active:shadow-none'
                : 'cursor-not-allowed border border-line bg-bg/40 text-text-muted opacity-50')
            }
          >
            🧊 VER SPACE 3D
          </button>
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

      <div className="grid gap-3">
        <label className="block">
          <span className="label-field">Código do AD / Nome do Space</span>
          <input
            type="text"
            value={job.name}
            onChange={(e) => onName(e.target.value)}
            placeholder={`Ex: AD15VN-PRPB06 (job ${index + 1})`}
            className="input-field"
            disabled={running}
          />
        </label>

        <label className="block">
          <span className="label-field">
            Prompts deste job (JSON do Claude ou texto numerado)
          </span>
          <textarea
            value={job.raw}
            onChange={(e) => onRaw(e.target.value)}
            placeholder={`[ { "imagePrompt": "...", "videoPrompt": "..." }, ... ]`}
            rows={8}
            className="input-field resize-y font-mono text-xs"
            disabled={running}
          />
          <div className="mt-1 text-xs text-text-muted">
            Detectados: <span className="mono text-lime">{takesCount}</span> takes
          </div>
        </label>
      </div>

      {job.error && (
        <div
          role="alert"
          className="mt-3 rounded-[10px] border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300"
        >
          {job.error}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-3">
        {running ? (
          <CancelButton onClick={onCancel} label="Cancelar este job" />
        ) : (
          <button
            type="button"
            onClick={onRun}
            disabled={!extConnected || takesCount === 0}
            className="btn-primary"
          >
            Disparar {takesCount || 0} take{takesCount === 1 ? '' : 's'}
          </button>
        )}
        <button
          type="button"
          onClick={onDebug}
          disabled={!extConnected || takesCount === 0}
          className="mono rounded-md border border-fuchsia-500/50 bg-fuchsia-500/10 px-3 py-1.5 text-[11px] uppercase tracking-widest text-fuchsia-200 transition hover:bg-fuchsia-500/20 disabled:opacity-40"
          title="DEBUG (reserva p/ bugs/loop): aborta o atual e recria do ZERO num space novo"
        >
          🐞 Debug
        </button>
        {job.zip && (
          <button type="button" onClick={onDownload} className="btn-secondary">
            Baixar {job.zip.name} ({(job.zip.blob.size / 1024 / 1024).toFixed(1)} MB)
          </button>
        )}
        {running && (
          <span className="mono rounded-full border border-line bg-bg/60 px-2 py-0.5 text-[10px] uppercase tracking-wider text-text-muted">
            rodando em 2º plano
          </span>
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
