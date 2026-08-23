/**
 * GET /api/auto-cortes/drive?id=<fileId>
 *
 * Plano B do Auto Cortes pra Google Drive SEM a extensão instalada. Streama o
 * arquivo do Drive pro navegador sem nunca guardar nada no servidor.
 *
 * Limitações honestas (e por quê):
 *  - Só arquivo PÚBLICO ("qualquer pessoa com o link"). Aqui não existe cookie
 *    do usuário — quem alcança arquivo privado é a extensão (ela faz o fetch
 *    credenciado na sessão logada dele).
 *  - Teto de 800 MB (`LIMITS.driveServerFallbackMaxBytes`): a função da Vercel
 *    morre em 300 s e um arquivo maior não atravessa a tempo. Acima disso a
 *    orientação é instalar a extensão ou subir o arquivo.
 *
 * A cadeia de URLs de confirmação é a mesma que a extensão usa
 * (extension/background.js `handleDownloadDrive`): arquivo grande faz o Drive
 * devolver uma PÁGINA de confirmação em vez do arquivo, e é preciso repetir o
 * pedido com `confirm=`/`uuid=`.
 *
 * Anti-SSRF: `safeFetch` (valida a URL e cada redirect) + allowlist de host.
 */

import { NextResponse } from 'next/server';
import { requireToolAccess } from '@/lib/require-tier';
import { safeFetch, SsrfError } from '@/lib/safe-fetch';
import { LIMITS } from '@/lib/auto-cortes/types';

export const runtime = 'nodejs';
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

const MAX_BYTES = LIMITS.driveServerFallbackMaxBytes;
const HOSTS_OK = new Set(['drive.google.com', 'drive.usercontent.google.com', 'docs.google.com']);
const SNIFF_BYTES = 3000;
const MAX_HTML_BYTES = 256 * 1024;

function erro(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

/** Mesma regra do `extractDriveFileIdFromText` (lib/clickup-client.ts). */
function extrairId(texto: string): string | null {
  const s = String(texto || '').trim();
  if (/^[a-zA-Z0-9_-]{20,60}$/.test(s)) return s;
  const pats = [
    /\/file\/d\/([a-zA-Z0-9_-]{20,60})/,
    /[?&]id=([a-zA-Z0-9_-]{20,60})/,
    /\/d\/([a-zA-Z0-9_-]{20,60})/,
  ];
  for (const re of pats) {
    const m = s.match(re);
    if (m) return m[1];
  }
  return null;
}

function hostPermitido(url: string): boolean {
  try {
    return HOSTS_OK.has(new URL(url).hostname.toLowerCase());
  } catch {
    return false;
  }
}

type Tentativa =
  | {
      tipo: 'arquivo';
      res: Response;
      head: Uint8Array;
      reader: ReadableStreamDefaultReader<Uint8Array>;
    }
  | { tipo: 'html'; confirm?: string; uuid?: string; login: boolean }
  | { tipo: 'erro'; mensagem: string; status: number }
  | { tipo: 'grande'; bytes: number };

async function tentar(url: string): Promise<Tentativa> {
  if (!hostPermitido(url)) return { tipo: 'erro', mensagem: 'Endereço não permitido.', status: 400 };
  let res: Response;
  try {
    res = await safeFetch(url, {
      cache: 'no-store',
      headers: { accept: '*/*', 'user-agent': 'Mozilla/5.0 (compatible; AutoEdit)' },
    });
  } catch (e) {
    if (e instanceof SsrfError) return { tipo: 'erro', mensagem: 'Endereço não permitido.', status: 400 };
    return { tipo: 'erro', mensagem: 'O Google Drive não respondeu agora.', status: 502 };
  }
  if (!res.ok) {
    try {
      await res.body?.cancel();
    } catch {
      /* nada */
    }
    return { tipo: 'erro', mensagem: `O Drive respondeu ${res.status}.`, status: res.status === 404 ? 404 : 502 };
  }

  // Teto ANTES de puxar qualquer byte (o header não mente pra mais).
  const declarado = parseInt(res.headers.get('content-length') || '', 10);
  const ct = (res.headers.get('content-type') || '').toLowerCase();
  const pareceHtml = ct.startsWith('text/html');
  if (!pareceHtml && Number.isFinite(declarado) && declarado > MAX_BYTES) {
    try {
      await res.body?.cancel();
    } catch {
      /* nada */
    }
    return { tipo: 'grande', bytes: declarado };
  }
  if (!res.body) return { tipo: 'erro', mensagem: 'O Drive respondeu sem conteúdo.', status: 502 };

  const reader = res.body.getReader();
  // Espia os primeiros bytes: página de confirmação vem como HTML.
  const pedacos: Uint8Array[] = [];
  let lidos = 0;
  const limiteEspiada = pareceHtml ? MAX_HTML_BYTES : SNIFF_BYTES;
  while (lidos < limiteEspiada) {
    const { done, value } = await reader.read();
    if (done) break;
    pedacos.push(value);
    lidos += value.byteLength;
  }
  const head = new Uint8Array(lidos);
  let off = 0;
  for (const p of pedacos) {
    head.set(p, off);
    off += p.byteLength;
  }
  const amostra = new TextDecoder().decode(head.subarray(0, Math.min(lidos, MAX_HTML_BYTES)));
  const ehHtml = pareceHtml || /<html|<!DOCTYPE/i.test(amostra.slice(0, SNIFF_BYTES));

  if (ehHtml) {
    // Puxa o resto da página (é pequena) pra achar confirm/uuid.
    let texto = amostra;
    if (texto.length < MAX_HTML_BYTES) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        texto += new TextDecoder().decode(value);
        if (texto.length > MAX_HTML_BYTES) break;
      }
    }
    try {
      await reader.cancel();
    } catch {
      /* nada */
    }
    const confirm = texto.match(/confirm=([0-9A-Za-z_-]+)/);
    const uuid = texto.match(/uuid=([0-9a-f-]+)/);
    const login = /sign in|signin|accounts\.google/i.test(texto.slice(0, 4000));
    return {
      tipo: 'html',
      confirm: confirm ? confirm[1] : undefined,
      uuid: uuid ? uuid[1] : undefined,
      login,
    };
  }

  return { tipo: 'arquivo', res, head, reader };
}

/** Junta a espiada + o resto do corpo, cortando se passar do teto. */
function repassar(head: Uint8Array, reader: ReadableStreamDefaultReader<Uint8Array>): ReadableStream<Uint8Array> {
  let enviados = head.byteLength;
  return new ReadableStream<Uint8Array>({
    start(controller) {
      if (head.byteLength > 0) controller.enqueue(head);
    },
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) {
        controller.close();
        return;
      }
      enviados += value.byteLength;
      if (enviados > MAX_BYTES) {
        try {
          await reader.cancel();
        } catch {
          /* nada */
        }
        controller.error(new Error('arquivo maior que o limite de 800 MB'));
        return;
      }
      controller.enqueue(value);
    },
    async cancel() {
      try {
        await reader.cancel();
      } catch {
        /* nada */
      }
    },
  });
}

export async function GET(req: Request) {
  const gate = await requireToolAccess('/tools/auto-cortes', 'basic');
  if (!gate.ok) return gate.response;

  const { searchParams } = new URL(req.url);
  const bruto = searchParams.get('id') || searchParams.get('url') || '';
  const fileId = extrairId(bruto);
  if (!fileId) {
    return erro('Não achei o arquivo nesse link do Drive. Use o link do ARQUIVO (…/file/d/…), não o da pasta.', 400);
  }

  const cadeia: string[] = [`https://drive.google.com/uc?export=download&id=${fileId}`];
  let usouConfirm = false;
  let houveLogin = false;

  for (let passo = 0; passo < 6; passo++) {
    const url = cadeia[cadeia.length - 1];
    const r = await tentar(url);

    if (r.tipo === 'grande') {
      return erro(
        `Esse arquivo tem ${Math.round(r.bytes / 1024 / 1024)} MB e por aqui eu só trago até 800 MB. Instale a extensão do navegador (passo 1 do Downloader) ou suba o arquivo direto.`,
        413,
      );
    }

    if (r.tipo === 'arquivo') {
      const nome = r.res.headers.get('content-disposition');
      const headers = new Headers();
      headers.set('content-type', r.res.headers.get('content-type') || 'application/octet-stream');
      const len = r.res.headers.get('content-length');
      if (len) headers.set('content-length', len);
      headers.set('content-disposition', nome || `attachment; filename="${fileId}.mp4"`);
      headers.set('cache-control', 'no-store');
      return new Response(repassar(r.head, r.reader), { status: 200, headers });
    }

    if (r.tipo === 'erro') {
      // 4xx/5xx no primeiro passo ainda pode ser resolvido pela próxima URL
      // da cadeia; no último, é o erro final.
      if (passo >= 3) return erro(r.mensagem, r.status);
    }

    if (r.tipo === 'html') {
      if (r.login) houveLogin = true;
      if (!usouConfirm && (r.confirm || r.uuid)) {
        usouConfirm = true;
        const params = new URLSearchParams({ id: fileId, export: 'download' });
        if (r.confirm) params.set('confirm', r.confirm);
        if (r.uuid) params.set('uuid', r.uuid);
        cadeia.push(`https://drive.usercontent.google.com/download?${params}`);
        continue;
      }
    }

    // Próxima estratégia da cadeia (mesma ordem da extensão).
    const proxima = [
      `https://drive.usercontent.google.com/download?id=${fileId}&export=download&authuser=0&confirm=t`,
      `https://drive.google.com/uc?export=download&id=${fileId}&confirm=t`,
      `https://drive.google.com/u/0/uc?id=${fileId}&export=download&confirm=t`,
    ].find((u) => !cadeia.includes(u));
    if (!proxima) break;
    cadeia.push(proxima);
  }

  if (houveLogin) {
    return erro('Arquivo privado — use a extensão ou suba o arquivo.', 403);
  }
  return erro(
    'Não consegui baixar esse arquivo do Drive. Confira se ele está compartilhado como "qualquer pessoa com o link" — ou use a extensão / suba o arquivo.',
    502,
  );
}
