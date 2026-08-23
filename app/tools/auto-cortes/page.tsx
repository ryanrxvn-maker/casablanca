'use client';

/**
 * AUTO CORTES — vídeo longo (podcast, live, aula, entrevista) vira cortes
 * prontos: corte por contexto, legenda animada, headline queimada e
 * reenquadro inteligente. Tudo roda no navegador do cliente — nenhum byte
 * de vídeo sobe pro servidor.
 *
 * A página é só a montagem: quem faz o trabalho é `lib/auto-cortes/pipeline.ts`
 * (via `usePipeline`) e quem desenha cada pedaço são os componentes de
 * `components/auto-cortes/`. Ver docs/auto-cortes/ARQUITETURA.md.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { TierGate } from '@/components/TierGate';
import { ToolHero, ToolStep } from '@/components/tool-kit';
import {
  IconStepLink,
  IconStepScissors,
  IconStepSliders,
  IconStepWand,
} from '@/components/ToolIcons';
import { useToolState } from '@/components/ToolsStateProvider';
import { downloadBlob } from '@/lib/audio-engine';
import { toFriendlyMessage } from '@/lib/friendly-error';
import { resolveSourceKind } from '@/lib/auto-cortes/ingest';
import type { PipelineSource } from '@/lib/auto-cortes/pipeline';
import {
  DEFAULT_CLIP_SETTINGS,
  type Clip,
  type ClipSettings,
  type ProjectPhase,
} from '@/lib/auto-cortes/types';
import { ClipEditor } from '@/components/auto-cortes/ClipEditor';
import { ClipGrid } from '@/components/auto-cortes/ClipGrid';
import { ClipPreview } from '@/components/auto-cortes/ClipPreview';
import { ClipSettingsPanel } from '@/components/auto-cortes/ClipSettingsPanel';
import { PipelineProgress } from '@/components/auto-cortes/PipelineProgress';
import { ResultsBar } from '@/components/auto-cortes/ResultsBar';
import { SourceInput } from '@/components/auto-cortes/SourceInput';
import { TranscriptPanel } from '@/components/auto-cortes/TranscriptPanel';
import { AC_HUE, ErrorNote, MiniButton, fmtClock } from '@/components/auto-cortes/ui';
import { usePipeline } from '@/components/auto-cortes/usePipeline';

const HUE = AC_HUE;
const DEFAULTS_KEY = 'auto-cortes:defaults';

const PHASE_LABEL: Record<ProjectPhase, string> = {
  fonte: 'sem começar',
  baixando: 'baixando',
  audio: 'extraindo áudio',
  transcrevendo: 'transcrevendo',
  analisando: 'analisando',
  renderizando: 'renderizando',
  pronto: 'pronto',
  erro: 'parou com erro',
};

const ACTIVE_PHASES: ProjectPhase[] = [
  'baixando',
  'audio',
  'transcrevendo',
  'analisando',
  'renderizando',
];

function slug(s: string): string {
  return (
    String(s || 'corte')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'corte'
  );
}

/** Duração e tamanho do vídeo lidos pelo próprio `<video>` (sem ffmpeg). */
function probeLocal(
  file: File,
): Promise<{ durationSec: number; width: number; height: number } | null> {
  return new Promise((resolve) => {
    if (typeof document === 'undefined') return resolve(null);
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.muted = true;
    let done = false;
    const finish = (r: { durationSec: number; width: number; height: number } | null) => {
      if (done) return;
      done = true;
      try {
        v.removeAttribute('src');
        v.load();
      } catch {
        /* ignora */
      }
      URL.revokeObjectURL(url);
      resolve(r);
    };
    v.onloadedmetadata = () =>
      finish({
        durationSec: isFinite(v.duration) ? v.duration : 0,
        width: v.videoWidth || 0,
        height: v.videoHeight || 0,
      });
    v.onerror = () => finish(null);
    setTimeout(() => finish(null), 12_000);
    v.src = url;
  });
}

export default function AutoCortesPage() {
  return (
    <TierGate require="admin" toolName="Auto Cortes">
      <AutoCortesInner />
    </TierGate>
  );
}

function AutoCortesInner() {
  const pipe = usePipeline();
  const project = pipe.project;
  const phase: ProjectPhase = project?.phase ?? 'fonte';
  const rodando = ACTIVE_PHASES.includes(phase);

  const [settings, setSettings] = useToolState<ClipSettings>(
    'auto-cortes:settings',
    DEFAULT_CLIP_SETTINGS,
  );
  const [url, setUrl] = useToolState<string>('auto-cortes:url', '');
  const [startedAt, setStartedAt] = useToolState<number | null>('auto-cortes:startedAt', null);
  const [endedAt, setEndedAt] = useToolState<number | null>('auto-cortes:endedAt', null);
  const [savedDefaults, setSavedDefaults] = useState(false);
  const [uiError, setUiError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [zipRatio, setZipRatio] = useState<number | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [editorId, setEditorId] = useState<string | null>(null);
  const [meta, setMeta] = useState<{ durationSec: number; width: number; height: number } | null>(
    null,
  );

  // ── ajustes padrão salvos neste navegador ────────────────────────────────
  const hydratedRef = useRef(false);
  useEffect(() => {
    if (hydratedRef.current) return;
    hydratedRef.current = true;
    try {
      const raw = localStorage.getItem(DEFAULTS_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<ClipSettings>;
      if (parsed && typeof parsed === 'object') {
        setSettings({ ...DEFAULT_CLIP_SETTINGS, ...parsed });
      }
    } catch {
      /* padrão corrompido — segue com o de fábrica */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Projeto que já tem trabalho feito manda nos ajustes exibidos (o que está
  // na tela precisa bater com o que gerou aqueles cortes).
  const syncedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!project) return;
    if (syncedRef.current === project.id) return;
    syncedRef.current = project.id;
    if (project.phase !== 'fonte') setSettings(project.settings);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id, project?.phase]);

  // congela o relógio quando o lote termina (ou para)
  useEffect(() => {
    if ((phase === 'pronto' || phase === 'erro') && startedAt != null && endedAt == null) {
      setEndedAt(Date.now());
    }
    if (rodando && endedAt != null) setEndedAt(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, startedAt, endedAt, rodando]);

  // metadados do arquivo escolhido (duração pro campo de trecho, forma pro reenquadro)
  const file = pipe.file;
  useEffect(() => {
    if (!file) {
      setMeta(null);
      return;
    }
    let alive = true;
    void probeLocal(file).then((m) => {
      if (alive) setMeta(m);
    });
    return () => {
      alive = false;
    };
  }, [file]);

  const durationSec = meta?.durationSec ?? project?.source.durationSec ?? null;
  const sourceAspect = useMemo(() => {
    const w = meta?.width ?? project?.source.width ?? null;
    const h = meta?.height ?? project?.source.height ?? null;
    return w && h ? w / h : null;
  }, [meta, project?.source.width, project?.source.height]);

  const clips = project?.clips ?? [];
  const previewClip = clips.find((c) => c.id === previewId) ?? null;
  const editorClip = clips.find((c) => c.id === editorId) ?? null;

  // ── ações ────────────────────────────────────────────────────────────────
  const onGerar = useCallback(async () => {
    setUiError(null);
    const u = url.trim();
    const f = pipe.file;
    if (!f && !u) {
      setUiError('Cole um link ou escolha um arquivo pra começar.');
      return;
    }
    if (!f && !resolveSourceKind(u)) {
      setUiError('Esse link não parece um vídeo. Confira o endereço ou suba o arquivo.');
      return;
    }
    const source: PipelineSource = f ? { kind: 'upload', file: f } : { kind: 'link', url: u };
    setStartedAt(Date.now());
    setEndedAt(null);
    await pipe.start({ settings, source });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, pipe, settings]);

  const salvarPadrao = useCallback(() => {
    try {
      localStorage.setItem(DEFAULTS_KEY, JSON.stringify(settings));
      setSavedDefaults(true);
      setTimeout(() => setSavedDefaults(false), 2600);
    } catch {
      setUiError('Não deu pra salvar o padrão neste navegador (armazenamento cheio).');
    }
  }, [settings]);

  const baixarCorte = useCallback(
    async (clip: Clip) => {
      setUiError(null);
      try {
        const blob = await pipe.getClipBlob(clip.id);
        if (!blob) {
          setUiError('Esse corte ainda não tem vídeo salvo. Renderize de novo.');
          return;
        }
        const title = clip.edited?.title ?? clip.plan.title;
        await downloadBlob(blob, `${String(clip.rank).padStart(2, '0')}-${slug(title)}.mp4`);
      } catch (e) {
        setUiError(toFriendlyMessage(e, 'O download desse corte falhou.'));
      }
    },
    [pipe],
  );

  const baixarSrt = useCallback(
    async (clip: Clip) => {
      setUiError(null);
      const srt = pipe.buildSrt(clip.id);
      if (!srt.trim()) {
        setUiError('Esse corte não tem legenda pra exportar.');
        return;
      }
      const title = clip.edited?.title ?? clip.plan.title;
      await downloadBlob(
        new Blob([srt], { type: 'text/plain;charset=utf-8' }),
        `${String(clip.rank).padStart(2, '0')}-${slug(title)}.srt`,
      );
    },
    [pipe],
  );

  const copiarTextos = useCallback(async (clip: Clip) => {
    const title = clip.edited?.title ?? clip.plan.title;
    const tags = (clip.plan.hashtags || []).map((h) => (h.startsWith('#') ? h : `#${h}`)).join(' ');
    const texto = [title, '', clip.plan.description, '', tags].join('\n').trim();
    try {
      await navigator.clipboard.writeText(texto);
      setAviso('Título, descrição e hashtags copiados.');
      setTimeout(() => setAviso(null), 2600);
    } catch {
      setUiError('O navegador bloqueou a cópia. Selecione o texto no card e copie na mão.');
    }
  }, []);

  const baixarZip = useCallback(async () => {
    setUiError(null);
    setZipRatio(0);
    try {
      const blob = await pipe.buildZip((r) => setZipRatio(Math.max(0, Math.min(1, r))));
      const nome = slug(project?.source.name ?? 'auto-cortes');
      await downloadBlob(blob, `${nome}-cortes.zip`);
    } catch (e) {
      setUiError(toFriendlyMessage(e, 'O ZIP não ficou pronto. Baixe os cortes um a um.'));
    } finally {
      setZipRatio(null);
    }
  }, [pipe, project?.source.name]);

  const erro = uiError ?? pipe.error;

  return (
    <div className="mx-auto max-w-[1180px] space-y-6 px-4 py-6 md:px-6">
      <ToolHero
        eyebrow="IA · cortes"
        title="Auto Cortes"
        subtitle="Podcast, live ou aula viram cortes prontos — com legenda, headline e enquadro."
        hue={HUE}
        icon={<IconStepScissors size={34} />}
      />

      {erro ? <ErrorNote>{erro}</ErrorNote> : null}
      {aviso ? (
        <p className="rounded-[12px] border border-lime/35 bg-lime/10 px-3.5 py-2.5 text-[12.5px] text-lime">
          {aviso}
        </p>
      ) : null}

      <ToolStep n={1} title="Fonte" hue={HUE} icon={<IconStepLink size={20} />}>
        <SourceInput
          url={url}
          onUrl={setUrl}
          file={pipe.file}
          onFile={pipe.setFile}
          disabled={rodando}
          needsFile={
            pipe.needsFile && project
              ? {
                  name: project.source.name,
                  sizeBytes: project.source.sizeBytes,
                  onAttach: pipe.attachFile,
                }
              : null
          }
        />
      </ToolStep>

      <ToolStep
        n={2}
        title="Ajustes"
        hue={HUE}
        icon={<IconStepSliders size={20} />}
        hint="Proporção, duração, legenda, headline e enquadro."
      >
        <ClipSettingsPanel
          value={settings}
          onChange={setSettings}
          disabled={rodando}
          durationSec={durationSec}
          sourceAspect={sourceAspect}
          onSaveDefaults={salvarPadrao}
          savedDefaults={savedDefaults}
        />
      </ToolStep>

      <ToolStep n={3} title="Gerar cortes" hue={HUE} icon={<IconStepWand size={20} />}>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void onGerar()}
            disabled={rodando || !pipe.ready || pipe.needsFile}
            className="btn-primary !py-3.5 text-[14px] disabled:opacity-40"
          >
            Gerar cortes
          </button>
          <MiniButton onClick={pipe.newProject} disabled={rodando}>
            Novo projeto
          </MiniButton>
          {durationSec ? (
            <span className="mono text-[11.5px] text-text-muted">
              {fmtClock(durationSec)} de vídeo
            </span>
          ) : null}
        </div>
        <p className="mt-2.5 text-[11.5px] leading-relaxed text-text-dim">
          A transcrição e a curadoria usam a sua chave de transcrição (Groq, gratuita) — nada é
          cobrado. O vídeo é cortado e renderizado aqui no seu navegador — pode demorar alguns minutos num
          arquivo longo, e a aba pode ficar em segundo plano.
        </p>
      </ToolStep>

      <PipelineProgress
        phase={phase}
        progress={project?.progress ?? { ratio: 0, label: '' }}
        startedAt={startedAt}
        endedAt={endedAt}
        warnings={project?.warnings ?? []}
        lastError={project?.lastError ?? null}
        onCancel={pipe.cancel}
        onResume={() => void pipe.resume()}
      />

      <ClipGrid
        clips={clips}
        aspect={settings.aspect}
        getThumbUrl={pipe.getThumbUrl}
        onPreview={(c) => setPreviewId(c.id)}
        onEdit={(c) => setEditorId(c.id)}
        onDownload={(c) => void baixarCorte(c)}
        onCopyTexts={(c) => void copiarTextos(c)}
        onSrt={(c) => void baixarSrt(c)}
        onRerender={(c) => void pipe.rerenderClip(c.id)}
        busy={zipRatio != null}
      />

      <ResultsBar
        clips={clips}
        phase={phase}
        settings={settings}
        onZip={() => void baixarZip()}
        zipRatio={zipRatio}
        onRerenderAll={(patch) => {
          setSettings({ ...settings, ...patch });
          void pipe.rerenderAll(patch);
        }}
        onReanalyze={() => void pipe.reanalyze()}
        onResume={() => void pipe.resume()}
        busy={rodando || zipRatio != null}
      />

      <TranscriptPanel
        transcript={project?.transcript ?? null}
        clips={clips}
        onPick={(_s, clip) => {
          if (clip) setPreviewId(clip.id);
        }}
      />

      <RecentProjects
        recents={pipe.recents}
        currentId={project?.id ?? null}
        disabled={rodando}
        onOpen={pipe.openProject}
        onRemove={(id) => void pipe.removeProject(id)}
      />

      <ClipPreview
        clip={previewClip}
        aspect={settings.aspect}
        getClipBlob={pipe.getClipBlob}
        onClose={() => setPreviewId(null)}
        onDownload={(c) => void baixarCorte(c)}
      />

      <ClipEditor
        clip={editorClip}
        sentences={project?.transcript?.sentences ?? []}
        durationSec={durationSec}
        onSave={pipe.updateClip}
        onRerender={(id) => void pipe.rerenderClip(id)}
        onClose={() => setEditorId(null)}
        busy={zipRatio != null}
      />
    </div>
  );
}

/* ───────────────────────── Projetos recentes ───────────────────────── */

function RecentProjects({
  recents,
  currentId,
  disabled,
  onOpen,
  onRemove,
}: {
  recents: Array<{ id: string; name: string; updatedAt: number; phase: ProjectPhase; clips: number }>;
  currentId: string | null;
  disabled?: boolean;
  onOpen: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const [confirmId, setConfirmId] = useState<string | null>(null);
  if (recents.length === 0) return null;

  return (
    <section className="rounded-[16px] border border-line bg-bg-soft/40 p-4">
      <div
        className="mb-2.5 text-[10.5px] font-bold uppercase tracking-[0.18em] text-text-muted"
        style={{ fontFamily: 'var(--font-tech)' }}
      >
        Projetos recentes
      </div>
      <ul className="space-y-1.5">
        {recents.map((r) => {
          const atual = r.id === currentId;
          return (
            <li
              key={r.id}
              className={
                'flex flex-wrap items-center gap-2 rounded-[11px] border px-3 py-2 ' +
                (atual ? 'border-pink-400/45 bg-pink-400/[0.06]' : 'border-line')
              }
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-semibold text-text">
                  {r.name || 'Projeto sem nome'}
                </span>
                <span className="mono text-[10.5px] text-text-dim">
                  {new Date(r.updatedAt).toLocaleString('pt-BR')} · {PHASE_LABEL[r.phase]} ·{' '}
                  {r.clips} {r.clips === 1 ? 'corte' : 'cortes'}
                </span>
              </span>
              {atual ? (
                <span className="text-[11px] font-bold text-pink-300">aberto</span>
              ) : (
                <MiniButton onClick={() => onOpen(r.id)} disabled={disabled}>
                  Abrir
                </MiniButton>
              )}
              {confirmId === r.id ? (
                <>
                  <MiniButton
                    tone="danger"
                    onClick={() => {
                      setConfirmId(null);
                      onRemove(r.id);
                    }}
                  >
                    Apagar mesmo
                  </MiniButton>
                  <MiniButton onClick={() => setConfirmId(null)}>Não</MiniButton>
                </>
              ) : (
                <MiniButton tone="danger" onClick={() => setConfirmId(r.id)} disabled={disabled}>
                  Apagar
                </MiniButton>
              )}
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-[11px] text-text-dim">
        Os projetos ficam só neste navegador e são podados sozinhos (6 projetos / 7 dias). Baixe o
        que quiser guardar.
      </p>
    </section>
  );
}
