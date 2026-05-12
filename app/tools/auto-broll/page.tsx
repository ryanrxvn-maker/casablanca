'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ToolShell } from '@/components/ToolShell';
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

/**
 * Magnific Auto B-Rolls (substitui o Auto B-Roll antigo via Claude API).
 *
 * Fluxo:
 *  1) User cola prompts (JSON do Claude DO PROPRIO USER, ou texto livre)
 *  2) Parser local detecta N takes (sem chamar Claude API daqui)
 *  3) Extension "DARKO LAB Magnific Auto" dispara:
 *     - Nano Banana 2/Pro p/ cada imagem (12 simultaneas)
 *     - Kling 2.5 p/ cada video (6 simultaneos)
 *  4) Pipeline baixa MP4s e empacota ZIP com take1.mp4...takeN.mp4 + manifest.json
 *
 * Plano Premium+ obrigatorio no Magnific (Kling 2.5 720p + Nano Banana 1K
 * ilimitados nao consomem creditos).
 */

type ImageModelChoice = 'nano-banana-2' | 'nano-banana-pro';

export default function AutoBrollPage() {
  const [extStatus, setExtStatus] = useState<MagnificExtensionStatus>({
    connected: false,
  });
  const [sessionOk, setSessionOk] = useState<null | { ok: boolean; detail?: string }>(null);
  const [testingSession, setTestingSession] = useState(false);

  const [adName, setAdName] = useToolState<string>('mgAuto:adName', '');
  const [rawPrompts, setRawPrompts] = useToolState<string>('mgAuto:raw', '');
  const [imageModel, setImageModel] = useToolState<ImageModelChoice>(
    'mgAuto:imgModel',
    'nano-banana-2',
  );
  const [globalMotion, setGlobalMotion] = useToolState<string>(
    'mgAuto:motion',
    '',
  );
  const [processing, setProcessing] = useToolState<boolean>(
    'mgAuto:processing',
    false,
  );
  const [progress, setProgress] = useState<PipelineProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [zipReady, setZipReady] = useState<{ blob: Blob; name: string } | null>(
    null,
  );
  const abortRef = useRef<AbortController | null>(null);

  // Detect extension on mount + le handoff do clickup-pilot (se houver)
  useEffect(() => {
    let cancelled = false;
    detectMagnificExtension().then((s) => {
      if (!cancelled) setExtStatus(s);
    });
    try {
      const raw = sessionStorage.getItem('darkolab:auto-broll:handoff');
      if (raw) {
        const ho = JSON.parse(raw) as {
          adName?: string;
          copy?: string;
          mode?: string;
        };
        if (ho.adName) setAdName(ho.adName);
        // Pre-popula rawPrompts com a copy concatenada como SUGESTAO — o user
        // ainda precisa rodar no Claude dele e colar de volta os prompts.
        // Damos um header explicativo:
        if (ho.copy) {
          const header =
            `# COPY DO AD ${ho.adName ?? ''}\n` +
            `# Cole no seu Claude/LLM e peça pra gerar prompts Nano Banana 2 (3-5s).\n` +
            `# Depois cole o JSON resultante aqui.\n` +
            `# Modo: ${ho.mode ?? 'only-magnific'}\n\n` +
            ho.copy;
          setRawPrompts(header);
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

  const parsedTakes = useMemo<MagnificTakeInput[]>(() => {
    if (!rawPrompts.trim()) return [];
    const t = parseMagnificPrompts(rawPrompts);
    // Aplica motion global se take nao tem
    return t.map((it) => ({
      ...it,
      videoPrompt: it.videoPrompt || globalMotion || '',
    }));
  }, [rawPrompts, globalMotion]);

  async function handleTestSession() {
    setTestingSession(true);
    try {
      const r = await testMagnificSession();
      setSessionOk(r);
    } catch (e) {
      setSessionOk({ ok: false, detail: (e as Error).message });
    } finally {
      setTestingSession(false);
    }
  }

  async function handleRun() {
    if (!extStatus.connected) {
      setError('Extension Magnific nao detectada. Instale e recarregue.');
      return;
    }
    if (!parsedTakes.length) {
      setError('Sem prompts validos. Cole o JSON/texto e tente de novo.');
      return;
    }
    setError(null);
    setProgress(null);
    setZipReady(null);
    setProcessing(true);
    abortRef.current = new AbortController();
    try {
      const r = await runMagnificPipeline(
        {
          spaceName: adName.trim() || 'DARKO_LAB_BROLLS',
          takes: parsedTakes,
          imageModel,
          videoModel: 'kling-25',
        },
        {
          signal: abortRef.current.signal,
          onProgress: (p) => setProgress(p),
        },
      );
      if (r.ok && r.zipBlob && r.zipName) {
        setZipReady({ blob: r.zipBlob, name: r.zipName });
      } else {
        setError(
          `Pipeline finalizou sem MP4s. Sucesso=${r.successCount} / Falhas=${r.failedCount}. ` +
            'Provavel: endpoints reais do Magnific ainda nao mapeados. F12 na aba magnific.com -> Network -> capture um generate manual e me cole o cURL.',
        );
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setProcessing(false);
      abortRef.current = null;
    }
  }

  function handleCancel() {
    abortRef.current?.abort();
  }

  function downloadZip() {
    if (!zipReady) return;
    const url = URL.createObjectURL(zipReady.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = zipReady.name;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <ToolShell
      title="Magnific Auto B-Rolls"
      description="Cole os prompts (JSON do Claude do seu LLM, ou texto livre). A extensao Magnific gera N imagens (Nano Banana 2/Pro) + N videos (Kling 2.5) e empacota tudo em ZIP."
    >
      <div className="grid gap-5">
        {/* Extension status */}
        <div className="rounded-xl border border-line bg-bg-soft/40 p-4">
          <div className="mb-2 flex items-center justify-between gap-2 flex-wrap">
            <div className="text-sm font-semibold uppercase tracking-wide text-text-muted">
              Extension DARKO LAB Magnific Auto
            </div>
            <div className="flex items-center gap-2">
              {extStatus.connected ? (
                <span className="rounded-full bg-lime-soft px-2 py-0.5 text-xs font-medium text-lime">
                  conectada v{extStatus.version}
                </span>
              ) : (
                <span className="rounded-full bg-red-500/10 px-2 py-0.5 text-xs text-red-300">
                  nao detectada
                </span>
              )}
              <button
                type="button"
                onClick={() => detectMagnificExtension().then(setExtStatus)}
                className="btn-secondary text-xs"
              >
                Re-checar
              </button>
              <button
                type="button"
                onClick={handleTestSession}
                disabled={!extStatus.connected || testingSession}
                className="btn-secondary text-xs"
              >
                {testingSession ? 'Testando...' : 'Testar sessao Magnific'}
              </button>
            </div>
          </div>
          {sessionOk && (
            <div
              className={`mt-2 rounded-md border px-3 py-2 text-xs ${
                sessionOk.ok
                  ? 'border-lime/40 bg-lime/5 text-lime'
                  : 'border-red-500/40 bg-red-500/10 text-red-300'
              }`}
            >
              {sessionOk.ok
                ? `Sessao OK. Endpoint: ${sessionOk.detail ?? 'detectado'}`
                : `Falha: ${sessionOk.detail ?? 'sem detalhe'}`}
            </div>
          )}
          <p className="mt-2 text-xs text-text-muted">
            Plano Premium+ obrigatorio. Nano Banana 1K + Kling 2.5 720p sao{' '}
            <span className="text-lime">ilimitados</span> nesse plano (nao consome
            creditos).
          </p>
        </div>

        {/* Inputs */}
        <div className="grid gap-3 md:grid-cols-2">
          <label className="block">
            <span className="label-field">Codigo do AD / Space</span>
            <input
              type="text"
              value={adName}
              onChange={(e) => setAdName(e.target.value)}
              placeholder="Ex: AD15VN-PRPB06"
              className="input-field"
              disabled={processing}
            />
          </label>
          <label className="block">
            <span className="label-field">Modelo de imagem</span>
            <select
              value={imageModel}
              onChange={(e) => setImageModel(e.target.value as ImageModelChoice)}
              className="input-field"
              disabled={processing}
            >
              <option value="nano-banana-2">Nano Banana 2 (1K, ilimitado)</option>
              <option value="nano-banana-pro">Nano Banana Pro (1K, ilimitado)</option>
            </select>
          </label>
        </div>

        <label className="block">
          <span className="label-field">
            Prompts (cole JSON do Claude ou texto livre numerado)
          </span>
          <textarea
            value={rawPrompts}
            onChange={(e) => setRawPrompts(e.target.value)}
            placeholder={`Suporta:
[ { "imagePrompt": "...", "videoPrompt": "..." }, ... ]
ou texto livre:
1. PROMPT_IMG aqui
   MOTION: slow zoom in
---
2. Outro prompt`}
            rows={10}
            className="input-field resize-y font-mono text-xs"
            disabled={processing}
          />
          <div className="mt-1 text-xs text-text-muted">
            Detectados:{' '}
            <span className="mono text-lime">{parsedTakes.length}</span> takes
          </div>
        </label>

        <label className="block">
          <span className="label-field">Motion default (opcional, Kling 2.5)</span>
          <input
            type="text"
            value={globalMotion}
            onChange={(e) => setGlobalMotion(e.target.value)}
            placeholder="Ex: slow camera push-in, soft handheld motion"
            className="input-field"
            disabled={processing}
          />
        </label>

        {error && (
          <div
            key={error}
            role="alert"
            className="error-shake rounded-[12px] border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300"
          >
            {error}
          </div>
        )}

        <div className="flex flex-wrap gap-3">
          {processing ? (
            <CancelButton onClick={handleCancel} label="Cancelar pipeline" />
          ) : (
            <button
              type="button"
              onClick={handleRun}
              disabled={!extStatus.connected || parsedTakes.length === 0}
              className="btn-primary"
            >
              Disparar {parsedTakes.length || 0} take{parsedTakes.length === 1 ? '' : 's'}
            </button>
          )}
          {zipReady && (
            <button type="button" onClick={downloadZip} className="btn-secondary">
              Baixar {zipReady.name} ({(zipReady.blob.size / 1024 / 1024).toFixed(1)} MB)
            </button>
          )}
        </div>

        {progress && (
          <div className="rounded-xl border border-line bg-bg-soft/40 p-4">
            <div className="mb-3 flex items-center justify-between text-xs">
              <span className="text-text-muted">
                {progress.spaceUrl ? (
                  <a
                    href={progress.spaceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-lime underline"
                  >
                    Abrir Space no Magnific
                  </a>
                ) : (
                  <span>Sem Space ainda</span>
                )}
              </span>
              <span className="mono text-lime">
                {progress.ready}/{progress.total} prontos
              </span>
            </div>
            {progress.message && (
              <p className="mb-3 text-xs italic text-text-muted">
                {progress.message}
              </p>
            )}
            <ul className="grid gap-1.5">
              {progress.takes.map((t) => (
                <TakeRow key={t.idx} t={t} />
              ))}
            </ul>
          </div>
        )}

        {parsedTakes.length > 0 && !progress && (
          <div className="rounded-xl border border-line bg-bg-soft/30 p-3">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">
              Preview dos prompts parseados ({parsedTakes.length})
            </div>
            <ul className="grid gap-2 max-h-[260px] overflow-auto">
              {parsedTakes.slice(0, 30).map((t) => (
                <li
                  key={t.idx}
                  className="rounded-md border border-line bg-black/20 p-2 text-xs"
                >
                  <div className="mono text-lime">take{t.idx}</div>
                  <div className="text-white">{t.imagePrompt}</div>
                  {t.videoPrompt && (
                    <div className="mt-1 text-text-muted">motion: {t.videoPrompt}</div>
                  )}
                </li>
              ))}
              {parsedTakes.length > 30 && (
                <li className="text-xs text-text-muted">
                  +{parsedTakes.length - 30} mais...
                </li>
              )}
            </ul>
          </div>
        )}
      </div>
    </ToolShell>
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
