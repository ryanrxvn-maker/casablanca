import { NextResponse } from 'next/server';
import { readFile, readdir, stat } from 'fs/promises';
import path from 'path';
import JSZip from 'jszip';
import { requireAdmin } from '@/app/api/admin/_helpers';

/**
 * GET /api/subtitle-remover-engine/installer
 *
 * Entrega o instalador do Smart Remover como ZIP de scripts ABERTOS
 * (.cmd + .ps1 + .py). Sem .exe = sem trigger de Avast/Defender.
 *
 * Conteúdo do ZIP (de engine/subtitle-remover-pkg/):
 *   - INSTALAR.cmd / Instalar.ps1
 *   - DESINSTALAR.cmd / Desinstalar.ps1
 *   - server.py
 *   - pipeline.py + sttn_engine.py + propainter_engine.py + ...
 *   - LEIA-ME.txt
 *
 * Pula arquivos pesados/binários do build process:
 *   - *.exe, *.7z, *.png (preview)
 *   - propainter/ e sttn/ (models — baixados sob demanda pelo Python)
 */

export const runtime = 'nodejs';
export const maxDuration = 30;

function pkgDir() {
  return path.join(process.cwd(), 'engine', 'subtitle-remover-pkg');
}

// arquivos que NÃO devem entrar no ZIP do user (são artefatos de build)
const SKIP_FILES = new Set<string>([
  'DarkoLab-SubtitleRemover-Installer.exe',
  'darko-content.7z',
  '_BUILD-INSTALLER.md',
  'darko-icon-preview.png',
  '.gitignore',
]);

// extensões a pular (binários grandes, vão ser baixados pelo Python)
const SKIP_EXT = new Set<string>(['.7z', '.zip']);

// subpastas pesadas (models pré-treinados — baixados sob demanda)
const SKIP_DIRS = new Set<string>(['propainter', 'sttn', '__pycache__']);

async function buildZip(): Promise<Buffer> {
  const dir = pkgDir();
  const zip = new JSZip();

  async function walk(rel: string): Promise<void> {
    const full = rel ? path.join(dir, rel) : dir;
    const entries = await readdir(full);
    for (const name of entries) {
      if (SKIP_FILES.has(name)) continue;
      const sub = rel ? path.posix.join(rel, name) : name;
      const fullSub = path.join(dir, sub);
      const s = await stat(fullSub);
      if (s.isDirectory()) {
        if (SKIP_DIRS.has(name)) continue;
        await walk(sub);
        continue;
      }
      if (!s.isFile()) continue;
      const ext = path.extname(name).toLowerCase();
      if (SKIP_EXT.has(ext)) continue;
      const buf = await readFile(fullSub);
      zip.file(sub, buf);
    }
  }

  await walk('');

  return zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
}

export async function GET() {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  try {
    const buf = await buildZip();
    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        'content-type': 'application/zip',
        'content-disposition': 'attachment; filename="AutoEditSmartRemover.zip"',
        'content-length': String(buf.byteLength),
        'cache-control': 'public, max-age=300',
      },
    });
  } catch (e) {
    return NextResponse.json(
      {
        error:
          'Instalador indisponivel. Verifique se engine/subtitle-remover-pkg/ tem os scripts.',
        detail: e instanceof Error ? e.message : String(e),
      },
      { status: 503 },
    );
  }
}
