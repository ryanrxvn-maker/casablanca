import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * DEV-ONLY: recebe um PNG e grava em .dev-fp-audit/ — usado pela auditoria de
 * export do FakePass (/tools/fakepass/audit) pra salvar cada PNG exportado e
 * permitir inspeção visual. Inerte fora do dev local: exige NODE_ENV=development
 * E DEV_OPEN_TOOLS=1 no .env.local (em produção devolve 404).
 */
export async function POST(req: NextRequest) {
  if (process.env.NODE_ENV !== 'development' || process.env.DEV_OPEN_TOOLS !== '1') {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
  const name = (req.nextUrl.searchParams.get('name') || 'shot').replace(/[^a-z0-9_.-]/gi, '');
  const buf = Buffer.from(await req.arrayBuffer());
  const dir = path.join(process.cwd(), '.dev-fp-audit');
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `${name}.png`);
  await fs.writeFile(file, buf);
  return NextResponse.json({ ok: true, file, bytes: buf.length });
}
