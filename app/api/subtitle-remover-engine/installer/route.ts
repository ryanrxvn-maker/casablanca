import { NextResponse, type NextRequest } from 'next/server';
import { readFile } from 'fs/promises';
import path from 'path';
import JSZip from 'jszip';
import { requirePro } from '@/app/api/admin/_helpers';

/**
 * GET /api/subtitle-remover-engine/installer
 *
 * Entrega o Motor de Remocao de Legenda, empacotado de forma que o
 * Chrome NAO bloqueie por "Download suspeito" (SafeBrowsing flag em
 * .exe sem reputacao). Por padrao serve um .zip contendo o .exe +
 * LEIA-ME.txt — Chrome aceita zip sem fricao.
 *
 * Formatos suportados:
 *   default       → AutoEditSmartRemoverSetup.zip (exe + LEIA-ME dentro)
 *   ?format=exe   → .exe puro (escape hatch pra power users / IT)
 *   ?format=pkg   → pkg-remover.zip (scripts crus, fallback raro)
 *
 * Notas tecnicas:
 *  - .exe assinado com self-signed cert (CN=Auto Edit) + timestamp DigiCert
 *  - WinForms UI violet/fuchsia, sem CMD visivel, manifest XML asInvoker
 *  - Compilado de engine/installer/Setup.cs com /define:REMOVER
 *  - Pra eliminar TODA fricao no Windows tambem (SmartScreen) precisa
 *    Authenticode cert real (~$200/ano OV) ou EV cert (~$400/ano, zero
 *    warning). Roadmap.
 *
 * Build: node engine/package-remover.mjs
 */

export const runtime = 'nodejs';
export const maxDuration = 30;

type Format = 'zip-wrapped' | 'exe' | 'pkg';

function resolveFormat(p: string | null): Format {
  if (p === 'exe') return 'exe';
  if (p === 'pkg' || p === 'pkg-zip') return 'pkg';
  return 'zip-wrapped';
}

const LEIA_ME = `AUTO EDIT — Motor de Remocao de Legenda
========================================

INSTALACAO (2 passos, leva 10 segundos):

  1) Extraia este ZIP em qualquer pasta (clique direito → Extrair tudo).
  2) De duplo-clique em "AutoEditSmartRemoverSetup.exe".
     Aceite caso o Windows pergunte sobre permissoes.

Quando rodar pela 1a vez ele baixa o motor de IA (~500 MB, ~10-12 min)
e configura tudo automaticamente. Depois disso o motor inicia junto
com o Windows e voce nao precisa fazer mais nada.

Volte na pagina /tools/remover-elementos do Auto Edit — a caixa fica
verde sozinha, indicando que o motor esta online.

----

POR QUE VEM EMPACOTADO EM ZIP?
O Chrome bloqueia automaticamente .exe novos por baixa "reputacao
SmartScreen" — politica padrao desde 2023. ZIP nao tem esse bloqueio.
O arquivo dentro eh exatamente o mesmo .exe assinado.

QUALQUER PROBLEMA: contato@autoedit.com ou suporte no proprio app.
`;

export async function GET(req: NextRequest) {
  const guard = await requirePro();
  if (!guard.ok) return guard.response;

  const { searchParams } = new URL(req.url);
  const format = resolveFormat(searchParams.get('format'));

  try {
    if (format === 'exe') {
      // Power-user direct .exe (Chrome PODE bloquear).
      const exePath = path.join(process.cwd(), 'engine', 'AutoEditSmartRemoverSetup.exe');
      const bytes = await readFile(exePath);
      return new NextResponse(bytes as unknown as BodyInit, {
        status: 200,
        headers: {
          'content-type': 'application/octet-stream',
          'content-disposition': 'attachment; filename="AutoEditSmartRemoverSetup.exe"',
          'content-length': String(bytes.length),
          'cache-control': 'public, max-age=3600',
        },
      });
    }

    if (format === 'pkg') {
      // Scripts crus (sem .exe) — fallback se AV corporativo bloquear ate o .exe dentro do zip.
      const pkgPath = path.join(process.cwd(), 'engine', 'pkg-remover.zip');
      const bytes = await readFile(pkgPath);
      return new NextResponse(bytes as unknown as BodyInit, {
        status: 200,
        headers: {
          'content-type': 'application/zip',
          'content-disposition': 'attachment; filename="AutoEditSmartRemover-scripts.zip"',
          'content-length': String(bytes.length),
          'cache-control': 'public, max-age=3600',
        },
      });
    }

    // DEFAULT: zip-wrapped exe (Chrome-friendly). Wrap on-the-fly com JSZip.
    const exePath = path.join(process.cwd(), 'engine', 'AutoEditSmartRemoverSetup.exe');
    const exeBytes = await readFile(exePath);

    const zip = new JSZip();
    zip.file('AutoEditSmartRemoverSetup.exe', exeBytes, {
      binary: true,
      // Sem compressao no .exe — ja eh compacto (~230 KB) e descomprime instant.
      compression: 'STORE',
    });
    zip.file('LEIA-ME.txt', LEIA_ME);

    const zipBytes = await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 1 }, // rapido — exe ja nao comprime, LEIA-ME eh texto
    });

    return new NextResponse(zipBytes as unknown as BodyInit, {
      status: 200,
      headers: {
        'content-type': 'application/zip',
        'content-disposition': 'attachment; filename="AutoEditSmartRemoverSetup.zip"',
        'content-length': String(zipBytes.length),
        'cache-control': 'public, max-age=3600',
        'x-accel-buffering': 'no',
      },
    });
  } catch (e) {
    return NextResponse.json(
      {
        error: 'Instalador indisponivel. Gere com: node engine/package-remover.mjs',
        detail: e instanceof Error ? e.message : String(e),
      },
      { status: 503 },
    );
  }
}
