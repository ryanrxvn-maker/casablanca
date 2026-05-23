'use client';

import { useEffect, useRef, useState } from 'react';
import { ToolShell } from '@/components/ToolShell';
import { JobControlPanel } from '@/components/JobControlPanel';
import { useToolState } from '@/components/ToolsStateProvider';
import { CancelButton } from '@/components/CancelButton';
import {
  detectMagnificExtension,
  testMagnificSession,
  type MagnificExtensionStatus,
} from '@/lib/magnific-extension-bridge';
import {
  parseMagnificPrompts,
  runMagnificPipeline,
  type MagnificTakeInput,
  type PipelineProgress,
  type TakeState,
} from '@/lib/magnific-pipeline';
import { ToolStep } from '@/components/tool-kit';
import { IconAutoBroll } from '@/components/ToolIcons';

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

type ImageModelChoice = 'nano-banana-2' | 'nano-banana-pro';

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
  const [extStatus, setExtStatus] = useState<MagnificExtensionStatus>({
    connected: false,
  });
  const [sessionOk, setSessionOk] = useState<null | { ok: boolean; detail?: string }>(null);
  const [testingSession, setTestingSession] = useState(false);

  const [imageModel, setImageModel] = useToolState<ImageModelChoice>(
    'mgAuto:imgModel',
    'nano-banana-2',
  );
  const [globalMotion, setGlobalMotion] = useToolState<string>('mgAuto:motion', '');

  const [jobs, setJobs] = useState<Job[]>([newJob()]);
  const abortRefs = useRef<Record<string, AbortController | null>>({});

  // Detect extension on mount + handoff do clickup-pilot (preenche 1º job)
  useEffect(() => {
    let cancelled = false;
    detectMagnificExtension().then((s) => {
      if (!cancelled) setExtStatus(s);
    });
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
      patchJob(job.id, { error: 'Extension Magnific não detectada.' });
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
      const r = await runMagnificPipeline(
        {
          spaceName: job.name.trim() || `DARKO_BROLLS_${job.id}`,
          takes,
          imageModel,
          videoModel: 'kling-25',
          // SEM templateSpaceId / spaceId → cada job cria SEU PRÓPRIO space
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
        <ToolStep n={1} title="Extensão Magnific" hint="Conecta à sua conta Premium+ — gera sem gastar crédito" hue={HUE}>
        {/* Extension status */}
        {extStatus.connected ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-[12px] border border-lime/40 bg-lime/5 px-4 py-3 text-sm">
            <div className="flex items-center gap-2">
              <span className="relative flex h-2 w-2 shrink-0">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-lime opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-lime shadow-[0_0_8px_rgba(200,255,0,0.9)]" />
              </span>
              <span className="text-lime">
                Extensão DARKO LAB Magnific v{extStatus.version}
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
          <div className="rounded-[12px] border border-yellow-500/40 bg-yellow-500/10 px-4 py-3">
            <div className="flex items-start gap-2">
              <span className="text-yellow-300">⚠</span>
              <div className="flex-1 text-xs text-yellow-300/90">
                <strong className="text-yellow-300">
                  Extensão DARKO LAB Magnific não instalada
                </strong>
                . Você precisa dela pra gerar B-Rolls (usa sua conta Magnific
                Premium+ logada — NUNCA gasta créditos).
                <details className="mt-2">
                  <summary className="cursor-pointer text-yellow-300/80 hover:text-yellow-200 select-none">
                    Como instalar (passo a passo)
                  </summary>
                  <ol className="mt-2 list-decimal space-y-1 pl-5 text-yellow-300/80">
                    <li>
                      Baixa o pacote:{' '}
                      <a
                        href="/api/extension-magnific/download"
                        className="underline hover:text-lime"
                        download
                      >
                        darkolab-magnific-extension.zip
                      </a>
                    </li>
                    <li>Descompacta numa pasta</li>
                    <li>
                      Abre <code className="mono">chrome://extensions</code>
                    </li>
                    <li>Liga &quot;Modo de desenvolvedor&quot;</li>
                    <li>&quot;Carregar sem compactação&quot; → seleciona a pasta</li>
                    <li>
                      Login no <code className="mono">www.magnific.com</code> (Premium+)
                    </li>
                    <li>Volta aqui — extensão auto-detecta</li>
                  </ol>
                </details>
              </div>
            </div>
          </div>
        )}
        </ToolStep>

        <ToolStep n={2} title="Configuração global" hint="Aplica a todos os jobs deste lote" hue={HUE}>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="block">
              <span className="label-field">Modelo de imagem</span>
              <select
                value={imageModel}
                onChange={(e) => setImageModel(e.target.value as ImageModelChoice)}
                className="input-field"
                disabled={anyRunning}
              >
                <option value="nano-banana-2">Nano Banana 2 (1K, ilimitado)</option>
                <option value="nano-banana-pro">Nano Banana Pro (1K, ilimitado)</option>
              </select>
            </label>
            <label className="block">
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
          </div>
        </ToolStep>

        <ToolStep n={3} title="Jobs" hint="Cada lista de prompts dispara em seu próprio Space — rodam em série" hue={HUE}>
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
        <div className="mt-3 rounded-xl border border-line bg-bg/30 p-3">
          <div className="mb-2 flex items-center justify-between text-xs">
            <span className="text-text-muted">
              {hasSpace ? 'Space ativo (use 🧊 VER SPACE 3D)' : 'Preparando Space…'}
            </span>
            <span className="mono text-lime">
              {p.ready}/{p.total} prontos
            </span>
          </div>
          {p.message && (
            <p className="mb-2 text-xs italic text-text-muted">{p.message}</p>
          )}
          <ul className="grid gap-1.5">
            {p.takes.map((t) => (
              <TakeRow key={t.idx} t={t} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function TakeRow({ t }: { t: TakeState }) {
  let badge: { label: string; color: string } = { label: 'idle', color: 'text-text-muted' };
  let percent = 0;
  let detail = '';
  switch (t.status) {
    case 'idle':
      badge = { label: 'idle', color: 'text-text-muted' };
      break;
    case 'running':
      badge = { label: t.phase || 'run', color: 'text-cyan-300' };
      percent = t.percent;
      detail = t.message;
      break;
    case 'image-done':
      badge = { label: 'img-ok', color: 'text-cyan-400' };
      percent = 100;
      break;
    case 'video-done':
      badge = { label: 'video-ok', color: 'text-amber-400' };
      percent = 100;
      break;
    case 'downloading':
      badge = { label: 'dl', color: 'text-purple-300' };
      break;
    case 'ready':
      badge = { label: 'ready', color: 'text-lime' };
      percent = 100;
      detail = `${(t.mp4Size / 1024 / 1024).toFixed(1)} MB`;
      break;
    case 'failed':
      badge = { label: 'err', color: 'text-red-300' };
      detail = t.error;
      break;
  }
  return (
    <li className="flex items-center gap-2 text-xs">
      <span className="mono w-14 text-text-muted">take{t.idx}</span>
      <span className={`mono w-16 ${badge.color}`}>{badge.label}</span>
      <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-bg">
        <div
          className={`absolute left-0 top-0 h-full transition-all ${
            t.status === 'ready'
              ? 'bg-lime'
              : t.status === 'failed'
              ? 'bg-red-500/60'
              : 'bg-cyan-400/70'
          }`}
          style={{ width: `${Math.max(percent, t.status === 'ready' ? 100 : 0)}%` }}
        />
      </div>
      <span className="hidden md:block w-[280px] truncate text-text-muted">
        {detail}
      </span>
    </li>
  );
}
