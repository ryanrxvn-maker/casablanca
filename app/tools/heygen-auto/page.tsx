'use client';

import { useEffect, useRef, useState } from 'react';
import { ToolShell } from '@/components/ToolShell';
import { CancelButton } from '@/components/CancelButton';
import { MissingKeyBanner } from '@/components/MissingKeyBanner';
import { useToolState } from '@/components/ToolsStateProvider';
import { Toggle3D } from '@/components/Toggle3D';
import { extractAudio, muxAudioIntoVideo } from '@/lib/ffmpeg-worker';
import { camuflar } from '@/lib/camuflagem';
import {
  detectExtension,
  splitCopyIntoParts,
  testHeygenSession,
  type ExtensionStatus,
} from '@/lib/heygen-extension-bridge';
import { runHeyGenJobs, type RunnerResult } from '@/lib/heygen-job-runner';
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

  /* ----- Modo ESTRUTURADO (multi-hook + body) — feature parity com clickup-pilot ----- */
  /** Quando ON: substitui o textarea/audioParts unicos por inputs separados
   *  pra cada HOOK (1-10) + 1 BODY opcional. Cada hook vira 1 take.
   *  Body e splitado em ~20s pra cada take. Output final: 3 ZIPs igual clickup-pilot
   *  (takes individuais, montados HOOK[N]+BODY decupados, camuflados opcional). */
  const [structuredMode, setStructuredMode] = useToolState<boolean>(
    'hgauto:structured',
    false,
  );
  type StructuredInput = { text: string; audio: File | null };
  const [structuredHooks, setStructuredHooks] = useState<StructuredInput[]>([
    { text: '', audio: null },
  ]);
  const [structuredBody, setStructuredBody] = useState<{ enabled: boolean; text: string; audio: File | null }>({
    enabled: true,
    text: '',
    audio: null,
  });

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

  /* --------------- Copy split preview --------------- */
  useEffect(() => {
    if (mode !== 'copy') {
      setParts([]);
      return;
    }
    // Modo estruturado: parts = [HOOK 1, HOOK 2, ..., BODY split 1, BODY split 2, ...]
    if (structuredMode) {
      const arr: string[] = [];
      for (const h of structuredHooks) {
        if (h.text.trim()) arr.push(h.text);
      }
      if (structuredBody.enabled && structuredBody.text.trim()) {
        arr.push(...splitCopyIntoParts(structuredBody.text, { targetSec: 20, minSec: 10, maxSec: 35 }));
      }
      setParts(arr);
      return;
    }
    // Forced parts (do ClickUp Pilot) sobrescreve auto-split
    if (forcedParts && forcedParts.length > 0) {
      setParts(forcedParts.map((p) => p.text));
      return;
    }
    if (!copy.trim()) {
      setParts([]);
      return;
    }
    setParts(
      splitCopyIntoParts(copy, { targetSec: 20, minSec: 10, maxSec: 35 }),
    );
  }, [copy, mode, forcedParts, structuredMode, structuredHooks, structuredBody]);

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
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 5000);

      // === PIPELINE POS-PRODUCAO (modo estruturado): gera ZIP montado HOOK[N]+BODY decupados ===
      // Usa o mesmo runPostPipeline do clickup-pilot. So roda em modo estruturado
      // porque depende de labels HOOK/BODY corretos (no modo legado labels sao "parte1/2..."
      // que nao se enquadram nem como hook nem body — pipeline retorna vazio).
      let pipeMontadoUrl: string | undefined;
      let pipeMontadoName: string | undefined;
      let pipeDiagnostic: string | undefined;
      if (structuredMode && partBlobs.some(p => p.blob)) {
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
    } catch (e) {
      setError(`Falha no download: ${(e as Error)?.message || e}`);
      setDownloadStage(null);
    } finally {
      setDownloading(false);
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
    // Estruturado: precisa montar lista de labels coerentes (HOOK 1, HOOK 2, BODY 1, ...)
    // pra que o pipeline pos-prod (runPostPipeline) saiba quem e hook vs body
    function makeStructuredLabel(idx: number): string {
      if (!structuredMode) return `parte${idx + 1}`;
      const hookCount = structuredHooks.filter((h) => mode === 'copy' ? h.text.trim() : h.audio).length;
      if (idx < hookCount) return `HOOK ${idx + 1}`;
      const bodyIdx = idx - hookCount;
      // Se body for 1 split, label = BODY; senao BODY 1, BODY 2, ...
      const totalParts = parts.length;
      const bodyTotal = totalParts - hookCount;
      if (bodyTotal === 1) return 'BODY';
      return `BODY ${bodyIdx + 1}`;
    }
    if (mode === 'copy') {
      if (parts.length === 0) {
        setError(structuredMode ? 'Preenche pelo menos 1 HOOK.' : 'Cola uma copy primeiro.');
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
      // Modo estruturado audio: hooks[].audio + body.audio
      if (structuredMode) {
        const hookFiles = structuredHooks.map((h) => h.audio).filter((f): f is File => !!f);
        const bodyFile = structuredBody.enabled ? structuredBody.audio : null;
        if (hookFiles.length === 0 && !bodyFile) {
          setError('Faca upload de pelo menos 1 audio de hook OU body.');
          return;
        }
        jobs = hookFiles.map((file, i) => ({
          label: `HOOK ${i + 1}`,
          audio: file,
          avatarId: dynamicMode ? selectedAvatar?.id : undefined,
        }));
        if (bodyFile) {
          jobs.push({
            label: 'BODY',
            audio: bodyFile,
            avatarId: dynamicMode ? selectedAvatar?.id : undefined,
          });
        }
      } else {
        if (audioParts.length === 0) {
          setError('Faca upload de pelo menos um arquivo de audio.');
          return;
        }
        // Modo dinamico: usa permutacao explicita do user (audioOrder).
        // Modo classico: ordena por filename (parte1, parte2...).
        const orderedFiles = dynamicMode
          ? audioOrder.map((idx) => audioParts[idx]).filter(Boolean)
          : [...audioParts].sort((a, b) =>
              a.name.localeCompare(b.name, 'pt', { numeric: true }),
            );
        jobs = orderedFiles.map((file, i) => {
          const origIdx = dynamicMode ? audioOrder[i] : i;
          const partAvatar = dynamicMode ? partAvatars[origIdx] : null;
          const effectiveAvatar = partAvatar || selectedAvatar;
          return {
            label: `parte${i + 1}`,
            audio: file,
            avatarId: dynamicMode ? effectiveAvatar?.id : undefined,
          };
        });
      }
    }

    cancelRef.current = false;
    setError(null);
    setResults([]);
    setProcessing(true);

    try {
      const collected: PartResult[] = [];
      const finalResults = await runHeyGenJobs(jobs, {
        parallel: 3,
        mode,
        avatarId: selectedAvatar.id,
        // Modo copy:
        //  1) override marcado + voz escolhida → usa essa voz
        //  2) selectedAvatar.voiceId presente (extension v4.0.13+) → voz do avatar
        //  3) undefined → processJob faz lookup via API (fallback frageis pra
        //     talking_photo, mas funciona pra avatares regulares)
        voiceId:
          mode === 'copy' && overrideVoice && selectedVoice
            ? selectedVoice.id
            : (selectedAvatar.voiceId || undefined),
        motor,
        adNameSafe: safeName,
        isCancelled: () => cancelRef.current,
        onProgress: (msg) => setStage(msg),
        onResult: (r) => {
          collected.push(r);
          setResults([...collected].sort((a, b) => a.index - b.index));
        },
      });
      setResults([...finalResults].sort((a, b) => a.index - b.index));
      setStage(null);
    } catch (e) {
      setError((e as Error).message ?? 'Falha desconhecida.');
      setStage(null);
    } finally {
      setProcessing(false);
      cancelRef.current = false;
    }
  }

  return (
    <>
      <ToolShell
        title="HeyGen Auto Avatar"
        description="Automacao do HeyGen via extensao Chrome — gera o avatar parte por parte usando sua propria conta HeyGen (sem custo de API). Voce manda copy ou audios, recebe ZIP organizado por parte na ordem certa."
      >
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

            {/* Motor */}
            <section className="border-t border-line pt-6">
              <h2 className="label-field !mb-3">Motor do avatar</h2>
              <div className="flex flex-wrap gap-2">
                {(['III', 'IV', 'V'] as const).map((m) => {
                  const active = motor === m;
                  return (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setMotor(m)}
                      disabled={processing}
                      className={
                        'rounded-[12px] px-5 py-2.5 text-sm transition-all duration-200 active:scale-[0.97] ' +
                        (active
                          ? 'bg-lime font-semibold text-black shadow-[0_0_18px_-4px_rgba(200,255,0,0.6)]'
                          : 'border border-line-strong text-text-muted hover:border-lime hover:text-white')
                      }
                    >
                      Avatar {m}
                    </button>
                  );
                })}
              </div>
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
              <Toggle3D
                on={structuredMode}
                onChange={setStructuredMode}
                label="Modo estruturado (Hook + Body)"
                hint="Inputs separados por HOOK (ate 10) + BODY. Output 3 ZIPs igual ClickUp Pilot: takes, montado/decupado, camuflado opcional"
                variant="lime"
                icon={<span className="text-base">📦</span>}
              />
            </section>

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

              {structuredMode ? (
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
                            onChange={(e) => {
                              const f = e.target.files?.[0] || null;
                              setStructuredHooks((prev) =>
                                prev.map((p, i) => (i === hi ? { ...p, audio: f } : p)),
                              );
                            }}
                            className="input-field file:mr-3 file:rounded-md file:border-0 file:bg-lime file:px-3 file:py-1 file:text-xs file:font-semibold file:text-black"
                            disabled={processing}
                          />
                          {h.audio ? (
                            <div className="text-[11px] text-text-muted">📎 {h.audio.name} ({(h.audio.size / (1024 * 1024)).toFixed(2)}MB)</div>
                          ) : null}
                        </div>
                      )}
                    </div>
                  ))}
                  {structuredHooks.length < 10 ? (
                    <button
                      type="button"
                      onClick={() => setStructuredHooks((prev) => [...prev, { text: '', audio: null }])}
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
                            onChange={(e) => {
                              const f = e.target.files?.[0] || null;
                              setStructuredBody((p) => ({ ...p, audio: f }));
                            }}
                            className="input-field file:mr-3 file:rounded-md file:border-0 file:bg-fuchsia-500 file:px-3 file:py-1 file:text-xs file:font-semibold file:text-white"
                            disabled={processing}
                          />
                          {structuredBody.audio ? (
                            <div className="text-[11px] text-text-muted">📎 {structuredBody.audio.name} ({(structuredBody.audio.size / (1024 * 1024)).toFixed(2)}MB)</div>
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
              ) : mode === 'copy' ? (
                <div className="mt-4">
                  {forcedParts && forcedParts.length > 0 ? (
                    <div className="mb-2 flex items-center justify-between rounded-[10px] border border-fuchsia-500/40 bg-fuchsia-500/10 px-3 py-2 text-[11px]">
                      <span className="text-fuchsia-200">
                        ⚙ Partes vindas do <strong>ClickUp Pilot</strong> (split do parser preservado: {forcedParts.map(p => p.label).join(', ')})
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
                  <textarea
                    value={copy}
                    onChange={(e) => { setCopy(e.target.value); if (forcedParts) setForcedParts(null); }}
                    placeholder="Cole aqui a copy completa. A ferramenta vai dividir em takes de ~20s sem cortar frase."
                    rows={10}
                    className="input-field resize-y font-mono text-sm"
                    disabled={processing}
                  />
                  {parts.length > 0 ? (
                    <div className="mt-3 rounded-[10px] border border-line bg-bg-soft/40 px-3 py-2 text-[11px] text-text-muted">
                      <strong className="text-lime">
                        {parts.length} take{parts.length === 1 ? '' : 's'}
                      </strong>{' '}
                      ({parts.length} arquivo
                      {parts.length === 1 ? '' : 's'} no ZIP final). Cada um
                      sera 1 video gerado pelo HeyGen via extensao.
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="mt-4">
                  <input
                    type="file"
                    accept="audio/*"
                    multiple
                    onChange={(e) =>
                      setAudioParts(Array.from(e.target.files ?? []))
                    }
                    className="input-field file:mr-3 file:rounded-md file:border-0 file:bg-lime file:px-3 file:py-1 file:text-xs file:font-semibold file:text-black"
                    disabled={processing}
                  />
                  {audioParts.length > 0 ? (
                    <div className="mt-2 text-[11px] text-text-muted">
                      {audioParts.length} arquivo
                      {audioParts.length === 1 ? '' : 's'} —{' '}
                      {audioParts.map((a) => a.name).join(', ')}
                    </div>
                  ) : null}
                  <div className="mt-2 rounded-[10px] border border-lime/30 bg-lime/5 px-3 py-2 text-[11px] text-lime/80">
                    ✓ Modo audio: a extensao envia cada arquivo pro HeyGen e
                    gera o avatar usando esse audio (lipsync).{' '}
                    {dynamicMode
                      ? 'Ordem CONTROLADA por voce (setas abaixo).'
                      : 'Os arquivos sao processados na ordem dos nomes (parte1, parte2...).'}
                  </div>
                </div>
              )}
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
