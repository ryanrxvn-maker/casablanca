/**
 * Publica engine/pkg.zip num GitHub Release (asset grande, ~380 MB).
 * RODE VOCE MESMO (usa sua credencial do GitHub, na sua maquina):
 *
 *   node engine/build.mjs && node engine/package.mjs
 *   node engine/publish-release.mjs
 *
 * Token: usa env GH_TOKEN / GITHUB_TOKEN se existir; senao tenta a
 * credencial cacheada do git (a mesma do `git push`).
 *
 * No fim, imprime a URL do .zip e a linha de env pra colar na Vercel:
 *   DOWNLOADER_ENGINE_URL=https://github.com/.../releases/download/...
 */
import { execFileSync, spawnSync } from 'child_process';
import { createReadStream, statSync, existsSync } from 'fs';
import https from 'https';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ZIP = path.join(here, 'pkg.zip');
const TAG = 'motor';
const ASSET = 'DarkoLab-Downloader-motor.zip';

if (!existsSync(ZIP)) {
  console.error(
    'engine/pkg.zip nao existe. Rode antes:\n  node engine/build.mjs && node engine/package.mjs',
  );
  process.exit(1);
}

// repo "owner/name" do remote origin
const remote = execFileSync('git', ['remote', 'get-url', 'origin'], {
  cwd: here,
  encoding: 'utf8',
}).trim();
const m = remote.match(/github\.com[:/]([^/]+)\/(.+?)(?:\.git)?$/i);
if (!m) {
  console.error('remote nao parece GitHub: ' + remote);
  process.exit(1);
}
const OWNER = m[1];
const REPO = m[2];

function getToken() {
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN;
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  // credencial cacheada do git (executada por VOCE, nesta maquina)
  const r = spawnSync('git', ['credential', 'fill'], {
    input: 'protocol=https\nhost=github.com\n\n',
    encoding: 'utf8',
  });
  const t = (r.stdout || '').match(/^password=(.+)$/m);
  return t ? t[1].trim() : null;
}

const TOKEN = getToken();
if (!TOKEN) {
  console.error(
    'Sem token. Defina GH_TOKEN=<seu PAT> e rode de novo:\n' +
      '  $env:GH_TOKEN="ghp_..."; node engine/publish-release.mjs',
  );
  process.exit(1);
}

function api(method, urlPath, body, host = 'api.github.com', extraHeaders) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = https.request(
      {
        host,
        path: urlPath,
        method,
        headers: {
          'user-agent': 'darko-publish',
          authorization: `Bearer ${TOKEN}`,
          accept: 'application/vnd.github+json',
          ...(data
            ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) }
            : {}),
          ...extraHeaders,
        },
      },
      (res) => {
        let b = '';
        res.on('data', (c) => (b += c));
        res.on('end', () =>
          resolve({ status: res.statusCode, json: b ? JSON.parse(b) : null }),
        );
      },
    );
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function uploadAsset(uploadUrlBase, relId, file) {
  return new Promise((resolve, reject) => {
    const size = statSync(file).size;
    const host = 'uploads.github.com';
    const p = `/repos/${OWNER}/${REPO}/releases/${relId}/assets?name=${ASSET}`;
    const req = https.request(
      {
        host,
        path: p,
        method: 'POST',
        headers: {
          'user-agent': 'darko-publish',
          authorization: `Bearer ${TOKEN}`,
          'content-type': 'application/zip',
          'content-length': size,
        },
      },
      (res) => {
        let b = '';
        res.on('data', (c) => (b += c));
        res.on('end', () =>
          resolve({ status: res.statusCode, json: b ? JSON.parse(b) : null }),
        );
      },
    );
    req.on('error', reject);
    createReadStream(file).pipe(req);
  });
}

(async () => {
  console.log(`Repo: ${OWNER}/${REPO}  | zip: ${(statSync(ZIP).size / 1048576).toFixed(0)} MB`);

  // release existente pela tag?
  let rel = await api(
    'GET',
    `/repos/${OWNER}/${REPO}/releases/tags/${TAG}`,
  );
  if (rel.status === 404) {
    console.log('criando release ' + TAG + '...');
    rel = await api('POST', `/repos/${OWNER}/${REPO}/releases`, {
      tag_name: TAG,
      name: 'DarkoLab Downloader — Motor',
      body: 'Motor local autocontido (Windows). Baixe, extraia, rode Instalar.ps1.',
    });
  }
  if (!rel.json || !rel.json.id) {
    console.error('falha no release:', rel.status, rel.json);
    process.exit(1);
  }
  const relId = rel.json.id;

  // remove asset antigo de mesmo nome
  for (const a of rel.json.assets || []) {
    if (a.name === ASSET) {
      console.log('removendo asset antigo...');
      await api('DELETE', `/repos/${OWNER}/${REPO}/releases/assets/${a.id}`);
    }
  }

  console.log('subindo ' + ASSET + ' (pode demorar bastante)...');
  const up = await uploadAsset(null, relId, ZIP);
  if (up.status >= 300 || !up.json || !up.json.browser_download_url) {
    console.error('falha no upload:', up.status, up.json);
    process.exit(1);
  }
  const url = up.json.browser_download_url;
  console.log('\n=========================================================');
  console.log(' MOTOR PUBLICADO:');
  console.log('   ' + url);
  console.log('');
  console.log(' Defina na Vercel (e local .env) e refaca o deploy:');
  console.log('   DOWNLOADER_ENGINE_URL=' + url);
  console.log('=========================================================\n');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
