import { NextResponse } from 'next/server';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const runtime = 'nodejs';

/**
 * DEV-ONLY: recebe um canvas em data URL e grava o PNG em disco.
 *
 * Existe pra tirar o desenho de dentro do navegador e virar ARQUIVO — assim
 * da pra olhar a legenda/headline em tamanho de verdade, comparar com a
 * referencia e mandar pro Silas, em vez de descrever o que apareceu na tela.
 *
 * Fora do dev responde 404. O nome e higienizado e o arquivo so' cai em
 * `.preview-shots/` na raiz do projeto — nada de caminho vindo do cliente.
 */
export async function POST(req: Request) {
  if (process.env.NODE_ENV === 'production') {
    return new NextResponse('Not found', { status: 404 });
  }

  let corpo: { nome?: string; dataUrl?: string };
  try {
    corpo = (await req.json()) as { nome?: string; dataUrl?: string };
  } catch {
    return NextResponse.json({ error: 'json inválido' }, { status: 400 });
  }

  const dataUrl = corpo.dataUrl ?? '';
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!m) return NextResponse.json({ error: 'esperava um PNG em data URL' }, { status: 400 });

  // so' letras, numeros, hifen e underscore — nada de ../ nem barra
  const nome = (corpo.nome ?? 'shot').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 60) || 'shot';
  const dir = path.join(process.cwd(), '.preview-shots');
  await mkdir(dir, { recursive: true });
  const arquivo = path.join(dir, `${nome}.png`);
  await writeFile(arquivo, Buffer.from(m[1], 'base64'));

  return NextResponse.json({ ok: true, arquivo });
}
