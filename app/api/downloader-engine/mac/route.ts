import { NextResponse, type NextRequest } from 'next/server';
import { readFile } from 'fs/promises';
import path from 'path';

/**
 * GET /api/downloader-engine/mac
 *
 * Instalador do MOTOR para macOS — o equivalente do
 * AutoEditDownloaderSetup.exe do Windows.
 *
 *   GET /api/downloader-engine/mac              -> script de instalacao (sh)
 *   GET /api/downloader-engine/mac?part=server  -> bundle do motor (server.cjs)
 *
 * POR QUE text/plain E NAO UM DOWNLOAD:
 * o cliente instala colando UMA linha no Terminal:
 *
 *   curl -fsSL https://www.darkoautoedit.com/api/downloader-engine/mac | bash
 *
 * Isso existe por um motivo tecnico, nao por preguica de fazer .pkg: a flag
 * `com.apple.quarantine` — a que dispara o Gatekeeper "desenvolvedor nao
 * verificado" — quem poe e o NAVEGADOR, no arquivo baixado. O que o curl
 * baixa de dentro de um script rodando no Terminal nao recebe quarantine.
 * Entao esse caminho dispensa notarizacao, certificado Developer ID e a
 * conta Apple de US$99/ano — e e como Homebrew, nvm, rustup e Ollama
 * instalam. Um .pkg sem notarizar daria tela de bloqueio no cliente.
 *
 * SEM AUTENTICACAO, de proposito: o `curl` do Terminal nao tem cookie de
 * sessao. O middleware ja deixa passar (`/api/` nao redireciona pro /login,
 * e checkOrigin faz fail-open em GET sem Origin). O script so baixa
 * binarios publicos (Node oficial, yt-dlp, ffmpeg estatico) + este bundle;
 * nao carrega segredo nenhum. O gate de quem PODE baixar continua sendo a
 * pagina /tools/downloader, igual ao .exe.
 */

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const part = searchParams.get('part');

  // ── bundle do motor ────────────────────────────────────────────────
  if (part === 'server') {
    // Dois caminhos de proposito: `dist/` e a saida de `node engine/build.mjs`
    // (destravada no .gitignore justamente pra chegar no deploy), e `pkg/` e o
    // mesmo bundle que o instalador do Windows ja versionava. Se um faltar no
    // build da Vercel, o outro salva — o motor nunca fica indisponivel por
    // causa de arquivo nao commitado.
    const candidatos = [
      path.join(process.cwd(), 'engine', 'dist', 'server.cjs'),
      path.join(process.cwd(), 'engine', 'pkg', 'server.cjs'),
    ];
    for (const p of candidatos) {
      try {
        const buf = await readFile(p);
        return new NextResponse(buf, {
          status: 200,
          headers: {
            'content-type': 'application/javascript; charset=utf-8',
            'content-length': String(buf.length),
            'cache-control': 'public, max-age=300',
          },
        });
      } catch {
        /* tenta o proximo */
      }
    }
    console.error('[downloader-engine/mac] server.cjs ausente:', candidatos);
    return NextResponse.json(
      {
        error:
          'O motor nao esta disponivel no servidor agora. Tente de novo em alguns minutos.',
      },
      { status: 503 },
    );
  }

  // ── script de instalacao ───────────────────────────────────────────
  try {
    let sh = await readFile(
      path.join(process.cwd(), 'engine', 'install-mac.sh'),
      'utf8',
    );

    // O script precisa saber de onde baixar o bundle.
    //
    // A ORIGEM DA REQUISICAO VEM PRIMEIRO, de proposito: o cliente acabou de
    // baixar este script desse host, entao esse host comprovadamente
    // responde. NEXT_PUBLIC_SITE_URL fica so de reserva — quando ela lidera,
    // um valor velho/errado gera um instalador que aponta pro lugar errado e
    // morre no cliente (em dev isso ja aconteceu: a env dizia :3000 enquanto
    // o servidor subia na :50881).
    const proto = req.headers.get('x-forwarded-proto') || 'https';
    const host = req.headers.get('host');
    const site =
      (host ? `${proto}://${host}` : null) ||
      process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '') ||
      'https://www.darkoautoedit.com';
    sh = sh.replace(/__SITE__/g, site);

    // CRLF quebra shell script em TODA linha no macOS
    // ("bash: $'\r': command not found"). O .gitattributes ja trava LF no
    // repo; aqui e o cinto de seguranca pro caso de o arquivo chegar ao
    // deploy com CR (checkout no Windows, editor distraido).
    sh = sh.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    return new NextResponse(sh, {
      status: 200,
      headers: {
        // text/plain: o cliente le no navegador antes de rodar, se quiser.
        'content-type': 'text/plain; charset=utf-8',
        'cache-control': 'public, max-age=300',
      },
    });
  } catch (e) {
    console.error('[downloader-engine/mac] install-mac.sh ausente:', e);
    return new NextResponse(
      '#!/bin/bash\necho "O instalador do Mac nao esta disponivel agora. Tente de novo em alguns minutos."\nexit 1\n',
      { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8' } },
    );
  }
}
