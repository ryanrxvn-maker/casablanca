/**
 * AUTO CORTES — ingestão da fonte (link ou arquivo).
 *
 * Três caminhos, nesta ordem de preferência:
 *  1. EXTENSÃO 1.8.0 (`ext-bridge`) — YouTube & cia pelo Motor local, Drive
 *     pela sessão logada. Os bytes vêm em pedaços e vão DIRETO pro OPFS: o
 *     vídeo nunca passa pelo heap nem pelo nosso servidor.
 *  2. DRIVE SEM EXTENSÃO — `/api/auto-cortes/drive?id=` (só arquivo público,
 *     teto de 800 MB por causa do tempo da função da Vercel).
 *  3. UPLOAD — o `File` já é disk-backed; só lemos metadados.
 *
 * YouTube sem Motor NÃO tem plano B honesto (o servidor não baixa YouTube) —
 * então a gente orienta na hora, com o mesmo texto do Downloader, em vez de
 * deixar o cliente esperando uma falha.
 */

import { FriendlyError } from '@/lib/friendly-error';
import { probeVideoMetadata } from '@/lib/ffmpeg-worker';
import { AUTO_CORTES_MIN_EXT_VERSION, LIMITS, type ExtFetchRequest, type SourceKind, type SourceRef } from './types';
import {
  ExtFetchError,
  fetchViaExtension,
  pingExtension,
  versionAtLeast,
  type ExtFetchKind,
  type ExtFetchRequest as ExtFetchRequestEspelho,
} from './ext-bridge';
import { opfsProjectDir, opfsWriteStream, type OpfsWriteStream } from './opfs';

// ───────────────────────────────────────────────────────────────────────────
// Trava de contrato: o espelho de tipos do ext-bridge (que compila isolado no
// `npm test`, sem o alias `@/`) TEM que continuar idêntico ao contrato oficial
// de types.ts. Se alguém mexer num dos dois, o `tsc --noEmit` acusa aqui.
// ───────────────────────────────────────────────────────────────────────────
type Assert<A extends B, B> = A;
type _PedidoIgual = Assert<ExtFetchRequestEspelho, ExtFetchRequest>;
type _PedidoIgualVolta = Assert<ExtFetchRequest, ExtFetchRequestEspelho>;
type _KindIgual = Assert<ExtFetchKind, ExtFetchRequest['kind']>;
type _KindIgualVolta = Assert<ExtFetchRequest['kind'], ExtFetchKind>;

// ───────────────────────────────────────────────────────────────────────────
// Textos (PT-BR, acionáveis — mesma orientação do Downloader)
// ───────────────────────────────────────────────────────────────────────────

/** Copiado da orientação do Downloader (app/tools/downloader/page.tsx). */
const MOTOR_AUSENTE =
  'Pra baixar do YouTube, instala e conecta o Motor + Extensão (passo 1 do guia do Downloader — leva 1 minuto) e cola o link de novo. Ou sobe o arquivo direto do computador aqui.';

const EXT_DESATUALIZADA = (v: string) =>
  `A extensão instalada é a ${v} e o Auto Cortes precisa da 1.8.0 (ela é que entrega o vídeo pro navegador). Reinstala pelo passo 1 do Downloader e recarrega esta página. Ou sobe o arquivo direto do computador.`;

const DRIVE_SEM_EXT_GRANDE = (mb: number) =>
  `Esse arquivo do Drive tem ${mb} MB e sem a extensão eu só consigo trazer até 800 MB. Instala a extensão (passo 1 do Downloader) ou baixa o arquivo e sobe ele aqui.`;

// ───────────────────────────────────────────────────────────────────────────
// Reconhecimento do link
// ───────────────────────────────────────────────────────────────────────────

function parseUrl(raw: string): URL | null {
  const s = String(raw || '').trim();
  if (!s) return null;
  const withProto = /^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://${s}`;
  try {
    const u = new URL(withProto);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (!u.hostname.includes('.')) return null;
    return u;
  } catch {
    return null;
  }
}

/** youtube | drive | url — ou `null` quando nem parece um link. */
export function resolveSourceKind(raw: string): SourceKind | null {
  const u = parseUrl(raw);
  if (!u) return null;
  const h = u.hostname.toLowerCase();
  if (/(^|\.)youtube\.com$/.test(h) || /(^|\.)youtu\.be$/.test(h) || /(^|\.)youtube-nocookie\.com$/.test(h)) {
    return 'youtube';
  }
  if (/(^|\.)drive\.google\.com$/.test(h) || /(^|\.)docs\.google\.com$/.test(h)) {
    return extractDriveId(u.toString()) ? 'drive' : null;
  }
  if (/(^|\.)drive\.usercontent\.google\.com$/.test(h)) {
    return extractDriveId(u.toString()) ? 'drive' : null;
  }
  return 'url';
}

/** Mesma regra do `extractDriveFileIdFromText` (lib/clickup-client.ts). */
export function extractDriveId(text: string | null | undefined): string | null {
  if (!text) return null;
  const s = String(text);
  if (/^[a-zA-Z0-9_-]{20,60}$/.test(s.trim())) return s.trim();
  const patterns = [
    /\/file\/d\/([a-zA-Z0-9_-]{20,60})/,
    /[?&]id=([a-zA-Z0-9_-]{20,60})/,
    /\/d\/([a-zA-Z0-9_-]{20,60})/,
  ];
  for (const re of patterns) {
    const m = s.match(re);
    if (m) return m[1];
  }
  return null;
}

// ───────────────────────────────────────────────────────────────────────────
// Progresso
// ───────────────────────────────────────────────────────────────────────────

export type IngestProgress = {
  phase: 'motor' | 'baixando';
  receivedBytes: number;
  totalBytes: number | null;
  /** 0..1 quando dá pra saber o total; senão null. */
  ratio: number | null;
  /** texto pronto pra UI ("Baixando 340 MB de 1,2 GB") */
  label: string;
};

export type IngestOptions = {
  projectId: string;
  onProgress?: (p: IngestProgress) => void;
  onWarn?: (message: string) => void;
  signal?: AbortSignal;
};

function humanBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 MB';
  if (n >= 1024 * 1024 * 1024) return `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`;
  return `${Math.round(n / 1024 / 1024)} MB`;
}

function progressOf(received: number, total: number | null, phase: 'motor' | 'baixando'): IngestProgress {
  const ratio = total && total > 0 ? Math.min(1, received / total) : null;
  const label =
    phase === 'motor'
      ? 'O Motor está preparando o vídeo…'
      : total && total > 0
        ? `Baixando ${humanBytes(received)} de ${humanBytes(total)}`
        : `Baixando ${humanBytes(received)}`;
  return { phase, receivedBytes: received, totalBytes: total, ratio, label };
}

// ───────────────────────────────────────────────────────────────────────────
// Ingestão por link
// ───────────────────────────────────────────────────────────────────────────

export type IngestResult = { file: File; source: SourceRef };

export async function ingestLink(rawUrl: string, opts: IngestOptions): Promise<IngestResult> {
  const u = parseUrl(rawUrl);
  const kind = resolveSourceKind(rawUrl);
  if (!u || !kind) {
    throw new FriendlyError(
      'Esse link não parece um vídeo. Cola um link do YouTube ou do Google Drive — ou sobe o arquivo direto do computador.',
    );
  }
  const url = u.toString();

  const pong = await pingExtension(2500);
  const extPresente = !!pong;
  const extOk = !!pong && versionAtLeast(pong.version, AUTO_CORTES_MIN_EXT_VERSION);
  const motorOk = !!pong && pong.engine === true;

  if (kind === 'youtube') {
    // Ordem importa: se a extensão está aí mas velha, o problema é a VERSÃO —
    // mandar instalar o Motor de novo não resolveria nada.
    if (extPresente && !extOk) throw new FriendlyError(EXT_DESATUALIZADA(pong!.version || '?'));
    if (!extPresente || !motorOk) throw new FriendlyError(MOTOR_AUSENTE);
    return viaExtensao(url, 'engine', kind, opts);
  }

  if (kind === 'drive') {
    if (extOk) return viaExtensao(url, 'drive', kind, opts);
    if (extPresente && !extOk) throw new FriendlyError(EXT_DESATUALIZADA(pong!.version || '?'));
    return viaServidorDrive(url, opts);
  }

  // Link genérico: com Motor, ele resolve (yt-dlp cobre muita coisa). Sem
  // Motor, tenta puxar direto pelo navegador — só funciona se o servidor de
  // origem liberar CORS.
  if (extOk && motorOk) return viaExtensao(url, 'engine', kind, opts);
  return viaFetchDireto(url, kind, opts);
}

/** Extensão → OPFS, pedaço a pedaço. */
async function viaExtensao(
  url: string,
  extKind: ExtFetchKind,
  kind: SourceKind,
  opts: IngestOptions,
): Promise<IngestResult> {
  let nome = extKind === 'drive' ? 'drive.mp4' : 'video.mp4';
  let mime = 'video/mp4';
  // Cofre em vez de `let`: o stream é aberto/fechado dentro de callbacks e o
  // TS não acompanha atribuição feita em closure.
  const cofre: { stream: OpfsWriteStream | null } = { stream: null };
  let opfsPath = `${opfsProjectDir(opts.projectId)}/source.mp4`;
  let recebidos = 0;
  // Erro que a gente mesmo decidiu (limite estourado): cancela o download e
  // vira a mensagem final — sem virar "falha ao gravar pedaço N".
  let erroFatal: FriendlyError | null = null;

  const ctrl = new AbortController();
  const cancelarFora = () => ctrl.abort();
  if (opts.signal) {
    if (opts.signal.aborted) throw new FriendlyError('Cancelado por você.');
    opts.signal.addEventListener('abort', cancelarFora);
  }
  // NÃO lança: o `onMeta` roda dentro de um listener de `message` e um throw
  // ali viraria erro solto no console em vez de derrubar o download. Aqui a
  // gente aborta e guarda a mensagem — quem decide o que lançar é o catch.
  const pararCom = (msg: string): FriendlyError => {
    if (!erroFatal) erroFatal = new FriendlyError(msg);
    ctrl.abort();
    return erroFatal;
  };

  const abrirStream = async () => {
    opfsPath = `${opfsProjectDir(opts.projectId)}/source.${extOf(nome, mime)}`;
    cofre.stream = await opfsWriteStream(opfsPath, { mime, onWarn: opts.onWarn });
  };

  // O pedido é montado com o tipo OFICIAL — se types.ts mudar, quebra aqui.
  const pedido: ExtFetchRequest = {
    type: 'DL_FETCH',
    reqId: `ac-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    url,
    kind: extKind,
    mode: 'video',
    quality: '1080',
  };

  try {
    await fetchViaExtension(pedido, {
      signal: ctrl.signal,
      onMeta: (m) => {
        if (m.filename) nome = m.filename;
        if (m.mime && m.mime !== 'application/octet-stream') mime = m.mime;
        if (m.size && m.size > LIMITS.maxInputBytes) {
          pararCom(`Esse vídeo tem ${humanBytes(m.size)} e o limite é 4 GB. Usa um trecho menor.`);
        }
      },
      onChunk: async (buf) => {
        if (!cofre.stream) await abrirStream();
        recebidos += buf.byteLength;
        if (recebidos > LIMITS.maxInputBytes) {
          throw pararCom('O vídeo passou de 4 GB no meio do download e eu parei por segurança.');
        }
        await cofre.stream!.write(buf);
      },
      onRestart: async () => {
        // Retry rebobina o download inteiro: joga fora o que já foi escrito.
        if (cofre.stream) await cofre.stream.abort();
        cofre.stream = null;
        recebidos = 0;
      },
      onProgress: (p) => {
        opts.onProgress?.(progressOf(Math.max(p.receivedBytes, recebidos), p.totalBytes, p.phase));
      },
    });
  } catch (e) {
    if (cofre.stream) await cofre.stream.abort().catch(() => {});
    throw erroFatal ?? comoAmigavel(e);
  } finally {
    if (opts.signal) opts.signal.removeEventListener('abort', cancelarFora);
  }

  if (!cofre.stream) throw new FriendlyError('O download terminou sem trazer nenhum byte. Tenta de novo.');
  const file = await cofre.stream.close();
  return { file, source: await montarSourceRef({ kind, url, nome, file, opfsPath }) };
}

/** Drive sem extensão: passa pelo nosso servidor (só arquivo público). */
async function viaServidorDrive(url: string, opts: IngestOptions): Promise<IngestResult> {
  const id = extractDriveId(url);
  if (!id) {
    throw new FriendlyError(
      'Não achei o arquivo nesse link do Drive. Use o link do ARQUIVO (…/file/d/…), não o da pasta.',
    );
  }
  let res: Response;
  try {
    res = await fetch(`/api/auto-cortes/drive?id=${encodeURIComponent(id)}`, {
      signal: opts.signal,
      cache: 'no-store',
    });
  } catch (e) {
    throw comoAmigavel(e);
  }
  if (!res.ok) {
    let msg = 'Não consegui trazer esse arquivo do Drive.';
    try {
      const j = (await res.json()) as { error?: string };
      if (j?.error) msg = j.error;
    } catch {
      /* resposta sem json */
    }
    throw new FriendlyError(msg);
  }
  const declarado = Number(res.headers.get('content-length')) || null;
  if (declarado && declarado > LIMITS.driveServerFallbackMaxBytes) {
    throw new FriendlyError(DRIVE_SEM_EXT_GRANDE(Math.round(declarado / 1024 / 1024)));
  }
  const nome = nomeDoContentDisposition(res.headers.get('content-disposition')) || 'drive.mp4';
  return gravarResposta(res, {
    kind: 'drive',
    url,
    nome,
    maxBytes: LIMITS.driveServerFallbackMaxBytes,
    estourou: (b) => DRIVE_SEM_EXT_GRANDE(Math.round(b / 1024 / 1024)),
    opts,
  });
}

/** Link direto (mp4 num servidor qualquer) — depende do CORS de lá. */
async function viaFetchDireto(url: string, kind: SourceKind, opts: IngestOptions): Promise<IngestResult> {
  let res: Response;
  try {
    res = await fetch(url, { signal: opts.signal, cache: 'no-store', mode: 'cors' });
  } catch {
    throw new FriendlyError(
      'Esse site não deixa o navegador baixar o vídeo direto. Instala a extensão + Motor (passo 1 do Downloader) ou baixa o arquivo e sobe ele aqui.',
    );
  }
  if (!res.ok) {
    throw new FriendlyError(`O link respondeu ${res.status}. Confere se ele está público e tenta de novo.`);
  }
  const tipo = (res.headers.get('content-type') || '').toLowerCase();
  if (tipo.startsWith('text/html')) {
    throw new FriendlyError(
      'Esse link abre uma página, não um arquivo de vídeo. Cola o link direto do vídeo, um link do YouTube/Drive, ou sobe o arquivo.',
    );
  }
  const nome =
    nomeDoContentDisposition(res.headers.get('content-disposition')) ||
    decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).pop() || 'video.mp4');
  return gravarResposta(res, {
    kind,
    url,
    nome,
    maxBytes: LIMITS.maxInputBytes,
    estourou: () => 'Esse vídeo passa de 4 GB — o limite da ferramenta.',
    opts,
  });
}

/** Body de uma Response → OPFS, em stream, com teto de tamanho. */
async function gravarResposta(
  res: Response,
  cfg: {
    kind: SourceKind;
    url: string;
    nome: string;
    maxBytes: number;
    estourou: (bytes: number) => string;
    opts: IngestOptions;
  },
): Promise<IngestResult> {
  const { opts } = cfg;
  const total = Number(res.headers.get('content-length')) || null;
  const mime = (res.headers.get('content-type') || 'video/mp4').split(';')[0].trim();
  const opfsPath = `${opfsProjectDir(opts.projectId)}/source.${extOf(cfg.nome, mime)}`;
  const stream = await opfsWriteStream(opfsPath, { mime, onWarn: opts.onWarn });
  if (!res.body) {
    await stream.abort();
    throw new FriendlyError('O servidor respondeu sem conteúdo. Tenta de novo.');
  }
  const reader = res.body.getReader();
  let recebidos = 0;
  let ultimoAviso = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (opts.signal?.aborted) throw new FriendlyError('Cancelado por você.');
      recebidos += value.byteLength;
      if (recebidos > cfg.maxBytes) throw new FriendlyError(cfg.estourou(recebidos));
      await stream.write(value);
      const agora = Date.now();
      if (agora - ultimoAviso > 400) {
        ultimoAviso = agora;
        opts.onProgress?.(progressOf(recebidos, total, 'baixando'));
      }
    }
  } catch (e) {
    await stream.abort().catch(() => {});
    try {
      await reader.cancel();
    } catch {
      /* já morreu */
    }
    throw comoAmigavel(e);
  }
  opts.onProgress?.(progressOf(recebidos, total ?? recebidos, 'baixando'));
  const file = await stream.close();
  return { file, source: await montarSourceRef({ kind: cfg.kind, url: cfg.url, nome: cfg.nome, file, opfsPath }) };
}

// ───────────────────────────────────────────────────────────────────────────
// Upload
// ───────────────────────────────────────────────────────────────────────────

/** Assinatura que reconhece o MESMO arquivo depois de um F5. */
export function uploadSignature(file: File): string {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

export async function ingestUpload(file: File): Promise<SourceRef> {
  if (file.size <= 0) throw new FriendlyError('Esse arquivo está vazio.');
  if (file.size > LIMITS.maxInputBytes) {
    throw new FriendlyError(
      `Esse arquivo tem ${humanBytes(file.size)} e o limite é 4 GB. Comprime ele no Compressor antes (ou usa um trecho).`,
    );
  }
  const meta = await probeComTimeout(file);
  if (meta && meta.durationSec > LIMITS.maxDurationSec) {
    throw new FriendlyError('O vídeo passa de 4 horas — o limite da ferramenta. Usa um trecho menor.');
  }
  return {
    kind: 'upload',
    url: null,
    name: file.name,
    sizeBytes: file.size,
    signature: uploadSignature(file),
    opfsPath: null,
    durationSec: meta?.durationSec ?? null,
    width: null,
    height: meta?.height ?? null,
  };
}

/**
 * `probeVideoMetadata` já desiste sozinho em 8 s, mas em aba de 2º plano o
 * `loadedmetadata` pode simplesmente nunca vir — daí a corrida extra. Metadado
 * nulo NÃO é erro: a duração real sai depois, do log do ffmpeg.
 */
async function probeComTimeout(
  file: Blob,
  timeoutMs = 12_000,
): Promise<{ durationSec: number; height: number } | null> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      probeVideoMetadata(file),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Utilidades
// ───────────────────────────────────────────────────────────────────────────

async function montarSourceRef(a: {
  kind: SourceKind;
  url: string;
  nome: string;
  file: File;
  opfsPath: string;
}): Promise<SourceRef> {
  const meta = await probeComTimeout(a.file);
  return {
    kind: a.kind,
    url: a.url,
    name: a.nome,
    sizeBytes: a.file.size,
    signature: `${a.nome}:${a.file.size}:${a.opfsPath}`,
    opfsPath: a.opfsPath,
    durationSec: meta?.durationSec ?? null,
    width: null,
    height: meta?.height ?? null,
  };
}

const EXT_POR_MIME: Record<string, string> = {
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
  'video/x-matroska': 'mkv',
  'video/x-msvideo': 'avi',
};

function extOf(nome: string, mime: string): string {
  const m = /\.([a-z0-9]{2,5})$/i.exec(nome || '');
  if (m) return m[1].toLowerCase();
  return EXT_POR_MIME[(mime || '').toLowerCase()] || 'mp4';
}

function nomeDoContentDisposition(cd: string | null): string | null {
  if (!cd) return null;
  const utf8 = cd.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8) {
    try {
      return decodeURIComponent(utf8[1]).trim();
    } catch {
      /* segue */
    }
  }
  const simples = cd.match(/filename="([^"]+)"/i) || cd.match(/filename=([^;]+)/i);
  return simples ? simples[1].trim() : null;
}

/** Erro cru → FriendlyError (o cliente nunca vê jargão). */
function comoAmigavel(e: unknown): FriendlyError {
  if (e instanceof FriendlyError) return e;
  if (e instanceof ExtFetchError) return new FriendlyError(e.message);
  if (e instanceof Error && e.name === 'AbortError') return new FriendlyError('Cancelado por você.');
  if (e instanceof Error && /failed to fetch|networkerror|load failed/i.test(e.message)) {
    return new FriendlyError(
      'A internet falhou no meio do download. Confere a conexão e tenta de novo — nada do que já ficou pronto se perde.',
    );
  }
  return new FriendlyError(
    e instanceof Error && e.message
      ? e.message
      : 'Não consegui trazer esse vídeo. Tenta de novo ou sobe o arquivo direto do computador.',
  );
}
