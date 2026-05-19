/**
 * Monta engine/pkg/ — pacote AUTOCONTIDO do motor pra Windows:
 *   pkg/
 *     node.exe                (runtime, copiado do Node atual)
 *     server.cjs              (bundle do motor)
 *     node_modules/playwright (+ playwright-core, instalado limpo)
 *     ms-playwright/          (Chromium do Playwright)
 *     bin/yt-dlp.exe          (baixado do GitHub)
 *     bin/ffmpeg.exe          (baixado, build estatico)
 *     DarkoDownloader.cmd     (launcher: seta envs e roda o motor)
 *     Instalar.ps1 / Desinstalar.ps1
 *
 * Os binarios NAO vao pro git (sao baixados aqui). Rode:
 *   node engine/build.mjs && node engine/package.mjs
 */
import { build } from 'esbuild';
import { execFileSync, execSync } from 'child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  rmSync,
  statSync,
  writeFileSync,
  createWriteStream,
} from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import os from 'os';
import https from 'https';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const pkg = path.join(here, 'pkg');

function log(s) {
  console.log('[package] ' + s);
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const f = createWriteStream(dest);
    const get = (u) =>
      https
        .get(u, { headers: { 'user-agent': 'darko-pkg' } }, (r) => {
          if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location)
            return get(r.headers.location);
          if (r.statusCode !== 200)
            return reject(new Error(`HTTP ${r.statusCode} ${u}`));
          r.pipe(f);
          f.on('finish', () => f.close(() => resolve()));
        })
        .on('error', reject);
    get(url);
  });
}

async function main() {
  // 0) bundle atualizado
  log('bundle do motor...');
  await build({
    entryPoints: [path.join(here, 'server.ts')],
    bundle: true,
    platform: 'node',
    target: 'node18',
    format: 'cjs',
    outfile: path.join(here, 'dist', 'server.cjs'),
    external: ['playwright'],
    legalComments: 'none',
    logLevel: 'silent',
  });

  // 1) cria pkg/ (idempotente — NAO apaga binarios ja baixados)
  mkdirSync(path.join(pkg, 'bin'), { recursive: true });

  // 2) node.exe (runtime) — pula se ja presente (evita lock de unlink)
  const nodeDst = path.join(pkg, 'node.exe');
  if (existsSync(nodeDst) && statSync(nodeDst).size > 10_000_000) {
    log('node.exe ja presente — pulando');
  } else {
    log('copiando node.exe...');
    cpSync(process.execPath, nodeDst);
  }

  // 3) server.cjs (sempre atualiza)
  rmSync(path.join(pkg, 'server.cjs'), { force: true });
  cpSync(path.join(here, 'dist', 'server.cjs'), path.join(pkg, 'server.cjs'));

  // 4) playwright (modulo) instalado limpo dentro do pkg
  if (existsSync(path.join(pkg, 'node_modules', 'playwright'))) {
    log('playwright ja presente no pkg — pulando');
  } else {
    log('instalando playwright no pkg (pode demorar)...');
    writeFileSync(
      path.join(pkg, 'package.json'),
      JSON.stringify({ name: 'darko-engine-pkg', private: true }, null, 2),
    );
    execSync('npm install playwright@1.60.0 --omit=dev --no-audit --no-fund', {
      cwd: pkg,
      stdio: 'inherit',
    });
  }

  // 5) Chromium do Playwright -> ms-playwright/ (browsers path local)
  const browsers = path.join(pkg, 'ms-playwright');
  mkdirSync(browsers, { recursive: true });
  if (existsSync(path.join(browsers, 'chromium-1223'))) {
    log('Chromium ja presente no pkg — pulando');
  } else {
    log('instalando Chromium do Playwright no pkg...');
    execSync('npx playwright install chromium', {
      cwd: pkg,
      stdio: 'inherit',
      env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: browsers },
    });
  }

  // 6) yt-dlp.exe + ffmpeg.exe
  const ytExe = path.join(pkg, 'bin', 'yt-dlp.exe');
  if (existsSync(ytExe) && statSync(ytExe).size > 5_000_000) {
    log('yt-dlp.exe ja presente — pulando');
  } else {
    log('baixando yt-dlp.exe...');
    await download(
      'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe',
      ytExe,
    );
  }
  const ffExe = path.join(pkg, 'bin', 'ffmpeg.exe');
  if (existsSync(ffExe) && statSync(ffExe).size > 10_000_000) {
    log('ffmpeg.exe ja presente — pulando');
  } else {
    log('baixando ffmpeg.exe (build estatico)...');
    const ffZip = path.join(os.tmpdir(), 'ffmpeg-rel.zip');
    if (!existsSync(ffZip) || statSync(ffZip).size < 1_000_000) {
      await download(
        'https://github.com/GyanD/codexffmpeg/releases/download/7.1/ffmpeg-7.1-essentials_build.zip',
        ffZip,
      );
    }
    const ffDir = path.join(os.tmpdir(), 'ffmpeg-x');
    rmSync(ffDir, { recursive: true, force: true });
    // Expand-Archive (built-in, nao depende de assembly externa)
    execFileSync(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        `Expand-Archive -LiteralPath '${ffZip}' -DestinationPath '${ffDir}' -Force`,
      ],
      { stdio: 'inherit' },
    );
    // acha bin/ffmpeg.exe dentro do zip extraido e copia
    const found = execFileSync(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        `(Get-ChildItem -Recurse -Path '${ffDir}' -Filter ffmpeg.exe | Select-Object -First 1).FullName`,
      ],
      { encoding: 'utf8' },
    ).trim();
    if (!found) throw new Error('ffmpeg.exe nao encontrado no zip');
    cpSync(found, ffExe);
    rmSync(ffDir, { recursive: true, force: true });
  }

  // 7) launcher + instalador
  writeFileSync(
    path.join(pkg, 'DarkoDownloader.cmd'),
    [
      '@echo off',
      'setlocal',
      'set "HERE=%~dp0"',
      'set "YTDLP_PATH=%HERE%bin\\yt-dlp.exe"',
      'set "FFMPEG_PATH=%HERE%bin\\ffmpeg.exe"',
      'set "PLAYWRIGHT_BROWSERS_PATH=%HERE%ms-playwright"',
      'if not defined DARKO_ALLOW_ADULT set "DARKO_ALLOW_ADULT=1"',
      'echo [%DATE% %TIME%] start >> "%HERE%engine.log"',
      '"%HERE%node.exe" "%HERE%server.cjs" >> "%HERE%engine.log" 2>&1',
      'echo [%DATE% %TIME%] exit %ERRORLEVEL% >> "%HERE%engine.log"',
      '',
    ].join('\r\n'),
  );

  writeFileSync(
    path.join(pkg, 'Instalar.ps1'),
    INSTALAR_PS1.trim() + '\r\n',
  );
  writeFileSync(
    path.join(pkg, 'Desinstalar.ps1'),
    DESINSTALAR_PS1.trim() + '\r\n',
  );
  writeFileSync(path.join(pkg, 'LEIA-ME.txt'), LEIAME.trim() + '\r\n');

  log('pronto -> ' + pkg);
}

const INSTALAR_PS1 = `
# Instala o motor DarkoLab Downloader: copia pra LocalAppData,
# cria atalho na Inicializacao (auto-start), inicia e mostra o codigo.
$ErrorActionPreference = 'Stop'
$src = $PSScriptRoot
$dst = Join-Path $env:LOCALAPPDATA 'DarkoDownloaderApp'
Write-Host 'Instalando em' $dst
if (Test-Path $dst) { Remove-Item $dst -Recurse -Force }
Copy-Item $src $dst -Recurse -Force

# atalho na pasta Startup -> inicia junto com o Windows (sem janela)
$startup = [Environment]::GetFolderPath('Startup')
$vbs = Join-Path $dst 'run-hidden.vbs'
@'
Set s = CreateObject("WScript.Shell")
d = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
s.Run "cmd /c """ & d & "\\DarkoDownloader.cmd""", 0, False
'@ | Set-Content -Encoding ASCII $vbs
$ws = New-Object -ComObject WScript.Shell
$lnk = $ws.CreateShortcut((Join-Path $startup 'DarkoLab Downloader.lnk'))
$lnk.TargetPath = 'wscript.exe'
$lnk.Arguments = '"' + $vbs + '"'
$lnk.WorkingDirectory = $dst
$lnk.Save()

# inicia agora (oculto) e captura o codigo de pareamento
Start-Process wscript.exe -ArgumentList ('"' + $vbs + '"') -WindowStyle Hidden
$cfg = Join-Path $env:LOCALAPPDATA 'DarkoDownloader\\config.json'
for ($i=0; $i -lt 20 -and -not (Test-Path $cfg); $i++) { Start-Sleep 1 }
if (Test-Path $cfg) {
  $c = Get-Content $cfg -Raw | ConvertFrom-Json
  Write-Host ''
  Write-Host '====================================================='
  Write-Host ' DarkoLab Downloader instalado e rodando!'
  Write-Host ' Porta:' $c.port
  Write-Host ' CODIGO DE PAREAMENTO (cole na extensao do navegador):'
  Write-Host ''
  Write-Host ('   ' + $c.token)
  Write-Host ''
  Write-Host '====================================================='
  Set-Clipboard -Value $c.token
  Write-Host '(codigo copiado pra area de transferencia)'
} else {
  Write-Host 'Motor instalado, mas nao confirmei o start. Abra DarkoDownloader.cmd manualmente.'
}
`;

const DESINSTALAR_PS1 = `
$ErrorActionPreference = 'SilentlyContinue'
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -match 'server.cjs' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
$startup = [Environment]::GetFolderPath('Startup')
Remove-Item (Join-Path $startup 'DarkoLab Downloader.lnk') -Force
Remove-Item (Join-Path $env:LOCALAPPDATA 'DarkoDownloaderApp') -Recurse -Force
Write-Host 'Motor removido. (config/token em LOCALAPPDATA\\DarkoDownloader preservada)'
`;

const LEIAME = `
DarkoLab Downloader — Motor local
=================================
1) Clique direito em "Instalar.ps1" > Executar com PowerShell
   (instala, inicia junto com o Windows, e mostra/copia o CODIGO).
2) No navegador, instale a extensao "DarkoLab Downloader".
3) Abra a extensao > cole o CODIGO de pareamento > Parear.
4) Pronto: cole links e baixe. Funciona offline do servidor — roda no seu PC.

+18: defina a variavel DARKO_ALLOW_ADULT=1 antes de instalar
     (ou edite config.json: "allowAdult": true) e reinicie o motor.

Desinstalar: clique direito em "Desinstalar.ps1" > Executar com PowerShell.
`;

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
