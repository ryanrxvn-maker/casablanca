import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { checkpoint, validateRecord, isObject } from '@/lib/durable-records-core';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request) {
  const db = createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Entre na conta para recuperar seus registros.' }, { status: 401 });
  const url = new URL(req.url);
  const page = Number(url.searchParams.get('page') ?? 0);
  if (!Number.isInteger(page) || page < 0 || page > 10000) return NextResponse.json({ error: 'Página inválida.' }, { status: 400 });
  const { data, error } = await db.from('durable_records').select('*').eq('user_id', user.id)
    .order('kind').order('record_id').range(page * 100, page * 100 + 99);
  if (error) return NextResponse.json({ error: 'O armazenamento da conta está indisponível. Os registros locais foram preservados.' }, { status: 503 });
  return NextResponse.json({ userId: user.id, records: data, more: data.length === 100 }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(req: Request) {
  const db = createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Entre na conta para salvar os registros.' }, { status: 401 });
  const raw = await req.text();
  if (raw.length > 2_100_000) return NextResponse.json({ error: 'Registro muito grande.' }, { status: 413 });
  let body;
  try { body = JSON.parse(raw); } catch { return NextResponse.json({ error: 'Registro inválido.' }, { status: 400 }); }
  if (!isObject(body)) return NextResponse.json({ error: 'Registro inválido.' }, { status: 400 });
  const invalid = validateRecord(body.kind, body.id, body.data);
  if (invalid || typeof body.revision !== 'number' || !Number.isSafeInteger(body.revision) || body.revision < 0 ||
      typeof body.operationId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.operationId) || body.userId !== user.id) {
    return NextResponse.json({ error: invalid ?? 'Conta ou versão inválida.' }, { status: 400 });
  }
  const { data, error } = await db.rpc('save_durable_record', {
    p_kind: body.kind, p_id: body.id, p_payload: isObject(body.data) ? checkpoint(body.data) : null,
    p_revision: body.revision, p_operation: body.operationId,
  });
  if (error) return NextResponse.json({ error: 'Não foi possível confirmar o salvamento na conta. A cópia local foi mantida.' }, { status: 503 });
  return NextResponse.json(data, { status: data.conflict ? 409 : 200, headers: { 'Cache-Control': 'no-store' } });
}
