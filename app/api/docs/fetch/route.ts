/**
 * Proxy READ-ONLY pra fetch de Google Docs (e similares) em texto puro.
 *
 * Estrategia: usa o endpoint publico /export?format=txt do Google Docs.
 * Funciona pra QUALQUER doc com sharing 'anyone with link can view' OU
 * publico. Para docs privados, falha com 401/403 (esperado — user precisa
 * compartilhar publicamente o doc do briefing pra ferramenta ler).
 *
 * REGRA: ZERO escrita. So GET. Nunca expor PUT/POST.
 *
 * GET /api/docs/fetch?url=https://docs.google.com/document/d/XXXX/edit
 * → { ok, status, text, title? }
 */
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 30;

function jsonError(message: string, status = 400, detail?: string) {
  return NextResponse.json(
    detail ? { error: message, detail: detail.slice(0, 500) } : { error: message },
    { status },
  );
}

/** Extrai docId de URLs tipo /document/d/<ID>/... */
function extractGoogleDocId(rawUrl: string): string | null {
  const m = rawUrl.match(/\/document\/d\/([a-zA-Z0-9_-]+)/);
  return m ? m[1] : null;
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const target = searchParams.get('url');
    if (!target) return jsonError('Falta query param ?url=');

    let parsed: URL;
    try { parsed = new URL(target); } catch { return jsonError('URL invalida.'); }

    // Suporta apenas Google Docs por ora (formato confiavel)
    const docId = parsed.host.endsWith('docs.google.com') ? extractGoogleDocId(parsed.pathname) : null;
    if (!docId) {
      return jsonError(
        'Apenas Google Docs suportado por enquanto. URL precisa ser docs.google.com/document/d/<ID>/...',
        400,
      );
    }

    const exportUrl = `https://docs.google.com/document/d/${docId}/export?format=txt`;
    const upstream = await fetch(exportUrl, { redirect: 'follow' });

    if (!upstream.ok) {
      // 401/403 = doc privado. 404 = nao existe.
      const txt = await upstream.text().catch(() => '');
      return NextResponse.json(
        {
          ok: false,
          status: upstream.status,
          error: upstream.status === 401 || upstream.status === 403
            ? 'Doc privado. Compartilhe como "Qualquer pessoa com o link pode visualizar" e tente novamente.'
            : `Falha (${upstream.status}): ${txt.slice(0, 200)}`,
        },
        { status: 200 }, // sempre 200 no nosso lado, status real no body
      );
    }

    const text = await upstream.text();
    // Tenta extrair titulo da primeira linha nao-vazia
    const lines = text.split(/\r?\n/);
    const title = lines.find((l) => l.trim().length > 0)?.trim().slice(0, 200) || null;

    return NextResponse.json({
      ok: true,
      status: 200,
      text,
      length: text.length,
      title,
      docId,
    });
  } catch (e) {
    return jsonError('Falha no fetch.', 500, (e as Error)?.message);
  }
}
