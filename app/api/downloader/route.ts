import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/app/api/admin/_helpers';
import { createClient } from '@/lib/supabase/server';
import { assertPublicHttpUrl } from '@/lib/safe-fetch';
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
  // Exige sessão: /api/* fica fora do gate do middleware, então sem isto a rota
  // era chamável anonimamente (abuso de recurso). A página /tools/downloader já
  // é login-only, então usuário legítimo sempre traz o cookie de sessão.
  const {
    data: { user },
  } = await createClient().auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
  }

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

  if (!result.ok) {
    // Servidor sem yt-dlp (deploy serverless): quem baixa YouTube/Pinterest
    // e o MOTOR no computador do cliente. A resposta orienta o caminho que
    // resolve de verdade — nunca a mensagem tecnica interna.
    if (result.code === 'YTDLP_MISSING') {
      return NextResponse.json(
        {
          error:
            'Esse download é feito pelo Motor no seu computador. Instala e conecta o Motor + Extensão (passo 1 da página — leva 1 minuto) e clica em Baixar de novo.',
        },
        { status: 503 },
      );
    }
    return NextResponse.json(
      { error: result.error },
      { status: result.status },
    );
  }

  const cd = `attachment; filename="${result.name.replace(/"/g, '')}"`;

  // TikTok video: streama direto do CDN (sem disco, latencia minima).
  if (result.kind === 'remote') {
    try {
      // A URL vem da resposta do resolver (tikwm), não direto do usuário —
      // mas validamos contra destino interno (anti-SSRF de 2ª ordem) antes de
      // buscar/streamar de volta pro cliente.
      await assertPublicHttpUrl(result.url);
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
      console.error('[downloader] CDN stream', e);
      return NextResponse.json(
        { error: 'A fonte do vídeo falhou no meio do download. Tenta de novo em instantes.' },
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
    console.error('[downloader] file stream', e);
    return NextResponse.json(
      { error: 'Não consegui entregar o arquivo baixado. Tenta de novo em instantes.' },
      { status: 500 },
    );
  }
}
