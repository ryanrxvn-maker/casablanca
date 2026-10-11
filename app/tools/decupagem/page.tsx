'use client';

import { useEffect, useState } from 'react';
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
  trimSpeechCutWithPlan,
} from '@/lib/audio-engine';
import { planSpeechCut } from '@/lib/speech-detect';
import {
  cancelarMotorSeDono,
  concatDecupChunks,
  cutVideoSegments,
  extractAudioAs,
  prepareVoiceForDecupagem,
  splitMediaForChunks,
} from '@/lib/ffmpeg-worker';
import { CancelButton } from '@/components/CancelButton';
import { DecupAuditBadge, type DecupAudit } from '@/components/DecupAuditBadge';
import { formatTime } from '@/lib/utils';
import { useTier } from '@/lib/use-tier';
import { acquireKeepAlive, releaseKeepAlive } from '@/lib/tab-keepalive';
import { entrarNaFila, MSG_NA_FILA } from '@/lib/ffmpeg-serial';
import { zipCabeNoNavegador, MSG_ZIP_GRANDE, MSG_ZIP_FALHOU } from '@/lib/zip-limite';

type OutputKind = 'video' | 'audio';
type AudioFmt = 'wav' | 'mp3';
type OutFormat = 'mp4' | AudioFmt;

function toAudit(plan: { cuts: number; audit: { savedSec: number; speechRemovedSec: number; refusedCuts: number; ok: boolean } }): DecupAudit {
  return {
    savedSec: plan.audit.savedSec,
    speechRemovedSec: plan.audit.speechRemovedSec,
    refusedCuts: plan.audit.refusedCuts,
    cuts: plan.cuts,
    ok: plan.audit.ok,
  };
}

function mergeAudit(a: DecupAudit | undefined, b: DecupAudit | undefined): DecupAudit | undefined {
  if (!a) return b;
  if (!b) return a;
  return {
    savedSec: a.savedSec + b.savedSec,
    speechRemovedSec: a.speechRemovedSec + b.speechRemovedSec,
    refusedCuts: a.refusedCuts + b.refusedCuts,
    cuts: a.cuts + b.cuts,
    ok: a.ok && b.ok,
  };
}

type Result =
  | { kind: 'video'; blob: Blob; url: string; originalDur: number; newDur: number; audit?: DecupAudit }
  | { kind: 'audio'; blob: Blob; url: string; format: AudioFmt; originalDur: number; newDur: number; audit?: DecupAudit };

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

/** Dono desta ferramenta na fila do motor (o Cancelar daqui não derruba outra). */
const DONO = 'decupagem';
/**
 * Estado do LAÇO fora do componente (10.10). A fila passou a sobreviver a
 * trocar de ferramenta (antes um clique no menu apagava a fila e os arquivos
 * prontos); o laço que está rodando e o botão Cancelar da tela nova precisam
 * enxergar as MESMAS flags.
 */
const laco = { rodando: false, cancelado: false };

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

/**
 * O selo de auditoria — a promessa da ferramenta, escrita em número.
 *
 * Não é enfeite: o corte é reexaminado nas bordas e recua sempre que encosta em
 * fala, então "nenhuma palavra cortada" é uma medição do resultado, não uma
 * intenção. Quando o motor não consegue garantir (nunca deveria acontecer), o
 * selo vira aviso âmbar em vez de sumir.
 */
function baseName(name?: string | null) {
  if (!name) return 'arquivo';
  return name.replace(/\.[^.]+$/, '').replace(/\s+/g, '_');
}

/* ─────────────── Item da fila ───────────────
 * Componente de MÓDULO (nunca dentro da página: a página re-renderiza a cada
 * tique de progresso e um componente inline remontaria a miniatura toda vez).
 * Miniatura: vídeo mostra o 1º quadro do próprio arquivo (preload=metadata,
 * o navegador lê só o cabeçalho); áudio mostra uma onda. Por cima, o estado:
 * número na fila, anel de progresso, ✓ pronto ou ✕ erro.
 */
const WAVE_BARS = [0.35, 0.7, 0.5, 0.95, 0.6, 0.8, 0.4, 0.65, 0.3];
const RING = 2 * Math.PI * 15;

function QueueRow({
  item,
  idx,
  locked,
  onDownload,
  onRemove,
}: {
  item: QueueItem;
  idx: number;
  locked: boolean;
  onDownload: () => void;
  onRemove: () => void;
}) {
  const isVideo = isVideoFile(item.file);
  const failed = item.status === 'error';
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);
  const [srcDur, setSrcDur] = useState<number | null>(null);

  // Object URL só pra miniatura/duração — revogado quando o item sai da fila.
  // Arquivo recusado (formato/tamanho) nem chega a abrir.
  useEffect(() => {
    if (failed && !item.result) return;
    const url = URL.createObjectURL(item.file);
    setThumbUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [item.file, failed, item.result]);

  const r = item.result;
  const reduced = r && r.originalDur > 0 ? Math.max(0, Math.round((1 - r.newDur / r.originalDur) * 100)) : 0;
  const pct = item.progress != null ? Math.round(item.progress * 100) : null;
  const done = item.status === 'done';
  const running = item.status === 'processing';
  const origDur = r ? r.originalDur : srcDur;
  const sizeMb = (item.file.size / (1024 * 1024)).toFixed(1);
  const readDur = (d: number) => {
    if (Number.isFinite(d) && d > 0) setSrcDur(d);
  };

  return (
    <div
      className={
        'relative overflow-hidden rounded-[16px] border p-2.5 pr-3 transition-all duration-300 ' +
        (done
          ? 'border-lime/45 bg-lime/[0.05] shadow-[0_0_26px_-14px_rgb(var(--lime))]'
          : failed
            ? 'border-red-500/45 bg-red-500/[0.06]'
            : running
              ? 'scan-line border-lime/55 bg-lime/[0.035]'
              : 'border-line-strong bg-bg-soft/50 hover:border-violet/40')
      }
    >
      <div className="flex items-center gap-3.5">
        {/* MINIATURA + ESTADO */}
        <div className="relative h-[58px] w-[58px] shrink-0 overflow-hidden rounded-[12px] border border-line-strong bg-black">
          {isVideo && thumbUrl ? (
            <video
              src={`${thumbUrl}#t=0.1`}
              muted
              playsInline
              preload="metadata"
              onLoadedMetadata={(e) => readDur(e.currentTarget.duration)}
              className="pointer-events-none h-full w-full object-cover"
            />
          ) : (
            <div
              className="flex h-full w-full items-center justify-center gap-[3px]"
              style={{ background: 'linear-gradient(150deg, rgb(var(--violet) / 0.45), rgb(12 12 16) 78%)' }}
            >
              {WAVE_BARS.map((h, i) => (
                <span key={i} className="w-[3px] rounded-full bg-violet" style={{ height: `${Math.round(h * 30)}px` }} />
              ))}
              {thumbUrl && !isVideo ? (
                <audio src={thumbUrl} preload="metadata" className="hidden" onLoadedMetadata={(e) => readDur(e.currentTarget.duration)} />
              ) : null}
            </div>
          )}

          {running ? (
            <div className="absolute inset-0 flex items-center justify-center bg-black/60">
              <svg width="42" height="42" viewBox="0 0 40 40" className={'-rotate-90 ' + (pct == null ? 'animate-spin' : '')}>
                <circle cx="20" cy="20" r="15" fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth="3" />
                <circle
                  cx="20"
                  cy="20"
                  r="15"
                  fill="none"
                  stroke="rgb(var(--lime))"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeDasharray={RING}
                  strokeDashoffset={pct == null ? RING * 0.72 : RING * (1 - pct / 100)}
                  style={{ transition: 'stroke-dashoffset 300ms ease' }}
                />
              </svg>
              {pct != null ? <span className="mono absolute text-[10px] font-bold text-white">{pct}%</span> : null}
            </div>
          ) : done ? (
            <div className="absolute inset-0 flex items-center justify-center bg-black/35">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-lime shadow-[0_0_16px_rgb(var(--lime))]">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgb(var(--bg))" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M5 12.5l4.5 4.5L19 7.5" />
                </svg>
              </span>
            </div>
          ) : failed ? (
            <div className="absolute inset-0 flex items-center justify-center bg-red-950/75">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgb(252 165 165)" strokeWidth="3" strokeLinecap="round" aria-hidden>
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </div>
          ) : (
            <span className="mono absolute bottom-1 left-1 rounded-[6px] bg-black/75 px-1.5 py-[1px] text-[9.5px] font-bold text-white">
              {String(idx + 1).padStart(2, '0')}
            </span>
          )}
        </div>

        {/* NOME + DADOS */}
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13.5px] font-semibold tracking-tight text-text">{item.file.name}</div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <span
              className={
                'mono rounded-full border px-2 py-[2px] text-[9.5px] font-bold uppercase tracking-[0.14em] ' +
                (isVideo ? 'border-violet/45 bg-violet/10 text-violet' : 'border-cyan-400/45 bg-cyan-400/10 text-cyan-500')
              }
            >
              {isVideo ? 'Vídeo' : 'Áudio'}
            </span>
            <span className="mono rounded-full border border-text-muted/30 px-2 py-[2px] text-[10px] text-text-muted">{sizeMb} MB</span>
            {origDur != null ? (
              <span className="mono rounded-full border border-text-muted/30 px-2 py-[2px] text-[10px] text-text-muted">
                {formatTime(origDur)}
                {done && r ? <span className="font-bold text-text"> → {formatTime(r.newDur)}</span> : null}
              </span>
            ) : null}
            {done ? <span className="mono rounded-full bg-lime px-2 py-[2px] text-[10px] font-black text-bg">−{reduced}%</span> : null}
            {item.status === 'pending' ? <span className="mono text-[10px] text-text-muted">na fila</span> : null}
          </div>
          {running ? (
            <div className="mt-2">
              <div className="mono flex items-center justify-between gap-3 text-[10px] text-text">
                <span className="truncate">{item.stage ?? 'Iniciando...'}</span>
                {pct != null ? <span className="shrink-0 font-bold">{pct}%</span> : null}
              </div>
              <div className="mt-1 h-[5px] w-full overflow-hidden rounded-full bg-line">
                <div
                  className={'h-full rounded-full bg-lime transition-all duration-300 ' + (pct == null ? 'w-1/3 animate-pulse' : '')}
                  style={pct != null ? { width: `${pct}%`, boxShadow: '0 0 10px rgb(var(--lime))' } : undefined}
                />
              </div>
            </div>
          ) : null}
          {failed && item.error ? <div className="mt-1.5 text-[11px] leading-snug text-red-400">{item.error}</div> : null}
        </div>

        {/* AÇÕES — só ícone */}
        {done ? (
          <button
            type="button"
            onClick={onDownload}
            title="Baixar"
            aria-label={`Baixar ${item.file.name}`}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-lime/60 bg-lime/15 text-lime transition hover:scale-105 hover:bg-lime hover:text-bg"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M12 4v11" />
              <path d="M7 11l5 5 5-5" />
              <path d="M5 20h14" />
            </svg>
          </button>
        ) : null}
        {!locked ? (
          <button
            type="button"
            onClick={onRemove}
            title="Remover da fila"
            aria-label={`Remover ${item.file.name} da fila`}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-text-muted/30 text-text-muted transition hover:border-red-500/50 hover:bg-red-500/10 hover:text-red-400"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" aria-hidden>
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        ) : null}
      </div>
    </div>
  );
}

/* ─────────────── Card do arquivo pronto ───────────────
 * Antes × depois em barra PROPORCIONAL (a barra "depois" tem exatamente
 * newDur/originalDur da largura; o tracejado é o tempo de silêncio que saiu),
 * selo de auditoria, preview num palco com altura contida (vídeo em pé não
 * vira um cartaz de 1.200px) e o nome exato do arquivo que vai baixar.
 */
function ResultCard({ item, onDownload }: { item: QueueItem & { result: Result }; onDownload: () => void }) {
  const r = item.result;
  const reduced = r.originalDur > 0 ? Math.max(0, Math.round((1 - r.newDur / r.originalDur) * 100)) : 0;
  const keptPct = r.originalDur > 0 ? Math.min(100, Math.max(2, (r.newDur / r.originalDur) * 100)) : 100;
  const removed = Math.max(0, r.originalDur - r.newDur);
  const ext = r.kind === 'video' ? 'mp4' : r.format;
  const outName = `${baseName(item.file.name)}_decupado.${ext}`;

  return (
    <section
      className="relative overflow-hidden rounded-[22px] border border-lime/30 p-5 shadow-depth-1 md:p-6"
      style={{
        background:
          'radial-gradient(120% 90% at 100% 0%, rgb(var(--lime) / 0.10), transparent 55%), linear-gradient(180deg, rgb(var(--bg-softer)), rgb(var(--bg-soft)))',
      }}
    >
      {/* CABEÇALHO */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="mono inline-flex items-center gap-1.5 rounded-full border border-lime/40 bg-lime/10 px-2.5 py-[3px] text-[9.5px] font-bold uppercase tracking-[0.18em] text-lime">
              <span className="h-1.5 w-1.5 rounded-full bg-lime shadow-[0_0_8px_rgb(var(--lime))]" />
              Pronto
            </span>
            <span className="mono rounded-full border border-line-strong px-2.5 py-[3px] text-[9.5px] font-bold uppercase tracking-[0.18em] text-text-muted">
              {ext}
            </span>
          </div>
          <h3 className="mt-2.5 truncate text-[19px] font-bold tracking-tight text-text md:text-[21px]">{item.file.name}</h3>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-[34px] font-black leading-none tracking-tight text-lime md:text-[40px]">−{reduced}%</div>
          <div className="mono mt-1 text-[9.5px] uppercase tracking-[0.18em] text-text-muted">mais curto</div>
        </div>
      </div>

      {/* ANTES × DEPOIS */}
      <div className="mt-5 grid gap-2.5 rounded-[16px] border border-line-strong bg-bg/40 p-4">
        <div className="grid grid-cols-[92px_1fr] items-center gap-3">
          <div>
            <div className="mono text-[9.5px] uppercase tracking-[0.16em] text-text-muted">Original</div>
            <div className="text-[17px] font-bold tabular-nums text-text">{formatTime(r.originalDur)}</div>
          </div>
          <div className="h-3 w-full rounded-full bg-text-muted/25" />
        </div>
        <div className="grid grid-cols-[92px_1fr] items-center gap-3">
          <div>
            <div className="mono text-[9.5px] uppercase tracking-[0.16em] text-lime">Sem silêncio</div>
            <div className="text-[17px] font-bold tabular-nums text-lime">{formatTime(r.newDur)}</div>
          </div>
          <div className="relative h-3 w-full">
            <div
              className="absolute inset-0 rounded-full border border-dashed border-text-muted/40"
              style={{
                backgroundImage:
                  'repeating-linear-gradient(135deg, rgb(var(--text-muted) / 0.16) 0 5px, transparent 5px 10px)',
              }}
            />
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-lime shadow-[0_0_14px_rgb(var(--lime)/0.55)]"
              style={{ width: `${keptPct}%` }}
            />
          </div>
        </div>
        <div className="mono pl-[104px] text-[10.5px] text-text-muted">
          −{formatTime(removed)} de silêncio removido
        </div>
      </div>

      {r.audit ? <div className="mt-3"><DecupAuditBadge audit={r.audit} /></div> : null}

      {/* PREVIEW */}
      {r.kind === 'video' ? (
        <div className="mt-1 flex justify-center overflow-hidden rounded-[16px] border border-line-strong bg-black">
          <video src={r.url} controls preload="metadata" playsInline className="max-h-[440px] w-auto max-w-full" />
        </div>
      ) : (
        <AudioPlayer src={r.url} label="Preview" />
      )}

      {/* RODAPÉ — o nome exato do que vai baixar */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="mono min-w-0 truncate text-[11px] text-text-muted" title={outName}>
          {outName}
        </div>
        <button type="button" onClick={onDownload} className="btn-lime inline-flex items-center gap-2 !py-2.5 text-xs">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M12 4v11" />
            <path d="M7 11l5 5 5-5" />
            <path d="M5 20h14" />
          </svg>
          Baixar {ext.toUpperCase()}
        </button>
      </div>
    </section>
  );
}

export default function DecupagemPage() {
  const tier = useTier();
  const isFree = tier === 'free';

  // FILA de até 10 arquivos. No estado compartilhado das ferramentas (10.10):
  // sobrevive a trocar de ferramenta e voltar (fica em memória — F5 continua
  // com o aviso de "sair mesmo?", porque arquivo não dá pra guardar no disco).
  const [queue, setQueue] = useToolState<QueueItem[]>('decupagem:queue', []);

  // Configs GLOBAIS (aplicam a todos os arquivos da fila) — persistem.
  const [keepSilence, setKeepSilence] = useToolState<number>('decupagem:keepSilence', 0.05);
  const [outputKind, setOutputKind] = useToolState<OutputKind>('decupagem:outputKind', 'video');
  const [audioFormat, setAudioFormat] = useToolState<AudioFmt>('decupagem:audioFormat', 'mp3');
  const [processing, setProcessing] = useToolState<boolean>('decupagem:processing', false);
  // Guard SÍNCRONO contra duplo disparo: `processing` (state) só atualiza no
  // re-render — dois cliques rápidos entravam juntos e processavam a fila 2x
  // em paralelo (colisão de nomes no FS do ffmpeg-wasm = saída corrompida).
  // Fica em `laco.rodando` (fora do componente) pra valer também depois de
  // sair e voltar da página.
  //
  // Os endereços dos resultados NÃO são revogados ao sair da página (10.10):
  // a fila continua viva no estado compartilhado. Eles são soltos ao remover
  // o item ou limpar a fila.
  const [zipando, setZipando] = useState(false);
  const [zipMsg, setZipMsg] = useState<string | null>(null);

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
  const queueHasAudio = queue.some((q) => !isVideoFile(q.file));
  // O card "Formato de saída" mostra MP4 · MP3 · WAV juntos. MP4 = vídeo
  // cortado — só conta paga e só com fila SEM arquivo de áudio (áudio não vira
  // vídeo). Fora disso a saída é áudio no formato escolhido (MP3/WAV).
  const mp4Allowed = !isFree && !queueHasAudio;
  const outFormat: OutFormat = mp4Allowed && outputKind === 'video' ? 'mp4' : audioFormat;
  function pickOutFormat(v: OutFormat) {
    if (v === 'mp4') {
      if (!mp4Allowed) return;
      setOutputKind('video');
      return;
    }
    setOutputKind('audio');
    setAudioFormat(v);
  }

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
  ): Promise<{ blob: Blob | null; originalDur: number; newDur: number; audit?: DecupAudit }> {
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
      const { buffer: trimmed, plan: audioPlan } = trimSpeechCutWithPlan(decoded, keepSilence);
      const audit = toAudit(audioPlan);
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
      return { blob, originalDur: decoded.duration, newDur: trimmed.duration, audit };
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
    const videoPlan = planSpeechCut(decoded, keepSilence);
    const segments = videoPlan.segments;
    const audit = toAudit(videoPlan);
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
    return { blob, originalDur: decoded.duration, newDur, audit };
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
    let audit: DecupAudit | undefined;
    for (let i = 0; i < n; i++) {
      if (laco.cancelado) throw new Error('CANCELLED_BY_USER');
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
      audit = mergeAudit(audit, part.audit);
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
      return { kind: 'video', blob: joined, url: URL.createObjectURL(joined), originalDur, newDur, audit };
    }
    return { kind: 'audio', blob: joined, url: URL.createObjectURL(joined), format: audioFormat, originalDur, newDur, audit };
  }

  // Processa UM arquivo → retorna Result (não mexe em state global).
  async function processOne(
    item: QueueItem,
    onStage: (s: string) => void,
    onProgress: (r: number | null) => void,
  ): Promise<Result> {
    const file = item.file;
    const fileIsVideo = isVideoFile(file);
    // Segue EXATAMENTE o que o card mostra: MP4 só quando está liberado e escolhido.
    const effectiveKind: OutputKind = fileIsVideo && outFormat === 'mp4' ? 'video' : 'audio';

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
        audit: part.audit,
      };
    }
    return {
      kind: 'audio',
      blob: part.blob,
      url: URL.createObjectURL(part.blob),
      format: audioFormat,
      originalDur: part.originalDur,
      newDur: part.newDur,
      audit: part.audit,
    };
  }

  // Processa a FILA — 1 por vez (sequencial).
  async function processQueue() {
    if (laco.rodando) return;
    // Tier ainda resolvendo (1º load da sessão): não dispara — sem isso um
    // free podia sair com VÍDEO (que é só de pago) e vice-versa. O botão já
    // fica desabilitado; este é o cinto de segurança.
    if (tier === null) return;
    laco.rodando = true;
    laco.cancelado = false;
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
        if (laco.cancelado) break;
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
        let sair: (() => void) | null = null;
        try {
          // Um arquivo por vez na FILA GLOBAL do motor (10.10): outra
          // ferramenta rodando junto não troca nem apaga arquivo desta.
          sair = await entrarNaFila(DONO, () => patchItem(item.id, { stage: MSG_NA_FILA }));
          if (laco.cancelado) throw new Error('CANCELLED_BY_USER');
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
          // sem checar o Cancelar, o erro sumia em silêncio: o item voltava
          // pra 'pending' e a fila parava sem mostrar nada.
          if (laco.cancelado) {
            patchItem(item.id, { status: 'pending', stage: undefined, progress: null });
            break;
          }
          patchItem(item.id, {
            status: 'error',
            error: friendlyError(e),
            stage: undefined,
            progress: null,
          });
        } finally {
          sair?.();
        }
      }
    } finally {
      releaseKeepAlive();
      laco.rodando = false;
      setProcessing(false);
    }
  }

  function cancelAll() {
    laco.cancelado = true;
    // Só derruba o motor se for a vez DESTA ferramenta (não mata outra).
    cancelarMotorSeDono(DONO);
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
    if (done.length === 0 || zipando) return;
    if (!zipCabeNoNavegador(done.map((q) => q.result.blob.size))) {
      setZipMsg(MSG_ZIP_GRANDE);
      return;
    }
    setZipMsg(null);
    setZipando(true);
    try {
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
    } catch (e) {
      console.error('[decupagem] zip', e);
      setZipMsg(MSG_ZIP_FALHOU);
    } finally {
      setZipando(false);
    }
  }

  const doneCount = queue.filter((q) => q.status === 'done').length;
  const zippableCount = queue.filter((q) => q.result).length;
  const outOptions = [
    {
      value: 'mp4' as const,
      label: 'MP4',
      sub: isFree ? '🔒 Planos pagos' : queueHasAudio ? 'Só com vídeos na fila' : 'Vídeo já cortado',
      disabled: !mp4Allowed,
      title: isFree
        ? 'Receber o vídeo em MP4 é recurso dos planos pagos.'
        : queueHasAudio
          ? 'Com arquivo de áudio na fila, a saída é em áudio (MP3 ou WAV).'
          : undefined,
    },
    { value: 'mp3' as const, label: 'MP3', sub: 'Áudio leve' },
    { value: 'wav' as const, label: 'WAV', sub: 'Áudio sem perda' },
  ];

  return (
    <div className="mx-auto w-full max-w-[920px] px-5 md:px-8">
      <ToolHero
        title="Remover Silêncios"
        eyebrow="VÍDEO / ÁUDIO · FILA ATÉ 10"
        subtitle="Remova silêncios de áudio e vídeo. Adicione até 10 arquivos e acompanhe cada entrega na fila."
        hue="rgba(163,230,53,0.4)"
        icon={<IconDecupagem size={56} />}
      />

      <div className="mt-6 grid gap-5">
        {/* PASSO 1 — UPLOAD (FILA) */}
        <ToolStep
          n={1}
          icon={<IconStepUpload size={18} />}
          title={`Adicione seus arquivos (até ${MAX_QUEUE})`}
          hint={`MP3, WAV, MP4, WEBM ou MOV — vários de uma vez · até ${MAX_FILE_LABEL} cada`}
          hue="rgba(163,230,53,0.4)"
        >
          <ToolDropzone
            accept="audio/*,video/mp4,video/webm,video/quicktime"
            file={null}
            onFile={() => {}}
            multiple
            onFiles={addFiles}
            hint={`Selecione um ou mais arquivos. ${queue.length}/${MAX_QUEUE} na fila.`}
            hue="rgba(163,230,53,0.5)"
            disabled={processing || queue.length >= MAX_QUEUE}
          />

          {/* LISTA DA FILA */}
          {queue.length > 0 ? (
            <div className="mt-3 grid gap-2.5">
              {queue.map((item, idx) => (
                <QueueRow
                  key={item.id}
                  item={item}
                  idx={idx}
                  locked={processing}
                  onDownload={() => downloadOne(item)}
                  onRemove={() => removeItem(item.id)}
                />
              ))}
            </div>
          ) : null}
        </ToolStep>

        {/* PASSO 2 — FORMATO DE SAÍDA: MP4 · MP3 · WAV numa linha só, sempre à
            mostra, pra ficar claro que existe o modo vídeo. MP4 fica apagado
            (bloqueado) no plano grátis e quando a fila tem arquivo de áudio. */}
        <ToolStep
          n={2}
          icon={<IconStepFormat size={18} />}
          title="Formato de saída"
          hint="MP4 devolve o vídeo já cortado. MP3 e WAV devolvem só o áudio."
          hue="rgba(167,139,250,0.4)"
        >
          <ToolChoice value={outFormat} onChange={pickOutFormat} options={outOptions} disabled={processing} />
        </ToolStep>

        {/* PASSO 3 — TOLERÂNCIA */}
        <ToolStep
          n={3}
          icon={<IconStepSliders size={18} />}
          title="Quanto de silêncio manter?"
          hint="Valores menores deixam o corte mais curto. Valores maiores preservam mais pausa entre as falas."
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
            <button type="button" onClick={downloadAll} className="btn-lime !py-2.5 text-xs" disabled={processing || zipando}>
              {zipando ? 'Juntando…' : '↓ Baixar todos (ZIP)'}
            </button>
          ) : null}
          <button type="button" onClick={clearQueue} className="btn-ghost" disabled={processing || queue.length === 0}>
            Limpar fila
          </button>
        </div>

        {zipMsg ? (
          <p role="status" className="rounded-[10px] border border-amber-400/35 bg-amber-400/10 px-3 py-2 text-xs text-amber-200">
            {zipMsg}
          </p>
        ) : null}

        {/* PREVIEW de TODOS os arquivos prontos */}
        {doneCount > 0 ? (
          <div className="grid gap-4">
            <div className="label-tech text-[10px] uppercase tracking-widest text-lime">
              {doneCount} pronto{doneCount === 1 ? '' : 's'} — preview + download de cada
            </div>
            {queue
              .filter((q): q is QueueItem & { result: Result } => q.status === 'done' && !!q.result)
              .map((item) => (
                <ResultCard key={item.id} item={item} onDownload={() => downloadOne(item)} />
              ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
