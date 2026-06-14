/**
 * Avatar visual match via Claude vision (claude-haiku-4-5).
 *
 * Recebe uma imagem de referencia (do briefing — frame de video ou foto) +
 * lista de avatares HeyGen (id + thumb URL). Pergunta pro Claude qual avatar
 * e visualmente a mesma pessoa que a referencia.
 *
 * Util quando voice_name nao bate (avatar foi clonado mas voice_name esta
 * null) e nome fuzzy nao acha. Custo ~$0.005 por query.
 *
 * READ-ONLY: so le imagens. Nao altera nada no HeyGen ou Drive.
 */
import { NextResponse } from 'next/server';
import { getUserKey } from '@/lib/user-keys';
import { requireTier } from '@/lib/require-tier';
import { safeFetch } from '@/lib/safe-fetch';

export const runtime = 'nodejs';
export const maxDuration = 60;

type Candidate = { id: string; name: string; groupName?: string; thumbUrl: string };
type Body = {
  /** URL da imagem de referencia (do briefing — pode ser thumb do drive ou frame extraido) */
  referenceImageUrl: string;
  /** Avatares HeyGen pra comparar (limite 20 — cabe num prompt razoavel) */
  candidates: Candidate[];
};

function jsonError(message: string, status = 400, detail?: string) {
  return NextResponse.json(
    detail ? { error: message, detail: detail.slice(0, 500) } : { error: message },
    { status },
  );
}

/** Fetch image and convert to base64 + detect mime */
async function fetchImageBase64(url: string): Promise<{ data: string; mediaType: string } | null> {
  try {
    // safeFetch: segue redirect (Drive usa) mas revalida cada salto contra
    // destino interno (anti-SSRF). URL interna → SsrfError → cai no catch → null.
    const r = await safeFetch(url);
    if (!r.ok) return null;
    const ct = (r.headers.get('content-type') || 'image/jpeg').split(';')[0].trim();
    const buf = Buffer.from(await r.arrayBuffer());
    return { data: buf.toString('base64'), mediaType: ct };
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  try {
    const gate = await requireTier('pro');
    if (!gate.ok) return gate.response;
    const keyResult = await getUserKey('anthropic');
    if ('response' in keyResult) return keyResult.response;
    const apiKey = keyResult.key;

    const body = (await req.json().catch(() => null)) as Body | null;
    if (!body?.referenceImageUrl || !Array.isArray(body.candidates) || body.candidates.length === 0) {
      return jsonError('body precisa de {referenceImageUrl, candidates[]}.');
    }
    if (body.candidates.length > 20) {
      return jsonError('Max 20 candidates por chamada (cabe no prompt).');
    }

    // Fetch referencia
    const ref = await fetchImageBase64(body.referenceImageUrl);
    if (!ref) return jsonError('Falha ao fetch imagem de referencia.', 502);

    // Fetch candidatos em paralelo
    const candFetches = await Promise.all(body.candidates.map((c) => fetchImageBase64(c.thumbUrl).then((r) => ({ c, img: r }))));
    const validCands = candFetches.filter((x) => x.img !== null);
    if (validCands.length === 0) return jsonError('Nenhum thumb de candidato carregou.', 502);

    // Monta prompt vision
    const userContent: any[] = [
      { type: 'text', text: 'Imagem de REFERENCIA (pessoa do briefing):' },
      { type: 'image', source: { type: 'base64', media_type: ref.mediaType, data: ref.data } },
      { type: 'text', text: `\nAvatares HeyGen pra comparar (${validCands.length}):` },
    ];
    validCands.forEach((vc, i) => {
      userContent.push({ type: 'text', text: `\n[${i + 1}] ${vc.c.name}${vc.c.groupName ? ` (${vc.c.groupName})` : ''}:` });
      userContent.push({ type: 'image', source: { type: 'base64', media_type: vc.img!.mediaType, data: vc.img!.data } });
    });
    userContent.push({
      type: 'text',
      text: `\n\nQual desses avatares (1-${validCands.length}) e VISUALMENTE a MESMA PESSOA da referencia? Considera tracos faciais, idade, etnia, cabelo, etc — ignora qualidade da imagem, angulo, iluminacao, expressao.

Responde APENAS no formato JSON:
{"matchIndex": <numero 1-${validCands.length} OU 0 se nenhum>, "confidence": "alta|media|baixa", "reason": "explicacao curta"}`,
    });

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 500,
        messages: [{ role: 'user', content: userContent }],
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return jsonError('Claude API falhou.', 502, text);
    }

    const json = (await res.json().catch(() => null)) as { content?: Array<{ type: string; text?: string }>; usage?: any };
    const txt = json?.content?.find((b) => b.type === 'text')?.text || '';
    const m = txt.match(/\{[\s\S]*\}/);
    if (!m) return jsonError('Claude nao retornou JSON parseavel.', 502, txt.slice(0, 300));

    let parsed: { matchIndex: number; confidence: string; reason: string };
    try {
      parsed = JSON.parse(m[0]);
    } catch {
      return jsonError('JSON invalido na resposta.', 502, m[0]);
    }

    if (parsed.matchIndex === 0 || !validCands[parsed.matchIndex - 1]) {
      return NextResponse.json({
        ok: true,
        matched: null,
        confidence: parsed.confidence,
        reason: parsed.reason,
      });
    }

    const matched = validCands[parsed.matchIndex - 1].c;
    return NextResponse.json({
      ok: true,
      matched: { id: matched.id, name: matched.name, groupName: matched.groupName },
      confidence: parsed.confidence,
      reason: parsed.reason,
      usage: json?.usage,
    });
  } catch (e) {
    return jsonError('Falha no visual match.', 500, (e as Error)?.message);
  }
}
