'use client';

import { useEffect, useRef, useState } from 'react';
import { logHistory } from '@/lib/history';
import { toFriendlyMessage } from '@/lib/friendly-error';
import { AudioPlayer } from '@/components/AudioPlayer';
import {
  ToolHero,
  ToolStep,
  ToolDropzone,
  ToolChoice,
  ToolSlider,
  ToolAction,
  ToolResultCard,
  ToolMetric,
} from '@/components/tool-kit';
import {
  IconDecupagem,
  IconStepUpload,
  IconStepFormat,
  IconStepSliders,
} from '@/components/ToolIcons';
import { useToolState } from '@/components/ToolsStateProvider';
import {
  decodeAudioRobust,
  downloadBlob,
  encodeWAV,
  trimSilences,
  detectSilences,
} from '@/lib/audio-engine';
import {
  cancelFFmpeg,
  concatDecupChunks,
  cutVideoSegments,
  extractAudioAs,
  isCancellationError,
  prepareVoiceForDecupagem,
  splitMediaForChunks,
} from '@/lib/ffmpeg-worker';
import { CancelButton } from '@/components/CancelButton';
import { formatTime } from '@/lib/utils';
import { useTier } from '@/lib/use-tier';
import { acquireKeepAlive, releaseKeepAlive } from '@/lib/tab-keepalive';

type OutputKind = 'video' | 'audio';
type AudioFmt = 'wav' | 'mp3';

type Result =
  | { kind: 'video'; blob: Blob; url: string; originalDur: number; newDur: number }
  | { kind: 'audio'; blob: Blob; url: string; format: AudioFmt; originalDur: number; newDur: number };

type QueueStatus = 'pending' | 'processing' | 'done' | 'error';
type QueueItem = {
  id: string;
  file: File;
  status: QueueStatus;
  stage?: string;
  progress?: number | null;
  result?: Result;
  error?: string;
};

const MAX_QUEUE = 10;

// Teto de tamanho. A decupagem roda 100% no NAVEGADOR — custo zero de
// servidor. O ffmpeg-wasm tem heap de ~2GB, então arquivo acima de 200MB é
// DIVIDIDO em partes de ~160MB (sem re-encode, corte em keyframe), cada parte
// passa pelo pipeline normal e o resultado é JUNTADO no final. 800MB é o teto
// honesto: 5 partes com folga enorme de memória em qualquer máquina.
const MAX_FILE_MB = 800;
const MAX_FILE_BYTES = MAX_FILE_MB * 1024 * 1024;

// Acima disto o arquivo é processado EM PARTES (dividir → decupar → juntar).
// Abaixo, caminho direto de sempre (1 passada, sem divisão).
const CHUNK_THRESHOLD_BYTES = 200 * 1024 * 1024; // 200 MB

const MAX_FILE_LABEL = `${MAX_FILE_MB} MB`;

const TOO_BIG_MSG =
  `Esse vídeo é muito pesado pra processar aqui (máx ${MAX_FILE_LABEL}). ` +
  `Reduz o peso na ferramenta Compressor primeiro e tenta de novo.`;

const BAD_TYPE_MSG = 'Formato não suportado. Manda MP3, WAV, MP4, WEBM ou MOV.';

// Traduz falhas técnicas do ffmpeg/navegador num recado que o cliente entende.
function friendlyError(e: unknown): string {
  const raw = (e as Error)?.message || '';
  // Watchdog do ffmpeg-wasm matou um exec pendurado (hang) — não é arquivo
  // pesado: a instância já reiniciou limpa, re-tentar costuma resolver.
  if (/travad|reiniciada/i.test(raw)) {
    return 'O processamento travou no meio e já foi reiniciado. Clica em "Continuar fila" pra tentar esse arquivo de novo.';
  }
  if (/could not be read|out of memory|memory|allocation|RangeError|Aborted|Maximum call/i.test(raw)) {
    return TOO_BIG_MSG;
  }
  // Sem padrão local: passa pela lib compartilhada (rede, limite, timeout...)
  // — nunca devolve o erro técnico cru pro cliente.
  return toFriendlyMessage(e, 'Não consegui processar esse arquivo. Tenta de novo.');
}

function isVideoFile(file: File): boolean {
  if (file.type.startsWith('video/')) return true;
  return /\.(mp4|webm|mov|mkv|avi)$/i.test(file.name);
}

// Drag & drop NÃO passa pelo `accept` do input — qualquer arquivo cai aqui
// (PDF, PNG, ZIP...). Valida por MIME + extensão pra virar erro claro na
// hora, em vez de minutos de ffmpeg pra falhar com mensagem técnica.
function isAcceptedMedia(file: File): boolean {
  if (file.type.startsWith('audio/') || file.type.startsWith('video/')) return true;
  return /\.(mp3|wav|m4a|aac|ogg|opus|flac|mp4|webm|mov|mkv|avi)$/i.test(file.name);
}

function baseName(name?: string | null) {
  if (!name) return 'arquivo';
  return name.replace(/\.[^.]+$/, '').replace(/\s+/g, '_');
}

function computeSpeechSegments(
  silences: Array<{ start: number; end: number }>,
  totalDur: number,
  keepSilence: number,
): Array<{ start: number; end: number }> {
  const segs: Array<{ start: number; end: number }> = [];
  let cursor = 0;
  for (const s of silences) {
    const silStart = Math.max(0, s.start + keepSilence);
    const silEnd = Math.min(totalDur, s.end - keepSilence);
    if (silEnd > silStart) {
      if (silStart > cursor) segs.push({ start: cursor, end: silStart });
      cursor = silEnd;
    }
  }
  if (cursor < totalDur) segs.push({ start: cursor, end: totalDur });
  return segs.filter((s) => s.end - s.start > 0.05);
}

export default function DecupagemPage() {
  const tier = useTier();
  const isFree = tier === 'free';

  // FILA de até 10 arquivos. useState (File não serializa pra persistir).
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const cancelRef = useRef(false);

  // Configs GLOBAIS (aplicam a todos os arquivos da fila) — persistem.
  const [keepSilence, setKeepSilence] = useToolState<number>('decupagem:keepSilence', 0.05);
  const [outputKind, setOutputKind] = useToolState<OutputKind>('decupagem:outputKind', 'video');
  const [audioFormat, setAudioFormat] = useToolState<AudioFmt>('decupagem:audioFormat', 'mp3');
  const [processing, setProcessing] = useState(false);
  // Guard SÍNCRONO contra duplo disparo: `processing` (state) só atualiza no
  // re-render — dois cliques rápidos entravam juntos e processavam a fila 2x
  // em paralelo (colisão de nomes no FS do ffmpeg-wasm = saída corrompida).
  const processingRef = useRef(false);

  // Espelho da fila pra revogar os Object URLs no unmount. Navegação SPA não
  // descarrega o documento — sem isso, cada visita à ferramenta vazava os
  // blobs dos resultados prontos (centenas de MB presos até fechar a aba).
  const queueRef = useRef<QueueItem[]>(queue);
  queueRef.current = queue;
  useEffect(
    () => () => {
      queueRef.current.forEach((q) => {
        if (q.result && 'url' in q.result) URL.revokeObjectURL(q.result.url);
      });
    },
    [],
  );

  // Fila NÃO sobrevive a F5 (File não serializa — e persistir 10×1,5GB no IDB
  // travaria o Chrome, ver lição do zip-store). Então enquanto PROCESSA, um
  // fechar/recarregar acidental pede confirmação — uma fila de horas não pode
  // morrer num Ctrl+R sem querer.
  useEffect(() => {
    if (!processing) return;
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [processing]);

  // Free é forçado a 'audio'. Vídeo só pra pagos.
  const queueHasVideo = queue.some((q) => isVideoFile(q.file));

  function patchItem(id: string, patch: Partial<QueueItem>) {
    setQueue((prev) => prev.map((q) => (q.id === id ? { ...q, ...patch } : q)));
  }

  function addFiles(files: File[]) {
    setQueue((prev) => {
      const room = MAX_QUEUE - prev.length;
      if (room <= 0) return prev;
      const accepted = files.slice(0, room).map((f) => {
        const tooBig = f.size > MAX_FILE_BYTES;
        const badType = !isAcceptedMedia(f);
        return {
          id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          file: f,
          status: (tooBig || badType ? 'error' : 'pending') as QueueStatus,
          error: badType ? BAD_TYPE_MSG : tooBig ? TOO_BIG_MSG : undefined,
        };
      });
      return [...prev, ...accepted];
    });
  }

  function revokeResult(r?: Result) {
    if (r && 'url' in r) URL.revokeObjectURL(r.url);
  }

  function removeItem(id: string) {
    setQueue((prev) => {
      const it = prev.find((q) => q.id === id);
      revokeResult(it?.result);
      return prev.filter((q) => q.id !== id);
    });
  }

  function clearQueue() {
    queue.forEach((q) => revokeResult(q.result));
    setQueue([]);
  }

  // Executa o pipeline da decupagem pra UM blob (arquivo inteiro OU uma parte
  // de arquivo grande). `allowEmpty`: numa PARTE toda-silêncio, devolver
  // blob=null é legítimo (a parte só não entra na junção); no arquivo inteiro
  // é erro claro.
  async function processBrowserBlob(
    media: Blob,
    kind: OutputKind,
    onStage: (s: string) => void,
    onProgress: (r: number | null) => void,
    allowEmpty: boolean,
  ): Promise<{ blob: Blob | null; originalDur: number; newDur: number }> {
    if (kind === 'audio') {
      // Regula a voz (nível + limpeza, transparente) ANTES de cortar — voz
      // baixa não vira silêncio e o ruído some sem deixar a voz robótica.
      onStage('Regulando a voz...');
      const leveled = await prepareVoiceForDecupagem(
        media,
        { onStage, onProgress: ({ ratio }) => onProgress(ratio * 0.5) },
        'wav',
      );
      onStage('Carregando...');
      const decoded = await decodeAudioRobust(leveled, () => onStage('Carregando...'));
      onStage('Cortando silêncios...');
      const trimmed = trimSilences(decoded, keepSilence);
      if (trimmed.duration <= 0.05) {
        if (allowEmpty) return { blob: null, originalDur: decoded.duration, newDur: 0 };
        throw new Error('Não consegui detectar a fala. Diminui a tolerância de silêncio.');
      }
      let blob: Blob;
      if (audioFormat === 'wav') {
        onStage('Gerando arquivo...');
        blob = encodeWAV(trimmed);
      } else {
        onStage('Gerando arquivo...');
        const wav = encodeWAV(trimmed);
        blob = await extractAudioAs(wav, 'mp3', {
          onStage: () => onStage('Gerando arquivo...'),
          // Nivelamento ocupou 0→0.5 da barra; o encode MP3 fecha 0.5→1
          // (sem isso a barra voltava pro zero no meio do processo).
          onProgress: ({ ratio }) => onProgress(0.5 + ratio * 0.5),
        });
      }
      return { blob, originalDur: decoded.duration, newDur: trimmed.duration };
    }

    // vídeo
    // Regula a voz do vídeo INTEIRO (nível + limpeza, vídeo intacto via
    // -c:v copy) antes de detectar silêncio e cortar. Detecção e corte rodam
    // sobre o arquivo já nivelado → voz baixa não some, sem ruído/robótico.
    onStage('Regulando a voz...');
    const leveled = await prepareVoiceForDecupagem(
      media,
      { onStage, onProgress: ({ ratio }) => onProgress(ratio * 0.4) },
      'mp4',
    );
    onStage('Analisando...');
    const decoded = await decodeAudioRobust(leveled, () => onStage('Analisando...'));
    const silences = detectSilences(decoded);
    const segments = computeSpeechSegments(silences, decoded.duration, keepSilence);
    if (segments.length === 0) {
      if (allowEmpty) return { blob: null, originalDur: decoded.duration, newDur: 0 };
      throw new Error('Não consegui detectar a fala. Diminui a tolerância de silêncio.');
    }
    const newDur = segments.reduce((a, s) => a + (s.end - s.start), 0);
    onStage(`Cortando ${segments.length} trechos de fala...`);
    const blob = await cutVideoSegments(leveled, segments, {
      onStage: (s) => onStage(s),
      onProgress: ({ ratio }) => onProgress(0.4 + ratio * 0.6),
    });
    return { blob, originalDur: decoded.duration, newDur };
  }

  // Arquivo GRANDE (>200MB): divide em partes de ~160MB SEM re-encode, roda o
  // pipeline normal em cada parte (tarefa por tarefa, com progresso próprio) e
  // junta os resultados com -c copy. 100% no navegador — custo zero, e o pico
  // de memória fica o de UMA parte, nunca o do arquivo inteiro.
  async function processChunked(
    file: File,
    kind: OutputKind,
    onStage: (s: string) => void,
    onProgress: (r: number | null) => void,
  ): Promise<Result> {
    onStage('Dividindo o arquivo em partes...');
    onProgress(null);
    const chunks: Array<File | null> = await splitMediaForChunks(file, {
      onStage,
      onProgress: ({ ratio }) => onProgress(ratio * 0.05),
    });
    const n = chunks.length;
    const outputs: Blob[] = [];
    let originalDur = 0;
    let newDur = 0;
    for (let i = 0; i < n; i++) {
      if (cancelRef.current) throw new Error('CANCELLED_BY_USER');
      const prefix = n > 1 ? `Parte ${i + 1}/${n} — ` : '';
      const base = 0.05 + (i / n) * 0.9;
      const span = 0.9 / n;
      const part = await processBrowserBlob(
        chunks[i]!,
        kind,
        (s) => onStage(`${prefix}${s}`),
        (r) => onProgress(r == null ? null : base + r * span),
        n > 1, // parte toda-silêncio é legítima quando há outras partes
      );
      chunks[i] = null; // solta a parte crua já processada (GC)
      originalDur += part.originalDur;
      newDur += part.newDur;
      if (part.blob) outputs.push(part.blob);
    }
    if (outputs.length === 0) {
      throw new Error('Não consegui detectar a fala. Diminui a tolerância de silêncio.');
    }
    const joinFormat = kind === 'video' ? ('mp4' as const) : audioFormat;
    const joined =
      outputs.length === 1
        ? outputs[0]
        : await concatDecupChunks(outputs, joinFormat, {
            onStage,
            onProgress: ({ ratio }) => onProgress(0.95 + ratio * 0.05),
          });
    if (kind === 'video') {
      return { kind: 'video', blob: joined, url: URL.createObjectURL(joined), originalDur, newDur };
    }
    return { kind: 'audio', blob: joined, url: URL.createObjectURL(joined), format: audioFormat, originalDur, newDur };
  }

  // Processa UM arquivo → retorna Result (não mexe em state global).
  async function processOne(
    item: QueueItem,
    onStage: (s: string) => void,
    onProgress: (r: number | null) => void,
  ): Promise<Result> {
    const file = item.file;
    const fileIsVideo = isVideoFile(file);
    const effectiveKind: OutputKind = isFree ? 'audio' : fileIsVideo ? outputKind : 'audio';

    // Arquivo grande → dividir/decupar/juntar no próprio navegador.
    if (file.size > CHUNK_THRESHOLD_BYTES) {
      return await processChunked(file, effectiveKind, onStage, onProgress);
    }

    const part = await processBrowserBlob(file, effectiveKind, onStage, onProgress, false);
    if (!part.blob) {
      // allowEmpty=false já lança antes — defesa extra pro TS e pra runtime.
      throw new Error('Não consegui detectar a fala. Diminui a tolerância de silêncio.');
    }
    if (effectiveKind === 'video') {
      return {
        kind: 'video',
        blob: part.blob,
        url: URL.createObjectURL(part.blob),
        originalDur: part.originalDur,
        newDur: part.newDur,
      };
    }
    return {
      kind: 'audio',
      blob: part.blob,
      url: URL.createObjectURL(part.blob),
      format: audioFormat,
      originalDur: part.originalDur,
      newDur: part.newDur,
    };
  }

  // Processa a FILA — 1 por vez (sequencial).
  async function processQueue() {
    if (processingRef.current) return;
    // Tier ainda resolvendo (1º load da sessão): não dispara — sem isso um
    // free podia sair com VÍDEO (que é só de pago) e vice-versa. O botão já
    // fica desabilitado; este é o cinto de segurança.
    if (tier === null) return;
    processingRef.current = true;
    cancelRef.current = false;
    setProcessing(true);
    // Aba não congela em background durante a fila (mesmo motor do Pilot) — e a
    // sessão de áudio ativa segura o Windows acordado numa fila de madrugada.
    acquireKeepAlive();
    // Pré-carrega o chunk do JSZip AGORA: um deploy durante a noite invalida os
    // chunks antigos do CDN — de manhã o "Baixar todos (ZIP)" importaria um
    // chunk que não existe mais. Importado uma vez, fica cacheado no módulo.
    import('jszip').catch(() => { /* sem ZIP, downloads individuais seguem */ });
    try {
      for (const item of queue) {
        if (cancelRef.current) break;
        if (item.status === 'done') continue; // já processado, pula
        if (!isAcceptedMedia(item.file)) {
          // Formato inválido é permanente — nunca re-tenta.
          patchItem(item.id, { status: 'error', error: BAD_TYPE_MSG, stage: undefined, progress: null });
          continue;
        }
        if (item.file.size > MAX_FILE_BYTES) {
          // Arquivo grande demais pro navegador — nem tenta carregar.
          patchItem(item.id, { status: 'error', error: TOO_BIG_MSG, stage: undefined, progress: null });
          continue;
        }
        patchItem(item.id, { status: 'processing', stage: 'Iniciando...', progress: null, error: undefined });
        try {
          const result = await processOne(
            item,
            (s) => patchItem(item.id, { stage: s }),
            (r) => patchItem(item.id, { progress: r }),
          );
          patchItem(item.id, { status: 'done', result, stage: undefined, progress: null });
          logHistory({
            tool: 'decupagem',
            title: `${item.file.name} decupado`,
            meta:
              result.originalDur > 0
                ? `${Math.round((1 - result.newDur / result.originalDur) * 100)}% menor`
                : undefined,
          });
        } catch (e) {
          // Só trata como cancelamento se o USER cancelou de fato. Um crash
          // do wasm (OOM/watchdog) também rejeita com "abort"/"terminate" —
          // sem checar cancelRef, o erro sumia em silêncio: o item voltava
          // pra 'pending' e a fila parava sem mostrar nada.
          if (isCancellationError(e) && cancelRef.current) {
            patchItem(item.id, { status: 'pending', stage: undefined, progress: null });
            break;
          }
          patchItem(item.id, {
            status: 'error',
            error: friendlyError(e),
            stage: undefined,
            progress: null,
          });
        }
      }
    } finally {
      releaseKeepAlive();
      processingRef.current = false;
      setProcessing(false);
    }
  }

  function cancelAll() {
    cancelRef.current = true;
    cancelFFmpeg();
  }

  async function downloadOne(item: QueueItem) {
    if (!item.result) return;
    const r = item.result;
    const base = baseName(item.file.name);
    const ext = r.kind === 'video' ? 'mp4' : r.format;
    await downloadBlob(r.blob, `${base}_decupado.${ext}`);
  }

  async function downloadAll() {
    const done = queue.filter((q) => q.result) as Array<QueueItem & { result: Result }>;
    if (done.length === 0) return;
    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();
    const used = new Set<string>();
    for (const q of done) {
      const r = q.result;
      const ext = r.kind === 'video' ? 'mp4' : r.format;
      let name = `${baseName(q.file.name)}_decupado.${ext}`;
      let i = 2;
      while (used.has(name)) { name = `${baseName(q.file.name)}_decupado_${i++}.${ext}`; }
      used.add(name);
      // MP4/MP3 já são comprimidos — DEFLATE neles só queima CPU pra ganhar
      // ~0%. STORE junta direto; WAV (PCM cru) segue no DEFLATE global.
      zip.file(name, r.blob, ext === 'wav' ? undefined : { compression: 'STORE' });
    }
    const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 1 } });
    await downloadBlob(blob, `decupagem_${done.length}_arquivos.zip`);
  }

  const doneCount = queue.filter((q) => q.status === 'done').length;
  const zippableCount = queue.filter((q) => q.result).length;
  const audioOptions = [
    { value: 'mp3' as const, label: 'MP3' },
    { value: 'wav' as const, label: 'WAV' },
  ];

  return (
    <div className="mx-auto w-full max-w-[920px] px-5 md:px-8">
      <ToolHero
        title="Decupagem"
        eyebrow="VÍDEO / ÁUDIO · FILA ATÉ 10"
        subtitle="Corta os silêncios em lote. Joga até 10 arquivos, processa 1 por vez. Vídeo→vídeo, áudio→áudio."
        hue="rgba(163,230,53,0.4)"
        icon={<IconDecupagem size={56} />}
      />

      <div className="mt-6 grid gap-5">
        {/* PASSO 1 — UPLOAD (FILA) */}
        <ToolStep
          n={1}
          icon={<IconStepUpload size={18} />}
          title={`Solta os arquivos (até ${MAX_QUEUE})`}
          hint={`MP3, WAV, MP4, WEBM ou MOV — vários de uma vez · até ${MAX_FILE_LABEL} cada`}
          hue="rgba(163,230,53,0.4)"
        >
          <ToolDropzone
            accept="audio/*,video/mp4,video/webm,video/quicktime"
            file={null}
            onFile={() => {}}
            multiple
            onFiles={addFiles}
            hint={`Arraste vários ou clique. ${queue.length}/${MAX_QUEUE} na fila.`}
            hue="rgba(163,230,53,0.5)"
            disabled={processing || queue.length >= MAX_QUEUE}
          />

          {/* LISTA DA FILA */}
          {queue.length > 0 ? (
            <div className="mt-3 grid gap-2">
              {queue.map((item, idx) => {
                const itemIsVideo = isVideoFile(item.file);
                const reduced =
                  item.result && item.result.originalDur > 0
                    ? Math.max(0, Math.round((1 - item.result.newDur / item.result.originalDur) * 100))
                    : 0;
                return (
                  <div
                    key={item.id}
                    className={
                      'rounded-[12px] border px-3.5 py-2.5 transition ' +
                      (item.status === 'done'
                        ? 'border-lime/40 bg-lime/[0.06]'
                        : item.status === 'error'
                          ? 'border-red-500/40 bg-red-500/[0.06]'
                          : item.status === 'processing'
                            ? 'border-lime/50 bg-lime/[0.04] scan-line'
                            : 'border-line bg-bg-soft/40')
                    }
                  >
                    <div className="flex items-center gap-3">
                      {/* índice / status badge */}
                      <span
                        className={
                          'mono flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ' +
                          (item.status === 'done'
                            ? 'bg-lime/20 text-lime'
                            : item.status === 'error'
                              ? 'bg-red-500/20 text-red-300'
                              : item.status === 'processing'
                                ? 'bg-lime/15 text-lime'
                                : 'bg-line text-text-muted')
                        }
                      >
                        {item.status === 'done' ? '✓' : item.status === 'error' ? '✕' : idx + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[12.5px] font-semibold text-white">
                          {item.file.name}
                        </div>
                        <div className="mono text-[10px] text-text-muted">
                          {(item.file.size / (1024 * 1024)).toFixed(1)} MB · {itemIsVideo ? 'vídeo' : 'áudio'}
                          {item.status === 'processing' && item.stage ? ` · ${item.stage}` : ''}
                          {item.status === 'done' && item.result ? ` · −${reduced}% · ${formatTime(item.result.newDur)}` : ''}
                          {item.status === 'error' ? ` · ${item.error}` : ''}
                          {item.status === 'pending' ? ' · na fila' : ''}
                        </div>
                        {item.status === 'processing' && item.progress != null ? (
                          <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-line">
                            <div className="h-full bg-lime transition-all" style={{ width: `${Math.round(item.progress * 100)}%` }} />
                          </div>
                        ) : null}
                      </div>
                      {/* ações por item */}
                      {item.status === 'done' ? (
                        <button
                          type="button"
                          onClick={() => downloadOne(item)}
                          className="shrink-0 rounded-full border border-lime/50 bg-lime/10 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-lime hover:bg-lime/20"
                        >
                          ↓ Baixar
                        </button>
                      ) : null}
                      {!processing ? (
                        <button
                          type="button"
                          onClick={() => removeItem(item.id)}
                          className="shrink-0 rounded-full border border-text-muted/30 px-2 py-1 text-[11px] text-text-muted hover:border-red-500/40 hover:text-red-300"
                          title="Remover da fila"
                        >
                          ×
                        </button>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}
        </ToolStep>

        {/* PASSO 2 — SAÍDA (só se a fila tem vídeo) */}
        {queueHasVideo ? (
          <ToolStep
            n={2}
            icon={<IconStepFormat size={18} />}
            title="Como receber os vídeos?"
            hint={isFree ? 'A conta grátis exporta só áudio' : 'Aplica a todos os vídeos da fila'}
            hue="rgba(167,139,250,0.4)"
          >
            <ToolChoice
              value={isFree ? 'audio' : outputKind}
              onChange={(v) => {
                if (v === 'video' && isFree) return;
                setOutputKind(v);
              }}
              options={[
                { value: 'video' as const, label: 'Vídeo' },
                { value: 'audio' as const, label: 'Áudio' },
              ]}
              disabled={processing}
            />
            {isFree ? <p className="mt-2 text-[11.5px] text-violet">🔒 Vídeo bloqueado no plano grátis.</p> : null}
          </ToolStep>
        ) : null}

        {/* PASSO 3 — FORMATO DE ÁUDIO */}
        {(isFree || outputKind === 'audio' || !queueHasVideo) ? (
          <ToolStep
            n={queueHasVideo ? 3 : 2}
            icon={<IconStepFormat size={18} />}
            title="Formato do áudio"
            hue="rgba(34,211,238,0.4)"
          >
            <ToolChoice value={audioFormat} onChange={setAudioFormat} options={audioOptions} disabled={processing} />
          </ToolStep>
        ) : null}

        {/* PASSO 4 — TOLERÂNCIA */}
        <ToolStep
          n={queueHasVideo ? 4 : 3}
          icon={<IconStepSliders size={18} />}
          title="Quanto de silêncio manter?"
          hint="Pouco = corte agressivo. Muito = fala respira"
          hue="rgba(244,114,182,0.4)"
        >
          <ToolSlider
            label="Tolerância de silêncio"
            min={0.01}
            max={0.5}
            step={0.01}
            value={keepSilence}
            onChange={setKeepSilence}
            display={(v) => `${v.toFixed(2)}s`}
            disabled={processing}
          />
        </ToolStep>

        {/* AÇÃO */}
        <div className="flex flex-wrap items-center gap-3">
          {processing ? (
            <CancelButton onClick={cancelAll} label="Cancelar fila" />
          ) : (
            <ToolAction onClick={processQueue} disabled={queue.length === 0 || tier === null} variant="lime">
              {tier === null && queue.length > 0
                ? 'Verificando conta...'
                : doneCount > 0 && doneCount < queue.length
                  ? `Continuar fila (${queue.length - doneCount} restantes)`
                  : `Decupar fila (${queue.length})`}
            </ToolAction>
          )}
          {zippableCount >= 2 ? (
            <button onClick={downloadAll} className="btn-lime !py-2.5 text-xs" disabled={processing}>
              ↓ Baixar todos (ZIP)
            </button>
          ) : null}
          <button onClick={clearQueue} className="btn-ghost" disabled={processing || queue.length === 0}>
            Limpar fila
          </button>
        </div>

        {/* PREVIEW de TODOS os arquivos prontos */}
        {doneCount > 0 ? (
          <div className="grid gap-4">
            <div className="label-tech text-[10px] uppercase tracking-widest text-lime">
              {doneCount} pronto{doneCount === 1 ? '' : 's'} — preview + download de cada
            </div>
            {queue
              .filter((q) => q.status === 'done' && q.result)
              .map((item) => {
                const r = item.result!;
                const reduced = r.originalDur > 0 ? Math.max(0, Math.round((1 - r.newDur / r.originalDur) * 100)) : 0;
                return (
                  <ToolResultCard key={item.id} title={item.file.name} meta={`${reduced}% menor`}>
                    <div className="mb-4 grid gap-2.5 sm:grid-cols-3">
                      <ToolMetric value={formatTime(r.originalDur)} label="Original" />
                      <ToolMetric value={formatTime(r.newDur)} label="Após decupagem" accent="lime" />
                      <ToolMetric value={`–${reduced}%`} label="Redução" accent="lime" />
                    </div>
                    {r.kind === 'video' ? (
                      <video
                        src={r.url}
                        controls
                        preload="metadata"
                        className="w-full rounded-[14px] border border-lime/30 bg-bg shadow-[0_0_28px_-12px_rgba(200,232,124,0.4)]"
                      />
                    ) : (
                      <AudioPlayer src={r.url} label="Preview" />
                    )}
                    <div className="mt-4 flex justify-end">
                      <button onClick={() => downloadOne(item)} className="btn-lime !py-2.5 text-xs">
                        Baixar {r.kind === 'video' ? 'MP4' : r.format.toUpperCase()}
                      </button>
                    </div>
                  </ToolResultCard>
                );
              })}
          </div>
        ) : null}
      </div>
    </div>
  );
}
