import { NextResponse } from 'next/server';
import { readFile, readdir, stat } from 'fs/promises';
import path from 'path';
import JSZip from 'jszip';

/**
 * GET /api/downloader-engine/download
 *
 * Entrega o motor como ZIP de scripts ABERTOS (.cmd + .ps1).
 *
 * Mudança crítica vs versão anterior:
 *   - Antes: servia DarkoDownloaderSetup.exe (stub C# compilado).
 *     Defender/Avast flagueavam como SUSPEITO em 100% das máquinas.
 *   - Agora: zip plain text com INSTALAR.cmd + Instalar.ps1.
 *     Scripts abertos = zero pattern de malware = zero falso positivo.
 *
 * Conteúdo do ZIP (de engine/pkg/):
 *   - INSTALAR.cmd            (duplo-clique para instalar)
 *   - Instalar.ps1            (script de instalação)
 *   - DESINSTALAR.cmd
 *   - Desinstalar.ps1
 *   - AutoEditDownloader.cmd  (starter do motor)
 *   - server.cjs              (bundle do motor)
 *   - LEIA-ME.txt
 *
 * Como funciona pro usuário final:
 *   1. Baixa AutoEditDownloader.zip
 *   2. Extrai numa pasta
 *   3. Duplo-clique em INSTALAR.cmd (janela visível, sem flag de AV)
 *   4. PS1 baixa Node + Chromium + yt-dlp + ffmpeg na pasta LOCALAPPDATA
 *   5. Configura auto-start via Task Scheduler (NÃO via VBS+Startup)
 */

export const runtime = 'nodejs';
export const maxDuration = 30;

// pasta com os arquivos a empacotar
function pkgDir() {
  return path.join(process.cwd(), 'engine', 'pkg');
}

// nome interno do bundle de starter — vai como AutoEditDownloader.cmd
// mesmo que o arquivo fonte se chame DarkoDownloader.cmd (legado).
const STARTER_FILES_TO_RENAME: Record<string, string> = {
  'DarkoDownloader.cmd': 'AutoEditDownloader.cmd',
};

async function buildZip(): Promise<Buffer> {
  const dir = pkgDir();
  const entries = await readdir(dir);
  const zip = new JSZip();

  for (const name of entries) {
    const full = path.join(dir, name);
    const s = await stat(full);
    if (!s.isFile()) continue;
    const buf = await readFile(full);
    const target = STARTER_FILES_TO_RENAME[name] ?? name;
    zip.file(target, buf);
  }

  return zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
}

export async function GET() {
  try {
    const buf = await buildZip();
    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        'content-type': 'application/zip',
        'content-disposition': 'attachment; filename="AutoEditDownloader.zip"',
        'content-length': String(buf.byteLength),
        'cache-control': 'public, max-age=300',
      },
    });
  } catch (e) {
    return NextResponse.json(
      {
        error:
          'Instalador indisponivel. Verifique se a pasta engine/pkg/ existe e tem os scripts (INSTALAR.cmd, Instalar.ps1, server.cjs, etc).',
        detail: e instanceof Error ? e.message : String(e),
      },
      { status: 503 },
    );
  }
}
