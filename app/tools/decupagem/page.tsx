'use client';

import { useRef, useState } from 'react';
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
  cutVideoSegments,
  extractAudioAs,
  isCancellationError,
  prepareVoiceForDecupagem,
} from '@/lib/ffmpeg-worker';
import { CancelButton } from '@/components/CancelButton';
import { formatTime } from '@/lib/utils';
import { useTier } from '@/lib/use-tier';

type OutputKind = 'video' | 'audio';
type AudioFmt = 'wav' | 'mp3';

type Result =
  | { kind: 'video'; blob: Blob; url: string; originalDur: number; newDur: number }
  | { kind: 'audio'; blob: Blob; url: string; format: AudioFmt; originalDur: number; newDur: number }
  // Resultado processado NO SERVIDOR (arquivo grande): não temos o blob, só a
  // URL de download direto do worker (Content-Disposition força o nome).
  | { kind: 'server'; downloadUrl: string; outputKind: OutputKind; originalDur: number; newDur: number };

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

// Teto de tamanho. A decupagem roda 100% no navegador (ffmpeg.wasm carrega o
// arquivo inteiro na memória), e o WebAssembly tem um teto rígido (~2 GB num
// único bloco). Acima de ~1.5 GB o ffmpeg fica sem folga pra trabalhar e
// estoura no meio. Bloqueamos no upload com recado humano em vez de deixar o
// cliente descobrir com um "File could not be read! Code=-1".
const MAX_FILE_MB = 1536; // 1.5 GB
const MAX_FILE_BYTES = MAX_FILE_MB * 1024 * 1024;

// Acima deste tamanho, o arquivo NÃO é processado no navegador (ffmpeg-wasm
// estoura a memória). Vai pro SERVIDOR (Modal + ffmpeg nativo), que aguenta até
// 1.5 GB sempre e devolve um MP4 íntegro. Abaixo disso fica no navegador
// (instantâneo e sem custo). Só pra contas pagas (servidor tem custo).
const SERVER_THRESHOLD_BYTES = 200 * 1024 * 1024; // 200 MB

const TOO_BIG_MSG =
  `Esse vídeo é muito pesado pra processar aqui no navegador (máx ${(MAX_FILE_MB / 1024).toFixed(1).replace('.0', '')} GB). ` +
  `Reduz o peso na ferramenta Compressor primeiro e tenta de novo.`;

// Traduz falhas técnicas do ffmpeg/navegador num recado que o cliente entende.
function friendlyError(e: unknown): string {
  const raw = (e as Error)?.message || '';
  if (/could not be read|out of memory|memory|allocation|RangeError|Aborted|Maximum call/i.test(raw)) {
    return TOO_BIG_MSG;
  }
  return raw || 'Não consegui processar esse arquivo. Tenta de novo.';
}

function isVideoFile(file: File): boolean {
  if (file.type.startsWith('video/')) return true;
  return /\.(mp4|webm|mov|mkv|avi)$/i.test(file.name);
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

function fileExt(name: string): string {
  const m = /\.([a-zA-Z0-9]+)$/.exec(name);
  return (m ? m[1] : 'mp4').toLowerCase();
}

// Upload direto pro worker Modal com progresso (XHR — fetch não dá progresso de
// upload). `ticketBase` = { base, ticket } vindos da nossa rota /ticket.
function uploadToModal(
  base: string,
  ticket: string,
  file: File,
  onProgress: (ratio: number) => void,
  isCancelled: () => boolean,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const ext = fileExt(file.name);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${base}/up?ext=${encodeURIComponent(ext)}`);
    xhr.setRequestHeader('X-Decup-Ticket', ticket);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const j = JSON.parse(xhr.responseText);
          if (j?.id) return resolve(j.id as string);
          reject(new Error('Resposta de upload inválida.'));
        } catch {
          reject(new Error('Resposta de upload inválida.'));
        }
      } else {
        reject(new Error(`Falha no envio (HTTP ${xhr.status}).`));
      }
    };
    xhr.onerror = () => reject(new Error('Falha de rede no envio pro servidor.'));
    xhr.onabort = () => reject(new Error('CANCELLED_BY_USER'));
    // Cancelamento cooperativo.
    const timer = setInterval(() => {
      if (isCancelled()) {
        clearInterval(timer);
        try { xhr.abort(); } catch { /* noop */ }
      }
    }, 500);
    xhr.onloadend = () => clearInterval(timer);
    xhr.send(file);
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
        return {
          id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          file: f,
          status: (tooBig ? 'error' : 'pending') as QueueStatus,
          error: tooBig ? TOO_BIG_MSG : undefined,
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

  // Processa UM arquivo grande NO SERVIDOR (Modal + ffmpeg nativo). Sobe direto
  // pro worker (ticket descartável), dispara o job e acompanha por polling.
  async function processOnServer(
    file: File,
    outKind: OutputKind,
    onStage: (s: string) => void,
    onProgress: (r: number | null) => void,
  ): Promise<Result> {
    onStage('Preparando envio...');
    const tRes = await fetch('/api/tools/decupagem/ticket', { method: 'POST' });
    if (!tRes.ok) {
      const j = await tRes.json().catch(() => null);
      throw new Error(j?.error || 'Não consegui preparar o envio pro servidor.');
    }
    const { base, ticket } = (await tRes.json()) as { base: string; ticket: string };

    // Acorda o container do servidor ANTES de mandar o arquivo grande. Container
    // frio às vezes redireciona (303) o primeiro request grande; com ele já
    // quente, o upload entra direto.
    onStage('Acordando o servidor...');
    try {
      await fetch(`${base}/health`, { cache: 'no-store' });
      await sleep(1500);
    } catch { /* segue — o retry abaixo cobre */ }

    // Upload com retry: se o container ainda estava frio e derrubou, tenta de
    // novo (com o servidor já quente da tentativa anterior).
    onStage('Enviando pro servidor...');
    let inputId = '';
    let lastErr: unknown = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (cancelRef.current) throw new Error('CANCELLED_BY_USER');
      try {
        inputId = await uploadToModal(
          base,
          ticket,
          file,
          (ratio) => onProgress(ratio * 0.5), // upload = primeira metade da barra
          () => cancelRef.current,
        );
        break;
      } catch (e) {
        if ((e as Error)?.message === 'CANCELLED_BY_USER') throw e;
        lastErr = e;
        await sleep(2000); // deixa o servidor terminar de subir e tenta de novo
      }
    }
    if (!inputId) {
      throw new Error(
        'Não consegui enviar o arquivo pro servidor (tentei 3x). Verifica a conexão e tenta de novo.' +
          (lastErr ? ` (${(lastErr as Error).message})` : ''),
      );
    }

    onStage('Decupando no servidor...');
    onProgress(null); // indeterminado durante o processamento
    const sRes = await fetch('/api/tools/decupagem/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input_id: inputId,
        keepSilence,
        outputKind: outKind,
        fileName: file.name,
      }),
    });
    if (!sRes.ok) {
      const j = await sRes.json().catch(() => null);
      throw new Error(j?.error || 'Falha ao iniciar a decupagem no servidor.');
    }
    const { job } = (await sRes.json()) as { job: string };

    // Polling até concluir. Vídeo grande pode levar minutos.
    for (let i = 0; i < 600; i++) {
      if (cancelRef.current) throw new Error('CANCELLED_BY_USER');
      await sleep(5000);
      const st = await fetch(`/api/tools/decupagem/status?job=${encodeURIComponent(job)}`);
      const j = await st.json().catch(() => null);
      if (!j) continue;
      if (j.status === 'done') {
        return {
          kind: 'server',
          downloadUrl: j.download_url as string,
          outputKind: outKind,
          originalDur: Number(j.original_dur) || 0,
          newDur: Number(j.new_dur) || 0,
        };
      }
      if (j.status === 'failed' || j.status === 'error') {
        throw new Error(j.error || 'O servidor não conseguiu decupar esse arquivo.');
      }
      // 'processing' → segue no loop
    }
    throw new Error('O servidor demorou demais. Tenta de novo.');
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

    // Arquivo grande → SERVIDOR (ffmpeg nativo, sem teto de memória do navegador).
    // Só pra contas pagas; conta grátis segue no navegador (e recebe aviso se
    // passar do limite que o navegador aguenta).
    if (!isFree && file.size > SERVER_THRESHOLD_BYTES) {
      return await processOnServer(file, effectiveKind, onStage, onProgress);
    }

    if (effectiveKind === 'audio') {
      // Regula a voz (nível + limpeza, transparente) ANTES de cortar — voz
      // baixa não vira silêncio e o ruído some sem deixar a voz robótica.
      onStage('Regulando a voz...');
      const leveled = await prepareVoiceForDecupagem(
        file,
        { onStage, onProgress: ({ ratio }) => onProgress(ratio * 0.5) },
        'wav',
      );
      onStage('Carregando...');
      const decoded = await decodeAudioRobust(leveled, () => onStage('Carregando...'));
      onStage('Cortando silêncios...');
      const trimmed = trimSilences(decoded, keepSilence);
      let blob: Blob;
      if (audioFormat === 'wav') {
        onStage('Gerando arquivo...');
        blob = encodeWAV(trimmed);
      } else {
        onStage('Gerando arquivo...');
        const wav = encodeWAV(trimmed);
        blob = await extractAudioAs(wav, 'mp3', {
          onStage: () => onStage('Gerando arquivo...'),
          onProgress: ({ ratio }) => onProgress(ratio),
        });
      }
      return {
        kind: 'audio',
        blob,
        url: URL.createObjectURL(blob),
        format: audioFormat,
        originalDur: decoded.duration,
        newDur: trimmed.duration,
      };
    }

    // vídeo
    // Regula a voz do vídeo INTEIRO (nível + limpeza, vídeo intacto via
    // -c:v copy) antes de detectar silêncio e cortar. Detecção e corte rodam
    // sobre o arquivo já nivelado → voz baixa não some, sem ruído/robótico.
    onStage('Regulando a voz...');
    const leveled = await prepareVoiceForDecupagem(
      file,
      { onStage, onProgress: ({ ratio }) => onProgress(ratio * 0.4) },
      'mp4',
    );
    onStage('Analisando...');
    const decoded = await decodeAudioRobust(leveled, () => onStage('Analisando...'));
    const silences = detectSilences(decoded);
    const segments = computeSpeechSegments(silences, decoded.duration, keepSilence);
    if (segments.length === 0) {
      throw new Error('Não consegui detectar a fala. Diminui a tolerância de silêncio.');
    }
    const newDur = segments.reduce((a, s) => a + (s.end - s.start), 0);
    onStage(`Cortando ${segments.length} trechos de fala...`);
    const blob = await cutVideoSegments(leveled, segments, {
      onStage: (s) => onStage(s),
      onProgress: ({ ratio }) => onProgress(0.4 + ratio * 0.6),
    });
    return {
      kind: 'video',
      blob,
      url: URL.createObjectURL(blob),
      originalDur: decoded.duration,
      newDur,
    };
  }

  // Processa a FILA — 1 por vez (sequencial).
  async function processQueue() {
    if (processing) return;
    cancelRef.current = false;
    setProcessing(true);
    try {
      for (const item of queue) {
        if (cancelRef.current) break;
        if (item.status === 'done') continue; // já processado, pula
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
        } catch (e) {
          if (isCancellationError(e)) {
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
    // Resultado do servidor: baixa direto do worker (Content-Disposition já
    // força o nome certo). Navegação simples, sem fetch/CORS.
    if (r.kind === 'server') {
      const a = document.createElement('a');
      a.href = r.downloadUrl;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
      return;
    }
    const base = baseName(item.file.name);
    const ext = r.kind === 'video' ? 'mp4' : r.format;
    await downloadBlob(r.blob, `${base}_decupado.${ext}`);
  }

  async function downloadAll() {
    // O ZIP só junta os processados NO NAVEGADOR (têm blob). Os do servidor se
    // baixam individualmente (são arquivos grandes, fora do ZIP).
    const done = queue.filter((q) => q.result && q.result.kind !== 'server') as Array<
      QueueItem & { result: Exclude<Result, { kind: 'server' }> }
    >;
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
      zip.file(name, r.blob);
    }
    const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 1 } });
    await downloadBlob(blob, `decupagem_${done.length}_arquivos.zip`);
  }

  const doneCount = queue.filter((q) => q.status === 'done').length;
  // Só os processados no navegador entram no ZIP (servidor baixa individual).
  const zippableCount = queue.filter((q) => q.result && q.result.kind !== 'server').length;
  const audioOptions = [
    { value: 'mp3' as const, label: 'MP3', sub: 'menor' },
    { value: 'wav' as const, label: 'WAV', sub: 'qualidade máx' },
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
          hint={`MP3, WAV, MP4, WEBM ou MOV — vários de uma vez · até ${(MAX_FILE_MB / 1024).toFixed(1).replace('.0', '')} GB cada`}
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
                { value: 'video' as const, label: 'Vídeo', sub: 'mp4' },
                { value: 'audio' as const, label: 'Áudio', sub: 'só som' },
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
            <ToolAction onClick={processQueue} disabled={queue.length === 0} variant="lime">
              {doneCount > 0 && doneCount < queue.length
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
                    {r.kind === 'server' ? (
                      <div className="rounded-[14px] border border-lime/30 bg-lime/[0.05] px-4 py-3 text-[12px] text-text-muted">
                        ✓ Processado no servidor (arquivo grande). Clica em baixar pra pegar o {r.outputKind === 'audio' ? 'áudio' : 'vídeo'} decupado.
                      </div>
                    ) : r.kind === 'video' ? (
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
                        Baixar {r.kind === 'server' ? (r.outputKind === 'audio' ? 'MP3' : 'MP4') : r.kind === 'video' ? 'MP4' : r.format.toUpperCase()}
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
