import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/app/api/admin/_helpers';
import {
  processDownload,
  classify,
  type Mode,
  type Quality,
} from '@/lib/downloader-core';
import { createReadStream } from 'fs';
import { stat as statFs } from 'fs/promises';
import { Readable } from 'stream';

/**
 * POST /api/downloader — wrapper fino sobre lib/downloader-core.
 *
 * Toda a logica (YouTube/Instagram/TikTok/Pinterest/+18) vive no core,
 * compartilhado com o motor da extensao. Aqui so: validacao do gate
 * +18 (requireAdmin, Supabase) e serializacao da resposta HTTP.
 */

export const runtime = 'nodejs';
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  let body: {
    url?: string;
    mode?: Mode;
    quality?: Quality;
    adult?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'JSON invalido.' }, { status: 400 });
  }
  const url = (body.url ?? '').trim();
  const adult = body.adult === true;

  // Gate +18: SO admin autenticado. Usuario normal nao acessa nem
  // forjando o body — o gate roda ANTES do core.
  let host = '';
  try {
    host = new URL(url).hostname;
  } catch {
    /* core devolve 400 */
  }
  if (host && classify(host) === 'adult') {
    if (!adult)
      return NextResponse.json(
        { error: 'Conteudo +18: ative o modo +18 no Downloader.' },
        { status: 400 },
      );
    const guard = await requireAdmin();
    if (!guard.ok)
      return NextResponse.json(
        { error: 'Modo +18 restrito a administradores.' },
        { status: 403 },
      );
  }

  const result = await processDownload({
    url,
    mode: body.mode,
    quality: body.quality,
    adult,
  });

  if (!result.ok)
    return NextResponse.json(
      { error: result.error },
      { status: result.status },
    );

  const cd = `attachment; filename="${result.name.replace(/"/g, '')}"`;

  // TikTok video: streama direto do CDN (sem disco, latencia minima).
  if (result.kind === 'remote') {
    try {
      const upstream = await fetch(result.url, { headers: result.headers });
      if (!upstream.ok || !upstream.body) {
        await result.dispose();
        return NextResponse.json(
          { error: `Falha no CDN (HTTP ${upstream.status}).` },
          { status: 502 },
        );
      }
      result.dispose();
      return new NextResponse(upstream.body, {
        status: 200,
        headers: {
          'content-type': result.contentType,
          'content-disposition': cd,
          'cache-control': 'no-store',
        },
      });
    } catch (e) {
      await result.dispose();
      return NextResponse.json(
        { error: e instanceof Error ? e.message : 'Falha no CDN.' },
        { status: 502 },
      );
    }
  }

  // Arquivo em disco — STREAMING (não bufferiza em memória).
  // Vantagem: o cliente começa a receber bytes assim que o yt-dlp
  // termina a 1ª chunk; antes ele esperava o readFile completo
  // antes de QUALQUER byte chegar. Agora o browser/extensão recebe
  // content-length de cara e mostra % real desde o byte 0.
  try {
    const st = await statFs(result.filePath);
    const node = createReadStream(result.filePath);
    // converte Node Readable → Web ReadableStream
    const webStream = Readable.toWeb(node) as unknown as ReadableStream<Uint8Array>;

    // dispose quando o stream fechar (sucesso) ou der erro
    node.on('close', () => {
      void result.dispose();
    });
    node.on('error', () => {
      void result.dispose();
    });

    return new NextResponse(webStream, {
      status: 200,
      headers: {
        'content-type': result.contentType,
        'content-disposition': cd,
        'content-length': String(st.size),
        'cache-control': 'no-store',
        // Hint pro browser/proxy não bufferizar
        'x-accel-buffering': 'no',
      },
    });
  } catch (e) {
    await result.dispose();
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Falha lendo o arquivo.' },
      { status: 500 },
    );
  }
}
