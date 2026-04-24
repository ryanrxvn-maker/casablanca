import { NextResponse } from 'next/server';

/**
 * POST /api/troca-produto/elevenlabs-delete
 *
 * Remove a voz clonada da biblioteca do ElevenLabs. Chamado pelo
 * front apos concluir a geracao do audio final, pra nao acumular
 * vozes temporarias na conta.
 *
 * JSON body: { voiceId: string }
 */

export const runtime = 'nodejs';
export const maxDuration = 30;

type Body = { voiceId: string };

export async function POST(req: Request) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: 'ELEVENLABS_API_KEY não configurada.' },
      { status: 500 },
    );
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'Body JSON inválido.' }, { status: 400 });
  }
  if (!body.voiceId) {
    return NextResponse.json({ error: 'voiceId ausente.' }, { status: 400 });
  }

  const res = await fetch(
    `https://api.elevenlabs.io/v1/voices/${encodeURIComponent(body.voiceId)}`,
    {
      method: 'DELETE',
      headers: { 'xi-api-key': apiKey },
    },
  );

  if (!res.ok) {
    const t = await res.text();
    return NextResponse.json(
      { error: 'Falha ao deletar voz.', detail: t.slice(0, 500) },
      { status: 502 },
    );
  }

  return NextResponse.json({ ok: true });
}
