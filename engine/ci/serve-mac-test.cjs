/**
 * Servidor de apoio do teste do Motor macOS (roda no runner do GitHub).
 *
 * Faz o papel do site pro instalador, sem precisar de deploy:
 *   GET /api/downloader-engine/mac?part=server -> engine/dist/server.cjs
 *   GET /test.mp4                              -> ci-tmp/test.mp4
 *
 * O /test.mp4 existe pra o teste de download ser HERMETICO. Baixar do
 * YouTube aqui nao provaria nada: runner do GitHub sai por IP de datacenter,
 * e o YouTube bloqueia datacenter ("Sign in to confirm you're not a bot").
 * Uma falha dessas seria do IP, nao do port pro Mac. Servindo o video daqui,
 * o que o teste exercita e exatamente o que queremos provar: motor -> yt-dlp
 * -> ffmpeg -> stream HTTP de volta.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const PORT = Number(process.env.CI_SITE_PORT || 8099);

const server = http.createServer((req, res) => {
  const u = new URL(req.url || '/', `http://127.0.0.1:${PORT}`);

  if (u.pathname === '/api/downloader-engine/mac' && u.searchParams.get('part') === 'server') {
    const p = path.join(ROOT, 'engine', 'dist', 'server.cjs');
    if (!fs.existsSync(p)) {
      res.writeHead(503, { 'content-type': 'text/plain' });
      return res.end('server.cjs ausente — rode: node engine/build.mjs');
    }
    res.writeHead(200, {
      'content-type': 'application/javascript; charset=utf-8',
      'content-length': String(fs.statSync(p).size),
    });
    return fs.createReadStream(p).pipe(res);
  }

  if (u.pathname === '/test.mp4') {
    const p = path.join(ROOT, 'ci-tmp', 'test.mp4');
    if (!fs.existsSync(p)) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      return res.end('test.mp4 ainda nao gerado');
    }
    const size = fs.statSync(p).size;
    // content-type correto importa: e por ele que o extractor generico do
    // yt-dlp reconhece um link direto de midia.
    res.writeHead(200, {
      'content-type': 'video/mp4',
      'content-length': String(size),
      'accept-ranges': 'bytes',
    });
    return fs.createReadStream(p).pipe(res);
  }

  res.writeHead(404, { 'content-type': 'text/plain' });
  res.end('nao encontrado');
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[ci-site] ouvindo em http://127.0.0.1:${PORT}`);
});
