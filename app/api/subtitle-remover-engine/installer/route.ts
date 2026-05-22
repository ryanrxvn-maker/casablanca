import { NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import path from 'path';
import { requireAdmin } from '@/app/api/admin/_helpers';

/**
 * GET /api/subtitle-remover-engine/installer
 *
 * Serve o instalador EXE self-extracting (7-Zip SFX, ~230 KB).
 * O usuario baixa, da duplo-clique, e o EXE se extrai num diretorio
 * temporario e roda INSTALAR.cmd automaticamente. Sem precisar
 * descompactar zip manualmente.
 *
 * Build: gerado via `copy /b 7z.sfx + sfx_config.txt + darko-content.7z`
 * (ver engine/subtitle-remover-pkg/_BUILD-INSTALLER.md).
 */

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function GET() {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  try {
    const exePath = path.join(
      process.cwd(),
      'engine',
      'subtitle-remover-pkg',
      'DarkoLab-SubtitleRemover-Installer.exe',
    );
    const bytes = await readFile(exePath);
    return new NextResponse(bytes, {
      status: 200,
      headers: {
        'content-type': 'application/octet-stream',
        'content-disposition':
          'attachment; filename="DarkoLab-SubtitleRemover-Installer.exe"',
        'content-length': String(bytes.length),
        'cache-control': 'public, max-age=3600',
      },
    });
  } catch (e) {
    return NextResponse.json(
      {
        error:
          'Instalador EXE indisponivel. Gere com 7-Zip SFX (ver _BUILD-INSTALLER.md).',
        detail: e instanceof Error ? e.message : String(e),
      },
      { status: 503 },
    );
  }
}
