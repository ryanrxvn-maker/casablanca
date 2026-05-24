/**
 * Monta o instalador EXE do Auto Edit Smart Remover.
 *
 * Mesma estratégia do package.mjs (Downloader):
 *   1) Cria pkg-remover.zip com tudo de engine/subtitle-remover-pkg/
 *      (Instalar.ps1, server.py, pipeline.py, modelos, etc)
 *      — pula .exe/.7z legados do build antigo (7zSFX).
 *   2) Compila Setup.cs com /define:REMOVER → AutoEditSmartRemoverSetup.exe
 *      (mesma UI WinForms violet/fuchsia do Downloader; só muda brand
 *      via #if REMOVER no Setup.cs)
 *   3) Assina com self-signed cert via sign-exe.ps1
 *
 * Rode:  node engine/package-remover.mjs
 */
import { execFileSync } from 'child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const here = path.dirname(fileURLToPath(import.meta.url));
const log = (s) => console.log('[remover-pkg] ' + s);

// ============================================================
// Arquivos do subtitle-remover-pkg/ a INCLUIR no zip.
// Pulamos artefatos do build antigo 7zSFX + caches.
// ============================================================
const PKG_DIR = path.join(here, 'subtitle-remover-pkg');
const SKIP_FILES = new Set([
  'DarkoLab-SubtitleRemover-Installer.exe',
  'darko-content.7z',
  'darko-icon-preview.png',
  '_BUILD-INSTALLER.md',
]);
const SKIP_EXT = new Set(['.7z', '.zip']);
const SKIP_DIRS = new Set(['__pycache__']);

async function main() {
  if (!existsSync(PKG_DIR)) {
    throw new Error('Pasta engine/subtitle-remover-pkg/ não existe.');
  }

  // ===== 1) Cria pkg-remover.zip =====
  const stagingDir = path.join(here, '.remover-staging');
  rmSync(stagingDir, { recursive: true, force: true });
  mkdirSync(stagingDir, { recursive: true });

  log('copiando arquivos pro staging...');
  function copyTree(srcRel) {
    const srcFull = srcRel ? path.join(PKG_DIR, srcRel) : PKG_DIR;
    for (const name of readdirSync(srcFull)) {
      if (SKIP_FILES.has(name)) continue;
      const sub = srcRel ? path.posix.join(srcRel, name) : name;
      const subFull = path.join(PKG_DIR, sub);
      const s = statSync(subFull);
      if (s.isDirectory()) {
        if (SKIP_DIRS.has(name)) continue;
        copyTree(sub);
        continue;
      }
      const ext = path.extname(name).toLowerCase();
      if (SKIP_EXT.has(ext)) continue;
      const dst = path.join(stagingDir, sub);
      mkdirSync(path.dirname(dst), { recursive: true });
      cpSync(subFull, dst);
    }
  }
  copyTree('');

  const zipOut = path.join(here, 'pkg-remover.zip');
  rmSync(zipOut, { force: true });
  log('compactando pkg-remover.zip...');
  execFileSync(
    'powershell',
    [
      '-NoProfile',
      '-Command',
      `Compress-Archive -Path '${stagingDir}\\*' -DestinationPath '${zipOut}' -Force`,
    ],
    { stdio: 'inherit' },
  );
  rmSync(stagingDir, { recursive: true, force: true });

  // ===== 2) Compila Setup.exe com /define:REMOVER =====
  const csc =
    'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe';
  if (!existsSync(csc)) {
    throw new Error('csc.exe não encontrado: ' + csc);
  }

  // Reusa ícone do downloader (mesmo coelho)
  const icoPath = path.join(here, 'installer', 'icon.ico');
  const rabbitPng = path.join(
    here,
    '..',
    'extension-downloader',
    'icons',
    'icon-128.png',
  );
  const manifestPath = path.join(
    here,
    'installer',
    'AutoEditDownloaderSetup.manifest',
  );

  const exeOut = path.join(here, 'AutoEditSmartRemoverSetup.exe');
  rmSync(exeOut, { force: true });
  log('compilando AutoEditSmartRemoverSetup.exe (csc.exe /define:REMOVER)...');
  execFileSync(
    csc,
    [
      '/nologo',
      '/target:winexe',
      '/platform:anycpu',
      '/define:REMOVER',
      `/win32icon:${icoPath}`,
      `/win32manifest:${manifestPath}`,
      `/resource:${zipOut},AutoEdit.pkg.zip`,
      `/resource:${icoPath},AutoEdit.icon.ico`,
      `/resource:${rabbitPng},AutoEdit.rabbit.png`,
      '/reference:System.dll',
      '/reference:System.Drawing.dll',
      '/reference:System.Windows.Forms.dll',
      '/reference:System.IO.Compression.dll',
      '/reference:System.IO.Compression.FileSystem.dll',
      `/out:${exeOut}`,
      path.join(here, 'installer', 'AssemblyInfo.cs'),
      path.join(here, 'installer', 'Setup.cs'),
    ],
    { stdio: 'inherit' },
  );

  // ===== 3) Assina (self-signed) =====
  const signScript = path.join(here, 'installer', 'sign-exe.ps1');
  log('assinando o .exe (self-signed cert)...');
  try {
    execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-ExecutionPolicy', 'Bypass',
        '-File', signScript,
        '-Exe', exeOut,
      ],
      { stdio: 'inherit' },
    );
  } catch (e) {
    log('AVISO: assinatura falhou: ' + e.message);
  }

  log('pronto:');
  log('  -> ' + exeOut);
  log('  -> ' + zipOut + '  (zip cru, fallback opcional)');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
