'use client';

import { useEffect, useRef, useState } from 'react';
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
  deriveSceneLabel,
  buildTakeFileNames,
  type MagnificTakeInput,
  type PipelineProgress,
  type TakeState,
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
 * Modelo de IMAGEM escolhível (a imagem é depois animada pelo Kling 2.5).
 * Ambos confirmados ZERO-crédito no Unlimited. O VÍDEO segue travado em
 * Kling 2.5 720p 9:16 10s. O primeiro da lista é o default seguro.
 */
const IMAGE_MODELS = [
  { slug: 'imagen-nano-banana-2-flash', label: 'Nano Banana 2', icon: '🍌', desc: 'Rápido · consistente' },
  { slug: 'seedream-4-5', label: 'Seedream 4.5', icon: '🌱', desc: 'Detalhe rico · cinematográfico' },
] as const;

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
  // Conta Magnific ATIVA (lida dos cookies da aba magnific.com).
  // Atualiza sozinha a cada 30s — quando user logar em outra conta no
  // Freepik, em até 30s o app reflete (e o batch novo invalida na hora).
  const [activeAccount, setActiveAccount] = useState<{ fpId: number; name?: string; email?: string } | null>(null);
  const [refreshingAccount, setRefreshingAccount] = useState(false);
  useEffect(() => {
    if (!extStatus.connected) return;
    let alive = true;
    async function fetchAccount(force = false) {
      try {
        const { getCurrentAccount } = await import('@/lib/magnific-api-client');
        const acc = await getCurrentAccount(force);
        if (alive) setActiveAccount({ fpId: acc.fpId, name: acc.name, email: acc.email });
      } catch (e) {
        if (alive) console.warn('[auto-broll] fetch account falhou:', e);
      }
    }
    fetchAccount();
    const id = setInterval(() => fetchAccount(), 30_000);
    return () => { alive = false; clearInterval(id); };
  }, [extStatus.connected]);
  async function handleRefreshAccount() {
    setRefreshingAccount(true);
    try {
      const { invalidateUserIdCache, getCurrentAccount } = await import('@/lib/magnific-api-client');
      invalidateUserIdCache();
      const acc = await getCurrentAccount(true);
      setActiveAccount({ fpId: acc.fpId, name: acc.name, email: acc.email });
    } catch (e) {
      console.warn('[auto-broll] refresh account falhou:', e);
    } finally {
      setRefreshingAccount(false);
    }
  }

  // Modelo de IMAGEM escolhível (Nano Banana 2 OU Seedream 4.5). Persiste
  // entre sessões. Default = Nano Banana 2 (o que sempre funcionou). O VÍDEO
  // segue travado em Kling 2.5 — só a imagem que vira animada tem opção.
  const [imageModel, setImageModel] = useToolState<string>('mgAuto:imageModel', IMAGE_MODELS[0].slug);
  // Aspect escolhível (9:16 OU 16:9) — vale pra imagem E vídeo. Default 9:16.
  const [aspect, setAspect] = useToolState<string>('mgAuto:aspect', '9:16');
  const [globalMotion, setGlobalMotion] = useToolState<string>('mgAuto:motion', '');

  // PERSISTENCIA: jobs[] sobrevive reload (user perdia o JSON colado se
  // recarregava a aba sem disparar). Salva so os campos editaveis (name + raw),
  // descarta runtime stuff (progress/zip/status/error). Restaura como 'idle'
  // pra user disparar de novo.
  const JOBS_PERSIST_KEY = 'darkolab:auto-broll:jobs-draft';
  function loadPersistedJobs(): Job[] {
    if (typeof window === 'undefined') return [newJob()];
    try {
      const raw = localStorage.getItem(JOBS_PERSIST_KEY);
      if (!raw) return [newJob()];
      const parsed = JSON.parse(raw) as Array<{ id?: string; name?: string; raw?: string }>;
      if (!Array.isArray(parsed) || parsed.length === 0) return [newJob()];
      return parsed.map((p) => ({
        ...newJob(p.name || ''),
        id: p.id || 'job_' + Math.random().toString(36).slice(2, 9),
        raw: p.raw || '',
      }));
    } catch {
      return [newJob()];
    }
  }
  const [jobs, setJobs] = useState<Job[]>(() => loadPersistedJobs());
  const abortRefs = useRef<Record<string, AbortController | null>>({});

  // Persiste jobs[] (so name + raw + id) a cada mudanca. Throttled debounce
  // de 400ms pra evitar localStorage spam enquanto user digita.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const t = setTimeout(() => {
      try {
        const minimal = jobs.map((j) => ({ id: j.id, name: j.name, raw: j.raw }));
        localStorage.setItem(JOBS_PERSIST_KEY, JSON.stringify(minimal));
      } catch (e) {
        // localStorage cheio — tenta limpar o draft pra nao bloquear
        console.warn('[auto-broll] persist jobs falhou:', e);
      }
    }, 400);
    return () => clearTimeout(t);
  }, [jobs]);

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
    // Anti-freeze: aba em background com job rodando NÃO pode congelar
    const stopKeepAlive = startTabKeepAlive();
    patchJob(job.id, { status: 'running', error: null, zip: null, progress: null });

    // ════════════════════════════════════════════════════════════════════
    // MEMORIA PERSISTENTE (fix 2026-05-30):
    // CRIA entry no historico AGORA, antes do pipeline rodar — com
    // originalJson, takes, imageModel salvos. Se pipeline crashar, browser
    // fechar, energia cair, o que for — o JSON FICA SALVO e RETOMAR pode
    // re-disparar do zero.
    // Entry sera ATUALIZADA no final com takeUrls + ZIP. Ate la, fica como
    // "em andamento".
    // ════════════════════════════════════════════════════════════════════
    const preEntryKey = `broll:${job.id}:${Date.now()}:zip`;
    try {
      const histKey = 'darkolab:auto-broll:history';
      const hist = (() => { try { return JSON.parse(localStorage.getItem(histKey) || '[]'); } catch { return []; } })();
      // Remove só PRÉ-SAVES MORTOS do mesmo jobId (0 sucesso, não em voo) pra
      // evitar duplicata. PRESERVA entries com trabalho concluído (≥1 take ok)
      // — antes um re-disparo do mesmo job APAGAVA o batch completo anterior
      // do histórico (user perdeu o 45-completo ao disparar 85).
      const filtered = hist.filter(
        (h: any) => h.jobId !== job.id || (h.successCount || 0) > 0 || isEntryLive(h),
      );
      filtered.unshift({
        jobId: job.id,
        spaceName: job.name || `BROLL_${job.id}`,
        zipKey: preEntryKey,
        zipName: `${(job.name || `BROLL_${job.id}`).replace(/[^\w\d-]+/g, '_').slice(0, 60)}_takes.zip`,
        totalTakes: takes.length,
        successCount: 0,
        failedCount: takes.length,
        takeUrls: takes.map((t) => ({ idx: t.idx, status: 'pending', videoUrl: null, imageUrl: null })),
        createdAt: Date.now(),
        // ESSENCIAL: salva JSON cru ANTES do pipeline rodar. Se algo dar pau,
        // RETOMAR le isso e re-dispara sem precisar o user colar nada.
        originalJson: job.raw,
        imageModel,
        aspect,
        inFlight: true,
        lastBeatAt: Date.now(),
      });
      localStorage.setItem(histKey, JSON.stringify(filtered.slice(0, 50)));
      window.dispatchEvent(new Event('darkolab:auto-broll:history-changed'));
      console.log(`[auto-broll] pre-salvou entry ${preEntryKey} com ${takes.length} takes + originalJson (${job.raw.length} chars)`);
    } catch (e) {
      console.warn('[auto-broll] pre-save falhou (continua mesmo assim):', e);
    }

    // Heartbeat por TIMER (20s): prova pro RETOMAR (mesma aba ou outra) que
    // este run esta VIVO — bloqueia double-dispatch enquanto roda. Timer em
    // vez de onProgress: fases longas de poll (relaxed mode) ficam minutos
    // sem progress e o gate enfraquecia.
    const beatTimer = setInterval(
      () => patchHistEntry(preEntryKey, { lastBeatAt: Date.now() }),
      20_000,
    );

    try {
      // SEMPRE V2 — API direta Magnific server-side. Sem extension, sem aba aberta.
      let r = await runMagnificPipelineV2(
        {
          spaceName: job.name.trim() || `DARKO_BROLLS_${job.id}`,
          takes,
          imageModel,
          aspect: aspect as '9:16' | '16:9',
          videoModel: 'kling-25',
        },
        {
          signal: ac.signal,
          onProgress: (p) => {
            patchJob(job.id, { progress: p });
            // PERSISTÊNCIA INCREMENTAL: cada take pronto vai pro histórico +
            // IDB NA HORA → reload/desligar PC no meio nunca perde o que ja foi.
            persistTakesIncremental(preEntryKey, (p?.takes as any) || []);
          },
        },
      );

      // AUTO-RETRY de faltantes — user pediu: "A GERACAO NAO DEVE FALHAR NUNCA".
      // Apos primeira rodada, se sobrou >= 1 take faltante E nao foi cancelado,
      // tenta MAIS UMA RODADA automaticamente so com as faltantes. RETOMAR no
      // historico vira fallback de ultimo caso (rede caiu / Magnific morreu).
      const AUTO_RETRY_ROUNDS = 2;
      for (let round = 1; round <= AUTO_RETRY_ROUNDS; round++) {
        if (ac.signal.aborted) break;
        const missing = (r.missingIdxs || []).length;
        if (missing === 0) break;
        const missingTakes = takes.filter((t) => (r.missingIdxs || []).includes(t.idx));
        if (missingTakes.length === 0) break;
        console.log(`[auto-broll] auto-retry round ${round}/${AUTO_RETRY_ROUNDS} — ${missingTakes.length} faltantes`);
        patchJob(job.id, {
          progress: {
            ...(r as any),
            message: `Auto-retry ${round}/${AUTO_RETRY_ROUNDS} — re-disparando ${missingTakes.length} take(s) que faltaram…`,
            phase: 'auto-retry',
          } as any,
        });
        // Pausa entre rodadas pra Magnific liberar concurrent cap
        await new Promise((res) => setTimeout(res, 30_000));
        if (ac.signal.aborted) break;
        try {
          const r2 = await runMagnificPipelineV2(
            {
              spaceName: (job.name.trim() || `DARKO_BROLLS_${job.id}`) + `_AUTORETRY${round}`,
              takes: missingTakes,
              imageModel,
              aspect: aspect as '9:16' | '16:9',
              videoModel: 'kling-25',
            },
            {
              signal: ac.signal,
              onProgress: (p) => {
                patchJob(job.id, { progress: p });
                persistTakesIncremental(preEntryKey, (p?.takes as any) || []);
              },
            },
          );
          // Merge takes do retry com a rodada anterior (preserva os que ja eram
          // ok + atualiza os que viraram ok agora). Cast pra any pra navegar
          // o union de TakeState sem narrowing por cada variant.
          const hasUrl = (t: any) => t && (t.status === 'ready' || !!t.videoUrl);
          const mergedTakes: any[] = (r.takes as any[]).map((t: any) => {
            const better = (r2.takes as any[]).find((nt: any) => nt.idx === t.idx);
            if (better && hasUrl(better)) return better;
            return t;
          });
          // Garante que takes 100% novos (caso edge) tambem entram
          for (const nt of r2.takes as any[]) {
            if (!mergedTakes.find((mt) => mt.idx === nt.idx)) mergedTakes.push(nt);
          }
          const successCount = mergedTakes.filter(hasUrl).length;
          const missingIdxs = mergedTakes.filter((t) => !hasUrl(t)).map((t) => t.idx);
          // Merge ZIPs — preserva videos ja prontos + adiciona novos
          let mergedZip: Blob | undefined = r.zipBlob;
          if (r2.zipBlob && r.zipBlob) {
            try {
              const JSZip = (await import('jszip')).default;
              const merged = new JSZip();
              const a = await JSZip.loadAsync(await r.zipBlob.arrayBuffer());
              const b = await JSZip.loadAsync(await r2.zipBlob.arrayBuffer());
              for (const name of Object.keys(a.files)) {
                const f = a.files[name]; if (f.dir) continue;
                merged.file(name, await f.async('arraybuffer'));
              }
              for (const name of Object.keys(b.files)) {
                const f = b.files[name]; if (f.dir) continue;
                merged.file(name, await f.async('arraybuffer'));
              }
              mergedZip = await merged.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 1 } });
            } catch (e) {
              console.warn('[auto-retry] merge ZIP falhou, usa o maior:', e);
              mergedZip = r2.zipBlob || r.zipBlob;
            }
          } else if (r2.zipBlob) {
            mergedZip = r2.zipBlob;
          }
          r = {
            ...r,
            takes: mergedTakes as any,
            successCount,
            failedCount: takes.length - successCount,
            complete: successCount === takes.length,
            missingIdxs,
            zipBlob: mergedZip,
            zipName: r.zipName || r2.zipName,
          };
          if (successCount === takes.length) break; // 100% pronto, sai
        } catch (e) {
          console.warn(`[auto-broll] auto-retry round ${round} crashou:`, e);
          break; // se retry deu pau, deixa o user fazer RETOMAR manual
        }
      }
      // PERSISTE NO HISTÓRICO sempre que tiver pelo menos 1 sucesso —
      // mesmo batch parcial vale a pena salvar pra user re-baixar depois.
      // (Antes salvava só quando complete=true. Agora salva sempre que houver
      // zipBlob e ao menos 1 take ok.)
      if (r.zipBlob && r.zipName && r.successCount > 0) {
        try {
          const { saveZip } = await import('@/lib/zip-store');
          // Reusa a zipKey ja criada no pre-save (evita duplicata no historico)
          await saveZip(preEntryKey, r.zipBlob, r.zipName);
          const histKey = 'darkolab:auto-broll:history';
          const hist = (() => { try { return JSON.parse(localStorage.getItem(histKey) || '[]'); } catch { return []; } })();
          // ATUALIZA a entry ja existente (criada no pre-save) com o resultado.
          // Mantem originalJson + imageModel + jobId; sobrescreve takeUrls + counts.
          const updated = hist.map((h: any) => {
            if (h.zipKey !== preEntryKey) return h;
            return {
              ...h,
              zipName: r.zipName,
              successCount: r.successCount,
              failedCount: r.failedCount,
              takeUrls: r.takes.map((t: any) => ({
                idx: t.idx,
                status: t.status,
                videoUrl: t.videoUrl || null,
                imageUrl: t.imageUrl || null,
                // diagnóstico: sem isso o histórico só tinha status, impossível
                // saber DEPOIS por que um take falhou
                error: t.error ? String(t.error).slice(0, 250) : null,
                phase: t.phase || null,
              })),
              inFlight: false,
              // mantem originalJson + imageModel + jobId que ja estavam
            };
          });
          localStorage.setItem(histKey, JSON.stringify(updated.slice(0, 50)));
          window.dispatchEvent(new Event('darkolab:auto-broll:history-changed'));
        } catch (e) {
          console.warn('[auto-broll] persist history falhou:', e);
        }
      } else {
        // Sem zipBlob valido — marca entry como falha terminal mas preserva originalJson
        try {
          const histKey = 'darkolab:auto-broll:history';
          const hist = (() => { try { return JSON.parse(localStorage.getItem(histKey) || '[]'); } catch { return []; } })();
          const updated = hist.map((h: any) => {
            if (h.zipKey !== preEntryKey) return h;
            return { ...h, inFlight: false, failedCount: takes.length, successCount: 0 };
          });
          localStorage.setItem(histKey, JSON.stringify(updated.slice(0, 50)));
          window.dispatchEvent(new Event('darkolab:auto-broll:history-changed'));
        } catch {}
      }
      // PROGRESS FINAL com TODOS os takes (merged). Sem isso, o grid ao vivo
      // ficava preso no último onProgress — que vinha do AUTO-RETRY (só os
      // faltantes, ex: 2/2) — então o painel mostrava "2/2" apesar de 45/45
      // no resultado real. Reconstruímos o progress do r.takes completo.
      const finalProgress = {
        spaceId: r.spaceId,
        spaceUrl: undefined,
        takes: r.takes as any,
        ready: r.successCount,
        total: takes.length,
        message: `${r.successCount}/${takes.length} prontos`,
        phase: 'done',
        percent: 100,
      } as PipelineProgress;
      if (r.ok && r.complete && r.zipBlob && r.zipName) {
        patchJob(job.id, { status: 'done', zip: { blob: r.zipBlob, name: r.zipName }, progress: finalProgress });
      } else if (r.complete === false) {
        const miss = (r.missingIdxs || []).join(', ');
        // Mesmo incompleto, se temos ZIP parcial deixa baixar — user reclamou
        // que perdia takes ok quando alguns falhavam.
        patchJob(job.id, {
          status: 'error',
          zip: r.zipBlob && r.zipName ? { blob: r.zipBlob, name: r.zipName } : null,
          progress: finalProgress,
          error: `${r.successCount}/${takes.length} ok. Faltaram: ${miss || '?'}. ZIP parcial disponível abaixo + entrada criada no Histórico. Rode de novo pra completar os faltantes.`,
        });
      } else {
        patchJob(job.id, {
          status: 'error',
          error: `Finalizou sem MP4s (sucesso=${r.successCount}/falhas=${r.failedCount}).`,
        });
      }
    } catch (e) {
      patchJob(job.id, { status: 'error', error: (e as Error).message });
      // Marca entry como nao-em-vôo (originalJson + takes ja estao salvos
      // do pre-save) pra RETOMAR funcionar imediato.
      try {
        const histKey = 'darkolab:auto-broll:history';
        const hist = (() => { try { return JSON.parse(localStorage.getItem(histKey) || '[]'); } catch { return []; } })();
        const updated = hist.map((h: any) => h.zipKey === preEntryKey ? { ...h, inFlight: false } : h);
        localStorage.setItem(histKey, JSON.stringify(updated.slice(0, 50)));
        window.dispatchEvent(new Event('darkolab:auto-broll:history-changed'));
      } catch {}
    } finally {
      abortRefs.current[job.id] = null;
      clearInterval(beatTimer);
      stopKeepAlive();
      // Libera o RETOMAR: run terminou (qualquer que seja o caminho de saida)
      patchHistEntry(preEntryKey, { inFlight: false });
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
        <ToolStep n={1} icon={<IconStepPlug size={18} />} title="Extensão Magnific" hint="Conecta à sua conta Premium+ — gera sem gastar crédito" hue={HUE}>
        {/* Extension status */}
        {extStatus.connected ? (
          <div
            className="relative overflow-hidden rounded-[16px] border border-lime/35 bg-gradient-to-br from-lime/[0.08] via-bg-soft/40 to-bg/30 p-4 backdrop-blur-md"
            style={{
              boxShadow:
                'inset 0 1px 0 rgba(200,232,124,0.10), 0 12px 30px -14px rgba(200,232,124,0.30), 0 0 50px -22px rgba(200,232,124,0.45)',
            }}
          >
            {/* Glow decorativo no canto */}
            <div
              aria-hidden
              className="pointer-events-none absolute -right-12 -top-12 h-40 w-40 rounded-full opacity-40 blur-3xl"
              style={{ background: 'radial-gradient(circle, rgba(200,232,124,0.5), transparent 70%)' }}
            />
            <div className="relative flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] border border-lime/40 bg-lime/10">
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-lime opacity-60" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-lime shadow-[0_0_10px_rgba(200,232,124,0.95)]" />
                  </span>
                </div>
                <div className="flex flex-col gap-0.5">
                  <span
                    className="label-tech text-[10px] font-bold uppercase tracking-[0.18em] text-lime"
                    style={{ fontFamily: 'var(--font-tech)' }}
                  >
                    Magnific · Conectado
                  </span>
                  {/* Linha PRINCIPAL — so o email da conta (sem "Premium+", sem "user N",
                   *  sem versao da extensao — sao info tecnicas sem valor pro user) */}
                  {activeAccount?.email ? (
                    <span className="inline-flex items-center gap-2 text-[13px] font-semibold text-white" style={{ fontFamily: 'var(--font-tech)' }}>
                      {activeAccount.email}
                      <button
                        type="button"
                        onClick={handleRefreshAccount}
                        disabled={refreshingAccount}
                        title="Trocar conta — re-checa apos logar com outro usuario no magnific.com"
                        aria-label="Trocar conta"
                        className="group/sw relative inline-flex h-6 w-6 items-center justify-center rounded-full border border-cyan-400/45 bg-gradient-to-b from-cyan-400/18 via-cyan-400/8 to-transparent text-cyan-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_2px_8px_-3px_rgba(34,211,238,0.4)] transition-all hover:-translate-y-0.5 hover:scale-110 hover:border-cyan-400/70 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.26),0_8px_18px_-4px_rgba(34,211,238,0.6)] active:scale-95 disabled:opacity-50 disabled:cursor-wait"
                      >
                        <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 rounded-t-full bg-gradient-to-b from-white/25 to-transparent" aria-hidden />
                        {refreshingAccount ? (
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" className="relative animate-spin" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M21 12a9 9 0 0 1-15.4 6.4L3 16" />
                            <path d="M3 12a9 9 0 0 1 15.4-6.4L21 8" />
                            <path d="M21 3v5h-5" /><path d="M3 21v-5h5" />
                          </svg>
                        ) : (
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" className="relative" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M21 12a9 9 0 0 1-15.4 6.4L3 16" />
                            <path d="M3 12a9 9 0 0 1 15.4-6.4L21 8" />
                            <path d="M21 3v5h-5" /><path d="M3 21v-5h5" />
                          </svg>
                        )}
                      </button>
                    </span>
                  ) : (
                    // Fallback: se nao conseguimos puxar o email ainda, mostra ao menos
                    // que a extensao esta conectada (sem versao tecnica)
                    <span className="text-[12px] text-text-muted" style={{ fontFamily: 'var(--font-tech)' }}>
                      Detectando conta…
                    </span>
                  )}
                  {sessionOk?.ok ? (
                    <span
                      className="label-tech mt-0.5 inline-flex w-fit items-center gap-1 rounded-full bg-lime/15 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em] text-lime"
                      style={{ fontFamily: 'var(--font-tech)' }}
                    >
                      ✓ {sessionOk.detail || 'sessão validada'}
                    </span>
                  ) : sessionOk && !sessionOk.ok ? (
                    <span
                      className="label-tech mt-0.5 inline-flex w-fit items-center gap-1 rounded-full bg-red-500/15 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em] text-red-300"
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
                className="label-tech inline-flex items-center gap-1.5 rounded-[10px] border border-lime/30 bg-bg-soft/60 px-3 py-2 text-[10px] font-bold uppercase tracking-[0.14em] text-text-muted backdrop-blur transition-all hover:border-lime hover:bg-lime/5 hover:text-lime active:translate-y-px disabled:opacity-50"
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

        <ToolStep n={2} icon={<IconStepSliders size={18} />} title="Configuração" hint="Escolha o modelo da imagem — o vídeo é sempre Kling 2.5" hue={HUE}>
          {/* IMAGEM = escolhível (Nano Banana 2 OU Seedream 4.5, ambos
              zero-crédito). VÍDEO travado em Kling 2.5. */}
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-[14px] border border-violet/30 bg-bg-soft/40 p-3">
              <div className="label-tech mb-2 flex items-center gap-2 text-[10px] uppercase tracking-widest text-violet">
                <span>Imagem (animada pelo Kling)</span>
                <span className="rounded-full border border-lime/40 bg-lime/10 px-1.5 py-0.5 text-[8px] text-lime">unlimited · 0 crédito</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {IMAGE_MODELS.map((m) => {
                  const active = imageModel === m.slug;
                  return (
                    <button
                      key={m.slug}
                      type="button"
                      onClick={() => setImageModel(m.slug)}
                      disabled={anyRunning}
                      className={`flex flex-col items-start gap-0.5 rounded-[12px] border px-3 py-2.5 text-left transition disabled:opacity-50 ${
                        active
                          ? 'border-violet bg-violet/15 shadow-[0_0_0_1px_rgba(167,139,250,0.5),0_6px_18px_-8px_rgba(167,139,250,0.55)]'
                          : 'border-line bg-bg/40 hover:border-violet/50'
                      }`}
                    >
                      <span className="flex items-center gap-1.5 text-[13px] font-bold text-text">
                        <span>{m.icon}</span>{m.label}
                        {active && <span className="ml-auto text-violet">●</span>}
                      </span>
                      <span className="mono text-[9px] uppercase tracking-wider text-text-muted">1K · 9:16 · {m.desc}</span>
                    </button>
                  );
                })}
              </div>
            </div>
            <ModelCard
              kind="video"
              label="Vídeo"
              model="Kling 2.5"
              specs={['720p', aspect, '10s']}
              icon="🎬"
              tint="cyan"
            />
          </div>
          {/* ASPECT — vale pra imagem E vídeo (precisam casar). */}
          <div className="mt-3 rounded-[14px] border border-cyan-400/25 bg-bg-soft/40 p-3">
            <div className="label-tech mb-2 text-[10px] uppercase tracking-widest text-cyan-300">Formato (imagem + vídeo)</div>
            <div className="grid grid-cols-2 gap-2">
              {([
                { v: '9:16', label: 'Vertical 9:16', icon: '📱', desc: 'Reels · TikTok · Shorts' },
                { v: '16:9', label: 'Horizontal 16:9', icon: '🖥️', desc: 'YouTube · VSL · landscape' },
              ] as const).map((a) => {
                const active = aspect === a.v;
                return (
                  <button
                    key={a.v}
                    type="button"
                    onClick={() => setAspect(a.v)}
                    disabled={anyRunning}
                    className={`flex flex-col items-start gap-0.5 rounded-[12px] border px-3 py-2.5 text-left transition disabled:opacity-50 ${
                      active
                        ? 'border-cyan-400 bg-cyan-400/15 shadow-[0_0_0_1px_rgba(34,211,238,0.5),0_6px_18px_-8px_rgba(34,211,238,0.55)]'
                        : 'border-line bg-bg/40 hover:border-cyan-400/50'
                    }`}
                  >
                    <span className="flex w-full items-center gap-1.5 text-[13px] font-bold text-text">
                      <span>{a.icon}</span>{a.label}
                      {active && <span className="ml-auto text-cyan-300">●</span>}
                    </span>
                    <span className="mono text-[9px] uppercase tracking-wider text-text-muted">{a.desc}</span>
                  </button>
                );
              })}
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

        <ToolStep n={3} icon={<IconStepPipeline size={18} />} title="Jobs" hint="Cada lista de prompts roda em série" hue={HUE}>
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
                if (!confirm(`DEBUG: reiniciar "${job.name || 'job ' + (idx + 1)}" do ZERO?\n\nAborta o atual e recria do ZERO.`)) return;
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
              + Adicionar outro JSON
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

type HistEntry = {
  jobId: string;
  spaceName: string;
  zipKey: string;
  zipName: string;
  totalTakes: number;
  successCount: number;
  failedCount: number;
  takeUrls: Array<{ idx: number; status: string; videoUrl: string | null; imageUrl: string | null; error?: string | null; phase?: string | null }>;
  createdAt: number;
  /** JSON original colado pelo user. Pre-condicao pra RETOMAR — sem isso,
   *  nao temos como reconstruir as prompts das takes que faltaram.
   *  Adicionado em 2026-05-30; entries antigas nao tem. */
  originalJson?: string;
  imageModel?: string;
  /** aspect usado no batch (9:16 OU 16:9) — RETOMAR reusa o mesmo. */
  aspect?: string;
  /** true enquanto um pipeline (disparo OU retomar) esta rodando pra esta
   *  entry. Junto com lastBeatAt bloqueia RETOMAR de double-dispatch. */
  inFlight?: boolean;
  /** heartbeat: atualizado ~10s pelo onProgress. Se inFlight mas o beat
   *  parou ha >90s, o run morreu (crash/reload) e RETOMAR libera. */
  lastBeatAt?: number;
};

/** True se a entry tem um pipeline VIVO rodando agora (qualquer aba).
 *  inFlight sozinho nao basta: crash/reload deixa true pra sempre —
 *  o heartbeat diferencia run vivo de run morto. */
function isEntryLive(item: HistEntry): boolean {
  return !!item.inFlight && !!item.lastBeatAt && Date.now() - item.lastBeatAt < 90_000;
}

/** Extrai o array de takes cru do originalJson (aceita array direto OU
 *  objeto {takes:[...]} / {prompts:[...]}). */
function rawTakesOf(item: HistEntry): any[] {
  if (!item.originalJson) return [];
  try {
    const j = JSON.parse(item.originalJson);
    if (Array.isArray(j)) return j;
    return j?.takes || j?.prompts || j?.nano_banana_prompts || [];
  } catch { return []; }
}

/** idx de um take cru: take (num) → id (T01→1) → ordem. */
function rawTakeIdx(t: any, i: number): number {
  if (typeof t?.take === 'number') return t.take;
  if (typeof t?.id === 'string') { const m = t.id.match(/\d+/); if (m) return parseInt(m[0], 10); }
  return i + 1;
}

/** Mapa idx -> rótulo descritivo da cena (robusto a qualquer formato de JSON),
 *  pra rotular o preview. */
function buildLabelMap(item: HistEntry): Record<number, string> {
  const out: Record<number, string> = {};
  rawTakesOf(item).forEach((t, i) => {
    const label = deriveSceneLabel(t);
    if (label) out[rawTakeIdx(t, i)] = label;
  });
  return out;
}

/** Mapa idx -> nome de arquivo .mp4 descritivo (sem número, dedup), pros ZIPs
 *  reconstruídos baterem com a mesma regra do pipeline. */
function buildEntryFileNames(item: HistEntry): Record<number, string> {
  const labels = buildLabelMap(item);
  return buildTakeFileNames((item.takeUrls || []).map((t) => ({ idx: t.idx, label: labels[t.idx] })));
}

/** Chave IDB do MP4 individual de um take (offline-proof, sobrevive expiração
 *  de URL e PC desligado). */
function takeVideoKey(zipKey: string, idx: number): string {
  return `brollvid:${zipKey}:${idx}`;
}

// Set por zipKey dos takes cujo MP4 já foi (ou está sendo) baixado pro IDB.
const _savedTakeVideos = new Map<string, Set<number>>();

/** PERSISTÊNCIA INCREMENTAL — chamada a cada onProgress de um run vivo.
 *  (1) Grava videoUrl/status de cada take PRONTO na entry do histórico
 *      (localStorage) → sobrevive a reload no meio da geração.
 *  (2) Baixa o MP4 pro IndexedDB em background (1 por vez, idempotente) →
 *      sobrevive a URL expirada E a PC desligado.
 *  Fire-and-forget: NÃO bloqueia o onProgress. Como os vídeos completam
 *  espaçados (relaxed mode), o download incremental é naturalmente ritmado. */
function persistTakesIncremental(
  zipKey: string,
  takes: Array<{ idx: number; status?: string; videoUrl?: string | null; imageUrl?: string | null }>,
): void {
  // (1) merge URLs na entry (síncrono, barato)
  try {
    const histKey = 'darkolab:auto-broll:history';
    const hist = JSON.parse(localStorage.getItem(histKey) || '[]');
    let changed = false;
    const updated = hist.map((h: any) => {
      if (h.zipKey !== zipKey) return h;
      const tu = [...(h.takeUrls || [])];
      for (const t of takes) {
        const v = t.videoUrl;
        if (!v) continue;
        const i = tu.findIndex((x: any) => x.idx === t.idx);
        if (i >= 0) {
          if (tu[i].status !== 'ready' || tu[i].videoUrl !== v) {
            tu[i] = { ...tu[i], status: 'ready', videoUrl: v, imageUrl: t.imageUrl || tu[i].imageUrl || null };
            changed = true;
          }
        } else {
          tu.push({ idx: t.idx, status: 'ready', videoUrl: v, imageUrl: t.imageUrl || null });
          changed = true;
        }
      }
      if (!changed) return h;
      const ok = tu.filter((x: any) => x.status === 'ready' || x.videoUrl).length;
      return { ...h, takeUrls: tu, successCount: ok, failedCount: Math.max(0, (h.totalTakes || tu.length) - ok) };
    });
    if (changed) {
      localStorage.setItem(histKey, JSON.stringify(updated));
      window.dispatchEvent(new Event('darkolab:auto-broll:history-changed'));
    }
  } catch {}

  // (2) baixa MP4s novos pro IDB (offline), idempotente + 1 por vez
  let saved = _savedTakeVideos.get(zipKey);
  if (!saved) { saved = new Set(); _savedTakeVideos.set(zipKey, saved); }
  for (const t of takes) {
    const v = t.videoUrl;
    if (!v || saved.has(t.idx)) continue;
    saved.add(t.idx); // marca ANTES (evita corrida em onProgress paralelo)
    void (async () => {
      try {
        const r = await fetch(v);
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const blob = await r.blob();
        const { saveBlob } = await import('@/lib/zip-store');
        await saveBlob(takeVideoKey(zipKey, t.idx), blob, 'video/mp4');
      } catch {
        saved!.delete(t.idx); // libera p/ nova tentativa no próximo onProgress
      }
    })();
  }
}

/** Reconstrói o ZIP de um batch a partir do que sobreviveu: prefere os MP4s
 *  salvos no IDB (offline), cai pra fetch das URLs Magnific. Nomes descritivos
 *  pelo section (match CutFeeling). Retorna {blob, n, faltam}. */
async function buildZipFromEntry(item: HistEntry): Promise<{ blob: Blob; n: number; faltam: number } | null> {
  const JSZip = (await import('jszip')).default;
  const { loadBlob } = await import('@/lib/zip-store');
  const names = buildEntryFileNames(item);
  const zip = new JSZip();
  let n = 0, faltam = 0;
  for (const t of [...(item.takeUrls || [])].sort((a, b) => a.idx - b.idx)) {
    const name = names[t.idx] || `take_${String(t.idx).padStart(2, '0')}.mp4`;
    let bytes: ArrayBuffer | null = null;
    try {
      const blob = await loadBlob(takeVideoKey(item.zipKey, t.idx), 'video/mp4');
      if (blob) bytes = await blob.arrayBuffer();
    } catch {}
    if (!bytes && t.videoUrl) {
      try { const r = await fetch(t.videoUrl); if (r.ok) bytes = await r.arrayBuffer(); } catch {}
    }
    if (bytes) { zip.file(name, bytes); n++; } else if (t.status === 'ready' || t.videoUrl) { faltam++; }
  }
  if (n === 0) return null;
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 1 } });
  return { blob, n, faltam };
}

/** Grid de preview de UM batch do histórico: cada take com vídeo embutido
 *  (player nativo) + rótulo. Prefere o MP4 salvo no IDB (offline); se não
 *  houver, usa a URL Magnific; se expirou, mostra o poster da imagem.
 *  Takes que falharam viram placeholder. */
function HistoryPreviewCell({ zipKey, idx, videoUrl, imageUrl, label, status, live }: {
  zipKey: string; idx: number; videoUrl: string | null; imageUrl: string | null; label: string; status: string; live?: TakeState | null;
}) {
  // Prefere o MP4 salvo no IDB (offline-proof). Senão usa a URL Magnific.
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true; let created: string | null = null;
    (async () => {
      try {
        const { loadBlob } = await import('@/lib/zip-store');
        const blob = await loadBlob(takeVideoKey(zipKey, idx), 'video/mp4');
        if (blob && alive) { created = URL.createObjectURL(blob); setBlobUrl(created); }
      } catch {}
    })();
    return () => { alive = false; if (created) URL.revokeObjectURL(created); };
  }, [zipKey, idx]);
  // Estado AO VIVO (retomada): em geração mostra coelho + barra; recém-pronto
  // toca a URL nova na hora (antes do MP4 cair no IDB).
  const liveInProgress = !!live && (live.status === 'idle' || live.status === 'running' || live.status === 'image-done');
  const livePercent = live && live.status === 'running' ? live.percent : live && live.status === 'image-done' ? 50 : 0;
  const liveVideoUrl = live && (live.status === 'video-done' || live.status === 'ready') ? live.videoUrl : null;
  const src = blobUrl || liveVideoUrl || videoUrl;
  return (
    <div className="overflow-hidden rounded-[10px] border border-line/60 bg-bg/50">
      <div className="relative aspect-[9/16] bg-black/40">
        {liveInProgress ? (
          // EM GERAÇÃO AO VIVO — coelho saltitante + shimmer + barra (igual
          // ao disparo do zero). Refs de keyframes (abHop/abShimmer) injetadas
          // 1x pelo HistoryPreviewGrid.
          <div className="absolute inset-0 flex items-center justify-center overflow-hidden bg-gradient-to-br from-violet/[0.10] via-bg-soft to-bg">
            <div aria-hidden className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/[0.06] to-transparent" style={{ animation: 'abShimmer 2.4s ease-in-out infinite' }} />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/auto-edit-logo@64.png" alt="" width={32} height={32} className="relative z-10 drop-shadow-[0_0_12px_rgba(167,139,250,0.85)]" style={{ animation: 'abHop 1.6s ease-in-out infinite' }} />
            <div className="absolute bottom-0 left-0 right-0 h-1 bg-line/40">
              <div className="h-full bg-gradient-to-r from-violet via-violet-deep to-cyan-400 transition-all duration-500" style={{ width: `${Math.max(livePercent, 6)}%`, boxShadow: '0 0 8px rgba(167,139,250,0.6)' }} />
            </div>
          </div>
        ) : src ? (
          <video src={src} poster={imageUrl || undefined} controls playsInline muted preload="metadata" className="h-full w-full object-cover" />
        ) : imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imageUrl} alt={label} className="h-full w-full object-cover opacity-60" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-[10px] text-text-muted">
            {status === 'failed' ? 'falhou' : status}
          </div>
        )}
        <span className="absolute left-1 top-1 rounded bg-black/70 px-1.5 py-0.5 text-[9px] font-bold text-lime">
          {String(idx).padStart(2, '0')}
        </span>
        {liveInProgress ? (
          <span className="absolute right-1 top-1 flex h-3 w-3 items-center justify-center" title="Gerando agora">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-violet opacity-70" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-violet" />
          </span>
        ) : blobUrl ? (
          <span className="absolute right-1 top-1 rounded bg-lime/90 px-1 py-0.5 text-[8px] font-bold text-black" title="Salvo offline">💾</span>
        ) : null}
      </div>
      <div className="px-1.5 py-1 text-[9px] leading-tight text-text-dim line-clamp-2" title={label}>
        {label}
      </div>
    </div>
  );
}

function HistoryPreviewGrid({ item, live }: { item: HistEntry; live?: Record<number, TakeState> | null }) {
  const labels = buildLabelMap(item);
  const takes = [...(item.takeUrls || [])].sort((a, b) => a.idx - b.idx);
  const readyCount = takes.filter((t) => t.status === 'ready' || t.videoUrl).length;
  const liveOn = !!live;
  return (
    <div className={'rounded-[12px] border bg-bg-soft/30 p-3 ' + (liveOn ? 'border-cyan-400/40' : 'border-violet/40')}>
      {/* Keyframes globais (1x) referenciados pelas células em geração ao vivo. */}
      {liveOn ? (
        <style>{`
          @keyframes abHop { 0%,100%{transform:translateY(0) scale(1) rotate(-3deg)} 50%{transform:translateY(-7px) scale(1.08) rotate(3deg)} }
          @keyframes abShimmer { 0%,100%{transform:translateX(-100%)} 50%{transform:translateX(100%)} }
        `}</style>
      ) : null}
      <div className={'mono mb-2 text-[10px] uppercase tracking-widest ' + (liveOn ? 'text-cyan-300' : 'text-violet')}>
        {liveOn ? 'Retomando ao vivo' : 'Preview'} · {readyCount}/{takes.length} prontos
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
        {takes.map((t) => {
          const label = labels[t.idx] || `Take ${String(t.idx).padStart(2, '0')}`;
          return (
            <HistoryPreviewCell
              key={t.idx}
              zipKey={item.zipKey}
              idx={t.idx}
              videoUrl={t.videoUrl}
              imageUrl={t.imageUrl}
              label={label}
              status={t.status}
              live={live ? live[t.idx] || null : null}
            />
          );
        })}
      </div>
    </div>
  );
}

/** Keep-alive anti-freeze: enquanto um job roda, toca um tom INAUDÍVEL
 *  (gain 0.0001). Aba "tocando áudio" é isenta do tab-freezing/intensive
 *  throttling do Chrome — sem isso, a aba em segundo plano CONGELA os
 *  timers e o pipeline PAUSA até o user focar a aba de novo (visto em
 *  produção: heartbeat parado 7min, polls suspensos).
 *  Precisa ser chamado dentro do handler de clique (user gesture) pra o
 *  AudioContext poder iniciar. Retorna stop(). */
function startTabKeepAlive(): () => void {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return () => {};
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    gain.gain.value = 0.0001; // inaudível mas conta como "audible tab"
    osc.frequency.value = 40;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    void ctx.resume().catch(() => {});
    // SAFETY NET: se o disparo foi programático (sem gesture), o AudioContext
    // nasce 'suspended' e não segura a aba. Resume no PRIMEIRO toque do user
    // em qualquer lugar da página → 1 clique e a proteção anti-freeze trava.
    const resumeOnGesture = () => { if (ctx.state === 'suspended') void ctx.resume().catch(() => {}); };
    const evs = ['click', 'keydown', 'pointerdown', 'touchstart'] as const;
    for (const e of evs) window.addEventListener(e, resumeOnGesture, { passive: true });
    return () => {
      try { osc.stop(); void ctx.close(); } catch {}
      for (const e of evs) window.removeEventListener(e, resumeOnGesture);
    };
  } catch {
    return () => {};
  }
}

/** Atualiza campos de uma entry do historico por zipKey (helper compartilhado). */
function patchHistEntry(zipKey: string, patch: Record<string, unknown>): void {
  try {
    const histKey = 'darkolab:auto-broll:history';
    const hist = JSON.parse(localStorage.getItem(histKey) || '[]');
    const updated = hist.map((h: any) => (h.zipKey === zipKey ? { ...h, ...patch } : h));
    localStorage.setItem(histKey, JSON.stringify(updated));
    window.dispatchEvent(new Event('darkolab:auto-broll:history-changed'));
  } catch {}
}

function BrollHistorySection() {
  const [hist, setHist] = useState<HistEntry[]>([]);
  const [loading, setLoading] = useState<string | null>(null);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [retryMsg, setRetryMsg] = useState<string>('');
  // Progresso VISUAL do RETOMAR (barra + contador + rodada), igual ao disparo
  // do zero. done/total = takes renderizadas nesta retomada / faltantes totais.
  const [retryStats, setRetryStats] = useState<
    null | { done: number; total: number; round: number; maxRounds: number }
  >(null);
  // Segundos decorridos da retomada atual (sinal "tá vivo" quando a barra
  // fica parada esperando o Kling em prioridade reduzida).
  const [retryElapsed, setRetryElapsed] = useState<number>(0);
  // Estados AO VIVO por take (idx -> TakeState) durante a retomada — alimenta
  // a grade dinâmica (coelho + barra) igual ao disparo do zero.
  const [retryLive, setRetryLive] = useState<Record<number, TakeState>>({});
  // zipKey do item que esta com o editor inline expandido (pra colar JSON
  // de batches antigos que nao tem originalJson salvo).
  const [pendingJsonFor, setPendingJsonFor] = useState<string | null>(null);
  const [pendingJsonText, setPendingJsonText] = useState<string>('');
  // zipKey do item com o PREVIEW (grid de vídeos) expandido
  const [previewFor, setPreviewFor] = useState<string | null>(null);

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
        // ZIP completo não está no cache — reconstrói do que SOBREVIVEU:
        // MP4s salvos no IDB (offline, mesmo após desligar o PC) + URLs ainda
        // válidas. Nomes descritivos. Salva o ZIP reconstruído pra ficar
        // permanente. Mostra parcial se faltou algo (não perde o que tem).
        const built = await buildZipFromEntry(item);
        if (!built) {
          alert(
            'Nenhum vídeo deste batch está disponível offline nem nas URLs (expiraram). ' +
            'Se ainda há prompts salvos, use RETOMAR pra regerar.'
          );
          return;
        }
        const { blob, n, faltam } = built;
        // Persiste o ZIP reconstruído no IDB → próximos downloads são instantâneos
        try {
          const { saveZip } = await import('@/lib/zip-store');
          await saveZip(item.zipKey, blob, item.zipName);
          window.dispatchEvent(new Event('darkolab:auto-broll:history-changed'));
        } catch {}
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = item.zipName;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
        if (faltam > 0) {
          alert(`Baixado ZIP com ${n} take(s). ${faltam} não estavam mais acessíveis (URL expirada e sem cópia offline). Use RETOMAR pra completar.`);
        }
      }
    } catch (e) {
      alert('Erro: ' + ((e as Error)?.message || String(e)));
    } finally {
      setLoading(null);
    }
  }

  /**
   * Click do botao RETOMAR — TOTALMENTE AUTOMATICO.
   *
   * User: "QUERO QUE AUTOMATICAMENTE SE FALHAR SABER QUAL PROMPTS DO JSON
   * FALTOU E PARTIR DALI DE FORMA AUTOMATICA, INTELIGENCIA E MEMORIA NO
   * SISTEMA / NAO QUERO TER QUE PROCURAR OU TER BOTAO DISSO".
   *
   * Cascata de recuperacao (todas automaticas, sem UI):
   *  1. item.originalJson (saved no pre-save do dispatch — caso comum agora)
   *  2. jobs-draft localStorage (rascunho do editor)
   *  3. tryRecoverFromMagnific (busca prompts via /api/creations)
   *
   * Se TODAS falharem (raro pra batches novos), AI sim abre o editor manual
   * como fallback final + ja tenta auto-recovery em background.
   */
  async function onRetomarClick(item: HistEntry) {
    // 1. Tem originalJson direto na entry → dispara imediato
    if (item.originalJson) {
      void retomar(item, item.originalJson);
      return;
    }
    // 2. Procura no jobs-draft persistido
    let recovered: string | null = null;
    try {
      const draftsRaw = localStorage.getItem('darkolab:auto-broll:jobs-draft');
      if (draftsRaw) {
        const drafts = JSON.parse(draftsRaw) as Array<{ id?: string; raw?: string }>;
        // SOMENTE match exato por jobId. O fallback antigo ("primeiro draft
        // não-vazio") retomava com o JSON de OUTRO job/nicho e envenenava o
        // originalJson da entry pra sempre. Sem match → cai pro recovery via
        // Magnific API / paste manual.
        const exact = drafts.find((d) => d.id === item.jobId && d.raw?.trim());
        if (exact?.raw) recovered = exact.raw;
      }
    } catch {}
    if (recovered) {
      console.log('[retomar] recuperou de jobs-draft, disparando direto');
      // Persiste no entry pra proximos clicks serem instant
      persistJsonToEntrySync(item.zipKey, recovered);
      void retomar({ ...item, originalJson: recovered }, recovered);
      return;
    }
    // 3. Tenta Magnific API (background, mas BLOQUEIA aqui pra esperar)
    setRetrying(item.zipKey);
    setRetryMsg('Recuperando JSON automaticamente do Magnific…');
    try {
      const fromMagnific = await tryRecoverFromMagnific(item);
      if (fromMagnific) {
        console.log('[retomar] recuperou do Magnific, disparando direto');
        persistJsonToEntrySync(item.zipKey, fromMagnific);
        setRetrying(null);
        setRetryMsg('');
        void retomar({ ...item, originalJson: fromMagnific }, fromMagnific);
        return;
      }
    } catch (e) {
      console.warn('[retomar] magnific recovery falhou:', e);
    }
    setRetrying(null);
    setRetryMsg('');
    // 4. Last resort: abre editor pra paste manual (raro)
    setPendingJsonFor(item.zipKey);
    setPendingJsonText('');
    alert(
      'Nao consegui recuperar o JSON automaticamente desse batch antigo.\n\n' +
      'Cola o JSON original — proximos batches vao ter recuperacao automatica.'
    );
  }

  /** Helper sincrono pra salvar JSON na entry — usado quando recuperamos
   *  automaticamente, pra nao perder o JSON pra futuras chamadas. */
  function persistJsonToEntrySync(zipKey: string, json: string) {
    try {
      const histKey = 'darkolab:auto-broll:history';
      const histArr: HistEntry[] = (() => { try { return JSON.parse(localStorage.getItem(histKey) || '[]'); } catch { return []; } })();
      const updated = histArr.map((h) => (h.zipKey === zipKey ? { ...h, originalJson: json } : h));
      localStorage.setItem(histKey, JSON.stringify(updated));
      setHist(updated);
      window.dispatchEvent(new Event('darkolab:auto-broll:history-changed'));
    } catch (e) {
      console.warn('[persistJson] falhou:', e);
    }
  }

  /**
   * RECOVERY MAGICA — tenta recuperar o JSON original da entry buscando
   * direto na API do Magnific via /app/api/creations.
   *
   * Estrategia:
   *  1. Extrai family UUID de qualquer videoUrl/imageUrl da entry
   *  2. Lista creations recentes do Magnific (passa pelo bridge da extensao)
   *  3. Filtra por family
   *  4. Lê metadata.inputPrompt (image) + metadata.prompt (video)
   *  5. Reconstroi JSON ordenado por idx
   *
   * Funciona se: extensao Freepik Sync conectada + creations ainda
   * existem no historico Magnific (~ultimos meses).
   */
  async function tryRecoverFromMagnific(item: HistEntry): Promise<string | null> {
    // 1. Procura family UUID em qualquer URL da entry
    let family: string | null = null;
    for (const t of item.takeUrls) {
      const url = t.videoUrl || t.imageUrl;
      if (!url) continue;
      const m = url.match(/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/);
      if (m) { family = m[1]; break; }
    }
    if (!family) return null;
    // 2. Fetch creations via bridge
    const { magnificFetch } = await import('@/lib/magnific-bridge');
    const r = await magnificFetch(`/app/api/creations?limit=200`);
    if (!r.ok) throw new Error('Magnific API status ' + r.status);
    const body = r.json() as { data?: Array<{ family?: string; tool?: string; metadata?: any }> };
    if (!body.data || body.data.length === 0) return null;
    // 3. Filtra por family
    const matching = body.data.filter((c) => c.family === family);
    if (matching.length === 0) return null;
    // 4. Extrai prompts por idx
    const imageMap = new Map<number, string>();
    const videoMap = new Map<number, string>();
    for (const c of matching) {
      const idx = Number(c.metadata?.index ?? c.metadata?.image_index ?? c.metadata?.position ?? 0);
      const tool = String(c.tool || '').toLowerCase();
      const prompt = c.metadata?.inputPrompt || c.metadata?.prompt || c.metadata?.name;
      if (!prompt) continue;
      if (tool.includes('image') || tool === 'text-to-image') {
        if (!imageMap.has(idx)) imageMap.set(idx, prompt);
      } else if (tool.includes('video') || tool === 'video-generator') {
        if (!videoMap.has(idx)) videoMap.set(idx, prompt);
      }
    }
    if (imageMap.size === 0) return null;
    // 5. Reconstroi takes ordenados
    const takes: Array<{ imagePrompt: string; videoPrompt?: string }> = [];
    const idxs = Array.from(new Set([...imageMap.keys(), ...videoMap.keys()])).sort((a, b) => a - b);
    for (const i of idxs) {
      const img = imageMap.get(i);
      if (!img) continue;
      const obj: { imagePrompt: string; videoPrompt?: string } = { imagePrompt: img };
      const vid = videoMap.get(i);
      if (vid) obj.videoPrompt = vid;
      takes.push(obj);
    }
    return takes.length > 0 ? JSON.stringify(takes, null, 2) : null;
  }

  async function handleRecoverFromMagnific(item: HistEntry) {
    setRetryMsg('Buscando no Magnific…');
    setRetrying(item.zipKey);
    try {
      const json = await tryRecoverFromMagnific(item);
      if (json) {
        setPendingJsonText(json);
        const count = (JSON.parse(json) as any[]).length;
        alert(`Recuperado do Magnific: ${count} takes encontrados! Confere o JSON e clica RETOMAR.`);
      } else {
        alert(
          'Nao consegui recuperar do Magnific (creations sumiram ou extensao desconectada). ' +
          'Cola o JSON original manualmente.'
        );
      }
    } catch (e) {
      alert('Falha buscando no Magnific: ' + ((e as Error)?.message || String(e)) + '\nCola o JSON manualmente.');
    } finally {
      setRetrying(null);
      setRetryMsg('');
    }
  }

  async function handlePasteFromClipboard() {
    try {
      const text = await navigator.clipboard.readText();
      if (text && text.trim()) {
        setPendingJsonText(text.trim());
      } else {
        alert('Area de transferencia vazia. Copia o JSON primeiro.');
      }
    } catch (e) {
      alert('Browser bloqueou leitura da area de transferencia. Cola manualmente com Ctrl+V.');
    }
  }

  function submitPendingJson(item: HistEntry) {
    const raw = pendingJsonText.trim();
    if (!raw) {
      alert('Cola o JSON original primeiro.');
      return;
    }
    // PERSISTE O JSON na entry — esta linha deve rodar ANTES de qualquer
    // outra coisa que possa errar. Garante que o JSON fica salvo mesmo se
    // o retomar dar pau depois (proximo click vira instant).
    try {
      const histRaw = localStorage.getItem('darkolab:auto-broll:history');
      const histArr: HistEntry[] = histRaw ? JSON.parse(histRaw) : [];
      const updated = histArr.map((h) => (h.zipKey === item.zipKey ? { ...h, originalJson: raw } : h));
      localStorage.setItem('darkolab:auto-broll:history', JSON.stringify(updated));
      // Atualiza state local imediatamente — UI ja mostra item com JSON salvo
      setHist(updated);
      // Notifica outras abas + listeners
      window.dispatchEvent(new Event('darkolab:auto-broll:history-changed'));
      console.log(`[retomar] JSON persistido pra ${item.zipKey} (${raw.length} chars)`);
    } catch (e) {
      console.error('[retomar] FALHOU persistir JSON:', e);
      alert('Falha salvando JSON localmente: ' + ((e as Error)?.message || String(e)));
      return; // nem tenta o retomar se persistencia falhou
    }
    setPendingJsonFor(null);
    setPendingJsonText('');
    // Dispara retomar com o JSON capturado (JA persistido acima)
    void retomar({ ...item, originalJson: raw }, raw);
  }

  /**
   * RETOMAR — re-dispara SO os takes que faltaram (status != ready ou sem URL)
   * e mergeia os novos MP4s no ZIP existente no IDB.
   *
   * INTELIGENCIA: identifica precisamente onde parou cruzando o JSON original
   * (todas as takes esperadas) com takeUrls (status de cada uma na entry).
   * So re-dispara as que NAO tem videoUrl ou tem status diferente de 'ready'.
   * Preserva 100% das que ja deram OK + mergeia novos MP4s no ZIP via JSZip.
   *
   * Fluxo:
   *  1. Parseia originalJson → MagnificTakeInput[]
   *  2. Filtra so os idxs faltantes (cruzando com takeUrls)
   *  3. Dispara runMagnificPipelineV2 com subset
   *  4. Mergeia ZIP novo no antigo via JSZip
   *  5. Atualiza entry no localStorage (successCount, takeUrls)
   */
  async function retomar(item: HistEntry, originalJson: string) {
    setRetrying(item.zipKey);
    setRetryMsg('Preparando…');
    setRetryStats(null);
    setRetryElapsed(0);
    setRetryLive({});
    let retomarBeat: ReturnType<typeof setInterval> | null = null;
    let elapsedTimer: ReturnType<typeof setInterval> | null = null;
    // Anti-freeze: gesture do clique permite iniciar o áudio keep-alive
    const stopKeepAlive = startTabKeepAlive();
    try {
      // 1. Identifica faltantes
      const { parseMagnificPrompts } = await import('@/lib/magnific-pipeline');
      const allTakes = parseMagnificPrompts(originalJson);
      if (allTakes.length === 0) {
        throw new Error('JSON parseou vazio — verifica o formato e cola de novo.');
      }
      const readyIdxs = new Set(
        item.takeUrls
          .filter((t) => t.status === 'ready' || !!t.videoUrl)
          .map((t) => t.idx),
      );
      const missingTakes = allTakes.filter((t) => !readyIdxs.has(t.idx));
      if (missingTakes.length === 0) {
        alert('Nenhum take faltante — todos ja estao prontos. Use BAIXAR pra obter o ZIP.');
        return;
      }
      if (!confirm(
        `Retomar: re-disparar ${missingTakes.length} take(s) faltante(s)?\n\n` +
        `(idxs: ${missingTakes.map((t) => t.idx).join(', ')})\n\n` +
        `Os ${item.successCount} ja prontos serao preservados. ZIP sera atualizado no final.`
      )) return;

      // Abre o preview deste batch automaticamente: a grade dinâmica (coelho +
      // barra por take) aparece sem o user precisar clicar em "Preview".
      setPreviewFor(item.zipKey);

      // 2. Dispara so as faltantes — EM ATÉ N RODADAS pra AUTO-CONVERGIR sem o
      //    user clicar RETOMAR repetidamente. PARA quando uma rodada não rende
      //    NENHUMA nova (genuinamente travado: prompt vetado por política ou
      //    sessão Magnific caída) — assim NUNCA entra em loop infinito.
      //    Mesmo se o pipeline abortar uma rodada inteira, a rodada conta 0
      //    progresso e a gente para honesto em vez de re-disparar pra sempre.
      setRetryMsg(`Re-disparando ${missingTakes.length} take(s)…`);
      // Marca a entry como em-voo + heartbeat por timer: RETOMAR em outra
      // aba (ou um segundo clique pos-reload) fica bloqueado enquanto vive.
      patchHistEntry(item.zipKey, { inFlight: true, lastBeatAt: Date.now() });
      retomarBeat = setInterval(
        () => patchHistEntry(item.zipKey, { lastBeatAt: Date.now() }),
        20_000,
      );
      const retomarStartedAt = Date.now();
      elapsedTimer = setInterval(
        () => setRetryElapsed(Math.floor((Date.now() - retomarStartedAt) / 1000)),
        1_000,
      );
      const { runMagnificPipelineV2 } = await import('@/lib/magnific-pipeline-v2');
      // idxs JÁ prontos antes de começar — preserva. Vamos acumulando.
      const doneIdxs = new Set<number>(readyIdxs);
      // Progresso visual: total = faltantes desta retomada; done = soma das
      // rodadas anteriores + prontas da rodada atual (atualiza no onProgress).
      const originalMissing = missingTakes.length;
      let completedBefore = 0;
      setRetryStats({ done: 0, total: originalMissing, round: 1, maxRounds: 4 });
      // Resultados acumulados de TODAS as rodadas (rodadas posteriores
      // sobrescrevem por idx no merge final, então sucesso tardio vence falha).
      const accumTakes: any[] = [];
      const newZipBlobs: Blob[] = [];
      let remaining = missingTakes;
      const MAX_ROUNDS = 4;
      for (let round = 1; round <= MAX_ROUNDS && remaining.length > 0; round++) {
        setRetryMsg(`Rodada ${round}/${MAX_ROUNDS}: re-disparando ${remaining.length} take(s)… (Kling demora, esperando em paz)`);
        setRetryStats({ done: completedBefore, total: originalMissing, round, maxRounds: MAX_ROUNDS });
        const roundTotal = remaining.length;
        const r = await runMagnificPipelineV2(
          {
            spaceName: item.spaceName + '_RETRY',
            takes: remaining,
            imageModel: (item.imageModel as any) || 'imagen-nano-banana-2-flash',
            aspect: (item.aspect === '16:9' ? '16:9' : '9:16'),
            videoModel: 'kling-25',
          },
          {
            onProgress: (p: any) => {
              const ready = (p?.takes || []).filter((t: any) => t.status === 'ready' || !!t.videoUrl).length;
              setRetryMsg(`Rodada ${round}/${MAX_ROUNDS} · ${ready}/${roundTotal} prontos… (paciencia, Kling demora)`);
              setRetryStats({ done: completedBefore + ready, total: originalMissing, round, maxRounds: MAX_ROUNDS });
              // Estados ao vivo por take pra grade dinâmica (coelho + barra).
              setRetryLive((prev) => {
                const next = { ...prev };
                for (const t of ((p?.takes as TakeState[]) || [])) next[t.idx] = t;
                return next;
              });
              // Persiste incrementalmente os faltantes que vao ficando prontos
              // (localStorage + MP4 no IDB) — sobrevive a reload/crash.
              persistTakesIncremental(item.zipKey, (p?.takes as any) || []);
            },
          },
        );
        if (r.zipBlob) newZipBlobs.push(r.zipBlob);
        // videoUrl = verdade do sucesso (independe do status string).
        let newThisRound = 0;
        for (const t of (r.takes as any[]) || []) {
          accumTakes.push(t);
          if (!!t.videoUrl && !doneIdxs.has(t.idx)) { doneIdxs.add(t.idx); newThisRound++; }
        }
        completedBefore += newThisRound;
        setRetryStats({ done: completedBefore, total: originalMissing, round, maxRounds: MAX_ROUNDS });
        remaining = allTakes.filter((t) => !doneIdxs.has(t.idx));
        console.log(`[retomar] rodada ${round}: +${newThisRound} novas · faltam ${remaining.length}`);
        // SEM PROGRESSO nesta rodada = travado de verdade. Para de rodar pra
        // não loopar à toa — o user vê quantas sobraram (e o motivo provável).
        if (newThisRound === 0) {
          console.warn(`[retomar] rodada ${round} não rendeu nenhuma nova — parando (provável bloqueio de política/sessão)`);
          break;
        }
        if (remaining.length === 0) break;
        // Folga curta entre rodadas pra Magnific respirar antes da próxima leva.
        await new Promise((res) => setTimeout(res, 5_000));
      }

      // 3. Merge ZIP antigo + novos MP4s (de TODAS as rodadas)
      setRetryMsg('Mergeando MP4s no ZIP…');
      const { loadZip, saveZip } = await import('@/lib/zip-store');
      const JSZip = (await import('jszip')).default;
      const merged = new JSZip();
      // 3a. Copia arquivos do ZIP antigo (se existir)
      try {
        const oldZip = await loadZip(item.zipKey);
        if (oldZip) {
          const oldBytes = await fetch(oldZip.blobUrl).then((res) => res.arrayBuffer());
          const oldZipObj = await JSZip.loadAsync(oldBytes);
          for (const name of Object.keys(oldZipObj.files)) {
            const f = oldZipObj.files[name];
            if (f.dir) continue;
            const ab = await f.async('arraybuffer');
            merged.file(name, ab);
          }
          URL.revokeObjectURL(oldZip.blobUrl);
        }
      } catch (e) {
        console.warn('[retomar] zip antigo nao acessivel — usando so os novos:', e);
      }
      // 3b. Adiciona os novos de cada rodada (overwrite se duplicado)
      for (const zb of newZipBlobs) {
        try {
          const newBytes = await zb.arrayBuffer();
          const newZipObj = await JSZip.loadAsync(newBytes);
          for (const name of Object.keys(newZipObj.files)) {
            const f = newZipObj.files[name];
            if (f.dir) continue;
            const ab = await f.async('arraybuffer');
            merged.file(name, ab); // overwrite se duplicado
          }
        } catch (e) {
          console.warn('[retomar] zip de rodada não pôde ser mesclado:', e);
        }
      }
      const mergedBlob = await merged.generateAsync({
        type: 'blob',
        compression: 'DEFLATE',
        compressionOptions: { level: 1 },
      });
      await saveZip(item.zipKey, mergedBlob, item.zipName);

      // 4. Atualiza entry: merge takeUrls (novos sobrescrevem antigos do mesmo
      //    idx; rodadas posteriores já vêm depois em accumTakes, então sucesso
      //    tardio vence falha anterior do mesmo idx).
      const newTakeUrls = [...item.takeUrls];
      for (const newT of accumTakes) {
        const idx = newTakeUrls.findIndex((t) => t.idx === newT.idx);
        const entry = {
          idx: newT.idx,
          status: newT.status,
          videoUrl: newT.videoUrl || null,
          imageUrl: newT.imageUrl || null,
        };
        if (idx >= 0) newTakeUrls[idx] = entry;
        else newTakeUrls.push(entry);
      }
      const successCount = newTakeUrls.filter((t) => t.status === 'ready' || !!t.videoUrl).length;
      const failedCount = Math.max(0, item.totalTakes - successCount);
      const updated: HistEntry = {
        ...item,
        takeUrls: newTakeUrls,
        successCount,
        failedCount,
      };
      const histRaw = localStorage.getItem('darkolab:auto-broll:history');
      const histArr: HistEntry[] = histRaw ? JSON.parse(histRaw) : [];
      const newHist = histArr.map((h) => (h.zipKey === item.zipKey ? updated : h));
      localStorage.setItem('darkolab:auto-broll:history', JSON.stringify(newHist));
      window.dispatchEvent(new Event('darkolab:auto-broll:history-changed'));

      const stillMissing = Math.max(0, item.totalTakes - successCount);
      alert(
        stillMissing === 0
          ? `Retomar concluido: ${successCount}/${item.totalTakes} prontos! ZIP atualizado.`
          : `Retomar parou: ${successCount}/${item.totalTakes} prontos · ${stillMissing} seguem travadas após ${MAX_ROUNDS} rodadas (provável prompt vetado por política ou sessão Magnific). ZIP atualizado com o que deu certo — pode clicar RETOMAR de novo mais tarde.`
      );
    } catch (e) {
      alert('RETOMAR falhou: ' + ((e as Error)?.message || String(e)));
    } finally {
      if (retomarBeat) clearInterval(retomarBeat);
      if (elapsedTimer) clearInterval(elapsedTimer);
      stopKeepAlive();
      setRetrying(null);
      setRetryMsg('');
      setRetryStats(null);
      setRetryElapsed(0);
      setRetryLive({});
      patchHistEntry(item.zipKey, { inFlight: false });
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
          <div className="label-tech text-[10px] uppercase tracking-widest text-text-muted mb-1">
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
          const isEditingJson = pendingJsonFor === item.zipKey;
          const isRetrying = retrying === item.zipKey;
          return (
            <div key={item.zipKey} className="grid gap-2">
              <div className="flex items-center gap-3 rounded-[12px] border border-line/60 bg-bg-soft/40 px-4 py-3 backdrop-blur-sm hover:border-violet/40 transition">
                <div className="flex-1 min-w-0">
                  <div className="mono text-[11px] uppercase tracking-widest text-violet truncate">{item.spaceName}</div>
                  <div className="mt-0.5 flex flex-wrap gap-2 text-[10px] text-text-muted">
                    <span>{dateStr}</span>
                    <span>·</span>
                    <span className="text-lime">{item.successCount}/{item.totalTakes} ok</span>
                    {item.failedCount > 0 && (<><span>·</span><span className="text-yellow-300">{item.failedCount} falhas</span></>)}
                    {!item.originalJson && item.failedCount > 0 && (<><span>·</span><span className="text-cyan-300/70">⚠ batch antigo — RETOMAR pedira JSON</span></>)}
                  </div>
                </div>
                {/* RETOMAR — SEMPRE aparece quando ha falhas. Funciona com OU
                 *  sem originalJson (se nao tiver, abre editor pra colar).
                 *  BLOQUEADO enquanto o run original esta VIVO (heartbeat):
                 *  double-dispatch dobrava a carga na conta Magnific →
                 *  "exceeded concurrent" → cascata de falhas. */}
                {item.failedCount > 0 ? (
                  <button
                    type="button"
                    onClick={() => onRetomarClick(item)}
                    disabled={isRetrying || loading === item.zipKey || isEntryLive(item)}
                    className="inline-flex items-center gap-1.5 rounded-[8px] border border-cyan-400/55 bg-cyan-400/15 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-widest text-cyan-300 hover:bg-cyan-400/25 hover:border-cyan-400/75 disabled:opacity-50 disabled:cursor-not-allowed transition"
                    title={
                      isEntryLive(item)
                        ? 'Job AINDA RODANDO — aguarde terminar (retomar agora dobraria a carga e causaria falhas)'
                        : isRetrying
                        ? 'Retomando…'
                        : item.originalJson
                          ? `Retomar inteligente: re-dispara so as ${item.failedCount} faltantes + mergeia no ZIP`
                          : `Retomar: vai pedir o JSON original (batch antigo sem ele salvo)`
                    }
                  >
                    {isRetrying ? (
                      <>
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="animate-spin" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M21 12a9 9 0 0 1-15.4 6.4L3 16" />
                          <path d="M3 12a9 9 0 0 1 15.4-6.4L21 8" />
                          <path d="M21 3v5h-5" /><path d="M3 21v-5h5" />
                        </svg>
                        <span className="normal-case tracking-normal text-[10px]">{retryMsg || 'Retomando…'}</span>
                      </>
                    ) : (
                      <>
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M21 12a9 9 0 0 1-15.4 6.4L3 16" />
                          <path d="M3 12a9 9 0 0 1 15.4-6.4L21 8" />
                          <path d="M21 3v5h-5" /><path d="M3 21v-5h5" />
                        </svg>
                        Retomar ({item.failedCount})
                      </>
                    )}
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => setPreviewFor(previewFor === item.zipKey ? null : item.zipKey)}
                  className="rounded-[8px] border border-violet/45 bg-violet/10 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-widest text-violet hover:bg-violet/20 transition"
                  title="Ver preview dos vídeos deste batch"
                >
                  {previewFor === item.zipKey ? '▴ Fechar' : '👁 Preview'}
                </button>
                <button
                  type="button"
                  onClick={() => redownload(item)}
                  disabled={loading === item.zipKey || isRetrying}
                  className="rounded-[8px] border border-lime/40 bg-lime/10 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-widest text-lime hover:bg-lime/20 disabled:opacity-50"
                  title="Baixar ZIP novamente"
                >
                  {loading === item.zipKey ? '...' : '↓ Baixar'}
                </button>
                <button
                  type="button"
                  onClick={() => remove(item)}
                  disabled={isRetrying}
                  className="rounded-[8px] border border-text-muted/30 bg-bg/40 px-2 py-1.5 text-[11px] text-text-muted hover:border-red-500/40 hover:text-red-300 disabled:opacity-30"
                  title="Remover do histórico"
                >
                  ×
                </button>
              </div>
              {/* Barra de progresso do RETOMAR — visibilidade igual ao disparo
               *  do zero: contador X/total, rodada, tempo decorrido e barra. */}
              {isRetrying && retryStats ? (
                <div className="rounded-[12px] border border-cyan-400/40 bg-cyan-400/[0.05] px-4 py-3">
                  <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-widest text-cyan-300">
                    <span>
                      Rodada {retryStats.round}/{retryStats.maxRounds} · {retryStats.done}/{retryStats.total} renderizados
                    </span>
                    <span className="tabular-nums text-cyan-300/80">
                      {Math.floor(retryElapsed / 60)}m {String(retryElapsed % 60).padStart(2, '0')}s
                    </span>
                  </div>
                  <div className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-bg/60">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-violet transition-all duration-500"
                      style={{ width: `${Math.min(100, Math.round((retryStats.done / Math.max(1, retryStats.total)) * 100))}%` }}
                    />
                  </div>
                  <div className="mt-1.5 text-[9px] text-text-muted">
                    Kling renderiza em lotes de 3 — pode demorar (mais ainda em prioridade reduzida). Tá rodando: não feche a aba. O cronômetro andando = vivo.
                  </div>
                </div>
              ) : null}
              {/* Preview expandido: grid de vídeos do batch (dinâmico no retomar) */}
              {previewFor === item.zipKey ? (
                <HistoryPreviewGrid
                  item={item}
                  live={retrying === item.zipKey ? retryLive : null}
                />
              ) : null}
              {/* Editor inline pra colar JSON original em batches antigos */}
              {isEditingJson ? (
                <div className="rounded-[12px] border border-cyan-400/50 bg-cyan-400/[0.04] p-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_4px_18px_-8px_rgba(34,211,238,0.35)]">
                  <div className="mono mb-2 flex items-center justify-between gap-2 text-[10px] uppercase tracking-widest text-cyan-300">
                    <span>
                      {pendingJsonText.trim()
                        ? `JSON recuperado do draft · ${pendingJsonText.length} chars · RETOMAR vai re-disparar so as ${item.failedCount} faltantes`
                        : `Cola o JSON original aqui · RETOMAR vai re-disparar so as ${item.failedCount} faltantes`}
                    </span>
                    <button
                      type="button"
                      onClick={() => { setPendingJsonFor(null); setPendingJsonText(''); }}
                      className="rounded border border-text-muted/30 px-2 py-0.5 text-[9px] text-text-muted hover:border-red-500/50 hover:text-red-300"
                    >
                      Cancelar
                    </button>
                  </div>
                  <textarea
                    value={pendingJsonText}
                    onChange={(e) => setPendingJsonText(e.target.value)}
                    rows={5}
                    placeholder='[{"imagePrompt":"...","videoPrompt":"..."}, ...]'
                    className="input-field w-full resize-y font-mono text-[11px]"
                    autoFocus
                  />
                  {/* HELPERS pra preencher rapido */}
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={handlePasteFromClipboard}
                      disabled={retrying === item.zipKey}
                      className="label-tech inline-flex items-center gap-1 rounded-md border border-violet/45 bg-violet/10 px-2.5 py-1 text-[10px] uppercase tracking-widest text-violet hover:bg-violet/20 hover:border-violet/65 disabled:opacity-40 transition"
                      title="Colar JSON da area de transferencia (Ctrl+C antes)"
                    >
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
                        <rect x="8" y="2" width="8" height="4" rx="1" />
                      </svg>
                      Colar
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleRecoverFromMagnific(item)}
                      disabled={retrying === item.zipKey}
                      className="label-tech inline-flex items-center gap-1 rounded-md border border-amber-500/55 bg-amber-500/15 px-2.5 py-1 text-[10px] uppercase tracking-widest text-amber-700 hover:bg-amber-500/25 hover:border-amber-500/75 disabled:opacity-40 transition"
                      title="Tenta buscar o JSON direto do Magnific (precisa da extensao Freepik Sync conectada)"
                    >
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="m21 21-4.3-4.3" />
                        <circle cx="11" cy="11" r="8" />
                      </svg>
                      Buscar no Magnific
                    </button>
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    {pendingJsonText.trim() ? (
                      <span className="label-tech text-[9px] uppercase tracking-widest text-lime/80">
                        ✓ JSON ja preenchido — clica RETOMAR pra disparar
                      </span>
                    ) : <span />}
                    <button
                      type="button"
                      onClick={() => submitPendingJson(item)}
                      disabled={!pendingJsonText.trim()}
                      className="inline-flex items-center gap-1.5 rounded-full border border-cyan-400 bg-cyan-400/90 px-4 py-1.5 text-[11px] font-bold uppercase tracking-widest text-black shadow-[0_4px_14px_-4px_rgba(34,211,238,0.5)] hover:bg-cyan-400 hover:scale-[1.03] disabled:opacity-40 disabled:cursor-not-allowed transition"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 12a9 9 0 0 1-15.4 6.4L3 16" />
                        <path d="M3 12a9 9 0 0 1 15.4-6.4L21 8" />
                        <path d="M21 3v5h-5" /><path d="M3 21v-5h5" />
                      </svg>
                      Retomar com este JSON
                    </button>
                  </div>
                </div>
              ) : null}
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
            className="label-tech mb-1.5 block text-[10px] font-bold uppercase tracking-[0.18em] text-text-muted"
            style={{ fontFamily: 'var(--font-tech)' }}
          >
            Código do AD / Nome do Pack
          </span>
          <input
            type="text"
            value={job.name}
            onChange={(e) => onName(e.target.value)}
            placeholder="Ex: AD15VN / PACK DE CÉREBRO 3D"
            className="w-full rounded-[12px] border border-line bg-bg/60 px-4 py-3 text-sm font-medium text-white placeholder:text-text-dim focus:border-violet/60 focus:outline-none focus:ring-2 focus:ring-violet/20 disabled:opacity-50"
            disabled={running}
          />
        </label>

        {/* JSON code editor */}
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <span
              className="label-tech text-[10px] font-bold uppercase tracking-[0.18em] text-text-muted"
              style={{ fontFamily: 'var(--font-tech)' }}
            >
              Prompts do job
              <span className="mx-2 text-text-dim">·</span>
              <span className="text-violet">JSON</span>
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
          className="label-tech inline-flex items-center gap-1.5 rounded-[10px] border border-fuchsia-500/50 bg-fuchsia-500/10 px-3 py-2 text-[10px] font-bold uppercase tracking-[0.14em] text-fuchsia-200 transition-all hover:bg-fuchsia-500/20 active:translate-y-px disabled:opacity-40"
          title="Aborta o atual e recria do ZERO"
          style={{ fontFamily: 'var(--font-tech)' }}
        >
          🐞 Debug
        </button>
        {job.zip && (
          <button
            type="button"
            onClick={onDownload}
            className="label-tech inline-flex items-center gap-1.5 rounded-[10px] border border-lime/50 bg-lime/10 px-3 py-2 text-[10px] font-bold uppercase tracking-[0.14em] text-lime transition-all hover:bg-lime/20 active:translate-y-px"
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
                    className="label-tech text-[10px] font-bold uppercase tracking-[0.18em] text-text-muted"
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
                      className="label-tech rounded-full border border-violet/40 bg-violet/10 px-2 py-0.5 text-[9px] uppercase tracking-widest text-violet"
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
                    className="group relative inline-flex items-center gap-2 overflow-hidden rounded-full border border-lime/60 bg-lime/95 px-4 py-2 text-[11px] font-bold uppercase tracking-[0.14em] text-black shadow-[0_8px_22px_-8px_rgba(200,232,124,0.55)] transition-all hover:scale-[1.03]"
                    style={{ fontFamily: 'var(--font-tech)' }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path d="M12 3v12m0 0l-4-4m4 4l4-4M5 21h14" />
                    </svg>
                    Baixar ZIP ({(job.zip.blob.size / 1024 / 1024).toFixed(1)} MB)
                  </button>
                ) : (
                  <span
                    className="label-tech rounded-full border border-line bg-bg/60 px-3 py-1.5 text-[10px] uppercase tracking-widest text-text-muted"
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
              className={`label-tech text-[9px] font-bold uppercase tracking-[0.22em] ${tintCls.accent}`}
              style={{ fontFamily: 'var(--font-tech)' }}
            >
              {label}
            </span>
            <span
              className="label-tech inline-flex items-center gap-1 rounded-full border border-lime/45 bg-lime/10 px-1.5 py-0 text-[8.5px] font-bold uppercase tracking-[0.14em] text-lime"
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

