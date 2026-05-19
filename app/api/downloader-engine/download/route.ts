import { NextResponse } from 'next/server';
import { createReadStream } from 'fs';
import { stat } from 'fs/promises';
import { Readable } from 'stream';
import path from 'path';

/**
 * GET /api/downloader-engine/download
 *
 * O motor empacotado tem ~380 MB — grande demais pra servir por uma
 * function serverless (Vercel limita resposta). Estrategia:
 *
 *  1) Se DOWNLOADER_ENGINE_URL estiver definida (ex.: um GitHub
 *     Release), redireciona pra la (funciona na Vercel e local).
 *  2) Senao, se engine/pkg.zip existir no disco (app rodando
 *     local/self-host), STREAMA do disco.
 *  3) Senao, devolve um .txt com instrucoes (nao um "download.json"
 *     quebrado) explicando como publicar/gerar.
 */

export const runtime = 'nodejs';
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

export async function GET() {
  const ext = process.env.DOWNLOADER_ENGINE_URL;
  if (ext && /^https?:\/\//i.test(ext)) {
    return NextResponse.redirect(ext, 302);
  }

  const zipPath = path.join(process.cwd(), 'engine', 'pkg.zip');
  try {
    const s = await stat(zipPath);
    if (!s.isFile() || s.size < 1000) throw new Error('zip invalido');
    const webStream = Readable.toWeb(
      createReadStream(zipPath),
    ) as unknown as ReadableStream;
    return new NextResponse(webStream, {
      status: 200,
      headers: {
        'content-type': 'application/zip',
        'content-disposition':
          'attachment; filename="DarkoLab-Downloader-motor.zip"',
        'content-length': String(s.size),
        'cache-control': 'no-store',
      },
    });
  } catch {
    const txt = [
      'DarkoLab Downloader — Motor (Windows)',
      '',
      'O motor (~380 MB) ainda nao esta publicado neste servidor.',
      '',
      'Para o dono do projeto disponibilizar:',
      '  1. Gere o pacote:  node engine/build.mjs && node engine/package.mjs',
      '  2. Publique no GitHub Releases:  node engine/publish-release.mjs',
      '     (ou suba engine/pkg.zip em qualquer hospedagem de arquivo)',
      '  3. Defina a env DOWNLOADER_ENGINE_URL com o link do .zip',
      '     e refaca o deploy. O botao passa a baixar de la.',
      '',
      'Rodando o DARKO local/self-host com engine/pkg.zip presente,',
      'este botao ja serve o arquivo direto do disco.',
      '',
    ].join('\n');
    return new NextResponse(txt, {
      status: 200,
      headers: {
        'content-type': 'text/plain; charset=utf-8',
        'content-disposition':
          'attachment; filename="MOTOR-como-obter.txt"',
        'cache-control': 'no-store',
      },
    });
  }
}
