'use client';

import { useEffect, useRef, useState } from 'react';
import { ToolShell } from '@/components/ToolShell';
import { JobControlPanel } from '@/components/JobControlPanel';
import { CancelButton } from '@/components/CancelButton';
import { MissingKeyBanner } from '@/components/MissingKeyBanner';
import { useToolState } from '@/components/ToolsStateProvider';
import { Toggle3D } from '@/components/Toggle3D';
import { upsertSharedBatch } from '@/lib/heygen-batch-store';
import { extractAudio, muxAudioIntoVideo } from '@/lib/ffmpeg-worker';
import { camuflar } from '@/lib/camuflagem';
import {
  detectExtension,
  splitCopyIntoParts,
  testHeygenSession,
  type ExtensionStatus,
} from '@/lib/heygen-extension-bridge';
import { runHeyGenJobs, type RunnerResult } from '@/lib/heygen-job-runner';
import { MotorConfigPicker } from '@/components/MotorConfigPicker';
import { defaultMotorConfig, resolveMotors, estimateSecondsFromText, estimateSecondsFromAudio, type MotorConfig } from '@/lib/motor-config';
import {
  heygenApiFetch,
  REQUIRED_EXT_VERSION,
  pollVideosUntilReady,
  downloadVideoBytes,
  type VideoStatus,
} from '@/lib/heygen-api-direct';
import {
  HeyGenAvatarPicker,
  type AvatarOption,
} from '@/components/HeyGenAvatarPicker';
import { CompactAvatarPicker } from '@/components/CompactAvatarPicker';
import { getLibrarySnapshot, reloadLibrary } from '@/lib/heygen-library-cache';
import {
  HeyGenVoicePicker,
  type VoiceOption,
  type ClonedVoice,
} from '@/components/HeyGenVoicePicker';

/**
 * HeyGen Auto Avatar — automacao do HeyGen sem API.
 *
 * Como funciona:
 *  1. User instala a extensao DARKO LAB (Chrome)
 *  2. Faz login no HeyGen normalmente
 *  3. Aqui na ferramenta: escolhe avatar (preview via API, lookup), motor,
 *     voz (default ou override), modo (copy ou audios)
 *  4. Cola copy ou faz upload das partes de audio
 *  5. Clica gerar — extensao automatiza o HeyGen no fundo, parte por parte
 *  6. Recebe ZIP com parte1.mp4, parte2.mp4, ... na ordem certa
 *
 * IMPORTANTE: a geracao via extensao NAO consome a API HeyGen — usa a
 * mensalidade do user. So previews (lookup avatar/voz) usam a API.
 */

type Motor = 'III' | 'IV' | 'V';
type Mode = 'copy' | 'audio';
type SessionTest = {
  state: 'idle' | 'testing' | 'ok' | 'fail';
  detail?: string;
};

type PartResult = RunnerResult;

export default function HeyGenAutoPage() {
  const [extStatus, setExtStatus] = useState<ExtensionStatus>({
    connected: false,
  });
  const [extLoading, setExtLoading] = useState(true);

  const [adName, setAdName] = useToolState<string>('hgauto:adName', '');
  const [motor, setMotor] = useToolState<Motor>('hgauto:motor', 'IV');
  // Motor config avancado (global/percent/individual) — sobrepoe `motor` se usado
  const [motorConfig, setMotorConfig] = useToolState<MotorConfig>('hgauto:motorConfig', { kind: 'global', motor: 'III' });
  const [mode, setMode] = useToolState<Mode>('hgauto:mode', 'copy');
  const [avatarQuery, setAvatarQuery] = useToolState<string>(
    'hgauto:avatarQuery',
    '',
  );
  const [selectedAvatar, setSelectedAvatar] = useToolState<AvatarOption | null>(
    'hgauto:avatar',
    null,
  );
  const [voiceQuery, setVoiceQuery] = useToolState<string>('hgauto:voiceQuery', '');
  const [selectedVoice, setSelectedVoice] = useToolState<VoiceOption | null>(
    'hgauto:voice',
    null,
  );
  const [overrideVoice, setOverrideVoice] = useToolState<boolean>(
    'hgauto:overrideVoice',
    false,
  );

  const [copy, setCopy] = useToolState<string>('hgauto:copy', '');
  const [audioParts, setAudioParts] = useState<File[]>([]);
  // Duracoes reais dos audios (lidas quando audioParts muda)
  const [audioPartsSeconds, setAudioPartsSeconds] = useState<number[]>([]);
  // Avatar First toggle (avatar nao existe na biblioteca, cria via foto+audio)
  const [avatarFirstEnabled, setAvatarFirstEnabled] = useState(false);

  // Calcula duracoes reais dos audios em paralelo
  useEffect(() => {
    let cancelled = false;
    if (audioParts.length === 0) {
      setAudioPartsSeconds([]);
      return;
    }
    Promise.all(audioParts.map((f) => estimateSecondsFromAudio(f))).then((durs) => {
      if (!cancelled) setAudioPartsSeconds(durs);
    });
    return () => { cancelled = true; };
  }, [audioParts]);

  /* ----- Inputs estruturados (multi-hook + body) — feature parity com clickup-pilot ----- */
  /** SEMPRE ativo. Inputs separados pra cada HOOK (1-10) + 1 BODY opcional.
   *  Cada hook vira 1 take. Body e splitado em ~20s pra cada take.
   *  Output final: 3 ZIPs igual clickup-pilot (takes individuais, montados
   *  HOOK[N]+BODY decupados, camuflados opcional). */
  type StructuredInput = { text: string; audios: File[] };
  const [structuredHooks, setStructuredHooks] = useState<StructuredInput[]>([
    { text: '', audios: [] },
  ]);
  const [structuredBody, setStructuredBody] = useState<{
    enabled: boolean;
    text: string;
    audios: File[];
  }>({
    enabled: true,
    text: '',
    audios: [],
  });

  /**
   * Ordena uma lista de Files por nome detectando "parte1, parte2, ..." ou
   * "part1, p1" etc. Se não detectar número, mantém ordem original (estável).
   */
  function sortAudiosByPartName(files: File[]): File[] {
    const re = /(?:parte|part|p)\s*[-_]?\s*(\d+)/i;
    return [...files].sort((a, b) => {
      const ma = re.exec(a.name);
      const mb = re.exec(b.name);
      if (ma && mb) return parseInt(ma[1], 10) - parseInt(mb[1], 10);
      if (ma && !mb) return -1;
      if (!ma && mb) return 1;
      return a.name.localeCompare(b.name);
    });
  }

  /** ZIPs finais do pipeline pos-producao (montado/decupado/camuflado) */
  const [pipelineZips, setPipelineZips] = useState<{
    takesUrl?: string;
    takesName?: string;
    montadoUrl?: string;
    montadoName?: string;
    camufladoUrl?: string;
    camufladoName?: string;
    diagnosticMsg?: string;
  }>({});

  /* --------------- Modo Dinamico (multi-avatar por parte) --------------- */
  const [dynamicMode, setDynamicMode] = useToolState<boolean>(
    'hgauto:dynamic',
    false,
  );

  /* --------------- Modo Camuflagem (3a pasta com audio camuflado) --------- */
  const [camuflagemMode, setCamuflagemMode] = useToolState<boolean>(
    'hgauto:camuflagem',
    false,
  );
  const [camuflagemWhite, setCamuflagemWhite] = useState<File | null>(null);
  const [camuflagemVolume, setCamuflagemVolume] = useToolState<number>(
    'hgauto:camuflagemVol',
    30,
  );
  // Per-part avatar override (null = usa selectedAvatar global). Indexado
  // pela posicao da parte (text: ordem do split; audio: ordem do array).
  const [partAvatars, setPartAvatars] = useState<(AvatarOption | null)[]>([]);
  // Permutacao dos audios em modo dinamico (audioParts mantem ordem original
  // do upload; audioOrder vira a permutacao de indices). Default = identidade.
  const [audioOrder, setAudioOrder] = useState<number[]>([]);

  const [clonedVoices, setClonedVoices] = useToolState<ClonedVoice[]>(
    'hgauto:clonedVoices',
    [],
  );
  const [sessionTest, setSessionTest] = useState<SessionTest>({ state: 'idle' });

  const [parts, setParts] = useState<string[]>([]);
  // Quando vem do ClickUp Pilot com partes ja parseadas (HOOK 1, HOOK 2, BODY),
  // bypassa o auto-split. Reset via "Limpar override" ou troca de copy/mode.
  const [forcedParts, setForcedParts] = useState<{ label: string; text: string }[] | null>(null);
  const [results, setResults] = useState<PartResult[]>([]);
  const [processing, setProcessing] = useState(false);
  const [stage, setStage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cancelRef = useRef<boolean>(false);
  /** Id estavel desse run no store compartilhado de batches (espelho
   *  pro lipsync-history/background/painel + Retomar via motor). */
  const runBatchIdRef = useRef<string | null>(null);

  // Auto-download (polling + ZIP)
  const [downloading, setDownloading] = useState(false);
  const [downloadStage, setDownloadStage] = useState<string | null>(null);
  const [downloadStatuses, setDownloadStatuses] = useState<Record<string, VideoStatus>>({});
  const downloadCancelRef = useRef<boolean>(false);

  const safeName = (adName.trim() || 'heygen').replace(/[^a-z0-9_-]/gi, '_');

  /* --------------- Extension detection --------------- */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const s = await detectExtension();
      if (!cancelled) {
        setExtStatus(s);
        setExtLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /* --------------- Handoff de outras tools (ClickUp Pilot) --------------- */
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    if (url.searchParams.get('from') !== 'clickup-pilot') return;
    const raw = sessionStorage.getItem('darkolab:heygen-auto:handoff');
    if (!raw) return;
    try {
      const h = JSON.parse(raw) as {
        adName?: string;
        motor?: 'III' | 'IV' | 'V';
        mode?: 'copy' | 'audio';
        copy?: string;
        dynamic?: boolean;
        partAvatarIds?: (string | null)[];
        partLabels?: string[];
        partTexts?: string[];
        /** ClickUp Pilot pode enviar voiceId por parte (override). Se any
         *  parte tem voiceId !== null, usa override mode no HeyGen Auto. */
        partVoiceIds?: (string | null)[];
      };
      if (h.adName) setAdName(h.adName);
      if (h.motor) setMotor(h.motor);
      if (h.mode) setMode(h.mode);
      if (h.copy) setCopy(h.copy);
      if (h.dynamic) setDynamicMode(true);
      // Forca partes EXATAS do parser (HOOK 1, HOOK 2, BODY) em vez de
      // re-split. Mantem mapping consistente com partAvatars.
      if (h.partTexts && h.partTexts.length > 0) {
        setForcedParts(
          h.partTexts.map((text, i) => ({
            label: h.partLabels?.[i] || `parte${i + 1}`,
            text,
          })),
        );
      }
      // Pre-popula partAvatars depois que groups loadarem (precisa do snapshot)
      if (h.partAvatarIds && h.partAvatarIds.length > 0) {
        const snap = getLibrarySnapshot();
        const buildFromIds = () => {
          const flat: AvatarOption[] = [];
          for (const g of getLibrarySnapshot().groups) {
            for (const l of g.looks) {
              flat.push({
                id: l.id,
                name: l.name,
                thumb: l.thumb,
                videoPreview: l.videoPreview,
                type: l.type,
                version: l.version,
                groupId: l.groupId,
                groupName: l.groupName,
                voiceId: (l as any).voiceId ?? null,
              });
            }
          }
          const mapped = (h.partAvatarIds || []).map((id, i) => {
            if (!id) return null;
            const av = flat.find((a) => a.id === id) || null;
            // ClickUp Pilot pode enviar voiceId override por parte. Quando
            // presente, sobrescreve o voiceId padrao do avatar pra ESSA parte.
            const overrideVoice = h.partVoiceIds?.[i];
            if (av && overrideVoice) {
              return { ...av, voiceId: overrideVoice };
            }
            return av;
          });
          setPartAvatars(mapped);
          // Selecionar o PRIMEIRO avatar como global (pra fallback de partes
          // sem avatar especifico)
          const firstWithAvatar = mapped.find((a) => a !== null);
          if (firstWithAvatar) setSelectedAvatar(firstWithAvatar);
        };
        if (snap.groups.length > 0) buildFromIds();
        else {
          reloadLibrary(false).then(() => buildFromIds());
        }
      }
      // Limpa handoff pra nao re-aplicar em refresh
      sessionStorage.removeItem('darkolab:heygen-auto:handoff');
    } catch (e) {
      console.warn('[heygen-auto] handoff parse falhou:', e);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* (avatar + voice search delegados aos componentes compartilhados) */

  /* --------------- Parts preview (sempre estruturado) --------------- */
  useEffect(() => {
    if (mode !== 'copy') {
      setParts([]);
      return;
    }
    // Forced parts (do ClickUp Pilot) sobrescreve inputs estruturados.
    // Mantido pra compat — o handoff popula partTexts ja splitados.
    if (forcedParts && forcedParts.length > 0) {
      setParts(forcedParts.map((p) => p.text));
      return;
    }
    // Estruturado: parts = [HOOK 1, HOOK 2, ..., BODY split 1, BODY split 2, ...]
    const arr: string[] = [];
    for (const h of structuredHooks) {
      if (h.text.trim()) arr.push(h.text);
    }
    if (structuredBody.enabled && structuredBody.text.trim()) {
      arr.push(...splitCopyIntoParts(structuredBody.text, { targetSec: 20, minSec: 10, maxSec: 35 }));
    }
    setParts(arr);
  }, [mode, forcedParts, structuredHooks, structuredBody]);

  /* --------------- Resize dos arrays per-part quando count muda --------------- */
  useEffect(() => {
    const n = mode === 'copy' ? parts.length : audioParts.length;
    setPartAvatars((prev) => {
      const next = prev.slice(0, n);
      while (next.length < n) next.push(null);
      return next;
    });
    setAudioOrder((prev) => {
      if (mode !== 'audio') return [];
      // Se contagem mudou, reseta pra ordem identidade
      if (prev.length !== audioParts.length) {
        return audioParts.map((_, i) => i);
      }
      return prev;
    });
  }, [mode, parts.length, audioParts.length]);

  function cancel() {
    cancelRef.current = true;
    setStage('Cancelando...');
  }

  function cancelDownload() {
    downloadCancelRef.current = true;
    setDownloadStage('Cancelando...');
  }

  async function downloadAllAsZip() {
    const ready = results.filter((r) => r.videoId);
    if (ready.length === 0) {
      setError('Nenhuma parte com videoId. Gere as partes primeiro.');
      return;
    }
    setError(null);
    setDownloading(true);
    downloadCancelRef.current = false;
    setDownloadStatuses({});
    setDownloadStage(`Aguardando renderizacao no HeyGen (${ready.length} partes)...`);
    const bId = runBatchIdRef.current;
    if (bId) upsertSharedBatch(bId, { phase: 'downloading', message: 'Renderizando + baixando no HeyGen...' });

    try {
      const ids = ready.map((r) => r.videoId!) ;
      const final = await pollVideosUntilReady(ids, {
        intervalMs: 8000,
        timeoutMs: 30 * 60 * 1000,
        isCancelled: () => downloadCancelRef.current,
        onStatus: (statuses) => {
          setDownloadStatuses(statuses);
          const done = Object.values(statuses).filter((s) => s.status === 'completed').length;
          const failed = Object.values(statuses).filter((s) => s.status === 'failed').length;
          setDownloadStage(
            `Renderizando: ${done}/${ids.length} prontos${failed > 0 ? `, ${failed} falhou` : ''}...`,
          );
        },
      });

      if (downloadCancelRef.current) return;

      // Baixa cada video + zipa. Sequencial pra nao saturar download (videos sao grandes).
      // Mantem refs aos blobs em memoria pra rodar camuflagem apos zipar.
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();
      const partBlobs: Array<{ label: string; blob: Blob | null }> = [];
      for (let i = 0; i < ready.length; i++) {
        if (downloadCancelRef.current) return;
        const part = ready[i];
        const status = final[part.videoId!];
        setDownloadStage(`Baixando parte ${i + 1}/${ready.length} (${part.label})...`);
        if (status?.status !== 'completed' || !status.videoUrl) {
          zip.file(`${part.label}_FAILED.txt`, `Status: ${status?.status || 'unknown'}\nErro: ${status?.error || 'sem video_url'}`);
          partBlobs.push({ label: part.label, blob: null });
          continue;
        }
        try {
          const bytes = await downloadVideoBytes(status.videoUrl);
          zip.file(`${part.label}.mp4`, bytes);
          partBlobs.push({ label: part.label, blob: new Blob([bytes as BlobPart], { type: 'video/mp4' }) });
        } catch (e) {
          zip.file(`${part.label}_DOWNLOAD_ERROR.txt`, String((e as Error)?.message || e));
          partBlobs.push({ label: part.label, blob: null });
        }
      }

      setDownloadStage('Zipando takes...');
      const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 1 } });
      const filename = `${safeName}_takes.zip`;
      if (bId) {
        try {
          const { saveZip } = await import('@/lib/zip-store');
          await saveZip(`batch:${bId}:takes`, blob, filename);
          upsertSharedBatch(bId, { zipFilename: filename });
        } catch (e) { console.warn('[heygen-auto] save takes IDB:', e); }
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 5000);

      // === PIPELINE POS-PRODUCAO: gera ZIP montado HOOK[N]+BODY decupados ===
      // Usa o mesmo runPostPipeline do clickup-pilot.
      let pipeMontadoUrl: string | undefined;
      let pipeMontadoName: string | undefined;
      let pipeDiagnostic: string | undefined;
      if (partBlobs.some(p => p.blob)) {
        setDownloadStage('Montando HOOK+BODY decupados (pipeline)...');
        try {
          const { runPostPipeline } = await import('@/lib/clickup-pilot-pipeline');
          const pipeRes = await runPostPipeline({
            baseAdId: safeName,
            parts: partBlobs,
            decupagem: true,
            camuflagem: false, // camuflagem fica no zip dedicado abaixo
            onProgress: (p) => {
              setDownloadStage(`${p.stage} ${p.doneCount}/${p.totalCount}${p.currentFilename ? ` · ${p.currentFilename}` : ''}`);
            },
          });
          pipeDiagnostic = pipeRes.diagnostics.summary;
          // Monta ZIP com decupados (ou raw assembled se decupagem falhou)
          const zipMont = new JSZip();
          for (const item of pipeRes.items) {
            if (item.decupado) {
              zipMont.file(item.filename, item.decupado);
            } else if (item.rawAssembled && item.rawAssembled.size > 0 && !item.errors?.assemble) {
              zipMont.file(item.filename.replace('.mp4', '_sem_decupagem.mp4'), item.rawAssembled);
              zipMont.file(`${item.filename.replace('.mp4', '')}_DECUPAGEM_ERRO.txt`, item.errors?.decupagem || 'erro desconhecido');
            } else {
              zipMont.file(`${item.filename.replace('.mp4', '')}_ERRO.txt`,
                `Assemble: ${item.errors?.assemble || 'OK'}\nDecupagem: ${item.errors?.decupagem || 'OK'}`);
            }
          }
          zipMont.file('_DIAGNOSTICO.txt',
`Pipeline pos-producao - HeyGen Auto
====================================
${pipeRes.diagnostics.summary}

Total partes: ${pipeRes.diagnostics.totalParts}
Hooks identificados: ${pipeRes.diagnostics.hooksFound}
Bodies identificados: ${pipeRes.diagnostics.bodiesFound}
Labels nao reconhecidas: ${pipeRes.diagnostics.unrecognizedLabels.join(', ') || 'nenhuma'}

Items finais:
${pipeRes.items.map(it => `- ${it.filename}: assemble=${it.errors?.assemble ? 'ERRO ('+it.errors.assemble+')' : 'OK'} | decupagem=${it.errors?.decupagem ? 'ERRO ('+it.errors.decupagem+')' : (it.decupado ? 'OK ('+(it.decupado.size/(1024*1024)).toFixed(1)+'MB)' : '?')}`).join('\n')}`);
          const blobMont = await zipMont.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 1 } });
          pipeMontadoName = `${safeName}_montado_decupado.zip`;
          if (bId) {
            try {
              const { saveZip } = await import('@/lib/zip-store');
              await saveZip(`batch:${bId}:montado`, blobMont, pipeMontadoName);
              upsertSharedBatch(bId, { montadoZipName: pipeMontadoName });
            } catch (e) { console.warn('[heygen-auto] save montado IDB:', e); }
          }
          pipeMontadoUrl = URL.createObjectURL(blobMont);
          // Auto-download
          const am = document.createElement('a');
          am.href = pipeMontadoUrl;
          am.download = pipeMontadoName;
          document.body.appendChild(am);
          am.click();
          document.body.removeChild(am);
          setPipelineZips((prev) => ({
            ...prev,
            takesUrl: url,
            takesName: filename,
            montadoUrl: pipeMontadoUrl,
            montadoName: pipeMontadoName,
            diagnosticMsg: pipeDiagnostic,
          }));
        } catch (e) {
          console.error('[hgauto pipeline] falhou:', e);
          setError(`Takes OK · pipeline montagem FALHOU: ${(e as Error)?.message}`);
        }
      }

      // === CAMUFLAGEM (modo opcional): gera 3a ZIP com cada take camuflado ===
      if (camuflagemMode && camuflagemWhite) {
        setDownloadStage('Aplicando camuflagem em cada take...');
        try {
          // Extrai audio do WHITE (suporta video tambem)
          let whiteBlob: Blob = camuflagemWhite;
          if ((camuflagemWhite.type || '').startsWith('video/') || /\.(mp4|mov|webm|mkv)$/i.test(camuflagemWhite.name)) {
            whiteBlob = await extractAudio(camuflagemWhite);
          }
          const zipCamu = new JSZip();
          let camuOk = 0;
          for (let i = 0; i < partBlobs.length; i++) {
            const p = partBlobs[i];
            if (!p.blob) continue;
            setDownloadStage(`Camuflando ${i + 1}/${partBlobs.length} (${p.label})...`);
            try {
              const blackAudio = await extractAudio(p.blob);
              const camuWav = await camuflar({ black: blackAudio, white: whiteBlob, volumePercent: camuflagemVolume });
              const camuVid = await muxAudioIntoVideo(p.blob, camuWav);
              zipCamu.file(`${p.label}_camuflado.mp4`, camuVid);
              camuOk++;
            } catch (e) {
              zipCamu.file(`${p.label}_CAMUFLAGEM_ERROR.txt`, String((e as Error)?.message || e));
            }
          }
          const blobCamu = await zipCamu.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 1 } });
          const filenameCamu = `${safeName}_camuflado.zip`;
          if (bId) {
            try {
              const { saveZip } = await import('@/lib/zip-store');
              await saveZip(`batch:${bId}:camo`, blobCamu, filenameCamu);
              upsertSharedBatch(bId, { camufladoZipName: filenameCamu });
            } catch (e) { console.warn('[heygen-auto] save camo IDB:', e); }
          }
          const urlCamu = URL.createObjectURL(blobCamu);
          const a2 = document.createElement('a');
          a2.href = urlCamu;
          a2.download = filenameCamu;
          document.body.appendChild(a2);
          a2.click();
          document.body.removeChild(a2);
          setTimeout(() => URL.revokeObjectURL(urlCamu), 5000);
          setDownloadStage(`✓ ZIPs prontos: ${filename} + ${filenameCamu} (${camuOk}/${partBlobs.filter(p => p.blob).length} camuflados)`);
        } catch (e) {
          setDownloadStage(`⚠ Takes OK · camuflagem falhou: ${(e as Error)?.message}`);
        }
      } else {
        setDownloadStage(`✓ ZIP baixado: ${filename} (${(blob.size / (1024 * 1024)).toFixed(1)}MB)`);
      }
      setTimeout(() => setDownloadStage(null), 8000);
      if (bId) upsertSharedBatch(bId, { phase: 'done', message: 'Pronto — ZIPs no disco (veja lipsync-history)', finishedAt: Date.now() });
    } catch (e) {
      setError(`Falha no download: ${(e as Error)?.message || e}`);
      setDownloadStage(null);
      if (bId) upsertSharedBatch(bId, { phase: 'failed', message: `Falha no download: ${(e as Error)?.message || e}`, finishedAt: Date.now() });
    } finally {
      setDownloading(false);
      if (bId && downloadCancelRef.current) {
        upsertSharedBatch(bId, { phase: 'failed', message: 'Cancelado pelo user (download).', finishedAt: Date.now() });
      }
      downloadCancelRef.current = false;
    }
  }

  async function testSession() {
    setSessionTest({ state: 'testing' });
    const r = await testHeygenSession();
    setSessionTest({
      state: r.ok ? 'ok' : 'fail',
      detail: r.detail,
    });
  }

  async function run() {
    if (!extStatus.connected) {
      setError(
        'Extensao DARKO LAB nao detectada. Instale primeiro (instrucoes abaixo).',
      );
      return;
    }
    if (!selectedAvatar) {
      setError('Selecione um avatar primeiro.');
      return;
    }

    // Checa versao da extensao via ping no proxy. Se < REQUIRED, force reload.
    setStage('Checando versao da extensao...');
    const ping = await heygenApiFetch({
      url: 'https://api2.heygen.com/v1/pacific/account.get',
      method: 'GET',
    });
    const detected = ping.body?._extVersion as string | undefined;
    if (!detected) {
      setError(
        `Extensao com proxy desatualizado (sem _extVersion). RECARREGUE a extensao em chrome://extensions (botao reload no card DARKO LAB) e de refresh na aba do HeyGen. Versao requerida: ${REQUIRED_EXT_VERSION}.`,
      );
      setStage(null);
      return;
    }
    const parse = (v: string) => v.split('.').map((n) => parseInt(n, 10) || 0);
    const a = parse(detected);
    const b = parse(REQUIRED_EXT_VERSION);
    let ok = true;
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const x = a[i] ?? 0;
      const y = b[i] ?? 0;
      if (x > y) break;
      if (x < y) { ok = false; break; }
    }
    if (!ok) {
      setError(
        `Extensao desatualizada: detectada v${detected}, requer >= v${REQUIRED_EXT_VERSION}. RECARREGUE em chrome://extensions e de refresh na aba do HeyGen.`,
      );
      setStage(null);
      return;
    }
    setStage(null);

    type JobEntry = {
      label: string;
      copy?: string;
      audio?: File;
      avatarId?: string;
      voiceId?: string;
    };
    let jobs: JobEntry[] = [];
    // Labels coerentes (HOOK 1, HOOK 2, BODY 1, ...) pra que o pipeline
    // pos-prod (runPostPipeline) saiba quem e hook vs body
    function makeStructuredLabel(idx: number): string {
      // Se handoff do clickup-pilot, ja vem labelado em forcedParts
      if (forcedParts && forcedParts.length > 0 && forcedParts[idx]) {
        return forcedParts[idx].label;
      }
      const hookCount = structuredHooks.filter((h) => mode === 'copy' ? h.text.trim() : h.audios.length > 0).length;
      if (idx < hookCount) return `HOOK ${idx + 1}`;
      const bodyIdx = idx - hookCount;
      const totalParts = parts.length;
      const bodyTotal = totalParts - hookCount;
      if (bodyTotal === 1) return 'BODY';
      return `BODY ${bodyIdx + 1}`;
    }
    if (mode === 'copy') {
      if (parts.length === 0) {
        setError('Preenche pelo menos 1 HOOK.');
        return;
      }
      // Voz default = a voz original do avatar (lookup automatico no
      // processJob). So passamos voiceId quando o user marcou "substituir".
      if (overrideVoice && !selectedVoice) {
        setError(
          'Voce marcou "substituir voz" mas nao escolheu uma voz. Escolhe uma ou desmarca.',
        );
        return;
      }
      jobs = parts.map((p, i) => {
        const partAvatar = dynamicMode ? partAvatars[i] : null;
        const effectiveAvatar = partAvatar || selectedAvatar;
        return {
          label: makeStructuredLabel(i),
          copy: p,
          // Modo dinamico: cada parte usa seu avatar (com voiceId predefinido)
          avatarId: dynamicMode ? effectiveAvatar?.id : undefined,
          voiceId:
            dynamicMode && !overrideVoice
              ? (effectiveAvatar?.voiceId || undefined)
              : undefined,
        };
      });
    } else {
      // Modo audio: hooks[].audios[] + body.audios[]
      // Cada audio (já ordenado por nome) vira UM job HeyGen.
      // Hooks com múltiplas partes ficam labelados "HOOK N · parte M"
      // pro pipeline post-prod entender que são partes do mesmo hook.
      const hooksWithAudios = structuredHooks
        .map((h, i) => ({ idx: i, files: h.audios }))
        .filter((x) => x.files.length > 0);
      const bodyFiles = structuredBody.enabled ? structuredBody.audios : [];
      const totalAudios = hooksWithAudios.reduce((acc, h) => acc + h.files.length, 0) + bodyFiles.length;
      if (totalAudios === 0) {
        setError('Faça upload de pelo menos 1 áudio de hook OU body.');
        return;
      }

      jobs = [];
      hooksWithAudios.forEach((hook, hookIdx) => {
        const hookNumber = hookIdx + 1;
        hook.files.forEach((file, partIdx) => {
          const label =
            hook.files.length === 1
              ? `HOOK ${hookNumber}`
              : `HOOK ${hookNumber} · parte ${partIdx + 1}`;
          jobs.push({
            label,
            audio: file,
            avatarId: dynamicMode ? selectedAvatar?.id : undefined,
          });
        });
      });
      if (bodyFiles.length > 0) {
        bodyFiles.forEach((file, partIdx) => {
          const label =
            bodyFiles.length === 1 ? 'BODY' : `BODY · parte ${partIdx + 1}`;
          jobs.push({
            label,
            audio: file,
            avatarId: dynamicMode ? selectedAvatar?.id : undefined,
          });
        });
      }
    }

    cancelRef.current = false;
    setError(null);
    setResults([]);
    setProcessing(true);

    // Espelho no store compartilhado (lipsync-history/background/painel)
    const batchId = `heygenauto:${safeName}:${Date.now()}`;
    runBatchIdRef.current = batchId;
    const mirrorParts = (collected: PartResult[]) =>
      jobs.map((j, i) => {
        const rr = collected.find((c) => c.index === i + 1);
        return {
          label: j.label,
          videoId: rr?.videoId ?? null,
          error: rr?.error ?? null,
          renamedTo: `${j.label}.mp4`,
        };
      });
    upsertSharedBatch(batchId, {
      taskName: safeName,
      baseAdId: safeName,
      phase: 'dispatching',
      parts: mirrorParts([]),
      startedAt: Date.now(),
      message: 'Disparando partes no HeyGen (heygen-auto)...',
    });

    try {
      // Motor por job: usa motorConfig se ativo, senao cai pro motor global legacy
      const motorsPerPart = resolveMotors(motorConfig, jobs.length, {
        slotIds: jobs.map((j) => j.label),
        seed: safeName,
      });
      console.log(`[heygen-auto] motor config (${motorConfig.kind}): ${motorsPerPart.join(', ')}`);
      const jobsWithMotor = jobs.map((j, i) => ({ ...j, motor: motorsPerPart[i] }));

      const collected: PartResult[] = [];
      const finalResults = await runHeyGenJobs(jobsWithMotor, {
        parallel: 3,
        mode,
        avatarId: selectedAvatar.id,
        voiceId:
          mode === 'copy' && overrideVoice && selectedVoice
            ? selectedVoice.id
            : (selectedAvatar.voiceId || undefined),
        motor: motorConfig.kind === 'global' ? motorConfig.motor : motor, // fallback per-job vence
        adNameSafe: safeName,
        isCancelled: () => cancelRef.current,
        onProgress: (msg) => setStage(msg),
        onResult: (r) => {
          collected.push(r);
          setResults([...collected].sort((a, b) => a.index - b.index));
          upsertSharedBatch(batchId, { parts: mirrorParts(collected) });
        },
      });
      setResults([...finalResults].sort((a, b) => a.index - b.index));
      setStage(null);
      const okCount = finalResults.filter((r) => r.videoId).length;
      upsertSharedBatch(batchId, {
        phase: okCount > 0 ? 'rendering' : 'failed',
        parts: mirrorParts(finalResults),
        message:
          okCount > 0
            ? `${okCount}/${finalResults.length} disparados — clique "Baixar tudo" pra renderizar/baixar, ou Retomar depois.`
            : 'Todos os disparos falharam (cota/limite HeyGen?). Use Retomar.',
        ...(okCount > 0 ? {} : { finishedAt: Date.now() }),
      });
    } catch (e) {
      setError((e as Error).message ?? 'Falha desconhecida.');
      setStage(null);
      upsertSharedBatch(batchId, {
        phase: 'failed',
        message: (e as Error).message ?? 'Falha desconhecida.',
        finishedAt: Date.now(),
      });
    } finally {
      setProcessing(false);
      cancelRef.current = false;
    }
  }

  return (
    <>
      <ToolShell
        title="HeyGen Auto"
        eyebrow="VÍDEO COM IA"
        description="Cola o roteiro ou os áudios, recebe o vídeo do seu avatar falando tudo na ordem certa."
      >
          {/* Controle de jobs HeyGen (Retomar/Pausar/Debug) — funciona
              mesmo sem ter vindo do ClickUp Pilot */}
          <div className="mb-5">
            <JobControlPanel scopes={['heygen']} />
          </div>
          {/* Status da extensao */}
          {!extLoading ? (
            extStatus.connected ? (
              <div className="mb-5 flex flex-wrap items-center justify-between gap-2 rounded-[12px] border border-lime/40 bg-lime/5 px-4 py-3 text-sm">
                <div className="flex items-center gap-2">
                  <span className="relative flex h-2 w-2 shrink-0">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-lime opacity-60" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-lime shadow-[0_0_8px_rgba(200,255,0,0.9)]" />
                  </span>
                  <span className="text-lime">
                    Extensao DARKO LAB v{extStatus.version}
                  </span>
                  {sessionTest.state === 'ok' ? (
                    <span className="mono ml-2 rounded-full bg-lime/15 px-2 py-0.5 text-[10px] uppercase text-lime">
                      ✓ {sessionTest.detail}
                    </span>
                  ) : sessionTest.state === 'fail' ? (
                    <span className="mono ml-2 rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] uppercase text-red-300">
                      ✗ {sessionTest.detail}
                    </span>
                  ) : null}
                </div>
                <button
                  onClick={testSession}
                  disabled={sessionTest.state === 'testing'}
                  className="rounded-md border border-line-strong bg-bg-soft px-3 py-1 text-[11px] uppercase tracking-widest text-text-muted transition hover:border-lime hover:text-lime disabled:opacity-50"
                >
                  {sessionTest.state === 'testing'
                    ? 'Testando...'
                    : 'Testar conexao HeyGen'}
                </button>
              </div>
            ) : (
              <div className="mb-5 rounded-[12px] border border-yellow-500/40 bg-yellow-500/10 px-4 py-3">
                <div className="flex items-start gap-2">
                  <span className="text-yellow-300">⚠</span>
                  <div className="flex-1 text-xs text-yellow-300/90">
                    <strong className="text-yellow-300">
                      Extensao DARKO LAB nao instalada
                    </strong>
                    . Voce precisa dela pra gerar avatares (a automacao usa sua
                    conta HeyGen logada, sem consumir API).
                    <details className="mt-2">
                      <summary className="cursor-pointer text-yellow-300/80 hover:text-yellow-200">
                        Como instalar (passo a passo)
                      </summary>
                      <ol className="mt-2 list-decimal space-y-1 pl-5 text-yellow-300/80">
                        <li>
                          Baixa o pacote da extensao:{' '}
                          <a
                            href="/api/extension/download"
                            className="underline hover:text-lime"
                            download
                          >
                            darkolab-heygen-extension.zip
                          </a>
                        </li>
                        <li>
                          Descompacta numa pasta no seu computador
                        </li>
                        <li>
                          Abre <code className="mono">chrome://extensions</code>
                        </li>
                        <li>
                          Liga &quot;Modo de desenvolvedor&quot; (canto superior direito)
                        </li>
                        <li>
                          Clica &quot;Carregar sem compactacao&quot; e seleciona a pasta
                        </li>
                        <li>
                          Faz login no HeyGen normalmente em outra aba
                        </li>
                        <li>
                          Volta aqui — a extensao deve aparecer como conectada
                        </li>
                      </ol>
                    </details>
                  </div>
                </div>
              </div>
            )
          ) : null}

          <MissingKeyBanner services={['heygen']} />

          <div className="mt-6 flex flex-col gap-6">
            {/* Identidade */}
            <section>
              <h2 className="label-field !mb-3">Identidade</h2>
              <input
                type="text"
                value={adName}
                onChange={(e) => setAdName(e.target.value)}
                placeholder="Nome do AD (vai virar prefixo dos arquivos)"
                className="input-field"
                disabled={processing}
              />
            </section>

            {/* Motor — picker avancado (global/percent/individual + previa creditos) */}
            <section className="border-t border-line pt-6">
              <h2 className="label-field !mb-3">Motor do avatar (com previsibilidade de créditos)</h2>
              <MotorConfigPicker
                config={motorConfig}
                setConfig={setMotorConfig}
                takeCount={mode === 'audio' ? audioParts.length : parts.length}
                slotIds={mode === 'audio'
                  ? audioParts.map((_, i) => `HOOK${i + 1}`)
                  : parts.map((_, i) => `PART${i + 1}`)
                }
                takeSeconds={mode === 'copy'
                  ? parts.map((text) => estimateSecondsFromText(text))
                  : audioPartsSeconds
                }
              />
            </section>

            {/* Avatar — biblioteca real da conta HeyGen via extensao */}
            <section className="border-t border-line pt-6">
              <HeyGenAvatarPicker
                query={avatarQuery}
                setQuery={setAvatarQuery}
                selected={selectedAvatar}
                setSelected={setSelectedAvatar}
                disabled={processing}
                label="Avatar (sua biblioteca HeyGen)"
              />
              <p className="mt-2 text-[11px] text-text-muted">
                Lista 100% espelhada da sua conta HeyGen. O motor selecionado
                acima ({motor}) sera usado na hora de gerar — escolha o avatar
                aqui livremente.
              </p>
            </section>

            {mode === 'copy' ? (
              <section className="border-t border-line pt-6">
                <HeyGenVoicePicker
                  override={overrideVoice}
                  setOverride={setOverrideVoice}
                  query={voiceQuery}
                  setQuery={setVoiceQuery}
                  selected={selectedVoice}
                  setSelected={setSelectedVoice}
                  clonedVoices={clonedVoices}
                  setClonedVoices={setClonedVoices}
                  disabled={processing}
                />
              </section>
            ) : (
              <section className="border-t border-line pt-6">
                <div className="rounded-[12px] border border-blue-500/30 bg-blue-500/5 px-4 py-3 text-xs text-blue-300">
                  ℹ Modo audio: a voz vem do proprio audio enviado (lipsync).
                  Voice picker desativado.
                </div>
              </section>
            )}

            {/* Modo: copy ou audio */}
            <section className="border-t border-line pt-6">
              <h2 className="label-field !mb-3">Modo de input</h2>
              <div className="flex gap-2">
                {(
                  [
                    { id: 'copy' as const, label: 'Cole a copy (texto)' },
                    {
                      id: 'audio' as const,
                      label: 'Upload de audios (parte1, parte2...)',
                    },
                  ]
                ).map((m) => {
                  const active = mode === m.id;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setMode(m.id)}
                      disabled={processing}
                      className={
                        'flex-1 rounded-[12px] px-4 py-2.5 text-sm transition-all duration-200 active:scale-[0.98] ' +
                        (active
                          ? 'bg-lime font-semibold text-black'
                          : 'border border-line-strong text-text-muted hover:border-lime hover:text-white')
                      }
                    >
                      {m.label}
                    </button>
                  );
                })}
              </div>

              <div className="mt-4 grid gap-3">
                  <div className="mono text-[10px] uppercase tracking-widest text-text-muted">
                    Hooks ({structuredHooks.length}/10) — cada um vira 1 take final
                  </div>
                  {structuredHooks.map((h, hi) => (
                    <div key={hi} className="rounded-[10px] border border-lime/30 bg-lime/5 p-3">
                      <div className="mono flex items-center justify-between mb-2 text-[10px] uppercase tracking-widest text-lime">
                        <span>HOOK {hi + 1}</span>
                        {structuredHooks.length > 1 ? (
                          <button
                            type="button"
                            onClick={() => setStructuredHooks((prev) => prev.filter((_, i) => i !== hi))}
                            disabled={processing}
                            className="rounded-full px-2 py-0.5 text-text-muted hover:bg-red-500/10 hover:text-red-300"
                            title="Remover este hook"
                          >
                            × remover
                          </button>
                        ) : null}
                      </div>
                      {mode === 'copy' ? (
                        <textarea
                          value={h.text}
                          onChange={(e) =>
                            setStructuredHooks((prev) =>
                              prev.map((p, i) => (i === hi ? { ...p, text: e.target.value } : p)),
                            )
                          }
                          placeholder={`Texto do HOOK ${hi + 1} (uma frase tipica de chamariz, ~15-25s)`}
                          rows={3}
                          className="input-field resize-y font-mono text-sm"
                          disabled={processing}
                        />
                      ) : (
                        <div className="grid gap-2">
                          <input
                            type="file"
                            accept="audio/*"
                            multiple
                            onChange={(e) => {
                              const added = Array.from(e.target.files ?? []);
                              if (added.length === 0) return;
                              setStructuredHooks((prev) =>
                                prev.map((p, i) =>
                                  i === hi
                                    ? {
                                        ...p,
                                        audios: sortAudiosByPartName([
                                          ...p.audios,
                                          ...added,
                                        ]),
                                      }
                                    : p,
                                ),
                              );
                              // Limpa o input pra permitir re-upload do mesmo arquivo
                              e.target.value = '';
                            }}
                            className="input-field file:mr-3 file:rounded-md file:border-0 file:bg-lime file:px-3 file:py-1 file:text-xs file:font-semibold file:text-black"
                            disabled={processing}
                          />
                          {h.audios.length > 0 ? (
                            <div className="grid gap-1.5 rounded-[10px] border border-line bg-bg/40 p-2">
                              <div className="mono text-[10px] uppercase tracking-widest text-text-muted">
                                {h.audios.length} áudio
                                {h.audios.length === 1 ? '' : 's'} · ordem de
                                execução
                              </div>
                              {h.audios.map((file, ai) => (
                                <div
                                  key={ai + '-' + file.name}
                                  className="flex items-center gap-2 rounded-md border border-line-strong bg-bg/60 px-2 py-1.5 text-[11px]"
                                >
                                  <span className="mono w-6 shrink-0 text-center text-lime">
                                    {ai + 1}
                                  </span>
                                  <span className="flex-1 truncate text-text">
                                    {file.name}
                                  </span>
                                  <span className="mono shrink-0 text-text-muted">
                                    {(file.size / (1024 * 1024)).toFixed(2)}MB
                                  </span>
                                  <div className="flex shrink-0 gap-0.5">
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setStructuredHooks((prev) =>
                                          prev.map((p, i) => {
                                            if (i !== hi) return p;
                                            if (ai === 0) return p;
                                            const next = [...p.audios];
                                            [next[ai - 1], next[ai]] = [
                                              next[ai],
                                              next[ai - 1],
                                            ];
                                            return { ...p, audios: next };
                                          }),
                                        )
                                      }
                                      disabled={ai === 0 || processing}
                                      className="rounded p-0.5 text-text-muted transition hover:bg-bg hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
                                      title="Mover pra cima"
                                    >
                                      ▲
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setStructuredHooks((prev) =>
                                          prev.map((p, i) => {
                                            if (i !== hi) return p;
                                            if (ai === p.audios.length - 1)
                                              return p;
                                            const next = [...p.audios];
                                            [next[ai], next[ai + 1]] = [
                                              next[ai + 1],
                                              next[ai],
                                            ];
                                            return { ...p, audios: next };
                                          }),
                                        )
                                      }
                                      disabled={
                                        ai === h.audios.length - 1 || processing
                                      }
                                      className="rounded p-0.5 text-text-muted transition hover:bg-bg hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
                                      title="Mover pra baixo"
                                    >
                                      ▼
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setStructuredHooks((prev) =>
                                          prev.map((p, i) =>
                                            i === hi
                                              ? {
                                                  ...p,
                                                  audios: p.audios.filter(
                                                    (_, k) => k !== ai,
                                                  ),
                                                }
                                              : p,
                                          ),
                                        )
                                      }
                                      disabled={processing}
                                      className="rounded p-0.5 text-text-muted transition hover:bg-red-500/15 hover:text-red-300"
                                      title="Remover"
                                    >
                                      ×
                                    </button>
                                  </div>
                                </div>
                              ))}
                              {h.audios.length > 1 ? (
                                <div className="mono mt-0.5 text-[10px] text-text-muted">
                                  💡 Dica: nomeie como{' '}
                                  <span className="text-lime">parte1.mp3</span>,{' '}
                                  <span className="text-lime">parte2.mp3</span>{' '}
                                  pra ordenação automática.
                                </div>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                      )}
                    </div>
                  ))}
                  {structuredHooks.length < 10 ? (
                    <button
                      type="button"
                      onClick={() => setStructuredHooks((prev) => [...prev, { text: '', audios: [] }])}
                      disabled={processing}
                      className="mono rounded-[10px] border border-dashed border-line-strong bg-bg/30 py-2 px-3 text-[10px] uppercase tracking-widest text-text-muted hover:border-lime/40 hover:bg-lime/5 hover:text-lime transition disabled:opacity-50"
                    >
                      + adicionar hook ({structuredHooks.length}/10)
                    </button>
                  ) : (
                    <div className="mono text-[10px] uppercase tracking-widest text-text-muted text-center py-2">
                      Limite de 10 hooks atingido
                    </div>
                  )}

                  {/* Body opcional */}
                  <div className="mt-2 flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="hgauto-body-enabled"
                      checked={structuredBody.enabled}
                      onChange={(e) => setStructuredBody((p) => ({ ...p, enabled: e.target.checked }))}
                      disabled={processing}
                      className="h-4 w-4 cursor-pointer accent-fuchsia-400"
                    />
                    <label htmlFor="hgauto-body-enabled" className="mono cursor-pointer text-[10px] uppercase tracking-widest text-fuchsia-200">
                      Incluir BODY (texto/audio que vai depois de cada hook no video montado)
                    </label>
                  </div>
                  {structuredBody.enabled ? (
                    <div className="rounded-[10px] border border-fuchsia-500/30 bg-fuchsia-500/5 p-3">
                      <div className="mono mb-2 text-[10px] uppercase tracking-widest text-fuchsia-200">BODY</div>
                      {mode === 'copy' ? (
                        <textarea
                          value={structuredBody.text}
                          onChange={(e) => setStructuredBody((p) => ({ ...p, text: e.target.value }))}
                          placeholder="Texto do BODY completo. Sera splitado em takes de ~20s sem cortar frase."
                          rows={6}
                          className="input-field resize-y font-mono text-sm"
                          disabled={processing}
                        />
                      ) : (
                        <div className="grid gap-2">
                          <input
                            type="file"
                            accept="audio/*"
                            multiple
                            onChange={(e) => {
                              const added = Array.from(e.target.files ?? []);
                              if (added.length === 0) return;
                              setStructuredBody((p) => ({
                                ...p,
                                audios: sortAudiosByPartName([
                                  ...p.audios,
                                  ...added,
                                ]),
                              }));
                              e.target.value = '';
                            }}
                            className="input-field file:mr-3 file:rounded-md file:border-0 file:bg-fuchsia-500 file:px-3 file:py-1 file:text-xs file:font-semibold file:text-white"
                            disabled={processing}
                          />
                          {structuredBody.audios.length > 0 ? (
                            <div className="grid gap-1.5 rounded-[10px] border border-line bg-bg/40 p-2">
                              <div className="mono text-[10px] uppercase tracking-widest text-text-muted">
                                {structuredBody.audios.length} áudio
                                {structuredBody.audios.length === 1 ? '' : 's'} ·
                                ordem de execução
                              </div>
                              {structuredBody.audios.map((file, ai) => (
                                <div
                                  key={ai + '-' + file.name}
                                  className="flex items-center gap-2 rounded-md border border-line-strong bg-bg/60 px-2 py-1.5 text-[11px]"
                                >
                                  <span className="mono w-6 shrink-0 text-center text-fuchsia-300">
                                    {ai + 1}
                                  </span>
                                  <span className="flex-1 truncate text-text">
                                    {file.name}
                                  </span>
                                  <span className="mono shrink-0 text-text-muted">
                                    {(file.size / (1024 * 1024)).toFixed(2)}MB
                                  </span>
                                  <div className="flex shrink-0 gap-0.5">
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setStructuredBody((p) => {
                                          if (ai === 0) return p;
                                          const next = [...p.audios];
                                          [next[ai - 1], next[ai]] = [
                                            next[ai],
                                            next[ai - 1],
                                          ];
                                          return { ...p, audios: next };
                                        })
                                      }
                                      disabled={ai === 0 || processing}
                                      className="rounded p-0.5 text-text-muted transition hover:bg-bg hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
                                      title="Mover pra cima"
                                    >
                                      ▲
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setStructuredBody((p) => {
                                          if (ai === p.audios.length - 1)
                                            return p;
                                          const next = [...p.audios];
                                          [next[ai], next[ai + 1]] = [
                                            next[ai + 1],
                                            next[ai],
                                          ];
                                          return { ...p, audios: next };
                                        })
                                      }
                                      disabled={
                                        ai === structuredBody.audios.length - 1 ||
                                        processing
                                      }
                                      className="rounded p-0.5 text-text-muted transition hover:bg-bg hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
                                      title="Mover pra baixo"
                                    >
                                      ▼
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setStructuredBody((p) => ({
                                          ...p,
                                          audios: p.audios.filter(
                                            (_, k) => k !== ai,
                                          ),
                                        }))
                                      }
                                      disabled={processing}
                                      className="rounded p-0.5 text-text-muted transition hover:bg-red-500/15 hover:text-red-300"
                                      title="Remover"
                                    >
                                      ×
                                    </button>
                                  </div>
                                </div>
                              ))}
                              {structuredBody.audios.length > 1 ? (
                                <div className="mono mt-0.5 text-[10px] text-text-muted">
                                  💡 Dica: nomeie como{' '}
                                  <span className="text-fuchsia-300">
                                    parte1.mp3
                                  </span>
                                  ,{' '}
                                  <span className="text-fuchsia-300">
                                    parte2.mp3
                                  </span>{' '}
                                  pra ordenação automática.
                                </div>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                      )}
                    </div>
                  ) : null}

                  <div className="mono rounded-[10px] border border-lime/30 bg-lime/5 px-3 py-2 text-[11px] text-lime">
                    📦 Output: 3 ZIPs (takes individuais + montados HOOK[N]+BODY decupados{camuflagemMode ? ' + camuflados' : ''}).
                    Cada hook vira 1 video final {structuredBody.enabled ? '(com o body anexado)' : '(sem body)'}.
                  </div>
                </div>
                {forcedParts && forcedParts.length > 0 ? (
                  <div className="mt-3 flex items-center justify-between rounded-[10px] border border-fuchsia-500/40 bg-fuchsia-500/10 px-3 py-2 text-[11px]">
                    <span className="text-fuchsia-200">
                      ⚙ Partes vindas do <strong>ClickUp Pilot</strong> ({forcedParts.map(p => p.label).join(', ')}) — sobrescreveram os inputs estruturados
                    </span>
                    <button
                      type="button"
                      onClick={() => setForcedParts(null)}
                      className="mono shrink-0 rounded border border-fuchsia-500/40 px-2 py-0.5 text-[9px] uppercase tracking-widest text-fuchsia-200 hover:border-red-500/60 hover:text-red-300"
                      disabled={processing}
                    >
                      Limpar override
                    </button>
                  </div>
                ) : null}
            </section>

            {/* Modo Camuflagem — gera 2a ZIP com cada take camuflado no audio */}
            <section className="border-t border-line pt-6">
              <h2 className="label-field !mb-3">Modos extra</h2>
              <Toggle3D
                on={camuflagemMode}
                onChange={setCamuflagemMode}
                label="Camuflagem"
                hint="Gera 2a pasta ZIP com cada take + audio camuflado"
                variant="fuchsia"
                icon={<span className="text-base">🎭</span>}
              />
              {camuflagemMode ? (
                <div className="mt-3 rounded-[12px] border border-fuchsia-500/30 bg-fuchsia-500/5 p-3">
                  <div className="mono mb-2 text-[10px] uppercase tracking-widest text-fuchsia-200">
                    Audio WHITE pra camuflagem (audio OU video — extrai audio se video)
                  </div>
                  <div className="grid items-center gap-2 sm:grid-cols-[1fr_140px]">
                    <input
                      type="file"
                      accept="audio/*,video/*"
                      onChange={(e) => setCamuflagemWhite(e.target.files?.[0] || null)}
                      className="input-field text-xs"
                      disabled={processing || downloading}
                    />
                    <div className="flex items-center gap-2">
                      <input
                        type="range"
                        min={5}
                        max={100}
                        value={camuflagemVolume}
                        onChange={(e) => setCamuflagemVolume(Number(e.target.value))}
                        className="flex-1 accent-fuchsia-400"
                        disabled={processing || downloading}
                      />
                      <span className="mono w-10 text-right text-[11px] text-fuchsia-200">{camuflagemVolume}%</span>
                    </div>
                  </div>
                  {camuflagemWhite ? (
                    <div className="mt-2 text-[11px] text-fuchsia-200">
                      ✓ {camuflagemWhite.name} ({(camuflagemWhite.size / (1024 * 1024)).toFixed(1)}MB)
                    </div>
                  ) : (
                    <div className="mt-2 text-[11px] text-text-muted">
                      ⚠ Sem WHITE: a camuflagem nao roda. Selecione um arquivo.
                    </div>
                  )}
                </div>
              ) : null}
            </section>

            {/* HeyGen Auto Dynamic — multi-avatar por parte */}
            <section className="border-t border-line pt-6">
              <label className="flex cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  checked={dynamicMode}
                  onChange={(e) => setDynamicMode(e.target.checked)}
                  disabled={processing}
                  className="mt-1 h-4 w-4 shrink-0 cursor-pointer accent-lime"
                />
                <div>
                  <div className="text-sm font-semibold text-white">
                    HeyGen Auto Dynamic{' '}
                    <span className="mono ml-2 rounded-full border border-fuchsia-500/40 bg-fuchsia-500/10 px-2 py-0.5 text-[9px] uppercase tracking-widest text-fuchsia-300">
                      multi-avatar
                    </span>
                  </div>
                  <div className="mt-1 text-[11px] text-text-muted">
                    Cada parte (texto OU audio) usa um avatar diferente. Voz de
                    cada parte = a voz predefinida daquele avatar (a menos que
                    voce marque{' '}
                    <span className="text-lime/80">substituir voz</span> pra
                    forcar uma voz fixa em todas).
                  </div>
                </div>
              </label>

              {dynamicMode && mode === 'copy' && parts.length > 0 ? (
                <div className="mt-4 space-y-2">
                  <div className="mono text-[10px] uppercase tracking-widest text-text-muted">
                    Avatar por parte ({parts.length} take
                    {parts.length === 1 ? '' : 's'})
                  </div>
                  {parts.map((p, i) => (
                    <div
                      key={i}
                      className="flex items-start gap-2 rounded-[10px] border border-line bg-bg-soft/30 p-2"
                    >
                      <span className="mono mt-1 shrink-0 rounded-full bg-lime/15 px-2 py-0.5 text-[10px] uppercase tracking-widest text-lime">
                        #{i + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="line-clamp-2 text-[11px] text-text-muted">
                          {p.slice(0, 140)}
                          {p.length > 140 ? '…' : ''}
                        </div>
                        <div className="mt-2 max-w-[320px]">
                          <CompactAvatarPicker
                            selected={partAvatars[i] ?? null}
                            setSelected={(a) => {
                              setPartAvatars((prev) => {
                                const next = [...prev];
                                next[i] = a;
                                return next;
                              });
                            }}
                            fallback={selectedAvatar}
                            disabled={processing}
                            label={`Avatar pra parte ${i + 1}`}
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}

              {dynamicMode && mode === 'audio' && audioParts.length > 0 ? (
                <div className="mt-4 space-y-2">
                  <div className="mono text-[10px] uppercase tracking-widest text-text-muted">
                    Audios — ordem + avatar por parte ({audioParts.length}{' '}
                    arquivo{audioParts.length === 1 ? '' : 's'})
                  </div>
                  {audioOrder.map((origIdx, pos) => {
                    const file = audioParts[origIdx];
                    if (!file) return null;
                    const moveSwap = (delta: number) => {
                      const target = pos + delta;
                      if (target < 0 || target >= audioOrder.length) return;
                      setAudioOrder((prev) => {
                        const next = [...prev];
                        [next[pos], next[target]] = [next[target], next[pos]];
                        return next;
                      });
                    };
                    return (
                      <div
                        key={`${origIdx}-${file.name}`}
                        className="flex items-center gap-2 rounded-[10px] border border-line bg-bg-soft/30 p-2"
                      >
                        <span className="mono shrink-0 rounded-full bg-lime/15 px-2 py-0.5 text-[10px] uppercase tracking-widest text-lime">
                          #{pos + 1}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[11px] text-text-muted">
                            {file.name}
                          </div>
                          <div className="mt-2 max-w-[320px]">
                            <CompactAvatarPicker
                              selected={partAvatars[origIdx] ?? null}
                              setSelected={(a) => {
                                setPartAvatars((prev) => {
                                  const next = [...prev];
                                  next[origIdx] = a;
                                  return next;
                                });
                              }}
                              fallback={selectedAvatar}
                              disabled={processing}
                              label={`Avatar pra parte ${pos + 1}`}
                            />
                          </div>
                        </div>
                        <div className="flex shrink-0 flex-col gap-1">
                          <button
                            type="button"
                            onClick={() => moveSwap(-1)}
                            disabled={pos === 0 || processing}
                            className="mono rounded border border-line-strong px-2 py-0.5 text-[10px] text-text-muted hover:border-lime hover:text-lime disabled:opacity-30"
                            title="Subir"
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            onClick={() => moveSwap(1)}
                            disabled={pos === audioOrder.length - 1 || processing}
                            className="mono rounded border border-line-strong px-2 py-0.5 text-[10px] text-text-muted hover:border-lime hover:text-lime disabled:opacity-30"
                            title="Descer"
                          >
                            ↓
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : null}

              {dynamicMode &&
              ((mode === 'copy' && parts.length === 0) ||
                (mode === 'audio' && audioParts.length === 0)) ? (
                <div className="mt-4 rounded-[10px] border border-line bg-bg-soft/30 px-3 py-2 text-[11px] text-text-muted">
                  {mode === 'copy'
                    ? 'Cole uma copy primeiro pra atribuir avatares por parte.'
                    : 'Faca upload dos audios primeiro pra atribuir avatares por parte.'}
                </div>
              ) : null}
            </section>

            {/* Action */}
            <div className="flex flex-wrap gap-3 border-t border-line pt-6">
              {processing ? (
                <CancelButton onClick={cancel} label="Cancelar" />
              ) : (
                <button
                  onClick={run}
                  className="btn-primary"
                  disabled={
                    !extStatus.connected ||
                    !selectedAvatar ||
                    (mode === 'copy' && parts.length === 0) ||
                    (mode === 'audio' && audioParts.length === 0)
                  }
                >
                  Gerar todas as partes via HeyGen
                </button>
              )}
              {results.length > 0 && !processing ? (
                <>
                  {downloading ? (
                    <CancelButton onClick={cancelDownload} label="Cancelar download" />
                  ) : (
                    <button
                      onClick={downloadAllAsZip}
                      className="btn-primary"
                      disabled={results.filter((r) => r.videoId).length === 0}
                      title={`Aguarda renderizacao + baixa MP4s + zipa em ${safeName}.zip`}
                    >
                      ⬇ Baixar tudo como ZIP ({safeName}.zip)
                    </button>
                  )}
                  <a
                    href="https://app.heygen.com/projects"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-[12px] border border-line-strong px-4 py-2.5 text-sm text-text-muted transition hover:border-lime hover:text-lime"
                  >
                    Abrir HeyGen Projects
                  </a>
                </>
              ) : null}
            </div>

            {error ? (
              <div className="error-shake rounded-[12px] border border-red-500/40 bg-red-500/10 px-4 py-3 text-xs text-red-300">
                {error}
              </div>
            ) : null}

            {stage ? (
              <div className="scan-line rounded-[12px] border border-lime/40 bg-bg-soft/40 px-4 py-3 text-xs text-lime">
                <div className="flex items-center gap-2">
                  <span className="relative flex h-2 w-2 shrink-0">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-lime opacity-60" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-lime" />
                  </span>
                  <span className="mono uppercase tracking-widest">{stage}</span>
                </div>
              </div>
            ) : null}

            {/* Status do download em andamento */}
            {downloadStage ? (
              <div className="scan-line rounded-[12px] border border-fuchsia-500/40 bg-fuchsia-500/5 px-4 py-3 text-xs text-fuchsia-200">
                <div className="flex items-center gap-2">
                  <span className="relative flex h-2 w-2 shrink-0">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-fuchsia-400 opacity-60" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-fuchsia-400" />
                  </span>
                  <span className="mono uppercase tracking-widest">{downloadStage}</span>
                </div>
                {Object.keys(downloadStatuses).length > 0 ? (
                  <ul className="mt-2 grid gap-0.5 text-[10px] text-fuchsia-200/70">
                    {results.filter((r) => r.videoId).map((r) => {
                      const s = downloadStatuses[r.videoId!];
                      const sym =
                        s?.status === 'completed' ? '✓' :
                        s?.status === 'failed' ? '✗' :
                        s?.status === 'pending' ? '◷' : '?';
                      return (
                        <li key={r.label} className="mono">
                          {sym} {r.label} — {s?.status ?? 'unknown'}
                          {s?.error ? ` (${s.error.slice(0,80)})` : ''}
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
              </div>
            ) : null}

            {/* Resultados parciais — modo dispatch only */}
            {results.length > 0 ? (
              <div className="fade-in-up mt-2 rounded-[12px] border border-lime/30 bg-lime/5 p-4">
                <h3 className="mb-2 text-sm font-semibold uppercase tracking-widest text-lime">
                  {results.filter((r) => r.error == null).length}/{results.length}{' '}
                  parte{results.length === 1 ? '' : 's'} disparada
                  {results.length === 1 ? '' : 's'} no HeyGen
                </h3>
                <p className="mb-2 text-[11px] text-text-muted">
                  A geracao roda na fila do HeyGen. Acompanhe na sua pagina
                  Projects e baixe quando ficar pronto.
                </p>
                <ul className="grid gap-1 text-xs">
                  {results.map((r) => (
                    <li
                      key={r.label}
                      className="flex items-center justify-between rounded-md border border-line bg-bg px-3 py-2"
                    >
                      <span>
                        <span className="mono text-lime">{r.label}</span>
                        {r.videoId ? (
                          <span className="ml-2 text-text-muted">
                            id: {r.videoId.slice(0, 12)}...
                          </span>
                        ) : null}
                      </span>
                      {r.error ? (
                        <span className="text-[11px] text-red-300">
                          ✗ {r.error}
                        </span>
                      ) : (
                        <span className="text-[11px] text-lime">✓ disparado</span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
      </ToolShell>
    </>
  );
}
