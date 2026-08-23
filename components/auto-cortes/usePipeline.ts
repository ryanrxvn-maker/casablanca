'use client';

/**
 * AUTO CORTES — ponte entre a página e o `pipeline.ts`.
 *
 * O hook é o único lugar que conhece o ciclo de vida: qual projeto está
 * aberto (o último fica em localStorage), quem assina as mudanças de estado,
 * quando retomar sozinho depois de um F5 e quem manda destruir tudo ao sair
 * da página.
 *
 * Blindagem: o projeto nasce no IDB ANTES de qualquer trabalho, então recarregar
 * a página no meio nunca perde o que já foi feito. Se a fonte era upload, o
 * navegador não guarda o arquivo — aí `needsFile` fica true e a UI pede o
 * MESMO arquivo de volta (`attachFile` confere a assinatura).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createPipeline,
  listRecentProjects,
  loadOrCreateProject,
  newProjectId,
  type Pipeline,
  type PipelineSource,
} from '@/lib/auto-cortes/pipeline';
import { deleteProject } from '@/lib/auto-cortes/store';
import type { ClipSettings, Clip, Project, ProjectPhase } from '@/lib/auto-cortes/types';
import { toFriendlyMessage } from '@/lib/friendly-error';

export const LAST_PROJECT_KEY = 'auto-cortes:lastProject';

/** Fases em que existe trabalho em curso (o F5 precisa retomar). */
export const ACTIVE_PHASES: ProjectPhase[] = [
  'baixando',
  'audio',
  'transcrevendo',
  'analisando',
  'renderizando',
];

export type RecentProject = {
  id: string;
  name: string;
  updatedAt: number;
  phase: ProjectPhase;
  clips: number;
};

export type UsePipelineResult = {
  project: Project | null;
  /** o projeto já veio do IDB e o pipeline está montado */
  ready: boolean;
  /** erro de carregamento/execução que a página mostra inline */
  error: string | null;
  clearError: () => void;
  /** true quando a fonte era upload e o arquivo sumiu no F5 */
  needsFile: boolean;
  /** arquivo escolhido nesta sessão (o pipeline lê por getFile) */
  file: File | null;
  setFile: (f: File | null) => void;
  recents: RecentProject[];
  reloadRecents: () => void;

  start: (args: { settings: ClipSettings; source: PipelineSource }) => Promise<void>;
  resume: () => Promise<void>;
  cancel: () => void;
  attachFile: (f: File) => { ok: true } | { ok: false; reason: string };
  reanalyze: (patch?: Partial<ClipSettings>) => Promise<void>;
  rerenderClip: (clipId: string) => Promise<void>;
  rerenderAll: (patch: Partial<ClipSettings>) => Promise<void>;
  updateClip: (clipId: string, patch: NonNullable<Clip['edited']>) => void;
  getClipBlob: (clipId: string) => Promise<Blob | null>;
  getThumbUrl: (clipId: string) => Promise<string | null>;
  buildSrt: (clipId: string) => string;
  buildZip: (onProgress?: (ratio: number) => void) => Promise<Blob>;

  openProject: (id: string) => void;
  newProject: () => void;
  removeProject: (id: string) => Promise<void>;
};

export function usePipeline(): UsePipelineResult {
  const [project, setProject] = useState<Project | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsFile, setNeedsFile] = useState(false);
  const [file, setFileState] = useState<File | null>(null);
  const [recents, setRecents] = useState<RecentProject[]>([]);
  /** id pedido pela UI; null = usa o último do localStorage */
  const [desiredId, setDesiredId] = useState<string | null>(null);
  const [bootSeq, setBootSeq] = useState(0);

  const pipeRef = useRef<Pipeline | null>(null);
  const fileRef = useRef<File | null>(null);

  const setFile = useCallback((f: File | null) => {
    fileRef.current = f;
    setFileState(f);
  }, []);

  const reloadRecents = useCallback(() => {
    void (async () => {
      try {
        const list = await listRecentProjects();
        setRecents(list);
      } catch {
        /* lista de recentes é conveniência: sem ela a tool funciona igual */
      }
    })();
  }, []);

  // ── monta/desmonta o pipeline do projeto atual ───────────────────────────
  useEffect(() => {
    let alive = true;
    let unsub: (() => void) | null = null;
    setReady(false);
    setProject(null);
    setNeedsFile(false);

    void (async () => {
      let id = desiredId;
      if (!id) {
        try {
          id = localStorage.getItem(LAST_PROJECT_KEY);
        } catch {
          id = null;
        }
      }

      let inicial: Project;
      try {
        inicial = await loadOrCreateProject(id ?? undefined);
      } catch (e) {
        if (alive) setError(toFriendlyMessage(e, 'Não deu pra abrir o projeto salvo neste navegador.'));
        return;
      }
      if (!alive) return;

      try {
        localStorage.setItem(LAST_PROJECT_KEY, inicial.id);
      } catch {
        /* sem localStorage o projeto só não é lembrado no próximo F5 */
      }

      let pipe: Pipeline;
      try {
        pipe = createPipeline({ projectId: inicial.id, getFile: () => fileRef.current });
      } catch (e) {
        if (alive) setError(toFriendlyMessage(e, 'Não deu pra iniciar o Auto Cortes.'));
        return;
      }
      if (!alive) {
        pipe.destroy();
        return;
      }

      pipeRef.current = pipe;
      unsub = pipe.subscribe((next) => {
        if (!alive) return;
        setProject(next);
        try {
          setNeedsFile(pipe.needsFile());
        } catch {
          setNeedsFile(false);
        }
      });
      setProject(inicial);
      try {
        setNeedsFile(pipe.needsFile());
      } catch {
        setNeedsFile(false);
      }
      setReady(true);

      // Retomada automática: fase ativa + arquivo disponível = segue do ponto
      // onde parou, sem o cliente clicar em nada.
      if (ACTIVE_PHASES.includes(inicial.phase)) {
        let precisa = true;
        try {
          precisa = pipe.needsFile();
        } catch {
          precisa = false;
        }
        if (!precisa) {
          void pipe.resume().catch((e) => {
            if (alive) setError(toFriendlyMessage(e, 'A retomada falhou. Clique em Retomar.'));
          });
        }
      }
    })();

    return () => {
      alive = false;
      try {
        unsub?.();
      } catch {
        /* ignora */
      }
      try {
        pipeRef.current?.destroy();
      } catch {
        /* ignora */
      }
      pipeRef.current = null;
    };
  }, [desiredId, bootSeq]);

  useEffect(() => {
    reloadRecents();
  }, [reloadRecents, project?.phase]);

  // ── ações (todas erram amigável e nunca deixam a UI travada) ─────────────
  const guard = useCallback((): Pipeline => {
    const p = pipeRef.current;
    if (!p) throw new Error('O Auto Cortes ainda está abrindo. Tente de novo em um instante.');
    return p;
  }, []);

  const wrap = useCallback(
    async (fn: () => Promise<void>, fallback: string) => {
      setError(null);
      try {
        await fn();
      } catch (e) {
        setError(toFriendlyMessage(e, fallback));
      }
    },
    [],
  );

  const start = useCallback(
    (args: { settings: ClipSettings; source: PipelineSource }) =>
      wrap(async () => {
        if (args.source.kind === 'upload') setFile(args.source.file);
        await guard().start(args);
      }, 'Não deu pra começar. Confira a fonte e tente de novo.'),
    [guard, wrap, setFile],
  );

  const resume = useCallback(
    () => wrap(() => guard().resume(), 'A retomada falhou. Tente de novo.'),
    [guard, wrap],
  );

  const cancel = useCallback(() => {
    try {
      pipeRef.current?.cancel();
    } catch {
      /* cancelar nunca pode explodir na cara do cliente */
    }
  }, []);

  const attachFile = useCallback(
    (f: File): { ok: true } | { ok: false; reason: string } => {
      const p = pipeRef.current;
      if (!p) return { ok: false, reason: 'O Auto Cortes ainda está abrindo. Tente de novo.' };
      fileRef.current = f;
      let r: { ok: true } | { ok: false; reason: string };
      try {
        r = p.attachFile(f);
      } catch (e) {
        fileRef.current = null;
        return { ok: false, reason: toFriendlyMessage(e, 'Esse arquivo não foi aceito.') };
      }
      if (!r.ok) {
        fileRef.current = null;
        return r;
      }
      setFileState(f);
      try {
        setNeedsFile(p.needsFile());
      } catch {
        setNeedsFile(false);
      }
      // com o arquivo de volta, o trabalho continua sozinho
      const ph = p.getState().phase;
      if (ACTIVE_PHASES.includes(ph)) {
        void p.resume().catch((e) => setError(toFriendlyMessage(e, 'A retomada falhou.')));
      }
      return { ok: true };
    },
    [],
  );

  const reanalyze = useCallback(
    (patch?: Partial<ClipSettings>) =>
      wrap(() => guard().reanalyze(patch), 'A análise não terminou. Tente de novo.'),
    [guard, wrap],
  );

  const rerenderClip = useCallback(
    (clipId: string) =>
      wrap(() => guard().rerenderClip(clipId), 'Esse corte não renderizou. Tente de novo.'),
    [guard, wrap],
  );

  const rerenderAll = useCallback(
    (patch: Partial<ClipSettings>) =>
      wrap(() => guard().rerenderAll(patch), 'Não deu pra re-renderizar os cortes.'),
    [guard, wrap],
  );

  const updateClip = useCallback(
    (clipId: string, patch: NonNullable<Clip['edited']>) => {
      try {
        guard().updateClip(clipId, patch);
      } catch (e) {
        setError(toFriendlyMessage(e, 'Não deu pra salvar a edição.'));
      }
    },
    [guard],
  );

  const getClipBlob = useCallback(
    (clipId: string) => {
      const p = pipeRef.current;
      if (!p) return Promise.resolve(null);
      return p.getClipBlob(clipId);
    },
    [],
  );

  const getThumbUrl = useCallback((clipId: string) => {
    const p = pipeRef.current;
    if (!p) return Promise.resolve(null);
    return p.getThumbUrl(clipId);
  }, []);

  const buildSrt = useCallback(
    (clipId: string) => {
      try {
        return guard().buildSrt(clipId);
      } catch {
        return '';
      }
    },
    [guard],
  );

  const buildZip = useCallback(
    (onProgress?: (ratio: number) => void) => guard().buildZip(onProgress),
    [guard],
  );

  const openProject = useCallback((id: string) => {
    setError(null);
    setFileState(null);
    fileRef.current = null;
    setDesiredId(id);
    setBootSeq((n) => n + 1);
  }, []);

  const newProject = useCallback(() => {
    setError(null);
    setFileState(null);
    fileRef.current = null;
    const id = newProjectId();
    try {
      localStorage.setItem(LAST_PROJECT_KEY, id);
    } catch {
      /* ignora */
    }
    setDesiredId(id);
    setBootSeq((n) => n + 1);
  }, []);

  const removeProject = useCallback(
    async (id: string) => {
      try {
        await deleteProject(id);
      } catch (e) {
        setError(toFriendlyMessage(e, 'Não deu pra apagar esse projeto.'));
        return;
      }
      if (project?.id === id) {
        const novo = newProjectId();
        try {
          localStorage.setItem(LAST_PROJECT_KEY, novo);
        } catch {
          /* ignora */
        }
        setDesiredId(novo);
        setBootSeq((n) => n + 1);
      }
      reloadRecents();
    },
    [project?.id, reloadRecents],
  );

  return {
    project,
    ready,
    error,
    clearError: () => setError(null),
    needsFile,
    file,
    setFile,
    recents,
    reloadRecents,
    start,
    resume,
    cancel,
    attachFile,
    reanalyze,
    rerenderClip,
    rerenderAll,
    updateClip,
    getClipBlob,
    getThumbUrl,
    buildSrt,
    buildZip,
    openProject,
    newProject,
    removeProject,
  };
}
